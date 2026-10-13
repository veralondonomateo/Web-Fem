/**
 * Decide y ejecuta el despacho de un pedido: Sendura o Shopify.
 *
 * Es el **único** sitio donde se toma esa decisión. Los tres procesos que
 * pueden despachar un pedido —`/api/checkout/finalize`, el webhook de Mercado
 * Pago y el cron de rescate— llaman aquí. Si cada uno decidiera por su cuenta,
 * bastaría con que uno quedara desactualizado para que un mismo pedido saliera
 * por los dos operadores.
 *
 * ── Por qué el fallo de Sendura no se trata todo igual ──────────────────────
 *
 * El requisito es no perder pedidos y no duplicarlos. Chocan en un solo punto:
 * cuando no sabemos si Sendura creó la guía. Ahí no hay respuesta que cumpla
 * las dos, porque Sendura no expone un endpoint para consultar un pedido y
 * desempatar. Así que se separan los fallos por lo que se puede afirmar:
 *
 * - **Rechazo determinista** (cobertura, SKU, validación, credenciales): la
 *   guía no existe, con certeza. El pedido cae a Shopify y se despacha igual.
 *
 * - **Error 5xx con respuesta**: su servidor contestó con un fallo. En las
 *   pruebas del 20 de agosto uno de estos no dejó guía. Cae a Shopify, pero
 *   se registra en `sendura_error` para poder cotejarlo en su panel.
 *
 * - **Sin respuesta** (timeout o red caída): es el único caso de verdad
 *   ambiguo, porque la petición pudo llegar y perderse la respuesta. Aquí el
 *   pedido **no se despacha por ningún lado**: se marca `REVISAR:` y se queda
 *   quieto. Mandarlo a Shopify sería arriesgar un doble despacho, y reintentar
 *   en Sendura, dos guías. Un pedido detenido y visible es recuperable; dos
 *   despachos, no.
 *
 * Los `REVISAR:` salen listados en el dashboard, que es donde hay que ir a
 * buscarlos: este proyecto no tiene alertas configuradas.
 */

import { createShopifyOrder, getProducts } from "@/lib/shopify";
import { coberturaSendura, provinciaSendura } from "@/lib/cobertura-sendura";
import {
  crearOrdenSendura,
  resolverItemsSendura,
  SenduraError,
  type ItemPedido,
  type SenduraOrderInput,
} from "@/lib/sendura";

/** Prefijo que marca un pedido detenido a la espera de revisión humana. */
export const REVISAR_PREFIX = "REVISAR";

/**
 * Interruptor de emergencia. Con `SENDURA_ACTIVO` distinto de "true" todo sale
 * por Shopify, exactamente como antes de este cambio. Es una variable de
 * entorno y no una constante para poder apagarlo desde el panel de Vercel sin
 * volver a desplegar.
 */
export function senduraActivo(): boolean {
  return process.env.SENDURA_ACTIVO === "true";
}

/** El pedido no se despachó y no se debe reintentar solo. */
export class DespachoEnRevision extends Error {
  constructor(readonly detalle: string) {
    super(detalle);
    this.name = "DespachoEnRevision";
  }
}

export interface PedidoADespachar {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  address: string | null;
  complement: string | null;
  city: string | null;
  state: string | null;
  shipping: number | null;
  total: number;
  discount: number | null;
  coupon_code: string | null;
  /** Los dos únicos valores que escribe el checkout. */
  payment_method: "contraentrega" | "mercadopago";
}

export interface ResultadoDespacho {
  destino: "sendura" | "shopify";
  senduraOrderId?: string;
  senduraGuia?: string;
  shopifyOrderId?: number;
  /** Por qué no fue a Sendura pudiendo, cuando aplica. */
  notaSendura?: string;
}

/** Campos a escribir en `orders` tras un despacho exitoso. */
export function camposDeResultado(r: ResultadoDespacho): Record<string, unknown> {
  if (r.destino === "sendura") {
    return {
      sendura_order_id: r.senduraOrderId,
      sendura_guia: r.senduraGuia ?? null,
      sendura_error: null,
      shopify_error: null,
    };
  }
  return {
    shopify_order_id: r.shopifyOrderId,
    shopify_error: null,
    // Si cayó a Shopify por un fallo de Sendura, queda anotado por qué.
    ...(r.notaSendura ? { sendura_error: r.notaSendura } : {}),
  };
}

async function aShopify(
  pedido: PedidoADespachar,
  items: ItemPedido[],
  mpPaymentId?: string,
  notaSendura?: string
): Promise<ResultadoDespacho> {
  const shopifyOrderId = await createShopifyOrder({
    email: pedido.email ?? "",
    firstName: pedido.first_name ?? "",
    lastName: pedido.last_name ?? "",
    phone: pedido.phone ?? "",
    address: pedido.address ?? "",
    complement: pedido.complement ?? "",
    city: pedido.city ?? "",
    state: pedido.state ?? "",
    items: items.map((i) => ({
      name: i.name,
      variant: i.variant,
      price: i.price,
      quantity: i.quantity,
      shopifyVariantId: i.shopifyVariantId ?? undefined,
    })),
    shipping: pedido.shipping ?? 0,
    total: pedido.total,
    paymentMethod: pedido.payment_method,
    ...(mpPaymentId ? { mpPaymentId } : {}),
    femOrderId: pedido.id,
    couponCode: pedido.coupon_code ?? null,
    discount: pedido.discount ?? null,
  });

  return { destino: "shopify", shopifyOrderId, notaSendura };
}

