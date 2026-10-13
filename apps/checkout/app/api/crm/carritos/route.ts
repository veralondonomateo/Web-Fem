import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { autorizado, hidratar, COLUMNAS_COLA } from "@/lib/crm";
import { FilaCarrito } from "@/lib/carritos";

/**
 * GET /api/crm/carritos — cola de carritos abandonados para el CRM.
 *
 * Paginada por cursor: el CRM guarda el `cursor` que le devolvemos y lo manda
 * en la siguiente llamada. Así nunca ve dos veces el mismo carrito ni se le
 * escapa uno, aunque su proceso se caiga y vuelva horas después.
 *
 *   ?cursor=<n>     seguir desde donde quedó la última llamada
 *   ?desde=<ISO>    solo carritos detectados después de ese instante
 *   ?estado=        pendiente | entregado | contactado | recuperado | …
 *                   (por defecto: los que todavía se pueden trabajar)
 *   ?limite=        1..200 (por defecto 50)
 */

const LIMITE_POR_DEFECTO = 50;
const LIMITE_MAXIMO = 200;
const ESTADOS_ABIERTOS = ["pendiente", "entregado", "contactado"];

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

  const limite = Math.min(
    Math.max(parseInt(params.get("limite") ?? "", 10) || LIMITE_POR_DEFECTO, 1),
    LIMITE_MAXIMO
  );

  const supabase = createServerClient();

  let consulta = supabase
    .from("crm_carritos")
    .select(`${COLUMNAS_COLA}, secuencia`)
    .order("secuencia", { ascending: true })
    .limit(limite);

  const estado = params.get("estado");
  if (estado) {
    consulta = consulta.eq("estado", estado);
  } else {
    consulta = consulta.in("estado", ESTADOS_ABIERTOS);
  }

  if (cursor !== null) consulta = consulta.gt("secuencia", cursor);
  if (desde) consulta = consulta.gt("detectado_at", desde);

  const { data, error } = await consulta;

  if (error) {
    console.error("[CRM] Error leyendo la cola:", error);
    return NextResponse.json({ error: "Error consultando carritos" }, { status: 500 });
  }

  const filas = (data ?? []) as unknown as (FilaCarrito & { secuencia: number })[];
  const carritos = await hidratar(supabase, filas);

  // El cursor sale de la última fila leída, no del último carrito hidratado:
  // si una orden se borró y su carrito quedó sin datos, el cursor debe avanzar
  // igual o el CRM se quedaría pidiendo la misma página para siempre.
  const siguiente = filas.length > 0 ? filas[filas.length - 1].secuencia : cursor;

  return NextResponse.json(
    {
      carritos,
      cursor: siguiente,
      cantidad: carritos.length,
      hay_mas: filas.length === limite,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export const dynamic = "force-dynamic";
