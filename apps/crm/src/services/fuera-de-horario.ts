import { prisma } from '@/lib/prisma';
import { sendWhatsAppMessage } from '@/services/whatsapp';
import { registrarSalienteEnLinea } from '@/services/linea-postcompra';

/**
 * Aviso de «no estamos atendiendo» del fin de semana.
 *
 * Desde el sábado a las 11:45 hasta el lunes a las 7:00, hora de Colombia, a
 * quien escribe le sale este mensaje. El sábado se atiende hasta las 12, pero
 * lo que entra en el último cuarto de hora ya no alcanza a contestarse.
 *
 * Una sola vez por conversación y fin de semana: la clienta que manda cinco
 * mensajes seguidos no recibe cinco avisos. Y como Meta reenvía el webhook
 * cuando tardamos, y la clienta que manda foto y texto a la vez dispara dos
 * webhooks en paralelo, «ya se lo mandamos» no puede ser una consulta seguida
 * de un envío —en esa rendija caben dos avisos—. Se reserva con una fila de
 * `cron_locks` con nombre único: quien la inserta manda, quien choca no.
 *
 * El aviso no apaga `sin_responder`: no es la respuesta de una persona, y su
 * pregunta tiene que seguir en la bandeja el lunes.
 *
 * Freno: `FUERA_DE_HORARIO_APAGADO=true` en Vercel.
 */
export const TEXTO_FUERA_DE_HORARIO =
  '¡Hola, hermosa! 💖 Gracias por comunicarte con Fem.\n' +
  'En este momento no contamos con atención al cliente, pero estaremos de vuelta en nuestro próximo horario hábil para ayudarte con mucho gusto. 🩷\n' +
  'Nuestros horarios de atención son:\n' +
  'Lunes a jueves: 7:00 a.m. a 4:00 p.m.\n' +
  'Viernes: 7:00 a.m. a 3:00 p.m.\n' +
  'Sábados: 8:00 a.m. a 12:00 p.m.\n' +
  'Domingos y días festivos: no contamos con atención. 🌸\n\n' +
  'Si deseas realizar tu compra mientras tanto, puedes hacerlo directamente en nuestra página web:\n' +
  'https://femprobiotics.co/ 🛍️✨\n\n' +
  'Déjanos tu mensajito y apenas retomemos nuestro horario te responderemos lo más pronto posible. 💕\n' +
  '¡Gracias por tu paciencia y comprensión!';

const COLOMBIA_MS = 5 * 3_600_000;
const DIA_MS = 86_400_000;

/**
 * Si `ahora` cae dentro del cierre del fin de semana, devuelve cuándo empezó
 * ese cierre (sábado 11:45) y cuándo termina (lunes 7:00), en UTC. Si no, null.
 */
export function cierreDeFinDeSemana(ahora = new Date()): { desde: Date; hasta: Date } | null {
  // Colombia no tiene horario de verano: UTC−5 todo el año.
  const col = new Date(ahora.getTime() - COLOMBIA_MS);
  const diaSemana = col.getUTCDay(); // 0 domingo … 6 sábado
  const minutos = col.getUTCHours() * 60 + col.getUTCMinutes();

  // Días desde el sábado de este cierre: 0 el sábado, 1 el domingo, 2 el lunes.
  let desdeSabado: number;
  if (diaSemana === 6 && minutos >= 11 * 60 + 45) desdeSabado = 0;
  else if (diaSemana === 0) desdeSabado = 1;
  else if (diaSemana === 1 && minutos < 7 * 60) desdeSabado = 2;
  else return null;

  const medianocheSabado = Date.UTC(col.getUTCFullYear(), col.getUTCMonth(), col.getUTCDate()) - desdeSabado * DIA_MS;
  return {
    desde: new Date(medianocheSabado + (11 * 60 + 45) * 60_000 + COLOMBIA_MS),
    hasta: new Date(medianocheSabado + 2 * DIA_MS + 7 * 3_600_000 + COLOMBIA_MS),
  };
}

export async function avisarFueraDeHorario(opts: {
  conversationId: string;
  customerId: string;
  destino: string;
  phoneNumberId?: string;
}): Promise<void> {
  if (process.env.FUERA_DE_HORARIO_APAGADO === 'true') return;

  const cierre = cierreDeFinDeSemana();
  if (!cierre) return;

  // La reserva: si la fila ya existe, otro webhook ya mandó (o está mandando)
  // el aviso de este fin de semana a esta conversación.
  const name = `fuera-de-horario:${opts.conversationId}:${cierre.desde.toISOString().slice(0, 10)}`;
  const reservado = await prisma.cronLock.create({ data: { name, lockedUntil: cierre.hasta } })
    .then(() => true, () => false);
  if (!reservado) return;

  let envio;
  try {
    envio = await sendWhatsAppMessage(opts.destino, TEXTO_FUERA_DE_HORARIO, undefined, opts.phoneNumberId);
  } catch (e) {
    // Si no salió, se suelta la reserva: que lo intente su próximo mensaje.
    await prisma.cronLock.delete({ where: { name } }).catch(() => {});
    throw e;
  }
  const wamid = envio?.messages?.[0]?.id as string | undefined;
  await registrarSalienteEnLinea(opts.customerId, opts.phoneNumberId, TEXTO_FUERA_DE_HORARIO, wamid);

  // Las reservas de fines de semana pasados ya no protegen nada.
  await prisma.cronLock.deleteMany({
    where: { name: { startsWith: 'fuera-de-horario:' }, lockedUntil: { lt: new Date() } },
  }).catch(() => {});
}
