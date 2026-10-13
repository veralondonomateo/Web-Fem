import type { SupabaseClient } from "@supabase/supabase-js";
import { verificarToken, CUPON_RECUPERACION, TipoCarrito } from "@/lib/carritos";
import { getCouponRate, normalizeCoupon } from "@/lib/coupons";
import { VARIANT_IDS, VARIANTES_CAMPANA } from "@/lib/catalog";
import type { ShopifyProduct } from "@/lib/shopify";

/**
 * Reconstruye el carrito que la clienta dejó, a partir del token de
 * `/r/<token>`.
 *
 * Es la única fuente de verdad de "qué abre el link": la usa `/checkout` para
 * pintar el carrito y `GET /api/crm/carritos/:id` para decirle al CRM qué va a
 * restaurar antes de mandar el mensaje. Si las dos cosas salieran de código
 * distinto podrían volver a no coincidir, que es justo el error que esto
 * corrige: el link abría siempre el probiótico de $110.000, sin importar si la
 * clienta había dejado un combo de $169.900 o cuatro productos.
 *
 * Regla que no se negocia: si alguna línea no se puede reconstruir con su
 * variante exacta, el carrito **no** se restaura y se dice por qué. Nunca se
 * rellena con un producto por defecto.
 */

/**
 * Días que el link sigue rellenando los datos personales (nombre, celular,
 * dirección). Corto a propósito: un link de WhatsApp vive para siempre en el
 * chat y no queremos que dentro de seis meses siga sirviendo para leer una
 * dirección.
 */
export const VIGENCIA_DIAS = Number(process.env.RECUPERACION_VIGENCIA_DIAS ?? 30);

/**
 * Días que el link sigue abriendo los productos del carrito. Más largo que el
 * de los datos porque los productos no son datos personales; pasado este
 * plazo los precios guardados pueden haberse quedado viejos y el carrito se da
 * por caducado.
 */
export const VIGENCIA_CARRITO_DIAS = Number(process.env.CARRITO_VIGENCIA_DIAS ?? 90);

export type MotivoNoDisponible =
  | "token_invalido"
  | "no_encontrado"
  | "caducado"
  | "ya_comprado"
  | "producto_no_disponible";

export interface LineaRestaurada {
  /** Id de la línea en el carrito (el mismo que usaba el checkout original). */
  id: string;
  nombre: string;
  variante: string | null;
  variant_id: number;
  cantidad: number;
  /** Precio unitario que la clienta vio, no el de lista de hoy. */
  precio: number;
  imagen: string;
}

export type CarritoRestaurado =
  | {
      disponible: true;
      tipo: TipoCarrito;
      lineas: LineaRestaurada[];
      subtotal: number;
      /** Cupón que el link deja aplicado, o null. */
      cupon: string | null;
      descuento: number;
      total: number;
    }
  | {
      disponible: false;
      motivo: MotivoNoDisponible;
    };

/**
 * Ids que el checkout pone a las líneas de upsell. No son de Shopify, así que
 * la variante sale de aquí y no del catálogo.
 */
const VARIANTE_POR_ID_UPSELL: Record<string, number> = {
  "jabon-intimo-fem": VARIANT_IDS.jabon,
  "ovulos-fem": VARIANT_IDS.ovulos,
  "gomitas-pms": VARIANT_IDS.gomitas,
  // Línea de respaldo del checkout cuando Shopify no respondía.
  prod_001: VARIANT_IDS.principal,
};

interface LineaGuardada {
  id: string;
  nombre: string;
  variante: string | null;
  cantidad: number;
  precio: number;
  /** Solo lo traen las líneas de pedidos y las sesiones nuevas. */
  variantId: number | null;
  imagen?: string | null;
}

function aNumero(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  return 0;
}

function productoDeVariante(catalogo: ShopifyProduct[], variantId: number) {
  for (const p of catalogo) {
    const v = p.variants.find((x) => x.id === variantId);
    if (v) return { producto: p, variante: v };
  }
  return null;
}

/**
 * La variante de una línea de sesión antigua, que solo guardaba el id del
 * producto. Se decide por datos que identifican la variante sin adivinar: el
 * id guardado, el título de la variante o el precio que la clienta vio (el
 * mismo producto se vendía a 110.000 la unidad y a 199.900 el par). Si nada
 * de eso la distingue, se devuelve null y el carrito no se restaura.
 */
function resolverVariante(
  linea: LineaGuardada,
  catalogo: ShopifyProduct[],
  variantePrincipal: number | null
): number | null {
  if (linea.variantId) return linea.variantId;
  if (VARIANTE_POR_ID_UPSELL[linea.id]) return VARIANTE_POR_ID_UPSELL[linea.id];

  const producto = catalogo.find((p) => String(p.id) === linea.id);
  if (!producto) return null;

  if (variantePrincipal && producto.variants.some((v) => v.id === variantePrincipal)) {
    return variantePrincipal;
  }
  if (linea.variante) {
    const porTitulo = producto.variants.filter((v) => v.title === linea.variante);
    if (porTitulo.length === 1) return porTitulo[0].id;
  }
  // Varios productos repiten precio entre variantes equivalentes ("Compra
  // Única 1 / 1 unidad" y "Compra única 2 / 1 unidad", ambas a 110.000). Es el
  // mismo producto al mismo precio, así que cualquiera es fiel al carrito; se
  // prefiere la que el checkout ya vende.
  const porPrecio = producto.variants.filter(
    (v) => Math.round(parseFloat(v.price)) === Math.round(linea.precio)
  );
  const conocidas = new Set<number>([...Object.values(VARIANT_IDS), ...VARIANTES_CAMPANA]);
  if (porPrecio.length > 0) return (porPrecio.find((v) => conocidas.has(v.id)) ?? porPrecio[0]).id;
  // Con una sola variante no hay nada que distinguir, aunque el precio de
  // lista haya cambiado desde entonces.
  if (producto.variants.length === 1) return producto.variants[0].id;
  return null;
}

