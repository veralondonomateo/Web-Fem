import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase";
import { normalizarTelefono } from "@/lib/carritos";

/**
 * Captura parcial del checkout: guarda quién empezó a llenar el formulario y
 * se fue sin enviar el pedido.
 *
 * Lo llama el navegador mientras la clienta escribe (con debounce) y al salir
 * de la página. Es un camino totalmente lateral: no participa en la creación
 * de la orden, no bloquea nada y si falla el checkout no se entera.
 *
 * Solo se guarda cuando hay lo mínimo para poder escribir por WhatsApp:
 * nombre y un celular colombiano válido. Sin eso el registro no sirve para
 * nada y no vale la pena guardar datos personales de nadie.
 */

const esquema = z.object({
  sessionId: z.string().min(8).max(100),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  email: z.string().max(160).optional(),
  phone: z.string().max(30).optional(),
  state: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  address: z.string().max(200).optional(),
  couponCode: z.string().max(40).optional(),
  variantId: z.number().int().positive().optional(),
  qty: z.number().int().min(1).max(99).optional(),
  subtotal: z.number().nonnegative().max(100_000_000).optional(),
  total: z.number().nonnegative().max(100_000_000).optional(),
  items: z
    .array(
      z.object({
        id: z.string().max(80).optional(),
        name: z.string().max(200),
        variant: z.string().max(200).nullish(),
        price: z.number().nonnegative(),
        quantity: z.number().int().min(1).max(99),
        // La variante exacta de la línea. Sin ella el link de recuperación
        // tiene que deducirla del producto y el precio.
        shopifyVariantId: z.number().int().positive().optional(),
      })
    )
    .max(20)
    .optional(),
});

export async function POST(req: NextRequest) {
  if(req.cookies.get("fem_consent")?.value !== "all") return NextResponse.json({ok:true,guardado:false});
  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const parsed = esquema.safeParse(cuerpo);
  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const d = parsed.data;
  const nombre = d.firstName?.trim() ?? "";
  const telefono = normalizarTelefono(d.phone);

  // Todavía no hay con qué contactar — no guardamos nada.
  if (nombre.length < 2 || !telefono) {
    return NextResponse.json({ ok: true, guardado: false });
  }

  try {
    const supabase = createServerClient();

    // `updated_at` lo mueve el trigger, y es el reloj que decide cuándo el
    // carrito está maduro: cada tecleo nuevo reinicia la espera.
    const { error } = await supabase.from("checkout_sessions").upsert(
      {
        session_id: d.sessionId,
        first_name: nombre,
        last_name: d.lastName?.trim() || null,
        email: d.email?.trim().toLowerCase() || null,
        phone: telefono,
        state: d.state || null,
        city: d.city || null,
        address: d.address?.trim() || null,
        coupon_code: d.couponCode?.trim().toUpperCase() || null,
        variant_id: d.variantId ?? null,
        qty: d.qty ?? null,
        subtotal: d.subtotal ?? 0,
        total: d.total ?? 0,
        items: d.items ?? [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id" }
    );

    if (error) {
      console.error("[Track] Error guardando sesión:", error);
      return NextResponse.json({ ok: false }, { status: 500 });
    }

    return NextResponse.json({ ok: true, guardado: true });
  } catch (err) {
    console.error("[Track] Error inesperado:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
