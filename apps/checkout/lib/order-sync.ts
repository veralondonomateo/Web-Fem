import type { SupabaseClient } from "@supabase/supabase-js";

// Protocolo de reserva compartido por los tres procesos que pueden crear una
// orden en Shopify: /api/checkout/finalize, el webhook de Mercado Pago y el
// cron de rescate.
//
// Antes solo finalize y el webhook se coordinaban entre sí; el cron creaba
// órdenes sin reservar, así que podía duplicar un pedido que finalize estuviera
// procesando en ese mismo momento. Ahora los tres pasan por aquí.
//
// La reserva se escribe en `shopify_error` como `PROCESSING:<epoch_ms>`. El
// timestamp permite distinguir un proceso vivo de uno que murió a mitad de
// camino: pasado el margen, la orden vuelve a estar disponible para rescate
// (si no caducara, un crash dejaría el pedido sin sincronizar para siempre).

export const PROCESSING_PREFIX = "PROCESSING";

/** Margen tras el cual una reserva se considera abandonada. */
export const PROCESSING_STALE_MS = 10 * 60 * 1000;

export function processingMarker(now: number = Date.now()): string {
  return `${PROCESSING_PREFIX}:${now}`;
}

export function isProcessing(err: string | null | undefined): boolean {
  return typeof err === "string" && err.startsWith(PROCESSING_PREFIX);
}

/**
 * ¿Hay otro proceso trabajando esta orden ahora mismo?
 * Una reserva sin timestamp (formato viejo) o vencida cuenta como abandonada,
 * para que el cron pueda rescatar el pedido.
 */
export function isProcessingActive(
  err: string | null | undefined,
  now: number = Date.now()
): boolean {
  if (!isProcessing(err)) return false;
  const ts = Number.parseInt((err as string).slice(PROCESSING_PREFIX.length + 1), 10);
  if (!Number.isFinite(ts)) return false;
  return now - ts < PROCESSING_STALE_MS;
}

/**
 * ¿El pedido ya salió por algún operador?
 *
 * Desde que Sendura despacha parte de los pedidos, "ya sincronizado" dejó de
 * ser `shopify_order_id` no nulo. Si esta condición se olvidara en algún sitio,
 * el cron de rescate volvería a crear en Shopify un pedido que Sendura ya
 * despachó — dos entregas del mismo pedido.
 */
export function estaDespachado(orden: {
  shopify_order_id?: number | string | null;
  sendura_order_id?: string | null;
}): boolean {
  return !!orden.shopify_order_id || !!orden.sendura_order_id;
}

/**
 * Reserva la orden de forma atómica (compare-and-swap sobre `shopify_error`).
 * Devuelve false si otro proceso ganó la carrera o si la orden ya se despachó
 * por cualquiera de los dos operadores.
 */
export async function claimOrderForShopify(
  supabase: SupabaseClient,
  orderId: string,
  currentError: string | null
): Promise<boolean> {
  const base = supabase
    .from("orders")
    .update({ shopify_error: processingMarker() })
    .eq("id", orderId)
    .is("shopify_order_id", null)
    .is("sendura_order_id", null);

  const guarded =
    currentError === null
      ? base.is("shopify_error", null)
      : base.eq("shopify_error", currentError);

  const { data } = await guarded.select("id").maybeSingle();
  return !!data;
}
