import { esConfirmacion } from '@/services/order-flow';

/**
 * ¿Este mensaje de la clienta deja algo pendiente para una persona?
 *
 * Existe porque «sin responder» y «la última palabra fue suya» no son lo mismo,
 * y confundirlos rompe la bandeja por los dos lados.
 *
 * Contar solo el último mensaje escondía conversaciones: la clienta preguntaba,
 * un flujo automático le mandaba el aviso del envío, y su pregunta desaparecía
 * de la pestaña sin que nadie la hubiera leído. Pero contar TODO lo que ella
 * escribe la inunda: de las 5.348 conversaciones donde ella tuvo la última
 * palabra, 3.920 son «Sí, confirmo», 272 son «gracias» y 89 son reacciones.
 * Ninguna espera nada. Las que sí esperan: 1.067.
 *
 * Así que lo que se pregunta aquí no es quién habló último, sino si queda algo
 * por contestar.
 */
export function pideRespuesta(
  info: { contentType: string; quickReply: string | null; reactionTo: string | null },
  contenido: string,
): boolean {
  // Un ❤️ a nuestro mensaje no es una pregunta.
  if (info.reactionTo || info.contentType === 'reaction') return false;

  // Confirmar el pedido cierra su propio círculo: el flujo le contesta y sigue.
  if (esConfirmacion(contenido, !!info.quickReply)) return false;

  // «Gracias», «ok», «listo» — cortesía de cierre, no una petición.
  const t = contenido.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/^(gracias|muchas gracias|mil gracias|ok|okey|oki|listo|vale|dale|perfecto|bueno|excelente|gracias+|ok gracias|gracias hermosa)[\s.!]*$/.test(t)) return false;

  return true;
}

/**
 * ¿Está pidiendo que no le escriban más?
 *
 * Hace falta desde que hay campañas masivas: una baja que nadie registra
 * significa volver a escribirle a quien ya dijo que no, y eso es lo que
 * convierte una promo en un reporte de spam. Los reportes son lo que hunde la
 * calificación del número, así que respetarlas protege el negocio además de a
 * la clienta.
 *
 * Deliberadamente conservador: da de baja con lo que es inequívoco. Un «no
 * gracias» suelto puede ser la respuesta a otra cosa, así que no cuenta — para
 * eso está la agente, que puede darla de baja a mano.
 */
export function pideNoRecibirMas(contenido: string): boolean {
  const t = contenido.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (t.length > 160) return false;

  // «STOP» a secas, que es lo que dice el pie de la plantilla promocional.
  if (/^(stop|baja|cancelar suscripcion de mensajes)[\s.!]*$/.test(t)) return true;

  return /(no me (escriban|escribas|manden|mande|envien|contacten|moleste)|dejen de (escribir|enviar|mandar)|deja de (escribirme|mandarme)|no quiero recibir (mas )?(mensajes|promo|publicidad)|elimina(r|me)? (mi )?(numero|telefono)|borren mi numero|quiten mi numero|dar de baja|darme de baja|no envien mas (publicidad|promo)|quitar de la lista)/.test(t);
}
