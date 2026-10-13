import { OrderItem } from "@/types/checkout";

// Klaviyo tracking del checkout — vía Client API, sin el script onsite.
//
// Antes esto dependía de klaviyo.js (el script onsite). Ese script es también
// el que renderiza el popup de captura de emails, que en el checkout tapaba el
// formulario de pago y arrastraba ~14 archivos. Como aquí solo necesitamos
// enviar un evento, lo hacemos con una única petición a la Client API:
// el popup desaparece del checkout y no queda nada de JS de terceros.
//
// La Client API está diseñada para el navegador y usa solo el ID público de la
// cuenta (nunca una clave privada).
//
// Docs:
// - https://developers.klaviyo.com/en/reference/create_client_event
// - https://developers.klaviyo.com/en/docs/guide_to_integrating_a_platform_without_a_pre_built_klaviyo_integration

// ID público de la cuenta de Klaviyo que recibe los eventos del checkout.
// Es el mismo que servía klaviyo.js (…/onsite/js/TDVtU4/klaviyo.js).
const KLAVIYO_COMPANY_ID = "TDVtU4";
const KLAVIYO_REVISION = "2024-10-15";
const KLAVIYO_EVENTS_URL = `https://a.klaviyo.com/client/events?company_id=${KLAVIYO_COMPANY_ID}`;

// The event name is EXACT and intentionally distinct from Shopify's
// "Checkout Started" metric so the two stay separable in Klaviyo.
const STARTED_CHECKOUT_EVENT = "Started Checkout";

// Format a Colombian number to E.164 (+57...). Returns undefined when the value
// doesn't look like a valid 10-digit local number, so we can omit it.
function toE164(phone?: string): string | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/\D/g, "");
  if (/^\d{10}$/.test(digits)) return `+57${digits}`;
  if (/^57\d{10}$/.test(digits)) return `+${digits}`;
  return undefined;
}

// A stable per-cart/session id so $event_id is unique and the flag survives
// re-renders. Reused across identify re-runs within the same session.
function getCartId(): string {
  const KEY = "fem-klaviyo-cart-id";
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
    const id = `cart_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    return `cart_${Date.now()}`;
  }
}

function alreadyTracked(cartId: string): boolean {
  try {
    return sessionStorage.getItem(`fem-klaviyo-started-${cartId}`) === "1";
  } catch {
    return false;
  }
}

function markTracked(cartId: string): void {
  try {
    sessionStorage.setItem(`fem-klaviyo-started-${cartId}`, "1");
  } catch {
    /* ignore */
  }
}

interface StartedCheckoutInput {
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  items: OrderItem[];
  total: number;
}

/**
 * Envía "Started Checkout" a Klaviyo, creando o actualizando el perfil en la
 * misma petición (el bloque `profile` del evento hace de identify).
 *
 * Se dispara una sola vez por carrito/sesión. Además va `unique_id`, así que
 * si una petición se repitiera, Klaviyo la descarta del lado del servidor.
 */
export function trackStartedCheckout({
  email,
  firstName,
  lastName,
  phone,
  items,
  total,
}: StartedCheckoutInput): void {
  if (typeof window === "undefined") return;

  const trimmedEmail = email.trim();
  if (!trimmedEmail) return;

  const cartId = getCartId();
  if (alreadyTracked(cartId)) return;
  markTracked(cartId);

  // Solo incluimos lo que está lleno; el email es lo único obligatorio.
  const profileAttributes: Record<string, unknown> = { email: trimmedEmail };
  if (firstName?.trim()) profileAttributes.first_name = firstName.trim();
  if (lastName?.trim()) profileAttributes.last_name = lastName.trim();
  const phoneNumber = toE164(phone);
  if (phoneNumber) profileAttributes.phone_number = phoneNumber;

  const body = {
    data: {
      type: "event",
      attributes: {
        unique_id: cartId,
        value: total,
        properties: {
          $value: total,
          ItemNames: items.map((i) => i.name),
          CheckoutURL: window.location.href,
          Items: items.map((i) => ({
            ProductID: i.id,
            ProductName: i.name,
            Quantity: i.quantity,
            ItemPrice: i.price,
            RowTotal: i.price * i.quantity,
            ImageURL: i.image,
          })),
        },
        metric: {
          data: { type: "metric", attributes: { name: STARTED_CHECKOUT_EVENT } },
        },
        profile: {
          data: { type: "profile", attributes: profileAttributes },
        },
      },
    },
  };

  // keepalive: el cliente suele salir del checkout justo después (redirect a
  // Mercado Pago), y sin esto el navegador cancelaría la petición.
  if(typeof document === "undefined" || !/(?:^|;\s*)fem_consent=all(?:;|$)/.test(document.cookie) || process.env.NEXT_PUBLIC_FEM_PREVIEW === "true") return;
  fetch(KLAVIYO_EVENTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", revision: KLAVIYO_REVISION },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    // Si falla, permitimos que un intento posterior lo reintente.
    try {
      sessionStorage.removeItem(`fem-klaviyo-started-${cartId}`);
    } catch {
      /* ignore */
    }
  });
}
