import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { handleConfirmationButton } from '@/services/order-flow';
import { attachMediaToMessage } from '@/services/media';
import { describeIncoming } from '@/services/whatsapp-inbound';
import { registrarRespuestaEncuesta } from '@/services/encuestas';
import { pideRespuesta, pideNoRecibirMas } from '@/lib/pide-respuesta';
import { avisarFueraDeHorario } from '@/services/fuera-de-horario';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode      = searchParams.get('hub.mode');
  const token     = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!verifySignature(rawBody, req.headers.get('x-hub-signature-256'))) {
    console.warn('[Meta webhook] Firma inválida — evento rechazado');
    return new NextResponse('Invalid signature', { status: 401 });
  }

  // En Vercel la función se congela al responder: hay que procesar ANTES de
  // devolver el 200 (si no, los eventos se pierden). Meta tolera unos segundos.
  const body = JSON.parse(rawBody);
  try {
    await processMetaEvent(body);
  } catch (e) {
    console.error('[Meta webhook]', e);
  }
  return new NextResponse('EVENT_RECEIVED', { status: 200 });
}

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return false; // Fail closed: unsigned payloads must never change CRM data.

  if (!signatureHeader?.startsWith('sha256=')) return false;
  const received = signatureHeader.slice('sha256='.length);
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(received, 'hex'));
  } catch {
    return false;
  }
}

async function processMetaEvent(body: any) {
  if (body.object !== 'whatsapp_business_account' && body.object !== 'page' && body.object !== 'instagram') return;

  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;

      if (value?.messages) {
        // Con dos números en la misma WABA, Meta manda en `metadata.phone_number_id`
        // cuál de los dos recibió el mensaje. Sin esto, una clienta que le escribe
        // a las dos líneas terminaría con una sola conversación mezclada.
        const phoneNumberId = value.metadata?.phone_number_id as string | undefined;
        for (const message of value.messages) {
          // Los errores se registran: tragárselos en silencio fue lo que dejó
          // mensajes en "[Mensaje sin texto]" sin rastro de qué había pasado.
          await handleIncomingWhatsApp(message, value.contacts?.[0], phoneNumberId)
            .catch(e => console.error('[Meta webhook] Entrante de WhatsApp:', e));
        }
      }

      if (value?.statuses) {
        for (const status of value.statuses) {
          await handleMessageStatus(status)
            .catch(e => console.error('[Meta webhook] Estado de mensaje:', e));
        }
      }

      for (const messaging of entry.messaging || []) {
        if (messaging.message) {
          await handleIncomingInstagramFacebook(messaging, entry.id)
            .catch(e => console.error('[Meta webhook] Entrante de IG/Messenger:', e));
        }
      }
    }
  }
}

/**
 * Cae en caché por instancia: el número de la cuenta no cambia en caliente.
 *
 * Solo se guarda el acierto. Guardar también el «no existe» dejó 10
 * conversaciones sin línea el 10 de agosto: las instancias que venían vivas
 * desde antes de crear las dos líneas tenían apuntado que ese número no
 * existía, y siguieron atendiendo con ese dato viejo hasta que Vercel las
 * recicló. Las clientas escribieron y su conversación nació sin línea, así que
 * no le salía a ninguna agente —una de ellas había escrito «CONFIRMO»—.
 * Un fallo puntual de la base tendría el mismo efecto y duraría lo mismo.
 */
const cacheMetaAccount = new Map<string, string>();
async function metaAccountIdPorNumero(phoneNumberId?: string): Promise<string | null> {
  if (!phoneNumberId) return null;
  const enCache = cacheMetaAccount.get(phoneNumberId);
  if (enCache) return enCache;
  const cuenta = await prisma.metaAccount.findFirst({
    where: { channel: 'WHATSAPP', accountId: phoneNumberId },
    select: { id: true },
  });
  if (cuenta) cacheMetaAccount.set(phoneNumberId, cuenta.id);
  else console.error(`[Meta webhook] Llegó un mensaje por el número ${phoneNumberId}, que no está registrado como línea en el CRM.`);
  return cuenta?.id ?? null;
}

