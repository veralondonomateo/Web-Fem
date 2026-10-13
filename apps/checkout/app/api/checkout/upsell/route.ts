import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { findProductBySku, findProductByTitle, addLineItemToShopifyOrder } from "@/lib/shopify";
import { VARIANT_IDS } from "@/lib/catalog";
import { REVISAR_PREFIX } from "@/lib/despacho";
import { sendAlert } from "@/lib/alert";

const JABON = {
  product_id: "jabon-intimo-prebioticos",
  name: "Jabón íntimo pH neutro",
  variant: "200 ml",
  price: 19900,
  quantity: 1,
  image:
    "https://cdn.shopify.com/s/files/1/0611/6999/1768/files/Probiotico-jabon-5.jpg?v=1769877892",
};

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

  // Idempotencia: no añadir dos veces
  const { data: existing } = await supabase
    .from("order_items")
    .select("id")
    .eq("order_id", order_id)
    .eq("product_id", JABON.product_id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ ok: true, already: true });
  }

  // El pedido ya trae el jabón suelto.
  //
  // La página de gracias ya no muestra la oferta en ese caso, pero esta es la
  // validación que manda: el navegador arma esa condición con lo que tiene en
  // sessionStorage, que puede venir de otra pestaña o de un pedido anterior.
  // Sin esta guarda la clienta acaba con dos jabones y descubriendo que el
  // segundo costaba diez mil menos.
  //
  // Los combos que incluyen jabón no cuentan: son 2 de cada 3 pedidos
  // contraentrega, y ahí el jabón extra es una segunda unidad con descuento.
  const { data: items } = await supabase
    .from("order_items")
    .select("name, shopify_variant_id")
    .eq("order_id", order_id);

  const yaLlevaJabon = (items ?? []).some(
    (i) =>
      i.shopify_variant_id === VARIANT_IDS.jabon ||
      (/jab[oó]n/i.test(i.name ?? "") && !/combo|\+/i.test(i.name ?? ""))
  );

  if (yaLlevaJabon) {
    console.log(`[Upsell] Orden ${order_id} ya lleva jabón — no se añade otro`);
    return NextResponse.json({ ok: true, already: true });
  }

  // Obtener shopify_variant_id y precio actual del jabón en Shopify (SKU 117700)
  // El combo "probiótico óvulos y jabón" puede compartir este SKU, así que
  // excluimos explícitamente productos que sean combos o contengan "óvulos".
  let shopifyVariantId: number | null = null;
  let shopifyVariantPrice: number | null = null;
  try {
    const bySkuResult = await findProductBySku("117700");
    const isCombo =
      bySkuResult !== null &&
      (/combo/i.test(bySkuResult.product.title) ||
        /[oó]vulos/i.test(bySkuResult.product.title));

    if (bySkuResult && !isCombo) {
      shopifyVariantId = bySkuResult.variant.id;
      shopifyVariantPrice = parseFloat(bySkuResult.variant.price) || null;
      console.log(`[Upsell] Jabón encontrado por SKU: ${bySkuResult.product.title} — precio Shopify: ${shopifyVariantPrice}`);
    } else {
      // El SKU apunta a un combo — buscar el jabón íntimo solo por nombre exacto
      const jabonByTitle = await findProductByTitle(/jab[oó]n\s*[ií]ntimo.*pH\s*neutro/i);
      if (jabonByTitle && !/combo/i.test(jabonByTitle.title)) {
        const variant =
          jabonByTitle.variants.find((v) => v.sku === "117700") ??
          jabonByTitle.variants[0];
        if (variant) {
          shopifyVariantId = variant.id;
          shopifyVariantPrice = parseFloat(variant.price) || null;
          console.log(`[Upsell] Jabón encontrado por título: ${jabonByTitle.title} — precio Shopify: ${shopifyVariantPrice}`);
        }
      }
    }
  } catch (err) {
    console.error("[Upsell] Error buscando jabón en Shopify:", err);
  }

  // Insertar item en Supabase
  const { error: insertError } = await supabase.from("order_items").insert({
    order_id,
    product_id: JABON.product_id,
    name: JABON.name,
    variant: JABON.variant,
    price: JABON.price,
    quantity: JABON.quantity,
    image: JABON.image,
    shopify_variant_id: shopifyVariantId,
  });

  if (insertError) {
    console.error("[Upsell] Error insertando item:", insertError);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  // Actualizar total de la orden en Supabase
  const { error: rpcError } = await supabase.rpc("increment_order_total", {
    p_order_id: order_id,
    p_amount: JABON.price,
  });

  if (rpcError) {
    // Fallback manual
    const { data: ord } = await supabase
      .from("orders")
      .select("total")
      .eq("id", order_id)
      .single();
    if (ord) {
      await supabase
        .from("orders")
        .update({ total: ord.total + JABON.price })
        .eq("id", order_id);
    }
  }

  // Añadir como line item real en la orden ya creada.
  const { data: ord } = await supabase
    .from("orders")
    .select("shopify_order_id, sendura_order_id, sendura_guia")
    .eq("id", order_id)
    .single();

  // Sendura no expone forma de editar una guía ya emitida. Si el pedido salió
  // por ahí antes de que la clienta aceptara el jabón, lo tenemos cobrado y
  // ellos no saben que hay que meterlo: se marca para revisión y sale en rojo
  // arriba del dashboard. La ventana del upsell está pensada para que esto no
  // ocurra —el pedido no se despacha hasta que ella decide—, pero queda como
  // red por si el cron de rescate se adelanta.
  if (ord?.sendura_order_id) {
    const aviso = `${REVISAR_PREFIX}: la clienta añadió el jabón después de que el pedido saliera por Sendura (guía ${ord.sendura_guia ?? "—"}). Está cobrado pero no va en la guía: hay que añadirlo con ellos o devolver los ${JABON.price}.`;
    console.error(`[Upsell] ${order_id}: ${aviso}`);
    await supabase.from("orders").update({ sendura_error: aviso }).eq("id", order_id);
    sendAlert(`[Upsell] Orden ${order_id}: ${aviso}`).catch(() => {});
    return NextResponse.json({ ok: true, en_revision: true });
  }

  if (ord?.shopify_order_id) {
    try {
      await addLineItemToShopifyOrder(ord.shopify_order_id, {
        name: JABON.name,
        variant: JABON.variant,
        price: JABON.price,
        quantity: JABON.quantity,
        shopifyVariantId,
        shopifyVariantPrice,
      });
      console.log(`[Upsell] Line item añadido a Shopify orden #${ord.shopify_order_id}`);
    } catch (err) {
      // No bloqueamos — el item ya está en Supabase
      console.error("[Upsell] Error añadiendo line item a Shopify:", err);
    }
  }

  console.log(`[Upsell] Jabón añadido a orden ${order_id}`);
  return NextResponse.json({ ok: true });
}
