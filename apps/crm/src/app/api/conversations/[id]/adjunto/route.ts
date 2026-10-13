import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import {
  uploadWhatsAppMedia, sendWhatsAppAudio, sendWhatsAppMedia, claseDeAdjunto, revisarTipoAdjunto,
} from '@/services/whatsapp';
import { sePuedeEscribirPorWhatsApp } from '@/services/mastershop';
import { mediaLabel } from '@/services/media';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Manda un adjunto a la clienta: nota de voz, foto, video o documento.
 *
 * Va aparte de /messages porque el cuerpo es binario (multipart), no JSON, y
 * porque el archivo hay que subirlo a WhatsApp antes de poder mandarlo — no
 * acepta adjuntos por URL.
 *
 * El binario se guarda también en el CRM (message_media) para que la
 * conversación quede completa y se pueda volver a abrir desde la bandeja.
 */

/** WhatsApp admite hasta 100 MB en documentos, pero aquí el binario va en la
 *  base: por encima de 16 MB deja de ser razonable guardarlo en una fila. */
const MAX_BYTES = 16 * 1024 * 1024;


export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  if (user.role === 'ANALYST') return forbidden();

  const conversation = await prisma.conversation.findUnique({
    where: { id: (await params).id },
    include: { customer: true, metaAccount: { select: { accountId: true } } },
  });
  if (!conversation) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 });
  if (user.metaAccountId && conversation.metaAccountId !== user.metaAccountId) return forbidden();
  if (conversation.channel !== 'WHATSAPP') {
    return NextResponse.json({ error: 'Los adjuntos solo van por WhatsApp.' }, { status: 400 });
  }
  // El adjunto sube y se manda por la MISMA línea de la conversación: el media
  // id de WhatsApp solo sirve para el número que lo subió.
  const phoneNumberId = conversation.metaAccount?.accountId;
  if (!sePuedeEscribirPorWhatsApp(conversation.customer.phone)) {
    return NextResponse.json({ error: 'El celular de la clienta no es válido.' }, { status: 400 });
  }

  /**
   * La ventana de 24 h también vale para los adjuntos.
   *
   * Se cerró en el cuadro de texto y en el envío de plantillas, pero esta ruta
   * se quedó fuera y por ahí se coló una nota de voz el 15 de agosto: Meta la
   * rechazó con «Re-engagement message» y la agente la dio por enviada. Una
   * foto o un audio fuera de plazo rebotan igual que el texto —fuera de la
   * ventana solo entran plantillas, y un adjunto nunca lo es—.
   *
   * Se corta antes de leer el archivo: no tiene sentido subir 16 MB al
   * servidor para descubrir al final que Meta no lo va a aceptar.
   */
  const ultimaEntrante = await prisma.message.findFirst({
    where: { conversationId: (await params).id, direction: 'INBOUND' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const dentroDeVentana = ultimaEntrante &&
    Date.now() - ultimaEntrante.createdAt.getTime() < 24 * 3600_000;
  if (!dentroDeVentana) {
    return NextResponse.json({
      error: ultimaEntrante
        ? 'La clienta no escribe hace más de 24 horas, así que WhatsApp no deja mandarle archivos ni notas de voz. ' +
          'Escríbele con una plantilla aprobada y, cuando conteste, podrás enviarle lo que necesites.'
        : 'Esta clienta todavía no te ha escrito, así que WhatsApp no deja mandarle archivos ni notas de voz. ' +
          'El primer mensaje tiene que ser una plantilla aprobada.',
    }, { status: 409 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('archivo') ?? form?.get('audio');
  const caption = String(form?.get('caption') ?? '').trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Falta el archivo.' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'El archivo está vacío.' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'El archivo pesa más de 16 MB.' }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // El navegador manda "audio/webm;codecs=opus" y similares: WhatsApp quiere
  // el tipo a secas.
  const mime = (file.type || 'application/octet-stream').split(';')[0].trim();

  // Se revisa aquí y no solo en el selector porque el `accept` del navegador
  // no aplica cuando el archivo se arrastra a la ventana.
  const motivo = revisarTipoAdjunto(mime);
  if (motivo) return NextResponse.json({ error: motivo }, { status: 415 });

  const clase = claseDeAdjunto(mime);
  const nombre = file.name || `adjunto.${clase}`;
  const esNotaDeVoz = clase === 'audio' && form?.get('audio') !== null;

  let message = await prisma.message.create({
    data: {
      conversationId: (await params).id,
      direction: 'OUTBOUND',
      content: caption || (esNotaDeVoz ? '🎤 Nota de voz' : mediaLabel(clase as any, undefined, nombre)),
      contentType: clase,
      status: 'SENT',
      sentById: user.id,
      media: { create: { mimeType: mime, filename: nombre, size: bytes.length, data: bytes } },
    },
    include: { sentBy: { select: { id: true, name: true } } },
  });

  // El estado se decide más abajo, cuando se sepa si el adjunto salió: igual
  // que en la ruta de texto, responder cierra la conversación y un fallo la
  // deja abierta para que se vea que hay algo que arreglar.
  await prisma.conversation.update({
    where: { id: (await params).id },
    data: { lastMessageAt: new Date() },
  });

  try {
    const mediaId = await uploadWhatsAppMedia(bytes, mime, nombre, phoneNumberId);
    const result = esNotaDeVoz
      ? await sendWhatsAppAudio(conversation.customer.phone, mediaId, phoneNumberId)
      : await sendWhatsAppMedia(conversation.customer.phone, mediaId, clase, { caption, filename: nombre }, phoneNumberId);

    const wamid = result?.messages?.[0]?.id;
    if (wamid) {
      message = await prisma.message.update({
        where: { id: message.id },
        data: { externalId: wamid },
        include: { sentBy: { select: { id: true, name: true } } },
      });
    }
  } catch (e) {
    console.error('[Adjunto] Falló el envío:', e);
    message = await prisma.message.update({
      where: { id: message.id },
      data: { status: 'FAILED' },
      include: { sentBy: { select: { id: true, name: true } } },
    });
    await prisma.conversation.update({
      where: { id: (await params).id },
      data: { status: 'IN_PROGRESS', isRead: true, sinResponder: false },
    });
    return NextResponse.json(
      { ...message, sendError: e instanceof Error ? e.message : 'No se pudo enviar el adjunto' },
      { status: 502 },
    );
  }

  // Salió: la conversación queda atendida y se va de la bandeja. Vuelve sola
  // en cuanto la clienta escriba, que es lo que hace el webhook.
  await prisma.conversation.update({
    where: { id: (await params).id },
    data: { status: 'RESOLVED', isRead: true, sinResponder: false },
  });

  return NextResponse.json({ ...message, resuelta: true });
}
