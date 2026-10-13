const BASE_URL = 'https://graph.facebook.com/v23.0';

/**
 * Tope para una llamada a Meta que manda un mensaje.
 *
 * Sin él, una llamada lenta se quedaba colgada hasta que Vercel mataba la
 * función entera, y ahí pasaba lo peor: Meta ya había aceptado el mensaje —la
 * clienta lo recibía— pero la respuesta nunca volvía al navegador y la agente
 * veía «No enviado» en rojo. Reescribía el mensaje y la clienta lo recibía dos
 * veces.
 *
 * Cortando nosotros a los 25 s el fallo es nuestro y sale por el `catch` de
 * siempre, con motivo guardado, antes de que la plataforma nos guillotine.
 */
const TIMEOUT_ENVIO_MS = 25_000;

/**
 * Con dos números en la misma WABA —el de atención general y el de
 * postcompra—, cada función de envío recibe de qué línea sale. El token es el
 * mismo para ambos (una sola app de Meta), así que solo cambia el id del
 * número; quien no lo pase usa la línea general por defecto, que es la que
 * existía antes de tener dos.
 */
function idDeLinea(phoneNumberId?: string): string | undefined {
  return phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
}

/**
 * A quién va el mensaje, en el campo que Meta espera según lo que tengamos.
 *
 * Las clientas que ocultan su número no llegan con celular sino con un
 * identificador de Meta —el BSUID, «CO.834743372999542»—, y ese NO va en `to`:
 * va en `recipient`. Mandarlo en `to` devuelve «(#131009) Parameter value is
 * not valid», que es exactamente lo que llevaba pasando: 63 respuestas de las
 * agentes rebotadas en 30 días y 145 clientas incontactables.
 *
 * Comprobado contra la API el 31 de agosto de 2026: el mismo identificador que
 * en `to` da error, en `recipient` devuelve 200 con su wamid.
 *
 * El celular manda siempre que exista. Muchas clientas tienen las dos cosas, y
 * preferir el identificador al número dejó una vez a 544 sin mensajes.
 */
export function esBsuid(destino: string): boolean {
  return /^[A-Z]{2}\.\d+$/.test(destino);
}

function destinatario(to: string): Record<string, string> {
  return esBsuid(to) ? { recipient: to } : { to };
}

/**
 * @param respuestaA wamid del mensaje al que se responde. WhatsApp lo muestra
 *   citado encima, igual que cuando una responde desde el teléfono.
 */
export async function sendWhatsAppMessage(
  to: string, body: string, templateName?: string, phoneNumberId?: string, respuestaA?: string,
) {
  const numeroId = idDeLinea(phoneNumberId);
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!numeroId || !token) {
    console.warn('[WhatsApp] No configurado — mensaje no enviado');
    return null;
  }

  const payload = {
    ...(templateName
      ? { messaging_product: 'whatsapp', ...destinatario(to), type: 'template', template: { name: templateName, language: { code: 'es' } } }
      : { messaging_product: 'whatsapp', ...destinatario(to), type: 'text', text: { body } }),
    // Solo si se está respondiendo a un mensaje concreto. Meta rechaza el
    // envío si el wamid no es de esta conversación, así que no se inventa.
    ...(respuestaA ? { context: { message_id: respuestaA } } : {}),
  };

  const res = await fetch(`${BASE_URL}/${numeroId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_ENVIO_MS),
  });

  const data = await res.json();

  if (!res.ok || data.error) {
    console.error('[WhatsApp] Error al enviar:', JSON.stringify(data.error || data));
    throw new Error(data.error?.message || `WhatsApp API respondió ${res.status}`);
  }

  return data;
}

/**
 * Manda un mensaje con lista de opciones (interactive/list).
 *
 * Se usa para la encuesta de satisfacción: la clienta toca y elige, sin
 * escribir nada. Solo funciona DENTRO de la ventana de 24 h —igual que el texto
 * libre—, así que quien llama tiene que haberla comprobado antes.
 *
 * Meta admite hasta 10 filas y devuelve el `id` de la elegida en el webhook,
 * que es lo que permite leer la respuesta sin adivinar por el texto.
 */
export async function sendWhatsAppInteractiveList(
  to: string,
  cuerpo: string,
  textoBoton: string,
  seccion: string,
  filas: { id: string; title: string; description?: string }[],
  phoneNumberId?: string,
) {
  const numeroId = idDeLinea(phoneNumberId);
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!numeroId || !token) {
    console.warn('[WhatsApp] No configurado — lista no enviada');
    return null;
  }

  const res = await fetch(`${BASE_URL}/${numeroId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      ...destinatario(to),
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: cuerpo },
        action: {
          // Meta corta el botón a 20 caracteres y rechaza el envío si se pasa.
          button: textoBoton.slice(0, 20),
          sections: [{
            title: seccion.slice(0, 24),
            rows: filas.slice(0, 10).map(f => ({
              id: f.id.slice(0, 200),
              title: f.title.slice(0, 24),
              ...(f.description ? { description: f.description.slice(0, 72) } : {}),
            })),
          }],
        },
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_ENVIO_MS),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    console.error('[WhatsApp] Error al enviar la lista:', JSON.stringify(data.error || data));
    throw new Error(data.error?.message || `WhatsApp API respondió ${res.status}`);
  }
  return data;
}

