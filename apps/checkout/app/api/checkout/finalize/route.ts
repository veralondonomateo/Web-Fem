import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { sendAlert } from "@/lib/alert";
import { claimOrderForShopify, estaDespachado, isProcessingActive } from "@/lib/order-sync";
import { camposDeResultado, despacharPedido, DespachoEnRevision } from "@/lib/despacho";

// Crea la orden en Shopify para pedidos contraentrega, llamado desde el
// thank-you page tras la ventana de upsell (90 s o al cerrar la pestaña).
export async function POST(req: NextRequest) {
  let body: { order_id: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const { order_id } = body;
  if (!order_id) {
    return NextResponse.json({ error: "Falta order_id" }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: order } = await supabase
    .from("orders")
    .select("*, discount::float8, coupon_code")
    .eq("id", order_id)
    .single();

  if (!order) {
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }

  // Idempotencia: ya salió por Shopify o por Sendura
  if (estaDespachado(order)) {
    return NextResponse.json({
      ok: true,
      shopify_order_id: order.shopify_order_id,
      sendura_order_id: order.sendura_order_id,
    });
  }

  // Solo para órdenes aprobadas contraentrega
  if (order.payment_status !== "approved" || order.payment_method !== "contraentrega") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // Pre-claim: previene que dos procesos concurrentes creen ambos una orden en
  // Shopify. Mismo protocolo que el webhook de MP y el cron (lib/order-sync).
  if (isProcessingActive(order.shopify_error)) {
    console.log(`[Finalize] Orden ${order_id} ya siendo procesada por otra llamada — saliendo`);
    return NextResponse.json({ ok: true, already_processing: true });
  }

  const preclaimOk = await claimOrderForShopify(supabase, order_id, order.shopify_error);

  if (!preclaimOk) {
    console.log(`[Finalize] Perdida la carrera por orden ${order_id} — otra llamada ya la tomó`);
    return NextResponse.json({ ok: true, lost_claim: true });
  }

  const { data: items } = await supabase
    .from("order_items")
    .select("name, variant, price, quantity, shopify_variant_id")
    .eq("order_id", order_id);

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

    // Cierre atómico: solo escribe si nadie más despachó el pedido mientras
    // tanto. Mira las dos columnas, no solo la de Shopify.
    const { data: claimed } = await supabase
      .from("orders")
      .update(camposDeResultado(resultado))
      .eq("id", order_id)
      .is("shopify_order_id", null)
      .is("sendura_order_id", null)
      .select("id")
      .maybeSingle();

    if (!claimed) {
      const ref = resultado.senduraOrderId ?? resultado.shopifyOrderId;
      const alertMsg = `[Finalize] DUPLICADO: se creó ${resultado.destino} ${ref} para la orden ${order_id}, que ya estaba despachada. Revisar y anular el duplicado.`;
      console.error(alertMsg);
      sendAlert(alertMsg).catch(() => {});
    }

    console.log(`[Finalize] Orden ${order_id} despachada por ${resultado.destino}`);
    return NextResponse.json({
      ok: true,
      destino: resultado.destino,
      shopify_order_id: resultado.shopifyOrderId,
      sendura_order_id: resultado.senduraOrderId,
    });
  } catch (err) {
    // Sendura no respondió: el pedido queda detenido a propósito, sin
    // despachar por ningún lado, hasta que alguien mire su panel.
    if (err instanceof DespachoEnRevision) {
      await supabase
        .from("orders")
        .update({ sendura_error: err.detalle, shopify_error: null })
        .eq("id", order_id);
      sendAlert(`[Finalize] Orden ${order_id} detenida: ${err.detalle}`).catch(() => {});
      return NextResponse.json({ ok: false, en_revision: true }, { status: 202 });
    }

    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Finalize] Error despachando la orden:", msg);
    await supabase.from("orders").update({ shopify_error: msg }).eq("id", order_id);
    return NextResponse.json({ error: "Error de despacho", detail: msg }, { status: 500 });
  }
}