function lineasDeSesion(items: unknown): LineaGuardada[] {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 20).map((i) => {
    const it = i as Record<string, unknown>;
    const vid = aNumero(it.shopifyVariantId);
    return {
      id: String(it.id ?? ""),
      nombre: String(it.name ?? ""),
      variante: it.variant ? String(it.variant) : null,
      cantidad: Math.max(1, Math.round(aNumero(it.quantity ?? 1))),
      precio: aNumero(it.price),
      variantId: vid > 0 ? vid : null,
    };
  });
}

/** El cupón guardado, solo si sigue existiendo y de verdad descontó algo. */
function cuponGuardado(codigo: string | null, subtotal: number, total: number): string | null {
  if (!codigo) return null;
  const c = normalizeCoupon(codigo);
  if (getCouponRate(c) === undefined) return null;
  return total < subtotal ? c : null;
}

export async function restaurarCarrito(
  supabase: SupabaseClient,
  token: string,
  catalogo: ShopifyProduct[]
): Promise<CarritoRestaurado> {
  const verificado = verificarToken(token);
  if (!verificado) return { disponible: false, motivo: "token_invalido" };
  const { tipo, id, conDescuento } = verificado;

  let guardadas: LineaGuardada[];
  let variantePrincipal: number | null = null;
  let cupon: string | null;
  let creado: string;
  let convertido: boolean;

  if (tipo === "pago_no_completado") {
    const [{ data: orden }, { data: items }] = await Promise.all([
      supabase
        .from("orders")
        .select("created_at, payment_status, coupon_code, subtotal, total")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("order_items")
        .select("product_id, name, variant, price, quantity, image, shopify_variant_id")
        .eq("order_id", id)
        .order("created_at"),
    ]);
    if (!orden) return { disponible: false, motivo: "no_encontrado" };

    guardadas = (items ?? []).map((l) => ({
      id: String(l.product_id ?? l.shopify_variant_id ?? ""),
      nombre: l.name,
      variante: l.variant,
      cantidad: l.quantity,
      precio: aNumero(l.price),
      variantId: l.shopify_variant_id ?? null,
      imagen: l.image ?? null,
    }));
    const subtotal = guardadas.reduce((s, l) => s + l.precio * l.cantidad, 0);
    cupon = cuponGuardado(orden.coupon_code, subtotal, aNumero(orden.total));
    creado = orden.created_at;
    convertido = orden.payment_status === "approved";
  } else {
    const { data: sesion } = await supabase
      .from("checkout_sessions")
      .select("created_at, converted_at, coupon_code, subtotal, total, items, variant_id")
      .eq("id", id)
      .maybeSingle();
    if (!sesion) return { disponible: false, motivo: "no_encontrado" };

    guardadas = lineasDeSesion(sesion.items);
    variantePrincipal = sesion.variant_id ?? null;
    cupon = cuponGuardado(sesion.coupon_code, aNumero(sesion.subtotal), aNumero(sesion.total));
    creado = sesion.created_at;
    convertido = Boolean(sesion.converted_at);
  }

  if (guardadas.length === 0) return { disponible: false, motivo: "no_encontrado" };

  const edadDias = (Date.now() - new Date(creado).getTime()) / 86_400_000;
  if (edadDias > VIGENCIA_CARRITO_DIAS) return { disponible: false, motivo: "caducado" };

  // Además del origen, la cola sabe si la clienta terminó comprando por otro
  // camino (lo reconcilia el cron por teléfono).
  const { data: cola } = await supabase
    .from("crm_carritos")
    .select("estado")
    .eq("origen_id", id)
    .eq("tipo", tipo)
    .limit(1)
    .maybeSingle();
  if (convertido || cola?.estado === "recuperado") {
    return { disponible: false, motivo: "ya_comprado" };
  }

  const lineas: LineaRestaurada[] = [];
  for (const [i, g] of guardadas.entries()) {
    // Solo la primera línea es la del producto del link: las demás son
    // upsells o productos del selector, que no comparten su variante.
    const variantId = resolverVariante(g, catalogo, i === 0 ? variantePrincipal : null);
    if (!variantId) return { disponible: false, motivo: "producto_no_disponible" };

    const enCatalogo = productoDeVariante(catalogo, variantId);
    // Con catálogo disponible, una variante que ya no existe es un producto
    // que no se vende: no se resucita desde el carrito viejo.
    if (catalogo.length > 0 && !enCatalogo) {
      return { disponible: false, motivo: "producto_no_disponible" };
    }

    lineas.push({
      id: g.id,
      nombre: g.nombre,
      variante: g.variante,
      variant_id: variantId,
      cantidad: g.cantidad,
      precio: Math.round(g.precio),
      imagen: enCatalogo?.producto.images[0]?.src ?? g.imagen ?? "",
    });
  }

  if (conDescuento) cupon = CUPON_RECUPERACION;
  const subtotal = lineas.reduce((s, l) => s + l.precio * l.cantidad, 0);
  const descuento = cupon ? Math.round(subtotal * (getCouponRate(cupon) ?? 0)) : 0;

  return {
    disponible: true,
    tipo,
    lineas,
    subtotal,
    cupon,
    descuento,
    total: subtotal - descuento,
  };
}
