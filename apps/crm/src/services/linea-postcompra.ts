import { prisma } from '@/lib/prisma';

/**
 * A qué línea de WhatsApp sale cada mensaje automático, y cómo dejarlo por
 * escrito en la bandeja correcta.
 *
 * Hay dos números en la misma cuenta de Meta y cada uno tiene su oficio:
 *
 *   · El general atiende a quien escribe por primera vez, pregunta y hace
 *     pedidos.
 *   · El de postcompra lleva la confirmación del pedido, el seguimiento del
 *     envío y todo lo que viene después de comprar.
 *
 * Lo usan dos motores —el flujo de pedido y la recuperación de carritos— y
 * ambos necesitan lo mismo: mandar por el número que corresponde y que el
 * mensaje quede visible en la conversación de ESE número.
 */
export const LINEA_POSTCOMPRA = process.env.WHATSAPP_POSTCOMPRA_PHONE_NUMBER_ID;
export const LINEA_GENERAL    = process.env.WHATSAPP_PHONE_NUMBER_ID;

/**
 * Por dónde salen los recordatorios de carrito abandonado: la línea general.
 *
 * Tiene nombre propio y no se usa `LINEA_GENERAL` directamente porque no es lo
 * mismo decir «la línea general» que decir «la línea por la que se recuperan
 * carritos». Quien abandonó un carrito no ha comprado todavía: su conversación
 * es de venta, y la contesta quien lleva la venta. Si mañana se decide moverla,
 * se cambia aquí y solo aquí.
 */
export const LINEA_CARRITOS = LINEA_GENERAL;

/**
 * Cuentas de Meta por phone_number_id. No cambian en caliente: se cachean.
 *
 * Solo el acierto, nunca el «no existe»: una instancia que preguntara antes de
 * que la línea estuviera creada —o durante un tropiezo de la base— se quedaría
 * con esa respuesta hasta que Vercel la reciclara, y todo lo que enviara en ese
 * rato caería en conversaciones sin línea, invisibles para las agentes.
 */
const cache = new Map<string, string>();

export async function idCuentaDeLinea(phoneNumberId?: string | null): Promise<string | null> {
  if (!phoneNumberId) return null;
  const yaEsta = cache.get(phoneNumberId);
  if (yaEsta) return yaEsta;
  const cuenta = await prisma.metaAccount.findFirst({
    where: { channel: 'WHATSAPP', accountId: phoneNumberId },
    select: { id: true },
  });
  if (cuenta) cache.set(phoneNumberId, cuenta.id);
  else console.error(`[Líneas] El número ${phoneNumberId} no está registrado como línea en el CRM.`);
  return cuenta?.id ?? null;
}

export const idCuentaPostcompra = () => idCuentaDeLinea(LINEA_POSTCOMPRA);

/**
 * Deja un mensaje saliente en la conversación que la clienta tiene con ESA
 * línea, creándola si no existe.
 *
 * Se busca la conversación de esa línea y no cualquiera abierta: la clienta
 * puede tener otra en curso con el otro número y son hilos separados a
 * propósito —cada agente ve solo el suyo—.
 */
export async function registrarSalienteEnLinea(
  customerId: string, phoneNumberId: string | null | undefined,
  texto: string, wamid?: string,
): Promise<void> {
  const metaAccountId = await idCuentaDeLinea(phoneNumberId);

  // La última de esa línea, resuelta o no. Si se exigiera «no resuelta» se
  // crearía un hilo nuevo cada vez que un flujo escribe después de que una
  // agente cerró la conversación, y la historia quedaría partida en pedazos.
  // No se reabre: un mensaje nuestro no es algo que la agente deba atender.
  // Si la clienta contesta, el webhook la reabre y ahí sí vuelve a la bandeja.
  let conversacion = await prisma.conversation.findFirst({
    where: { customerId, channel: 'WHATSAPP', metaAccountId },
    orderBy: { lastMessageAt: 'desc' },
  });
  if (!conversacion) {
    conversacion = await crearORecuperar(customerId, metaAccountId);
  }

  await prisma.message.create({
    data: {
      conversationId: conversacion.id,
      direction: 'OUTBOUND',
      content: texto,
      status: 'SENT',
      externalId: wamid ?? null,
    },
  });
  await prisma.conversation.update({
    where: { id: conversacion.id },
    data: { lastMessageAt: new Date() },
  });
}

