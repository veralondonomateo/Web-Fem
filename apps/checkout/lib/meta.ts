import { createHash } from "crypto";

const PIXEL_ID = process.env.META_PIXEL_ID!;
const ACCESS_TOKEN = process.env.META_CONVERSIONS_TOKEN!;
const API_VERSION = "v22.0";

function sha256(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function hashPhone(phone: string): string {
  // Normalize to E.164 without '+': 573001234567
  const digits = phone.replace(/\D/g, "");
  const normalized = digits.startsWith("57") ? digits : `57${digits}`;
  return createHash("sha256").update(normalized).digest("hex");
}

interface PurchaseEventInput {
  marketingConsent?: boolean;
  orderId: string;
  email: string;
  phone?: string;
  value: number;         // COP
  currency?: string;
  eventSourceUrl?: string;
  clientIp?: string;
  clientUserAgent?: string;
  fbp?: string;          // _fbp cookie
  fbc?: string;          // _fbc cookie
  // Los siguientes ya están en la orden y suben la calidad de coincidencia
  // (EMQ) sin costo: cada uno es una señal más para que Meta empareje el
  // evento con una persona real.
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  /** Líneas del pedido — alimentan el catálogo y los anuncios dinámicos. */
  contents?: Array<{ id: string; quantity: number; price: number }>;
}

/**
 * Meta pide ciudad y región sin espacios, acentos ni puntuación, en minúscula:
 * "Bogotá D.C." → "bogotadc". Sin esta normalización el hash no coincide con
 * el suyo y el dato no suma nada.
 */
function normalizeGeo(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toLowerCase();
}

export async function sendPurchaseEvent(input: PurchaseEventInput): Promise<void> {
  if (input.marketingConsent !== true) return;
  if (!PIXEL_ID || !ACCESS_TOKEN) {
    console.warn("[Meta CAPI] Missing META_PIXEL_ID or META_CONVERSIONS_TOKEN — skipping");
    return;
  }

  const userData: Record<string, unknown> = {
    em: [sha256(input.email)],
    // Identificador estable de la compradora. Meta lo usa para unir eventos de
    // la misma persona aunque falten cookies, que es justo lo que pasa con los
    // pedidos de Mercado Pago.
    external_id: [sha256(input.email)],
  };
  if (input.phone) userData.ph = [hashPhone(input.phone)];
  if (input.firstName) userData.fn = [sha256(input.firstName)];
  if (input.lastName) userData.ln = [sha256(input.lastName)];
  if (input.city) userData.ct = [sha256(normalizeGeo(input.city))];
  if (input.state) userData.st = [sha256(normalizeGeo(input.state))];
  // Toda la operación es Colombia; el país es una señal más, y gratis.
  userData.country = [sha256("co")];
  if (input.clientIp) userData.client_ip_address = input.clientIp;
  if (input.clientUserAgent) userData.client_user_agent = input.clientUserAgent;
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;

  const payload = {
    data: [
      {
        event_name: "Purchase",
        event_time: Math.floor(Date.now() / 1000),
        action_source: "website",
        event_source_url: input.eventSourceUrl ?? "https://checkoutfem.com/checkout",
        event_id: `purchase_${input.orderId}`, // dedup con pixel browser
        user_data: userData,
        custom_data: {
          currency: input.currency ?? "COP",
          value: input.value,
          order_id: input.orderId,
          ...(input.contents?.length
            ? {
                content_type: "product",
                content_ids: input.contents.map((c) => c.id),
                contents: input.contents.map((c) => ({
                  id: c.id,
                  quantity: c.quantity,
                  item_price: c.price,
                })),
              }
            : {}),
        },
      },
    ],
    access_token: ACCESS_TOKEN,
  };

  try {
    const res = await fetch(
      `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const cuerpo = await res.text();
    if (!res.ok) {
      console.error("[Meta CAPI] Error:", cuerpo);
      return;
    }

    // La respuesta de Meta es lo único que confirma que el evento entró, y el
    // `fbtrace_id` es lo que pide su soporte para rastrear un evento concreto.
    // Sin esto, un evento descartado en silencio no deja rastro en ningún lado.
    try {
      const { events_received, fbtrace_id } = JSON.parse(cuerpo);
      console.log(
        `[Meta CAPI] Purchase ${input.orderId} — recibidos: ${events_received}, ` +
          `parámetros: ${Object.keys(userData).length}, fbtrace: ${fbtrace_id}`
      );
    } catch {
      console.log(`[Meta CAPI] Purchase ${input.orderId} enviado`);
    }
  } catch (err) {
    // No-fatal: nunca bloquear el flujo de pago por un error de tracking
    console.error("[Meta CAPI] Fetch error:", err);
  }
}