async function handleIncomingWhatsApp(message: any, contact: any, phoneNumberId?: string) {
  /**
   * Quién escribió.
   *
   * Meta manda dos identificadores y no siempre los dos:
   *   · `from`         — el celular, «573145569714».
   *   · `from_user_id` — una identidad opaca, «CO.939818055836462».
   *
   * Las clientas que tienen el número oculto llegan SOLO con la identidad.
   * El código leía únicamente `from` y componía `+${message.from}`, que para
   * ellas daba la cadena «+undefined»; como el celular es la llave única de la
   * ficha, las 26 que escribieron así terminaron dentro de una sola clienta
   * llamada «.», con 69 mensajes de gente distinta revueltos en dos hilos.
   * Nadie podía contestarles: al intentarlo, WhatsApp devolvía «(#131009)
   * Parameter value is not valid», porque «+undefined» no es un número.
   */
  const waUserId: string | null = message.from_user_id ?? null;
  const celular: string | null = message.from ? `+${message.from}` : null;

  if (!celular && !waUserId) {
    // Sin ninguna de las dos no hay a quién atribuirle el mensaje. Se guarda
    // crudo en vez de inventar una ficha: al menos queda el rastro para ver qué
    // mandó Meta, que es justamente lo que faltó para entender este caso.
    await prisma.webhookEvent.create({
      data: {
        platform: 'META', eventType: 'whatsapp.sin_remitente', status: 'FAILED',
        payload: message, headers: {},
        error: 'El mensaje entrante no traía ni `from` ni `from_user_id`',
      },
    }).catch(() => {});
    console.error('[Meta webhook] Mensaje entrante sin remitente identificable');
    return;
  }

  // La llave de la ficha sigue siendo `phone` porque es única y la usa todo el
  // CRM. Cuando no hay celular se guarda ahí la identidad: no es un número,
  // pero identifica a UNA persona, que es lo que hacía falta para no juntarlas.
  const phone = celular ?? waUserId!;
  const info = describeIncoming(message);
  const { attachment } = info;
  let content = info.content;
  const metaAccountId = await metaAccountIdPorNumero(phoneNumberId);

  // Una reacción suelta no dice nada: se cita el mensaje al que responde.
  if (info.reactionTo) {
    const target = await prisma.message.findFirst({
      where: { externalId: info.reactionTo },
      select: { content: true },
    });
    if (target) {
      const cita = target.content.replace(/\s+/g, ' ').trim();
      content = `${content}: "${cita.slice(0, 60)}${cita.length > 60 ? '…' : ''}"`;
    }
  }

  // Lo que no se reconoce se guarda crudo: es la única forma de saber después
  // qué mandó la clienta, porque la Cloud API no deja releer el mensaje.
  if (!info.understood) {
    await prisma.webhookEvent.create({
      data: {
        platform: 'META',
        eventType: `whatsapp.${message.type ?? 'desconocido'}`,
        status: 'IGNORED',
        payload: message,
        headers: {},
        error: 'Tipo de mensaje entrante sin soporte en el CRM',
      },
    }).catch(e => console.error('[Meta webhook] No se pudo guardar el payload crudo:', e));
  }

  // Meta reintenta el webhook si no le respondemos rápido, y aquí se procesa
  // ANTES de contestar el 200 —hay que hacerlo, si no Vercel congela la función
  // y el evento se pierde—. Con la clienta que manda foto y el flujo que sale a
  // responder, la vuelta se pasa del plazo y Meta reenvía el MISMO mensaje.
  // Sin este corte se guardaba repetido —se vieron hasta 5 copias del mismo
  // wamid— y, peor, `handleConfirmationButton` se ejecutaba una vez por copia:
  // la clienta recibía el «Ya confirmamos tus datos» cuatro o cinco veces.
  // El wamid identifica el mensaje en WhatsApp, así que basta con haberlo visto.
  const yaProcesado = await prisma.message.findFirst({
    where: { externalId: message.id, direction: 'INBOUND' },
    select: { id: true },
  });
  if (yaProcesado) return;

  // Se busca por identidad y por celular: una misma clienta puede haber escrito
  // antes con el número visible y ahora con él oculto, o al revés.
  let customer = waUserId
    ? await prisma.customer.findFirst({ where: { OR: [{ waUserId }, { phone }] } })
    : await prisma.customer.findUnique({ where: { phone } });

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        phone, waUserId,
        name: contact?.profile?.name || 'Nuevo contacto',
        originChannel: 'WHATSAPP', status: 'NEW',
      },
    });
  } else if (waUserId && !customer.waUserId) {
    // Se anota la identidad en cuanto Meta la manda, aunque la clienta tenga
    // celular: si mañana lo oculta, seguimos sabiendo que es la misma.
    // Si otra ficha ya la tiene, el índice único lo impide y se sigue igual:
    // perder la anotación no es motivo para descartar el mensaje.
    await prisma.customer.update({ where: { id: customer.id }, data: { waUserId } })
      .catch(() => {});
  }

  /**
   * ¿Es la respuesta a la encuesta de satisfacción?
   *
   * Va AQUÍ, antes de tocar la conversación y antes de guardar el mensaje, y
   * ese sitio es el módulo entero: si se guardara, la agente vería en su
   * bandeja la nota que le pusieron —y la conversación se reabriría por una
   * calificación, que no es algo que haya que atender—.
   *
   * Solo se retira cuando está seguro. Si el mensaje no encaja con una encuesta
   * recién enviada, `registrarRespuestaEncuesta` devuelve false y esto sigue su
   * camino de siempre: ningún mensaje de la clienta se pierde por aquí.
   */
  const eraLaEncuesta = await registrarRespuestaEncuesta(customer.id, metaAccountId, message)
    .catch(e => { console.error('[Meta webhook] Encuesta:', e); return false; });
  if (eraLaEncuesta) return;

  /**
   * «No me escriban más» queda registrado al instante.
   *
   * El mensaje SÍ sigue su camino a la bandeja —la clienta puede estar pidiendo
   * la baja y reclamando algo a la vez, y perder eso sería peor—, pero la baja
   * se anota aquí para que ninguna campaña vuelva a escribirle, ni esta ni las
   * de dentro de un año.
   */
  if (pideNoRecibirMas(content)) {
    await prisma.bajaMarketing.upsert({
      where: { customerId: customer.id },
      create: { customerId: customer.id, motivo: content.slice(0, 200) },
      update: {},
    }).catch(e => console.error('[Meta webhook] No se pudo registrar la baja:', e));
  }

  // Se busca (y crea) POR LÍNEA: si la clienta le ha escrito tanto a atención
  // general como a postcompra, son dos hilos separados a propósito —cada
  // agente solo debe ver el suyo—, no uno mezclado.
  //
  // Se toma la última de esa línea SIN mirar si está resuelta, y si lo está se
  // reabre. Antes se pedía `status: { not: 'RESOLVED' }` y eso partía el hilo:
  // bastaba con que una agente cerrara la conversación y la clienta volviera a
  // escribir un minuto después para que naciera un chat nuevo y vacío. En
  // pantalla parecía que se hubiera borrado la conversación, y la agente
  // respondía sin ver lo que ya se había hablado. En el teléfono de la clienta
  // el hilo siempre es uno solo; aquí también debe serlo.
  let conversation = await prisma.conversation.findFirst({
    where: { customerId: customer.id, channel: 'WHATSAPP', metaAccountId },
    orderBy: { lastMessageAt: 'desc' },
  });

  if (!conversation) {
    // Si otro proceso la crea en el mismo instante, el índice único de la base
    // lo impide y aquí se recoge la suya en vez de fallar. Sin esto, dos
    // eventos simultáneos de la misma clienta abrían dos hilos.
    conversation = await prisma.conversation.create({
      data: {
        customerId: customer.id, channel: 'WHATSAPP', metaAccountId,
        status: 'OPEN', lastMessageAt: new Date(),
        sinResponder: pideRespuesta(info, content),
      },
    }).catch(async () => {
      const suya = await prisma.conversation.findFirst({
        where: { customerId: customer.id, channel: 'WHATSAPP', metaAccountId },
        orderBy: { lastMessageAt: 'desc' },
      });
      if (!suya) throw new Error('No se pudo abrir la conversación de la clienta');
      return suya;
    });
  } else {
    conversation = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        isRead: false,
        /**
         * Queda pendiente de una persona si lo que escribió pide respuesta.
         *
         * Solo se enciende, nunca se apaga aquí: si ya estaba pendiente por un
         * mensaje anterior sin contestar, un «gracias» posterior no lo borra.
         * Lo apaga la agente al responder, y nada más.
         */
        ...(pideRespuesta(info, content) && { sinResponder: true }),
        // Vuelve a la bandeja: si estaba resuelta y la clienta escribió otra
        // vez, es que el asunto no estaba cerrado.
        ...(conversation.status === 'RESOLVED' && { status: 'OPEN' as const }),
      },
    });
  }

  const stored = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'INBOUND',
      content,
      contentType: info.contentType,
      externalId: message.id,
      status: 'DELIVERED',
    },
  });

  /**
   * Segunda barrera contra el reenvío de Meta.
   *
   * El corte de arriba compara antes de insertar, y entre esas dos cosas cabe
   * una carrera: se vio el mismo mensaje entrando dos veces con 0,3 segundos de
   * diferencia, y las dos pasaron el control. Aquí, ya insertado, se mira si
   * alguien se adelantó; si es así, esta copia se retira y no dispara nada más
   * —el duplicado más caro no era la fila repetida, sino la respuesta
   * automática saliendo dos veces—.
   *
   * Solo se borra la fila que acaba de crear esta misma ejecución.
   *
   * El desempate mira el id cuando las dos copias caen en el MISMO instante.
   * Antes se comparaba con `lte` a secas y, con timestamps iguales, cada copia
   * veía a la otra como anterior: las dos se retiraban y el mensaje de la
   * clienta desaparecía entero, sin dejar rastro ni en la bandeja ni en los
   * webhooks. Con el id como segundo criterio siempre sobrevive exactamente
   * una, porque el orden entre dos ids distintos nunca es recíproco.
   */
  const seAdelanto = await prisma.message.findFirst({
    where: {
      externalId: message.id, direction: 'INBOUND',
      id: { not: stored.id },
      OR: [
        { createdAt: { lt: stored.createdAt } },
        { createdAt: stored.createdAt, id: { lt: stored.id } },
      ],
    },
    select: { id: true },
  });
  if (seAdelanto) {
    await prisma.message.delete({ where: { id: stored.id } }).catch(() => {});
    return;
  }

  if (attachment) {
    const ok = await attachMediaToMessage(stored.id, attachment.mediaId, attachment.filename);
    // Si la descarga falla el mensaje queda con su etiqueta pero sin archivo, y
    // eso no se distingue de un adjunto normal en la bandeja: se deja dicho.
    if (!ok) {
      await prisma.message.update({
        where: { id: stored.id },
        data: { content: `${content} · ⚠️ no se pudo descargar el archivo` },
      });
    }
  }

  /**
   * Aquí NO se marca como leído.
   *
   * Se hacía al recibir, y eso le pintaba a la clienta los dos chulos azules
   * en el mismo instante en que escribía, sin que nadie hubiera abierto su
   * chat. Ella veía «leído» y sin respuesta, y se molestaba con razón.
   *
   * El acuse de lectura ahora sale cuando una agente abre la conversación de
   * verdad —en GET /api/conversations/[id]—. Hasta entonces la clienta ve los
   * dos chulos grises de «entregado», que es lo que de verdad ha pasado.
   */

  /**
   * Confirmación del pedido: por botón o escrita a mano.
   *
   * Antes solo se atendía el botón (`info.quickReply`). Quien escribía
   * «CONFIRMO» —que son muchas: la plantilla vieja del sistema anterior pedía
   * justo eso, y otras simplemente lo teclean— caía en el vacío. El pedido se
   * quedaba sin confirmar y Mastershop terminaba cancelándolo por demora:
   * 516 pedidos cancelados en 14 días de clientas que sí habían confirmado.
   *
   * Para el texto libre el manejador exige la palabra «confirm…» completa; un
   * «sí» suelto no basta porque puede estar respondiendo a otra cosa.
   */
  const textoConfirmacion = info.quickReply ?? (info.contentType === 'text' ? content : null);
  if (textoConfirmacion) {
    await handleConfirmationButton(customer.id, textoConfirmacion, phoneNumberId, !!info.quickReply)
      .catch(e => console.error('[Meta webhook] Confirmación de pedido:', e));
  }

  /**
   * Fin de semana: «ahora no estamos atendiendo».
   *
   * Solo a lo que pide respuesta. Un «Sí, confirmo», un «gracias» o una
   * reacción no esperan a nadie, y contestarles con el horario sería ruido.
   */
  if (pideRespuesta(info, content)) {
    await avisarFueraDeHorario({ conversationId: conversation.id, customerId: customer.id, destino: phone, phoneNumberId })
      .catch(e => console.error('[Meta webhook] Aviso fuera de horario:', e));
  }
}

