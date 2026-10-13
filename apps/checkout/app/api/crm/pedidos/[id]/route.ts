import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { autorizado } from "@/lib/crm";
import {
  armarPedido,
  COLUMNAS_PEDIDO,
  type FilaPedido,
  type ProductoPedido,
} from "@/lib/pedidos-crm";

/**
 * GET /api/crm/pedidos/{id} — estado actual de un pedido.
 *
 * Hay que llamarlo **justo antes de escribirle a la clienta**. `debe_avisar` se
 * recalcula aquí: si otro proceso ya la avisó, viene en false y no hay que
 * mandar nada. Sin esta revalidación, un CRM que reintente una tanda le manda
 * dos veces el mismo mensaje a la misma persona.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("orders")
    .select(COLUMNAS_PEDIDO)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[CRM] Error leyendo el pedido:", error);
    return NextResponse.json({ error: "Error consultando el pedido" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  }

  const fila = data as unknown as FilaPedido;
  if (fila.despacho_secuencia === null) {
    return NextResponse.json(
      { error: "El pedido todavía no se ha despachado: la transportadora aún no está decidida" },
      { status: 409 }
    );
  }

  const { data: items } = await supabase
    .from("order_items")
    .select("name, variant, quantity, price")
    .eq("order_id", id);

  const productos: ProductoPedido[] = (items ?? []).map((i) => ({
    nombre: i.name,
    variante: i.variant ?? null,
    cantidad: i.quantity,
    precio: Number(i.price ?? 0),
  }));

  return NextResponse.json(armarPedido(fila, productos), {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export const dynamic = "force-dynamic";
