import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase";
import { autorizado } from "@/lib/crm";

/**
 * POST /api/crm/carritos/{id}/eventos — el CRM reporta qué hizo con el carrito.
 *
 * Sin esto el sistema es ciego: no sabríamos a quién ya se le escribió, quién
 * pidió que no lo contacten más, ni cuántas ventas trajo la recuperación.
 *
 *   mensaje_enviado  se envió un mensaje (suma al contador)
 *   respondio        la clienta contestó
 *   recuperado       terminó comprando
 *   opt_out          pidió no recibir más mensajes → bloqueo permanente
 *   descartado       el CRM decidió no insistir
 */

const esquema = z.object({
  evento: z.enum(["mensaje_enviado", "respondio", "recuperado", "opt_out", "descartado"]),
  nota: z.string().max(500).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Id inválido" }, { status: 400 });
  }

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const parsed = esquema.safeParse(cuerpo);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Evento inválido. Valores permitidos: mensaje_enviado, respondio, recuperado, opt_out, descartado",
      },
      { status: 400 }
    );
  }

  const { evento, nota } = parsed.data;
  const supabase = createServerClient();
  const ahora = new Date().toISOString();

  const { data: carrito, error: errorLectura } = await supabase
    .from("crm_carritos")
    .select("id, telefono, estado, mensajes_enviados")
    .eq("id", id)
    .maybeSingle();

  if (errorLectura) {
    console.error("[CRM] Error leyendo carrito para evento:", errorLectura);
    return NextResponse.json({ error: "Error consultando el carrito" }, { status: 500 });
  }
  if (!carrito) {
    return NextResponse.json({ error: "Carrito no encontrado" }, { status: 404 });
  }

  const cambios: Record<string, unknown> = {};

  switch (evento) {
    case "mensaje_enviado":
      cambios.estado = "contactado";
      cambios.mensajes_enviados = (carrito.mensajes_enviados ?? 0) + 1;
      // `contactado_at` guarda el primer contacto, no el último: es la fecha
      // con la que se mide cuánto tarda en recuperarse una venta.
      if (carrito.estado !== "contactado") cambios.contactado_at = ahora;
      break;
    case "respondio":
      cambios.estado = "contactado";
      break;
    case "recuperado":
      cambios.estado = "recuperado";
      cambios.recuperado_at = ahora;
      break;
    case "descartado":
      cambios.estado = "perdido";
      break;
    case "opt_out":
      cambios.estado = "suprimido";
      break;
  }

  // El opt-out va a su propia tabla: debe sobrevivir a este carrito y bloquear
  // el celular en todos los carritos futuros, no solo en este.
  if (evento === "opt_out") {
    const { error: errorSupresion } = await supabase
      .from("crm_supresiones")
      .upsert(
        { telefono: carrito.telefono, motivo: nota ?? "Solicitado por la clienta" },
        { onConflict: "telefono" }
      );

    if (errorSupresion) {
      // Aquí sí fallamos con error: si el bloqueo no se guardó, el CRM tiene
      // que reintentar. Dar un 200 en falso terminaría en otro mensaje a
      // alguien que pidió no recibirlos.
      console.error("[CRM] No se pudo registrar la baja:", errorSupresion);
      return NextResponse.json(
        { error: "No se pudo registrar la baja, reintenta" },
        { status: 500 }
      );
    }
  }

  const { error } = await supabase.from("crm_carritos").update(cambios).eq("id", id);

  if (error) {
    console.error("[CRM] Error registrando evento:", error);
    return NextResponse.json({ error: "No se pudo registrar el evento" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id, evento, estado: cambios.estado });
}

export const dynamic = "force-dynamic";