async function handleIncomingInstagramFacebook(messaging: any, pageId: string) {
  const senderId = messaging.sender.id;
  const content  = messaging.message?.text || '[Multimedia]';
  const channel  = pageId === process.env.META_INSTAGRAM_ACCOUNT_ID ? 'INSTAGRAM' : 'FACEBOOK';

  let customer = await prisma.customer.findFirst({ where: { phone: `ig_${senderId}` } });
  if (!customer) {
    customer = await prisma.customer.create({
      data: { phone: `ig_${senderId}`, name: `Usuario ${channel}`, originChannel: channel as any, status: 'NEW' },
    });
  }

  let conversation = await prisma.conversation.findFirst({
    where: { customerId: customer.id, channel: channel as any, status: { not: 'RESOLVED' } },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { customerId: customer.id, channel: channel as any, externalId: senderId, status: 'OPEN', lastMessageAt: new Date() },
    });
  }

  await prisma.message.create({
    data: { conversationId: conversation.id, direction: 'INBOUND', content, status: 'DELIVERED' },
  });
}

async function handleMessageStatus(status: any) {
  const map: Record<string, string> = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };
  const mapped = map[status.status];
  if (!mapped) return;

  // Cuando rechaza, Meta explica por qué —fuera de la ventana de 24 h, número
  // inexistente, plantilla pausada—. Ese motivo se descartaba: en la bandeja un
  // mensaje que nunca llegó se veía igual que uno entregado, y con 134 rechazos
  // al día no había forma de saber qué estaba pasando ni a quién le faltó su
  // mensaje. Se guarda tal cual lo manda Meta.
  const motivo = mapped === 'FAILED'
    ? (status.errors ?? [])
        .map((e: any) => [e.title, e.error_data?.details].filter(Boolean).join(' — '))
        .filter(Boolean)
        .join(' | ') || 'WhatsApp lo rechazó sin dar motivo'
    : null;

  await prisma.message.updateMany({
    where: { externalId: status.id },
    data: { status: mapped as any, ...(mapped === 'FAILED' && { errorMotivo: motivo }) },
  });
}
