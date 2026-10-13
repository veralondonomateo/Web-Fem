import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  armarCarrito,
  CarritoCRM,
  FilaCarrito,
  ProductoCarrito,
} from "@/lib/carritos";

/**
 * Piezas compartidas por las rutas /api/crm/*: autenticación y armado del
 * carrito completo a partir de la cola.
 */

const ESTADOS_CONTACTABLES = new Set(["pendiente", "entregado", "contactado"]);

/** ¿La petición trae la llave del CRM? */
export function autorizado(req: NextRequest): boolean {
  const esperada = process.env.CRM_API_KEY;
  if (!esperada) return false;

  const cabecera = req.headers.get("authorization") ?? "";
  const recibida = cabecera.startsWith("Bearer ") ? cabecera.slice(7) : "";
  if (!recibida) return false;

  const a = Buffer.from(recibida);
  const b = Buffer.from(esperada);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface FilaOrden {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  total: number | string | null;
}

interface FilaSesion {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  total: number | string | null;
  items: unknown;
  variant_id: number | null;
  qty: number | null;
}

interface FilaItem {
  order_id: string;
  name: string;
  variant: string | null;
  price: number | string;
  quantity: number;
  shopify_variant_id: number | null;
}

function aNumero(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : parseFloat(v) || 0;
}

function productosDeJson(items: unknown): ProductoCarrito[] {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 20).map((i) => {
    const it = i as Record<string, unknown>;
    return {
      nombre: String(it.name ?? ""),
      variante: it.variant ? String(it.variant) : null,
      cantidad: Number(it.quantity ?? 1),
      precio: aNumero(it.price as number | string),
    };
  });
}

/**
 * Completa las filas de la cola con los datos de su origen (la orden sin pagar
 * o la sesión parcial) y devuelve el objeto que ve el CRM.
 *
 * Hace tres consultas en total sin importar cuántos carritos vengan — nunca
 * una por carrito.
 */
export async function hidratar(
  supabase: SupabaseClient,
  filas: FilaCarrito[]
): Promise<CarritoCRM[]> {
  if (filas.length === 0) return [];

  const idsOrdenes = filas.filter((f) => f.tipo === "pago_no_completado").map((f) => f.origen_id);
  const idsSesiones = filas.filter((f) => f.tipo === "datos_parciales").map((f) => f.origen_id);

  const [ordenes, items, sesiones] = await Promise.all([
    idsOrdenes.length
      ? supabase
          .from("orders")
          .select("id, first_name, last_name, email, city, state, total")
          .in("id", idsOrdenes)
      : Promise.resolve({ data: [] as FilaOrden[] }),
    idsOrdenes.length
      ? supabase
          .from("order_items")
          .select("order_id, name, variant, price, quantity, shopify_variant_id")
          .in("order_id", idsOrdenes)
      : Promise.resolve({ data: [] as FilaItem[] }),
    idsSesiones.length
      ? supabase
          .from("checkout_sessions")
          .select("id, first_name, last_name, email, city, state, total, items, variant_id, qty")
          .in("id", idsSesiones)
      : Promise.resolve({ data: [] as FilaSesion[] }),
  ]);

  const porOrden = new Map<string, FilaOrden>();
  for (const o of (ordenes.data ?? []) as FilaOrden[]) porOrden.set(o.id, o);

  const itemsPorOrden = new Map<string, FilaItem[]>();
  for (const i of (items.data ?? []) as FilaItem[]) {
    const lista = itemsPorOrden.get(i.order_id) ?? [];
    lista.push(i);
    itemsPorOrden.set(i.order_id, lista);
  }

  const porSesion = new Map<string, FilaSesion>();
  for (const s of (sesiones.data ?? []) as FilaSesion[]) porSesion.set(s.id, s);

  const resultado: CarritoCRM[] = [];

  for (const fila of filas) {
    const contactable = ESTADOS_CONTACTABLES.has(fila.estado);

    if (fila.tipo === "pago_no_completado") {
      const o = porOrden.get(fila.origen_id);
      if (!o) continue; // la orden desapareció: nada que recuperar
      const lineas = itemsPorOrden.get(fila.origen_id) ?? [];
      resultado.push(
        armarCarrito(fila, {
          nombre: o.first_name ?? fila.nombre ?? "",
          apellido: o.last_name ?? "",
          email: o.email,
          ciudad: o.city,
          departamento: o.state,
          total: aNumero(o.total),
          variantId: lineas[0]?.shopify_variant_id ?? null,
          qty: lineas[0]?.quantity ?? null,
          productos: lineas.map((l) => ({
            nombre: l.name,
            variante: l.variant,
            cantidad: l.quantity,
            precio: aNumero(l.price),
          })),
        }, contactable)
      );
      continue;
    }

    const s = porSesion.get(fila.origen_id);
    if (!s) continue;
    resultado.push(
      armarCarrito(fila, {
        nombre: s.first_name ?? fila.nombre ?? "",
        apellido: s.last_name ?? "",
        email: s.email,
        ciudad: s.city,
        departamento: s.state,
        total: aNumero(s.total),
        variantId: s.variant_id,
        qty: s.qty,
        productos: productosDeJson(s.items),
      }, contactable)
    );
  }

  return resultado;
}

export const COLUMNAS_COLA =
  "id, tipo, origen_id, telefono, nombre, estado, detectado_at, mensajes_enviados";
