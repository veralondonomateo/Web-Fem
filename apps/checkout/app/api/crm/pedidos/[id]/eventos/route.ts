import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { autorizado } from "@/lib/crm";

/**
 * POST /api/crm/pedidos/{id}/eventos — el CRM reporta lo que hizo.
 *
 * Por ahora un solo evento: `aviso_enviado`, cuando ya le escribió a la clienta
 * avisándole de que Sendura la va a llamar. Sella `crm_avisado_at`, que es lo
 * que hace `debe_avisar` false a partir de entonces.
 *
 * El sello se pone **solo si estaba vacío**. Así, si dos procesos del CRM
 * reportan el mismo aviso, el segundo no pisa la hora del primero y la métrica
 * sigue contando un aviso, no dos.
 */
const EVENTOS = ["aviso_enviado"] as const;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;

  let body: { evento?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  if (!body.evento || !EVENTOS.includes(body.evento as (typeof EVENTOS)[number])) {
    return NextResponse.json(
      { error: `El campo 'evento' debe ser uno de: ${EVENTOS.join(", ")}` },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("orders")
    .update({ crm_avisado_at: new Date().toISOString() })
    .eq("id", id)
    .is("crm_avisado_at", null)
    .select("id, crm_avisado_at")
    .maybeSingle();

  if (error) {
    console.error("[CRM] Error registrando el evento:", error);
    return NextResponse.json({ error: "Error registrando el evento" }, { status: 500 });
  }

  // Sin fila: o el pedido no existe, o ya estaba avisado. Se comprueba cuál.
  if (!data) {
    const { data: existe } = await supabase
      .from("orders")
      .select("crm_avisado_at")
      .eq("id", id)
      .maybeSingle();

    if (!existe) {
      return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      ya_estaba: true,
      avisado_at: existe.crm_avisado_at,
    });
  }

  return NextResponse.json({ ok: true, avisado_at: data.crm_avisado_at });
}

export const dynamic = "force-dynamic";
