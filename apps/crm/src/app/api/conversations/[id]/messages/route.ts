import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { sendWhatsAppMessage, sendWhatsAppTemplate, TemplateExtras } from '@/services/whatsapp';

/**
 * Esta ruta habla con Meta, y Meta a veces tarda. Sin declararlo se heredaba el
 * tope corto por defecto de la plataforma: la función moría a mitad, DESPUÉS de
 * que Meta hubiera aceptado el mensaje, y la respuesta nunca llegaba al
 * navegador. La agente veía «No enviado» en rojo, lo reescribía, y la clienta
 * recibía el mismo mensaje dos veces. La ruta de adjuntos ya declaraba 120 s;
 * esta se había quedado sin nada.
 */
export const maxDuration = 60;

/**
 * Completa lo que una plantilla exige más allá del cuerpo.
 *
 * Meta valida los componentes al enviar: si la plantilla se creó con cabecera
 * de imagen o con un botón de URL dinámica, el envío tiene que traerlos o
 * responde `132012 Parameter format does not match format in the created
 * template`. El CRM lo sabe porque el sync guarda `headerFormat` y
 * `hasUrlButton` de cada plantilla.
 */
async function extrasDePlantilla(
  template: { name: string; headerImageUrl?: string; urlButtonParam?: string },
): Promise<TemplateExtras> {
  const ficha = await prisma.messageTemplate.findFirst({
    where: { name: template.name },
    select: { headerFormat: true, hasUrlButton: true, status: true },
  });

  /**
   * Meta solo deja enviar plantillas APROBADAS. Una en revisión o rechazada
   * se rechaza con `(#132001) Template name does not exist in the translation`,
   * un mensaje que no dice nada y que hacía perder tiempo buscando un problema
   * de idioma que no existía: las 226 plantillas del CRM están en `es`.
   *
   * Pasó 12 veces entre el 11 y el 14 de agosto. El caso típico: se crea la
   * plantilla, aparece en el selector a los pocos minutos y la agente la manda
   * antes de que Meta la apruebe. Ella daba la conversación por contestada y la
   * clienta no recibía nada. Se corta aquí y se dice por qué.
   */
  if (!ficha) {
    throw new Error(
      `La plantilla «${template.name}» ya no está en el CRM. ` +
      'Sincroniza las plantillas desde Ajustes y vuelve a intentarlo.',
    );
  }
  if (ficha.status !== 'APPROVED') {
    throw new Error(
      ficha.status === 'REJECTED'
        ? `Meta rechazó la plantilla «${template.name}», así que no se puede enviar. Elige otra.`
        : `Meta todavía no aprueba la plantilla «${template.name}». ` +
          'Hasta que la apruebe no se puede enviar: elige otra o espera a que cambie de estado.',
    );
  }

  const extras: TemplateExtras = {};

  if (ficha.headerFormat === 'IMAGE') {
    // La única imagen de cabecera que usan hoy las plantillas es el testimonio.
    // Si algún día hay más, quien envía puede pasar la suya.
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? '';
    extras.headerImageUrl = template.headerImageUrl || `${base}/testimonio-carrito.jpg`;
  }

  if (ficha.hasUrlButton) {
    if (!template.urlButtonParam) {
      throw new Error(
        'Esta plantilla lleva un botón con enlace y hace falta el link de la clienta. ' +
        'Pégalo en el campo del enlace antes de enviarla.',
      );
    }
    // Se acepta el link completo o solo el token: lo que va después de /r/.
    extras.urlButtonParam = template.urlButtonParam.replace(/^.*\/r\//, '').trim();
  }

  return extras;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  if (user.role === 'ANALYST') return forbidden();

  const { content, contentType = 'text', isInternal = false, template, respondeA } = await req.json();
  // template opcional: { name, language?, params?[] } → se envía como plantilla real (válida fuera de la ventana de 24h)

  const conversation = await prisma.conversation.findUnique({
    where: { id: (await params).id },
    include: { customer: true, metaAccount: { select: { accountId: true } } },
  });
  if (!conversation) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 });
  if (user.metaAccountId && conversation.metaAccountId !== user.metaAccountId) return forbidden();
  // Se responde por la MISMA línea por la que llegó: si la clienta escribió a
  // postcompra, la respuesta no puede salir por el número de atención general.
  const phoneNumberId = conversation.metaAccount?.accountId;

  // Cuándo escribió ella por última vez: es lo que abre la ventana de 24 h.
  // Solo hace falta para el texto libre —las plantillas valen siempre—, así que
  // fuera de ese caso ni se pregunta.
  const necesitaVentana = !isInternal && conversation.channel === 'WHATSAPP' && !template?.name;

  /**
   * Guardar el mensaje, buscar el citado y mirar la ventana, a la vez: son
   * independientes, y cada ida y vuelta a la base son decenas de milisegundos
   * en una ruta que una agente usa cientos de veces al día.
   *
   * La conversación se actualiza al final, no aquí: su estado depende de si el
   * envío salió o no, y eso todavía no se sabe.
   */
  const [creado, citado, ultimaEntrante] = await Promise.all([
    prisma.message.create({
      data: {
        direction: 'OUTBOUND',
        content,
        contentType,
        isInternal,
        status: 'SENT',
        replyToId: typeof respondeA === 'string' && respondeA ? respondeA : null,
        sentById: user.id === 'demo' ? undefined : user.id,
        conversationId: (await params).id,
      },
      include: { sentBy: { select: { id: true, name: true } } },
    }),
    // Mensaje al que se responde. Se comprueba que sea de esta conversación:
    // Meta rechaza el envío entero si el wamid es de otro chat, y un id llegado
    // del navegador no es algo de lo que uno se pueda fiar.
    respondeA && typeof respondeA === 'string'
      ? prisma.message.findFirst({
          where: { id: respondeA, conversationId: (await params).id },
          select: { externalId: true },
        })
      : Promise.resolve(null),
    necesitaVentana
      ? prisma.message.findFirst({
          where: { conversationId: (await params).id, direction: 'INBOUND' },
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        })
      : Promise.resolve(null),
  ]);

  let message = creado;
  const citaWamid = citado?.externalId ?? undefined;

  let sendError: string | null = null;
  if (!isInternal && conversation.channel === 'WHATSAPP') {
    try {
      /**
       * A dónde va el mensaje.
       *
       * El celular manda siempre que exista: muchas clientas tienen celular Y
       * identidad de Meta, y preferir la identidad dejó una vez sin mensajes a
       * 544 que sí tenían número.
       *
       * Cuando NO hay celular —la clienta oculta su número y Meta solo nos da
       * su identidad, «CO.834743372999542»— ya no se bloquea. Antes sí, y era
       * correcto entonces: mandarla en `to` devuelve «(#131009) Parameter value
       * is not valid». Lo que faltaba era el campo: va en `recipient`, no en
       * `to`, y de eso se encarga ahora `sendWhatsAppMessage`. Comprobado
       * contra la API el 31 de agosto de 2026.
       *
       * Lo que sí sigue en pie para ellas es la ventana de 24 h, que se
       * comprueba justo debajo igual que para todo el mundo.
       */
      /**
       * La ventana de servicio de WhatsApp: 24 h desde el último mensaje de la
       * clienta. Fuera de ella Meta solo acepta plantillas aprobadas, y el
       * texto libre rebota con «Re-engagement message».
       *
       * Pasó 21 veces con mensajes escritos por agentes entre el 11 y el 14 de
       * agosto: la bandeja los dejaba enviar, se veían como enviados y la
       * clienta nunca los recibió. Se corta antes de llamar a Meta y se explica
       * la salida, que es mandar una plantilla.
       */
      if (necesitaVentana) {
        const abierta = ultimaEntrante &&
          Date.now() - ultimaEntrante.createdAt.getTime() < 24 * 3600_000;
        if (!abierta) {
          throw new Error(
            ultimaEntrante
              ? 'La clienta no escribe hace más de 24 horas, así que WhatsApp no deja mandarle texto libre. ' +
                'Escríbele con una plantilla aprobada (escribe «/» en el cuadro de mensaje).'
              : 'Esta clienta todavía no te ha escrito, así que WhatsApp no deja mandarle texto libre. ' +
                'El primer mensaje tiene que ser una plantilla aprobada (escribe «/» en el cuadro de mensaje).',
          );
        }
      }

      const destinatario = conversation.customer.phone;
      const result = template?.name
        ? await sendWhatsAppTemplate(
            destinatario,
            template.name,
            template.language || 'es',
            template.params || [],
            await extrasDePlantilla(template),
            phoneNumberId,
          )
        : await sendWhatsAppMessage(destinatario, content, undefined, phoneNumberId, citaWamid);
      const wamid = result?.messages?.[0]?.id;
      if (wamid) {
        message = await prisma.message.update({
          where: { id: message.id },
          data: { externalId: wamid },
          include: { sentBy: { select: { id: true, name: true } } },
        });
      }
    } catch (e) {
      console.error('[Mensajes] Falló el envío por WhatsApp:', e);
      sendError = e instanceof Error ? e.message : 'No se pudo enviar por WhatsApp';
      message = await prisma.message.update({
        where: { id: message.id },
        data: { status: 'FAILED', errorMotivo: sendError },
        include: { sentBy: { select: { id: true, name: true } } },
      });
    }
  }

  /**
   * Responder cierra la conversación.
   *
   * La agente contesta y el chat sale de la bandeja solo, sin tener que
   * acordarse de marcarlo. Si la clienta vuelve a escribir, el webhook lo
   * reabre y lo deja sin leer, así que reaparece arriba en «sin responder».
   * Ese ida y vuelta es toda la gestión: responder y olvidarse.
   *
   * Dos excepciones, y las dos importan:
   *  · Si el envío falló, la conversación NO se cierra. Cerrarla la escondería
   *    justo cuando hay algo que arreglar, que es lo contrario de lo que hace
   *    falta; además se la vería en «No llegaron», que filtra por no resuelta.
   *  · Una nota interna tampoco cierra: no es una respuesta a la clienta.
   *
   * Los mensajes automáticos no pasan por aquí —van por `registrarSalienteEn-
   * Linea`, que solo toca `lastMessageAt`—, así que un flujo no puede cerrar
   * una conversación que la clienta dejó abierta.
   */
  const atendida = !isInternal && !sendError;
  await prisma.conversation.update({
    where: { id: (await params).id },
    data: {
      lastMessageAt: new Date(),
      status: atendida ? 'RESOLVED' : 'IN_PROGRESS',
      isRead: true,
      // Contestó una persona: eso, y solo eso, cierra el pendiente.
      sinResponder: false,
    },
  });

  return NextResponse.json({ ...message, sendError, resuelta: atendida });
}
