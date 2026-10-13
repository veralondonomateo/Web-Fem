import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { autorizado, hidratar, COLUMNAS_COLA } from "@/lib/crm";
import { FilaCarrito, crearToken, estaSuprimido, yaCompro, CarritoCRM } from "@/lib/carritos";
import { restaurarCarrito, CarritoRestaurado } from "@/lib/restaurar-carrito";
import { getProducts, ShopifyProduct } from "@/lib/shopify";

/**
 * Lo que abre un link, en la forma que el CRM compara contra `productos` y
 * `total` antes de mandar el mensaje. `coincide` es la respuesta corta: si es
 * false, el link abriría algo distinto de lo que el mensaje va a nombrar.
 */
function resumenRestauracion(r: CarritoRestaurado, carrito: CarritoCRM, conDescuento: boolean) {
  if (!r.disponible) return { disponible: false, motivo: r.motivo, coincide: false };

  const mismasLineas =
    r.lineas.length === carrito.productos.length &&
    r.lineas.every(
      (l, i) =>
        l.cantidad === carrito.productos[i].cantidad &&
        l.precio === Math.round(carrito.productos[i].precio)
    );

  return {
    disponible: true,
    motivo: null,
    productos: r.lineas.map((l) => ({
      nombre: l.nombre,
      variante: l.variante,
      variant_id: l.variant_id,
      cantidad: l.cantidad,
      precio: l.precio,
    })),
    subtotal: r.subtotal,
    cupon: r.cupon,
    descuento: r.descuento,
    total: r.total,
    // El link con descuento añade VUELVE10 a propósito, así que su total no
    // se compara con `total`: basta con que las líneas sean las mismas.
    coincide: mismasLineas && (conDescuento || r.total === Math.round(carrito.total)),
  };
}

/**
 * GET /api/crm/carritos/{id} — estado de un carrito, revalidado en vivo.
 *
 * El CRM debe llamar esto **justo antes de enviar cada mensaje**. Entre que el
 * carrito se encola y pasan los 45 minutos de espera, la clienta pudo terminar
 * de comprar sola: `debe_contactar` vuelve a consultar las órdenes aprobadas y
 * la lista de bajas en ese instante, en vez de confiar en el estado guardado.
 */
export async function GET(
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

  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("crm_carritos")
    .select(COLUMNAS_COLA)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[CRM] Error leyendo carrito:", error);
    return NextResponse.json({ error: "Error consultando el carrito" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Carrito no encontrado" }, { status: 404 });
  }

  const fila = data as unknown as FilaCarrito;
  const [carrito] = await hidratar(supabase, [fila]);

  if (!carrito) {
    return NextResponse.json({ error: "Carrito no encontrado" }, { status: 404 });
  }

  // Revalidación en vivo — este es el punto de todo el endpoint.
  const desde = new Date(new Date(fila.detectado_at).getTime() - 2 * 60 * 60 * 1000);
  const [compro, suprimido] = await Promise.all([
    yaCompro(supabase, fila.telefono, desde),
    estaSuprimido(supabase, fila.telefono),
  ]);

  // Qué abre cada link, con la misma función que usa /checkout.
  const catalogo = await getProducts().catch(() => [] as ShopifyProduct[]);
  const [restaura, restauraDescuento] = await Promise.all([
    restaurarCarrito(supabase, crearToken(fila.tipo, fila.origen_id), catalogo),
    restaurarCarrito(supabase, crearToken(fila.tipo, fila.origen_id, true), catalogo),
  ]);

  const motivo = compro
    ? "ya_compro"
    : suprimido
      ? "opt_out"
      : !carrito.debe_contactar
        ? `estado_${fila.estado}`
        : null;

  return NextResponse.json(
    {
      ...carrito,
      debe_contactar: carrito.debe_contactar && !compro && !suprimido,
      motivo_no_contactar: motivo,
      link_restaura: resumenRestauracion(restaura, carrito, false),
      link_descuento_restaura: resumenRestauracion(restauraDescuento, carrito, true),
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}

export const dynamic = "force-dynamic";
