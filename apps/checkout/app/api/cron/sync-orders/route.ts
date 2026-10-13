import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { sendAlert } from "@/lib/alert";
import { claimOrderForShopify, isProcessingActive } from "@/lib/order-sync";
import {
  camposDeResultado,
  despacharPedido,
  DespachoEnRevision,
  REVISAR_PREFIX,
} from "@/lib/despacho";

/**
 * Safety-net cron: finds every approved order (contraentrega + paid MP)
 * that never made it to Shopify and creates it now.
 *
 * Runs every 10 minutes via vercel.json cron config.
 * Protected by CRON_SECRET to prevent unauthorized triggers.
 */
export async function GET(req: NextRequest) {
  // Auth: Vercel sends the secret as a Bearer token
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();

  // Orders approved >10 min ago with no Shopify order yet
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  // NULL-safe: `NOT ILIKE` in PostgreSQL returns NULL (not TRUE) for NULL values,
  // so orders with shopify_error=null would be silently excluded. Use OR to include them.
  const { data: orphans, error } = await supabase
    .from("orders")
    .select("id, email, first_name, last_name, phone, address, complement, city, state, shipping, total, discount, coupon_code, payment_method, shopify_error, sendura_error")
    .eq("payment_status", "approved")
    .is("shopify_order_id", null)
    // Un pedido que ya salió por Sendura no es huérfano: sin esto el cron lo
    // volvería a crear en Shopify y el cliente recibiría dos entregas.
    .is("sendura_order_id", null)
    .or("shopify_error.is.null,shopify_error.not.ilike.PERMANENT:%")
    // Los detenidos por respuesta ambigua de Sendura NO se reintentan solos:
    // reintentar podría crear una segunda guía. Salen en el dashboard.
    .or(`sendura_error.is.null,sendura_error.not.ilike.${REVISAR_PREFIX}:%`)
    .lt("created_at", cutoff);

  if (error) {
    console.error("[Cron] Supabase query error:", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  if (!orphans || orphans.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  console.log(`[Cron] Found ${orphans.length} orphaned order(s)`);

  const results: Array<{ id: string; status: "ok" | "error"; detail?: string }> = [];

  for (const order of orphans) {
    // Re-check inside loop in case a concurrent finalize just ran
    const { data: fresh } = await supabase
      .from("orders")
      .select("shopify_order_id, sendura_order_id, coupon_code, discount, shopify_error")
      .eq("id", order.id)
      .single();

    if (fresh?.shopify_order_id || fresh?.sendura_order_id) {
      results.push({ id: order.id, status: "ok", detail: "already_synced" });
      continue;
    }

    // El cron no participaba del protocolo de reserva: si finalize o el webhook
    // estaban creando la orden en ese instante, el cron creaba una segunda.
    if (isProcessingActive(fresh?.shopify_error)) {
      results.push({ id: order.id, status: "ok", detail: "processing_elsewhere" });
      continue;
    }

    const claimed = await claimOrderForShopify(supabase, order.id, fresh?.shopify_error ?? null);
    if (!claimed) {
      results.push({ id: order.id, status: "ok", detail: "claim_lost" });
      continue;
    }

    const { data: items } = await supabase
      .from("order_items")
      .select("name, variant, price, quantity, shopify_variant_id")
      .eq("order_id", order.id);

    try {
      const resultado = await despacharPedido(
        order,
        (items ?? []).map((i) => ({
          name: i.name,
          variant: i.variant,
          price: i.price,
          quantity: i.quantity,
          shopifyVariantId: i.shopify_variant_id ?? undefined,
        }))
      );

      // Cierre atómico contra las dos columnas.
      const { data: claimed } = await supabase
        .from("orders")
        .update(camposDeResultado(resultado))
        .eq("id", order.id)
        .is("shopify_order_id", null)
        .is("sendura_order_id", null)
        .select("id")
        .maybeSingle();

      if (!claimed) {
        const ref = resultado.senduraOrderId ?? resultado.shopifyOrderId;
        const alertMsg = `[Cron] DUPLICADO: se creó ${resultado.destino} ${ref} para la orden ${order.id}, que ya estaba despachada. Revisar y anular el duplicado.`;
        console.error(alertMsg);
        sendAlert(alertMsg).catch(() => {});
        results.push({ id: order.id, status: "ok", detail: "already_synced_race" });
        continue;
      }

      const ref = resultado.senduraOrderId ?? String(resultado.shopifyOrderId);
      console.log(`[Cron] Rescatada ${order.id} → ${resultado.destino} ${ref}`);
      results.push({ id: order.id, status: "ok", detail: `${resultado.destino}:${ref}` });
    } catch (err) {
      // Respuesta ambigua de Sendura: se marca y no se vuelve a intentar solo.
      if (err instanceof DespachoEnRevision) {
        await supabase
          .from("orders")
          .update({ sendura_error: err.detalle, shopify_error: null })
          .eq("id", order.id);
        results.push({ id: order.id, status: "error", detail: "en_revision" });
        continue;
      }

      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Cron] Failed to recover order ${order.id}:`, msg);
      // 422 = Shopify validation error (bad data) → permanent failure, don't retry
      const isPermanent = msg.includes("Shopify API 422");
      const storedError = isPermanent ? `PERMANENT: ${msg}` : msg;
      await supabase.from("orders").update({ shopify_error: storedError }).eq("id", order.id);
      results.push({ id: order.id, status: isPermanent ? "ok" : "error", detail: isPermanent ? "permanent_data_error" : msg });
    }
  }

  const ok = results.filter((r) => r.status === "ok").length;
  const failed = results.filter((r) => r.status === "error").length;
  const rescued = results.filter((r) => r.status === "ok" && !["already_synced", "already_synced_race"].includes(r.detail ?? ""));

  // Alert on every rescue — means a webhook failed silently
  if (rescued.length > 0) {
    const ids = rescued.map((r) => r.id).join(", ");
    sendAlert(`[Cron] Rescató ${rescued.length} orden(es) huérfana(s) (webhook fallido): ${ids}`).catch(() => {});
  }

  if (failed > 0) {
    const failedIds = results.filter((r) => r.status === "error").map((r) => `${r.id}: ${r.detail}`).join(" | ");
    sendAlert(`[Cron] ${failed} orden(es) fallaron al sincronizar con Shopify: ${failedIds}`).catch(() => {});
  }

  return NextResponse.json({ ok: true, processed: orphans.length, synced: ok, failed, results });
}
