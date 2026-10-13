import { sessionSecret } from '@/lib/session-secret';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

const BASE_URL = 'https://graph.facebook.com/v23.0';

/** Tope por archivo. WhatsApp permite hasta 100 MB en documentos, pero guardar
 *  eso en una fila de Postgres es abuso: por encima del tope se deja el mensaje
 *  con su etiqueta y sin adjunto. */
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

export type MediaKind = 'image' | 'audio' | 'video' | 'document' | 'sticker';

const KIND_LABEL: Record<MediaKind, string> = {
  image:    '📷 Foto',
  audio:    '🎤 Nota de voz',
  video:    '🎬 Video',
  document: '📄 Documento',
  sticker:  '🌟 Sticker',
};

/** Etiqueta legible para el listado de conversaciones cuando no hay texto. */
export function mediaLabel(kind: MediaKind, caption?: string, filename?: string): string {
  if (caption?.trim()) return caption.trim();
  if (kind === 'document' && filename) return `📄 ${filename}`;
  return KIND_LABEL[kind];
}

/**
 * Descarga un archivo de WhatsApp. Son dos saltos: primero se pide la URL
 * temporal por el media ID, luego se baja el binario con el mismo token.
 */
export async function fetchWhatsAppMedia(
  mediaId: string,
): Promise<{ buffer: Buffer; mimeType: string; size: number } | null> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) {
    console.warn('[Media] Sin WHATSAPP_ACCESS_TOKEN — no se descarga');
    return null;
  }

  const metaRes = await fetch(`${BASE_URL}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!metaRes.ok) {
    console.error('[Media] No se pudo resolver el media', mediaId, metaRes.status);
    return null;
  }

  const meta = await metaRes.json();
  if (!meta.url) return null;

  if (meta.file_size && Number(meta.file_size) > MAX_MEDIA_BYTES) {
    console.warn(`[Media] ${mediaId} pesa ${meta.file_size} bytes — excede el tope`);
    return null;
  }

  // La URL de descarga también exige el token.
  const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
  if (!binRes.ok) {
    console.error('[Media] Falló la descarga de', mediaId, binRes.status);
    return null;
  }

  const buffer = Buffer.from(await binRes.arrayBuffer());
  if (buffer.byteLength > MAX_MEDIA_BYTES) return null;

  return {
    buffer,
    mimeType: meta.mime_type || binRes.headers.get('content-type') || 'application/octet-stream',
    size: buffer.byteLength,
  };
}

/** Baja el archivo y lo cuelga del mensaje. Nunca lanza: un adjunto que falla
 *  no puede tumbar el procesamiento del webhook. */
export async function attachMediaToMessage(
  messageId: string, mediaId: string, filename?: string,
): Promise<boolean> {
  try {
    const media = await fetchWhatsAppMedia(mediaId);
    if (!media) return false;

    await prisma.messageMedia.create({
      data: {
        messageId,
        mimeType: media.mimeType,
        filename: filename ?? null,
        size: media.size,
        data: media.buffer,
      },
    });
    return true;
  } catch (e) {
    console.error('[Media] No se pudo adjuntar', mediaId, e);
    return false;
  }
}

/**
 * Token corto firmado para servir el archivo a una etiqueta <img>/<audio>, que
 * no puede mandar cabecera Authorization. Vale 6 horas y solo para ese mensaje.
 */
/**
 * El vencimiento se redondea a ventanas fijas de 6 h.
 *
 * Antes se calculaba con la hora exacta, así que CADA llamada devolvía un token
 * distinto y, con él, una URL distinta para el mismo archivo. La bandeja
 * refresca la conversación cada 8 segundos: el `src` del <audio> cambiaba, el
 * navegador lo daba por otro archivo y volvía a empezar. Las notas de voz se
 * cortaban cada ocho segundos y parecía que el audio estuviera dañado.
 *
 * Redondeando, el mismo mensaje produce siempre la misma URL dentro de la
 * ventana, el reproductor no se entera de los refrescos y además el navegador
 * puede cachear el archivo de verdad.
 */
const VENTANA_TOKEN = 6 * 60 * 60;

export function signMediaToken(messageId: string): string {
  const exp = (Math.floor(Date.now() / 1000 / VENTANA_TOKEN) + 2) * VENTANA_TOKEN;
  const sig = crypto
    .createHmac('sha256', sessionSecret())
    .update(`${messageId}.${exp}`)
    .digest('base64url');
  return `${exp}.${sig}`;
}

export function verifyMediaToken(messageId: string, token: string | null): boolean {
  if (!token) return false;
  const [expRaw, sig] = token.split('.');
  const exp = Number(expRaw);
  if (!exp || !sig || exp < Math.floor(Date.now() / 1000)) return false;

  const expected = crypto
    .createHmac('sha256', sessionSecret())
    .update(`${messageId}.${exp}`)
    .digest('base64url');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  } catch {
    return false;
  }
}