export interface TemplateExtras {
  /**
   * URL pública de la imagen de cabecera. Al ENVIAR, Meta no reutiliza el
   * handle con el que se creó la plantilla: hay que darle una imagen otra vez,
   * y por URL es lo más simple (la nuestra vive en /public del propio CRM).
   */
  headerImageUrl?: string;
  /**
   * Valor de {{1}} del botón de URL dinámica. Es solo el trozo variable —para
   * `https://checkoutfem.com/r/{{1}}`, el token que va después de /r/.
   */
  urlButtonParam?: string;
}

// Envía una plantilla APROBADA (type: template). Funciona fuera de la ventana de 24h,
// a diferencia del texto libre. bodyParams son los valores para {{1}}, {{2}}… en orden.
export async function sendWhatsAppTemplate(
  to: string, name: string, language: string, bodyParams: string[] = [], extras: TemplateExtras = {},
  phoneNumberId?: string,
) {
  const numeroId = idDeLinea(phoneNumberId);
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!numeroId || !token) {
    console.warn('[WhatsApp] No configurado — plantilla no enviada');
    return null;
  }

  const template: Record<string, unknown> = { name, language: { code: language || 'es' } };
  const components: Record<string, unknown>[] = [];

  if (extras.headerImageUrl) {
    components.push({
      type: 'header',
      parameters: [{ type: 'image', image: { link: extras.headerImageUrl } }],
    });
  }
  if (bodyParams.length) {
    components.push({ type: 'body', parameters: bodyParams.map(text => ({ type: 'text', text })) });
  }
  if (extras.urlButtonParam) {
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: extras.urlButtonParam }],
    });
  }
  if (components.length) template.components = components;

  const res = await fetch(`${BASE_URL}/${numeroId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...destinatario(to), type: 'template', template }),
    signal: AbortSignal.timeout(TIMEOUT_ENVIO_MS),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    console.error('[WhatsApp] Error al enviar plantilla:', JSON.stringify(data.error || data));
    throw new Error(data.error?.message || `WhatsApp API respondió ${res.status}`);
  }
  return data;
}

export interface MetaTemplate {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  components?: { type: string; text?: string }[];
}

export async function fetchMetaTemplates(): Promise<MetaTemplate[] | null> {
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!wabaId || !token) return null;

  const templates: MetaTemplate[] = [];
  let url = `${BASE_URL}/${wabaId}/message_templates?fields=name,status,category,language,components&limit=100`;

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok || data.error) {
      console.error('[WhatsApp] Error al listar plantillas:', JSON.stringify(data.error || data));
      throw new Error(data.error?.message || `WhatsApp API respondió ${res.status}`);
    }
    templates.push(...(data.data || []));
    url = data.paging?.next || '';
  }

  return templates;
}

export type BotonPlantilla =
  | { tipo: 'respuesta_rapida'; texto: string }
  /** Botón de enlace fijo — no dinámico. Para eso no hace falta {{1}}: la URL
   *  es siempre la misma (ej. el link a un PDF que vive en /public). */
  | { tipo: 'url'; texto: string; url: string };

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
  body: string;
  bodyExamples?: string[];
  header?: string;
  /**
   * Handle de la imagen de ejemplo para una cabecera de imagen (lo devuelve
   * `subirEjemploPlantilla`). Si viene, manda sobre `header`: una plantilla
   * tiene una sola cabecera.
   */
  headerImageHandle?: string;
  footer?: string;
  botones?: BotonPlantilla[];
}

/**
 * Sube la imagen de ejemplo que Meta exige para aprobar una plantilla con
 * cabecera de imagen, y devuelve su handle.
 *
 * No es el mismo endpoint que el de los adjuntos (`/{numero}/media`): las
 * plantillas usan la subida reanudable de la app, en dos pasos — abrir sesión
 * y mandar los bytes—. La app se saca del propio token para no tener que
 * configurar otra variable.
 */
export async function subirEjemploPlantilla(data: Buffer, mimeType: string): Promise<string> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error('WhatsApp no está configurado');

  const app = await fetch(`${BASE_URL}/app?access_token=${token}`).then(r => r.json());
  if (!app?.id) throw new Error(app?.error?.message || 'No se pudo saber a qué app pertenece el token');

  const sesion = await fetch(
    `${BASE_URL}/${app.id}/uploads?file_length=${data.length}&file_type=${encodeURIComponent(mimeType)}&access_token=${token}`,
    { method: 'POST' },
  ).then(r => r.json());
  if (!sesion?.id) throw new Error(sesion?.error?.message || 'Meta no abrió la sesión de subida');

  const subida = await fetch(`${BASE_URL}/${sesion.id}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, file_offset: '0' },
    body: new Uint8Array(data),
  }).then(r => r.json());
  if (!subida?.h) throw new Error(subida?.error?.message || 'Meta no aceptó la imagen de ejemplo');
  return subida.h as string;
}

