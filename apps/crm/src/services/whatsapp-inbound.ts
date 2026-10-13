import { mediaLabel, type MediaKind } from '@/services/media';

const MEDIA_KINDS: MediaKind[] = ['image', 'audio', 'video', 'document', 'sticker'];

export interface Incoming {
  content: string;
  contentType: string;
  attachment: { kind: MediaKind; mediaId: string; filename?: string } | null;
  /** Solo las respuestas rápidas de una plantilla ramifican el flujo de confirmación. */
  quickReply: string | null;
  /** wamid del mensaje al que reacciona, para poder citarlo. */
  reactionTo: string | null;
  /** false ⇒ se guarda el payload crudo para poder diagnosticarlo después. */
  understood: boolean;
}

/**
 * Traduce cualquier mensaje entrante de WhatsApp a algo legible en la bandeja.
 *
 * Antes solo se entendían texto, botones y los cinco tipos de adjunto: una
 * reacción, una ubicación o un contacto caían todos en "[Mensaje sin texto]"
 * y se perdía hasta el rastro de qué habían sido. Ahora cada tipo tiene su
 * lectura y lo que no se reconozca dice al menos de qué tipo era.
 */
export function describeIncoming(message: any): Incoming {
  const base = { attachment: null, quickReply: null, reactionTo: null, understood: true };

  // Respuestas rápidas de plantilla: llegan como 'button' o como 'interactive'.
  const quickReply: string | undefined =
    message.button?.text
    ?? message.interactive?.button_reply?.title
    ?? message.interactive?.list_reply?.title;
  if (quickReply) return { ...base, content: quickReply, contentType: 'text', quickReply };

  if (message.text?.body) return { ...base, content: message.text.body, contentType: 'text' };

  // Adjuntos: foto o audio, nota de voz, PDF… El binario se baja aparte.
  const kind = MEDIA_KINDS.find(k => message[k]?.id) as MediaKind | undefined;
  if (kind) {
    const node = message[kind];
    return {
      ...base,
      content: mediaLabel(kind, node.caption, node.filename),
      contentType: kind,
      attachment: { kind, mediaId: node.id as string, filename: node.filename as string | undefined },
    };
  }

  if (message.reaction) {
    const emoji = message.reaction.emoji;
    return {
      ...base,
      content: emoji ? `${emoji} Reaccionó a tu mensaje` : 'Quitó su reacción',
      contentType: 'reaction',
      reactionTo: message.reaction.message_id ?? null,
    };
  }

  if (message.location) {
    const { latitude, longitude, name, address } = message.location;
    const donde = [name, address].filter(Boolean).join(' — ');
    return {
      ...base,
      content: `📍 Ubicación${donde ? `: ${donde}` : ''}\nhttps://maps.google.com/?q=${latitude},${longitude}`,
      contentType: 'location',
    };
  }

  if (message.contacts?.length) {
    const fichas = message.contacts.map((c: any) => {
      const nombre = c.name?.formatted_name || 'Contacto';
      const tel = c.phones?.[0]?.phone;
      return tel ? `${nombre} — ${tel}` : nombre;
    });
    return { ...base, content: `👤 Contacto compartido: ${fichas.join(' · ')}`, contentType: 'contacts' };
  }

  if (message.order) {
    const n = message.order.product_items?.length ?? 0;
    const nota = message.order.text?.trim();
    return {
      ...base,
      content: `🛒 Pedido desde el catálogo (${n} producto${n === 1 ? '' : 's'})${nota ? `\n${nota}` : ''}`,
      contentType: 'order',
    };
  }

  if (message.interactive?.nfm_reply) {
    const nombre = message.interactive.nfm_reply.name;
    return {
      ...base,
      content: `📝 Respondió el formulario${nombre ? ` "${nombre}"` : ''}`,
      contentType: 'form',
    };
  }

  if (message.system?.body) return { ...base, content: `ℹ️ ${message.system.body}`, contentType: 'system' };

  // Meta avisa por aquí cuando no puede entregar el contenido (tipos de pago,
  // formatos nuevos…). El título trae la razón en claro.
  const error = message.errors?.[0];
  if (error) {
    return {
      ...base,
      content: `⚠️ ${error.title || 'WhatsApp no pudo entregar este mensaje'}`,
      contentType: 'unsupported',
      understood: false,
    };
  }

  return {
    ...base,
    content: `⚠️ Mensaje de tipo "${message.type ?? 'desconocido'}" que el CRM todavía no sabe mostrar`,
    contentType: message.type ?? 'unknown',
    understood: false,
  };
}