/**
 * Crea la conversación, o recupera la que otro proceso acabó de crear.
 *
 * Buscar y luego crear deja una rendija: dos pasos del flujo que corren a la
 * vez para la misma clienta encuentran los dos que no existe y los dos la
 * crean. Pasaba de verdad —se vieron dos hilos separados por una décima de
 * segundo, con los mensajes repartidos entre ambos— y era la razón de que los
 * chats duplicados reaparecieran después de unirlos a mano.
 *
 * Ahora la base tiene un índice único por (clienta, canal, línea): quien llega
 * segundo choca contra él, y en vez de fallar recoge la que ganó la carrera.
 */
async function crearORecuperar(customerId: string, metaAccountId: string | null) {
  try {
    return await prisma.conversation.create({
      // `isRead: true` a propósito: la conversación nace de un mensaje NUESTRO,
      // no hay nada que la agente tenga que leer. Sin esto, cada envío
      // automático sumaba uno al contador de pendientes de la bandeja y el
      // número dejaba de significar nada —llegó a marcar 1.459 conversaciones
      // «sin leer» en las que la clienta jamás escribió—. Cuando ella
      // responda, el webhook la marca sin leer y ahí sí corresponde.
      data: {
        customerId, channel: 'WHATSAPP', metaAccountId,
        status: 'OPEN', lastMessageAt: new Date(), isRead: true,
      },
    });
  } catch (e) {
    const existente = await prisma.conversation.findFirst({
      where: { customerId, channel: 'WHATSAPP', metaAccountId },
      orderBy: { lastMessageAt: 'desc' },
    });
    if (existente) return existente;
    throw e;
  }
}

/**
 * El mismo registro, pero partiendo del nombre de una plantilla: se busca su
 * texto y se rellenan los {{1}}, {{2}}… para que en la bandeja se lea el
 * mensaje real y no un código.
 */
export async function registrarPlantillaEnLinea(
  customerId: string, phoneNumberId: string | null | undefined,
  nombrePlantilla: string, params: string[], wamid?: string,
  /**
   * Lo que va en el `{{1}}` de la URL del botón, si la plantilla lo lleva.
   *
   * Sin esto en la bandeja quedaba escrito el molde —
   * `https://checkoutfem.com/r/{{1}}`— y no el enlace que de verdad recibió la
   * clienta. Con los carritos importaba el doble: cuando se sospechó que el
   * link llevaba a un pedido distinto del que decía el mensaje, no había forma
   * de comprobar qué se había enviado a quién.
   */
  urlButtonParam?: string,
): Promise<void> {
  const tpl = await prisma.messageTemplate.findFirst({ where: { name: nombrePlantilla } });
  let texto = tpl?.content
    ? tpl.content.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? `{{${n}}}`)
    : `[Plantilla ${nombrePlantilla}]`;

  /**
   * El botón, escrito debajo del mensaje.
   *
   * En la bandeja solo quedaba el cuerpo, así que la agente leía «te regalamos
   * un recetario» y no veía ningún recetario por ningún lado: daba por hecho
   * que no se había enviado. La clienta sí lo recibía —el botón viaja en la
   * plantilla— pero desde el CRM no había forma de saberlo, ni de mandarle el
   * enlace a mano si preguntaba.
   */
  const botones = Array.isArray(tpl?.botones) ? (tpl.botones as { text?: string; url?: string }[]) : [];
  const conEnlace = botones.filter(b => b.url).map(b => {
    const url = urlButtonParam ? b.url!.replace('{{1}}', urlButtonParam) : b.url;
    return `🔗 ${b.text ?? 'Ver'}: ${url}`;
  });
  if (conEnlace.length) texto += `\n\n${conEnlace.join('\n')}`;
  await registrarSalienteEnLinea(customerId, phoneNumberId, texto, wamid);
}

// El flujo de pedido siempre va por postcompra, así que tiene sus atajos.
export const registrarSalientePostcompra = (customerId: string, texto: string, wamid?: string) =>
  registrarSalienteEnLinea(customerId, LINEA_POSTCOMPRA, texto, wamid);

export const registrarPlantillaPostcompra = (
  customerId: string, nombrePlantilla: string, params: string[], wamid?: string,
) => registrarPlantillaEnLinea(customerId, LINEA_POSTCOMPRA, nombrePlantilla, params, wamid);
