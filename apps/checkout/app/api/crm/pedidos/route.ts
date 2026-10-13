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
 * GET /api/crm/pedidos — cola de pedidos ya despachados.
 *
 * Solo aparecen los pedidos que **ya salieron** por un operador. Antes de eso
 * la transportadora no se sabe con certeza —el ruteo se decide en el momento
 * del despacho, y un fallo de Sendura manda el pedido a Shopify—, así que
 * avisar antes sería avisar de algo que puede cambiar.
 *
 * Paginada por cursor igual que la de carritos: el CRM guarda el `cursor` que
 * le devolvemos y lo manda en la siguiente llamada.
 *
 *   ?cursor=<n>              seguir desde donde quedó la última llamada
 *   ?transportadora=sendura  filtrar por operador (sendura | shopify)
 *   ?desde=<ISO>             solo pedidos despachados después de ese instante
 *   ?limite=                 1..200 (por defecto 50)
 */

const LIMITE_POR_DEFECTO = 50;
const LIMITE_MAXIMO = 200;

export async function GET(req: NextRequest) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;

  const desde = params.get("desde");
  if (desde && Number.isNaN(Date.parse(desde))) {
    return NextResponse.json(
      { error: "El parámetro 'desde' debe ser una fecha ISO 8601" },
      { status: 400 }
    );
  }

  const cursorCrudo = params.get("cursor");
  const cursor = cursorCrudo ? Number(cursorCrudo) : null;
  if (cursorCrudo && !Number.isFinite(cursor)) {
    return NextResponse.json(
      { error: "El parámetro 'cursor' debe ser el número que devolvió la llamada anterior" },
      { status: 400 }
    );
  }

  const transportadora = params.get("transportadora");
  if (transportadora && !["sendura", "shopify"].includes(transportadora)) {
    return NextResponse.json(
      { error: "El parámetro 'transportadora' debe ser 'sendura' o 'shopify'" },
      { status: 400 }
    );
  }

  const limite = Math.min(
    Math.max(parseInt(params.get("limite") ?? "", 10) || LIMITE_POR_DEFECTO, 1),
    LIMITE_MAXIMO
  );

  const supabase = createServerClient();

  let consulta = supabase
    .from("orders")
    .select(COLUMNAS_PEDIDO)
    .not("despacho_secuencia", "is", null)
    .order("despacho_secuencia", { ascending: true })
    .limit(limite);

  if (transportadora === "sendura") consulta = consulta.not("sendura_order_id", "is", null);
  if (transportadora === "shopify") consulta = consulta.is("sendura_order_id", null);
  if (cursor !== null) consulta = consulta.gt("despacho_secuencia", cursor);
  if (desde) consulta = consulta.gt("despachado_at", desde);

  const { data, error } = await consulta;

  if (error) {
    console.error("[CRM] Error leyendo la cola de pedidos:", error);
    return NextResponse.json({ error: "Error consultando pedidos" }, { status: 500 });
  }

  const filas = (data ?? []) as unknown as FilaPedido[];

  // Los productos van en una sola consulta para no hacer N+1 con la página
  // entera: con `limite=200` serían 200 viajes a la base por cada lectura.
  const porPedido = new Map<string, ProductoPedido[]>();
  if (filas.length > 0) {
    const { data: items } = await supabase
      .from("order_items")
      .select("order_id, name, variant, quantity, price")
      .in("order_id", filas.map((f) => f.id));

    for (const i of items ?? []) {
      const lista = porPedido.get(i.order_id) ?? [];
      lista.push({
        nombre: i.name,
        variante: i.variant ?? null,
        cantidad: i.quantity,
        precio: Number(i.price ?? 0),
      });
      porPedido.set(i.order_id, lista);
    }
  }

  const pedidos = filas.map((f) => armarPedido(f, porPedido.get(f.id) ?? []));

  // El cursor sale de la última fila leída, no del último pedido armado: si una
  // fila viniera incompleta el cursor debe avanzar igual, o el CRM se quedaría
  // pidiendo la misma página para siempre.
  const siguiente =
    filas.length > 0 ? filas[filas.length - 1].despacho_secuencia : cursor;

  return NextResponse.json(
    {
      pedidos,
      cursor: siguiente,
      cantidad: pedidos.length,
      hay_mas: filas.length === limite,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export const dynamic = "force-dynamic";
