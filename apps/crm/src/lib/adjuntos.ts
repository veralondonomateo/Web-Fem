/**
 * Qué archivos admite WhatsApp, y por qué.
 *
 * Vive aparte de `services/whatsapp` —que habla con la API de Meta y usa
 * credenciales— para que la bandeja pueda usar estas listas sin arrastrar
 * código de servidor al navegador.
 */

export type ClaseAdjunto = 'image' | 'video' | 'audio' | 'document';

/** Qué clase de adjunto es, según su tipo MIME. WhatsApp los manda distinto. */
export function claseDeAdjunto(mimeType: string): ClaseAdjunto {
  const m = mimeType.toLowerCase();
  if (m.startsWith('image/') && !m.includes('svg')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  return 'document';
}

/**
 * Los tipos que WhatsApp acepta de verdad, comprobados uno por uno contra la
 * API de Meta. No basta con «image/*» o «video/*»: la lista es cerrada y deja
 * fuera cosas muy comunes —HEIC, que es como el iPhone guarda las fotos, y
 * .mov, que es como graba los videos—.
 */
export const TIPOS_ADMITIDOS: Record<ClaseAdjunto, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/3gpp'],
  audio: ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/opus'],
  document: [
    'application/pdf', 'text/plain',
    'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
};

/**
 * Lo que se le pasa al `accept` del selector de archivos. El audio no va: las
 * notas de voz se graban con el micrófono, no se adjuntan.
 */
export const ACCEPT_ADJUNTOS = [
  ...TIPOS_ADMITIDOS.image, ...TIPOS_ADMITIDOS.video, ...TIPOS_ADMITIDOS.document,
].join(',');

/** Los casos que más se van a dar, con la salida concreta para la agente. */
const CONSEJOS: Record<string, string> = {
  'image/heic': 'Las fotos del iPhone vienen en HEIC y WhatsApp no las recibe. En el iPhone: Ajustes › Cámara › Formatos › «Más compatible», o comparte la foto desde el mismo teléfono.',
  'image/heif': 'Las fotos del iPhone vienen en HEIF y WhatsApp no las recibe. En el iPhone: Ajustes › Cámara › Formatos › «Más compatible».',
  'image/gif':  'WhatsApp no recibe GIF por este medio. Conviértelo a MP4 y se envía como video.',
  'video/quicktime': 'Los videos .mov del iPhone no los recibe WhatsApp. Conviértelo a MP4.',
  'video/x-msvideo': 'Los videos .avi no los recibe WhatsApp. Conviértelo a MP4.',
  'text/csv': 'WhatsApp no recibe .csv. Guárdalo como Excel (.xlsx) o como PDF.',
  'audio/webm': 'Ese audio está en WebM y WhatsApp no lo recibe.',
};

const ADMITIDOS_TODOS = ([] as string[]).concat(
  TIPOS_ADMITIDOS.image, TIPOS_ADMITIDOS.video, TIPOS_ADMITIDOS.audio, TIPOS_ADMITIDOS.document,
);

/**
 * Revisa si el archivo se puede mandar. Devuelve el motivo si no, o null si sí.
 *
 * Se comprueba en el servidor y no solo en el `accept` del selector, porque el
 * `accept` no aplica cuando se arrastra el archivo a la ventana.
 */
export function revisarTipoAdjunto(mime: string): string | null {
  const m = mime.toLowerCase().split(';')[0].trim();
  if (ADMITIDOS_TODOS.indexOf(m) !== -1) return null;
  return CONSEJOS[m]
    ?? `WhatsApp no acepta archivos de tipo «${m}». Se pueden enviar fotos JPG o PNG, videos MP4, PDF, Word y Excel.`;
}