// Crea la plantilla en la WABA y la deja en revisión de Meta.
// Devuelve el id y estado que asigna Meta (normalmente PENDING).
export async function createMetaTemplate(
  input: CreateTemplateInput,
): Promise<{ id: string; status: string; category: string }> {
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!wabaId || !token) throw new Error('WhatsApp no está configurado');

  const components: Record<string, unknown>[] = [];

  if (input.headerImageHandle) {
    components.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [input.headerImageHandle] } });
  } else if (input.header?.trim()) {
    components.push({ type: 'HEADER', format: 'TEXT', text: input.header.trim() });
  }

  const bodyComponent: Record<string, unknown> = { type: 'BODY', text: input.body };
  if (input.bodyExamples && input.bodyExamples.length) {
    bodyComponent.example = { body_text: [input.bodyExamples] };
  }
  components.push(bodyComponent);

  if (input.footer?.trim()) {
    components.push({ type: 'FOOTER', text: input.footer.trim() });
  }

  if (input.botones?.length) {
    components.push({
      type: 'BUTTONS',
      buttons: input.botones.map(b => b.tipo === 'url'
        ? { type: 'URL', text: b.texto, url: b.url }
        : { type: 'QUICK_REPLY', text: b.texto }),
    });
  }

  const res = await fetch(`${BASE_URL}/${wabaId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: input.name,
      language: input.language,
      category: input.category,
      components,
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    const e = data.error || {};
    console.error('[WhatsApp] Error al crear plantilla:', JSON.stringify(e));
    // Meta suele traer un título legible en error_user_title/error_user_msg
    const friendly = e.error_user_title || e.error_user_msg;
    throw new Error(friendly ? `${friendly}${e.error_user_msg && e.error_user_title ? ': ' + e.error_user_msg : ''}` : (e.message || `WhatsApp API respondió ${res.status}`));
  }

  return { id: data.id, status: data.status, category: data.category };
}

/**
 * Sube un archivo a WhatsApp y devuelve su media id.
 *
 * El id vive 30 días y solo sirve para este número emisor. Es la vía correcta
 * para mandar una nota de voz: por URL, WhatsApp no acepta audio.
 */
export async function uploadWhatsAppMedia(
  data: Buffer, mimeType: string, filename = 'audio.ogg', phoneNumberId?: string,
): Promise<string> {
  const numeroId = idDeLinea(phoneNumberId);
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!numeroId || !token) throw new Error('WhatsApp no configurado');

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mimeType);
  form.append('file', new Blob([new Uint8Array(data)], { type: mimeType }), filename);

  const res = await fetch(`${BASE_URL}/${numeroId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json();
  if (!res.ok || !json.id) {
    throw new Error(json.error?.message || `WhatsApp no aceptó el archivo (${res.status})`);
  }
  return json.id as string;
}

/**
 * Manda una nota de voz ya subida.
 *
 * `voice: true` hace que aparezca como nota de voz (la onda azul) en vez de
 * como un adjunto de audio. Solo funciona con OGG/Opus, que es justo lo que
 * graba el navegador con MediaRecorder.
 */
export async function sendWhatsAppAudio(to: string, mediaId: string, phoneNumberId?: string) {
  const numeroId = idDeLinea(phoneNumberId);
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!numeroId || !token) {
    console.warn('[WhatsApp] No configurado — audio no enviado');
    return null;
  }

  const res = await fetch(`${BASE_URL}/${numeroId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      ...destinatario(to),
      type: 'audio',
      audio: { id: mediaId },
    }),
    signal: AbortSignal.timeout(TIMEOUT_ENVIO_MS),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    console.error('[WhatsApp] Error al enviar audio:', JSON.stringify(data.error || data));
    throw new Error(data.error?.message || `WhatsApp API respondió ${res.status}`);
  }
  return data;
}

// Las listas de tipos admitidos viven en lib/adjuntos para que la bandeja
// pueda usarlas sin arrastrar este módulo —y sus credenciales— al navegador.
export {
  claseDeAdjunto, revisarTipoAdjunto, TIPOS_ADMITIDOS, ACCEPT_ADJUNTOS,
} from '@/lib/adjuntos';
export type { ClaseAdjunto } from '@/lib/adjuntos';
import type { ClaseAdjunto } from '@/lib/adjuntos';

/**
 * Manda un archivo ya subido: foto, video, PDF, lo que sea.
 *
 * `filename` solo lo usa WhatsApp para los documentos —es el nombre que ve la
 * clienta al descargarlo— y `caption` no está permitido en audio.
 */
export async function sendWhatsAppMedia(
  to: string, mediaId: string, clase: ClaseAdjunto,
  opciones: { caption?: string; filename?: string } = {},
  phoneNumberId?: string,
) {
  const numeroId = idDeLinea(phoneNumberId);
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!numeroId || !token) {
    console.warn('[WhatsApp] No configurado — adjunto no enviado');
    return null;
  }

  const adjunto: Record<string, unknown> = { id: mediaId };
  if (opciones.caption && clase !== 'audio') adjunto.caption = opciones.caption;
  if (clase === 'document' && opciones.filename) adjunto.filename = opciones.filename;

  const res = await fetch(`${BASE_URL}/${numeroId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...destinatario(to), type: clase, [clase]: adjunto }),
    signal: AbortSignal.timeout(TIMEOUT_ENVIO_MS),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    console.error('[WhatsApp] Error al enviar adjunto:', JSON.stringify(data.error || data));
    throw new Error(data.error?.message || `WhatsApp API respondió ${res.status}`);
  }
  return data;
}

export async function markMessageRead(messageId: string, phoneNumberId?: string) {
  const numeroId = idDeLinea(phoneNumberId);
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!numeroId || !token) return;

  await fetch(`${BASE_URL}/${numeroId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
  });
}