/**
 * Despacha el pedido por donde corresponda.
 *
 * Lanza `DespachoEnRevision` cuando queda en el aire, y el error original de
 * Shopify si es Shopify quien falla (ahí sí manda el manejo de siempre).
 */
export async function despacharPedido(
  pedido: PedidoADespachar,
  items: ItemPedido[],
  opciones: { mpPaymentId?: string } = {}
): Promise<ResultadoDespacho> {
  const cobertura = coberturaSendura(pedido.state ?? "", pedido.city ?? "");

  if (!senduraActivo() || !cobertura.cubierta || !cobertura.municipio) {
    return aShopify(pedido, items, opciones.mpPaymentId);
  }

  // Sendura **ignora en silencio** los SKU que no conoce: con uno solo válido
  // responde 201 y guía, y despacha el pedido incompleto. Si falta alguno, el
  // pedido entero se va a Shopify.
  let catalogo: Awaited<ReturnType<typeof getProducts>> = [];
  try {
    catalogo = await getProducts();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Despacho] Sin catálogo de Shopify para resolver SKU: ${msg}`);
    return aShopify(
      pedido,
      items,
      opciones.mpPaymentId,
      `No se pudo leer el catálogo para resolver los SKU (${msg}); se despachó por Shopify.`
    );
  }

  const { items: resueltos, faltantes } = resolverItemsSendura(items, catalogo);
  if (faltantes.length > 0) {
    const nota = `Sin SKU para: ${faltantes.join(", ")}. Sendura los ignoraría y despacharía incompleto, así que se despachó por Shopify.`;
    console.warn(`[Despacho] Pedido ${pedido.id}: ${nota}`);
    return aShopify(pedido, items, opciones.mpPaymentId, nota);
  }

  // El corregimiento va en la segunda línea: la base de Sendura conoce
  // municipios, no las 8.193 veredas del catálogo colombiano.
  const direccion2 = [cobertura.corregimiento, pedido.complement]
    .filter(Boolean)
    .join(" — ");

  // Los dos identificadores viajan vacíos y los genera Sendura; mandar texto en
  // `shopify_id` tumbaba su servidor con un 500. Nuestra referencia va en las
  // notas, que es el único campo donde sobrevive para reconciliar.
  const payload: SenduraOrderInput = {
    order_number: "",
    shopify_id: "",
    customer_name: `${pedido.first_name ?? ""} ${pedido.last_name ?? ""}`.trim(),
    customer_email: pedido.email || undefined,
    customer_phone: (pedido.phone ?? "").replace(/\D/g, ""),
    shipping_address_1: pedido.address ?? "",
    shipping_address_2: direccion2 || undefined,
    shipping_city: cobertura.municipio.city,
    shipping_province: provinciaSendura(cobertura.municipio),
    shipping_country: "Colombia",
    notes: `Ref FEM: ${pedido.id}${pedido.payment_method === "mercadopago" ? " · Incluir 1 gorro de satín rosado de regalo por pago anticipado" : ""}`,
    total_price: pedido.total,
    financial_status: pedido.payment_method === "contraentrega" ? "pending" : "paid",
    items: resueltos.map((i) => ({
      sku: i.sku as string,
      name: i.variant ? `${i.name} – ${i.variant}` : i.name,
      quantity: i.quantity,
      price: i.price,
    })),
  };

  try {
    const { ok } = await crearOrdenSendura(payload);
    console.log(
      `[Despacho] Pedido ${pedido.id} → Sendura ${ok.order_id}, guía ${ok.guia_number ?? "—"}`
    );
    return {
      destino: "sendura",
      senduraOrderId: String(ok.order_id),
      senduraGuia: ok.guia_number ?? undefined,
    };
  } catch (err) {
    const e = err instanceof SenduraError ? err : null;
    const mensaje = err instanceof Error ? err.message : String(err);
    const detalle = `[${e?.motivo ?? "desconocido"}] ${mensaje}`;

    // Único caso ambiguo: no hubo respuesta, así que la guía puede existir.
    // Ver la nota de arriba sobre por qué esto no cae a Shopify.
    if (e?.motivo === "transitorio" && e.httpStatus === null) {
      console.error(`[Despacho] Pedido ${pedido.id} EN REVISIÓN: ${detalle}`);
      throw new DespachoEnRevision(
        `${REVISAR_PREFIX}: Sendura no respondió y la guía puede haberse creado. Verificar en su panel antes de despachar. ${detalle}`
      );
    }

    console.warn(`[Despacho] Sendura rechazó ${pedido.id}, va a Shopify: ${detalle}`);
    return aShopify(
      pedido,
      items,
      opciones.mpPaymentId,
      `Sendura rechazó el pedido, se despachó por Shopify. ${detalle}`
    );
  }
}
