import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyMediaToken } from '@/services/media';

export const dynamic = 'force-dynamic';

/**
 * Sirve el archivo de un mensaje. Las etiquetas <img>/<audio> no pueden mandar
 * cabecera Authorization, así que la autorización va en un token firmado y de
 * vida corta que emite el detalle de la conversación.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const token = new URL(req.url).searchParams.get('t');
  if (!verifyMediaToken((await params).id, token)) {
    return new NextResponse('No autorizado', { status: 401 });
  }

  const media = await prisma.messageMedia.findUnique({ where: { messageId: (await params).id } });
  if (!media) return new NextResponse('No encontrado', { status: 404 });

  const completo = new Uint8Array(media.data);
  const disposition = media.filename
    ? `inline; filename="${encodeURIComponent(media.filename)}"`
    : 'inline';

  const comunes = {
    'Content-Type': media.mimeType,
    'Content-Disposition': disposition,
    // El token ya limita el acceso; el binario nunca cambia.
    'Cache-Control': 'private, max-age=21600',
    'Accept-Ranges': 'bytes',
  };

  /**
   * Entrega por tramos (HTTP Range).
   *
   * Sin esto no se puede adelantar ni retroceder una nota de voz: el navegador
   * pide un tramo, recibe el archivo entero con un 200 y se queda sin saber
   * dónde está. Con audio largo algunos navegadores directamente cortan.
   */
  const rango = req.headers.get('range');
  const m = rango?.match(/^bytes=(\d*)-(\d*)$/);
  if (m) {
    const total = completo.byteLength;
    const desde = m[1] ? Number(m[1]) : 0;
    const hasta = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1;

    if (desde >= total || desde > hasta) {
      return new NextResponse(null, {
        status: 416,
        headers: { ...comunes, 'Content-Range': `bytes */${total}` },
      });
    }

    const trozo = completo.subarray(desde, hasta + 1);
    return new NextResponse(trozo, {
      status: 206,
      headers: {
        ...comunes,
        'Content-Range': `bytes ${desde}-${hasta}/${total}`,
        'Content-Length': String(trozo.byteLength),
      },
    });
  }

  return new NextResponse(completo, {
    headers: { ...comunes, 'Content-Length': String(completo.byteLength) },
  });
}
