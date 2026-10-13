import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { mapMPStatus, type DBPaymentStatus } from "@/lib/mp";

// Fallback del redirect de MP — verifica el estado real del pago en la API de MP
// (no confiamos en el ?status= de la URL que puede ser manipulado)
export async function POST(req: NextRequest) {
  let body: { order_id: string; payment_id: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const { order_id, payment_id } = body;

  if (typeof order_id !== "string" || !/^[a-f0-9-]{36}$/i.test(order_id) || typeof payment_id !== "string" || !/^\d{1,30}$/.test(payment_id)) {
    return NextResponse.json({ error: "Faltan campos" }, { status: 400 });
  }

  // Consultar el estado real en MP — nunca confiar en el status del query param
  let status: DBPaymentStatus = "pending";
  try {
    const mpRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${payment_id}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    );

    if (mpRes.ok) {
      const payment = await mpRes.json();
      const db = createServerClient();
      const {data: order, error: lookupError} = await db.from("orders").select("id,total,payment_method").eq("id",order_id).maybeSingle();
      if (lookupError) return NextResponse.json({error:"Verificación no disponible"},{status:503});
      if (!order || payment.external_reference !== order_id || order.payment_method !== "mercadopago" || payment.currency_id !== "COP" || !Number.isFinite(Number(payment.transaction_amount)) || Math.abs(Number(payment.transaction_amount)-Number(order.total)) > 0.01) return NextResponse.json({error:"El pago no corresponde al pedido"},{status:409});
      status = mapMPStatus(payment.status);
    } else {
      console.warn("[Confirm] MP API no disponible, usando status de redirect como fallback");
      // Si MP no responde, dejamos la orden en pending para que el webhook la actualice
      return NextResponse.json({ ok: true, verified: false });
    }
  } catch (err) {
    console.error("[Confirm] Error consultando MP:", err);
    return NextResponse.json({ ok: true, verified: false });
  }

  const supabase = createServerClient();
  const { data: updated, error } = await supabase
    .from("orders")
    .update({
      payment_status: status,
      mp_payment_id: payment_id,
    })
    .eq("id", order_id)
    .eq("payment_method", "mercadopago")
    .select("id");

  if (error) {
    console.error("[Confirm] Error actualizando orden:", error);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  if (!updated || updated.length === 0) {
    console.warn("[Confirm] Orden no encontrada:", order_id);
    return NextResponse.json({ error: "Orden no encontrada" }, { status: 404 });
  }

  // La orden en Shopify la crea exclusivamente el webhook de MP
  // (/api/webhooks/mercadopago) para evitar duplicados por condición de carrera.
  // El cron actúa como red de seguridad si el webhook falla.

  return NextResponse.json({ ok: true, verified: true, status });
}
