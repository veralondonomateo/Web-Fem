import { createHmac, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCouponRate } from "@/lib/coupons";

/**
 * Recuperación de carritos abandonados.
 *
 * Hay dos fuentes de carrito y el CRM las consume por la misma cola:
 *
 * - `pago_no_completado`: la clienta llenó todo, eligió Mercado Pago y el pago
 *   nunca quedó aprobado. La fila ya existe en `orders` desde antes de este
 *   sistema — no se creó nada para capturarla.
 * - `datos_parciales`: llenó al menos nombre y celular pero nunca envió el
 *   pedido. Se captura en `checkout_sessions` desde /api/checkout/track.
 *
 * Nada de esto escribe sobre `orders`: el flujo de compra no cambia.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://checkoutfem.com";

/** 'o' = orden de Mercado Pago sin pagar · 's' = sesión con datos parciales */
export type TipoCarrito = "pago_no_completado" | "datos_parciales";

const PREFIJO: Record<TipoCarrito, string> = {
  pago_no_completado: "o",
  datos_parciales: "s",
};

/**
 * El descuento viaja dentro del token (prefijo `od`/`sd`), no como parámetro
 * suelto en la URL.
 *
 * Así el link con descuento sigue siendo **una sola cadena** —lo que Meta
 * necesita para el botón de URL dinámica— y, como la firma cubre el prefijo,
 * nadie puede convertir un link normal en uno con descuento sin el secreto.
 */
const SUFIJO_DESCUENTO = "d";

/** Cupón que aplican los links de recuperación. Debe existir en lib/coupons. */
export const CUPON_RECUPERACION = process.env.CUPON_RECUPERACION ?? "VUELVE10";

/**
 * Minutos de inactividad antes de considerar abandonado un carrito.
 *
 * Corto a propósito: el CRM espera 45 minutos más antes del primer mensaje, y
 * ese es el reloj que manda. Aquí solo se trata de no encolar a alguien que
 * todavía está escribiendo su dirección.
 */
export const MADURACION_MIN = Number(process.env.CARRITO_MADURACION_MIN ?? 15);

/** Pasada esta ventana el carrito está frío y ya no se encola. */
export const VENTANA_MAX_HORAS = Number(process.env.CARRITO_VENTANA_HORAS ?? 24);

/** Espera que el CRM aplica antes del primer mensaje. Solo informativo. */
export const ESPERA_PRIMER_MENSAJE_MIN = Number(
  process.env.CRM_ESPERA_MIN ?? 45
);

/**
 * Celular colombiano a E.164. Devuelve null si no parece un móvil válido —
 * y sin móvil válido el carrito no sirve para WhatsApp, así que no se encola.
 */
export function normalizarTelefono(phone?: string | null): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.startsWith("57") && d.length === 12) d = d.slice(2);
  if (!/^3\d{9}$/.test(d)) return null;
  return `+57${d}`;
}

/** Los últimos 10 dígitos, como los guarda `orders.phone`. */
export function soloDigitos(telefonoE164: string): string {
  return telefonoE164.replace(/\D/g, "").replace(/^57/, "");
}

// ── Tokens de recuperación ──────────────────────────────────────────────────

function secreto(): string {
  const s = process.env.RECOVERY_SECRET ?? process.env.CRON_SECRET;
  if (!s) throw new Error("Falta RECOVERY_SECRET (o CRON_SECRET) para firmar los links de recuperación");
  return s;
}

function firmar(payload: string): string {
  return createHmac("sha256", secreto()).update(payload).digest("hex").slice(0, 20);
}

/**
 * Token opaco y firmado para el link de "termina tu compra".
 *
 * Formato `<tipo>.<uuid>.<firma>`. La firma es lo que impide que alguien
 * enumere UUIDs y se traiga los datos de otras clientas: sin el secreto no se
 * puede fabricar un token válido.
 */
export function crearToken(tipo: TipoCarrito, id: string, conDescuento = false): string {
  const base = `${PREFIJO[tipo]}${conDescuento ? SUFIJO_DESCUENTO : ""}.${id}`;
  return `${base}.${firmar(base)}`;
}

export function verificarToken(
  token: string
): { tipo: TipoCarrito; id: string; conDescuento: boolean } | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  const [prefijo, id, firma] = partes;

  const conDescuento = prefijo.endsWith(SUFIJO_DESCUENTO);
  const base = conDescuento ? prefijo.slice(0, -1) : prefijo;
  const tipo = (Object.keys(PREFIJO) as TipoCarrito[]).find((t) => PREFIJO[t] === base);
  if (!tipo) return null;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const esperada = firmar(`${prefijo}.${id}`);
  // Comparación de tiempo constante: comparar con === filtra tokens por
  // tiempo de respuesta y permite adivinar la firma byte a byte.
  const a = Buffer.from(firma);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return { tipo, id, conDescuento };
}

/**
 * Link corto de "termina tu compra": `/r/<token>`.
 *
 * Corto a propósito. En WhatsApp el link se ve entero en el chat y, sobre todo,
 * el botón de URL dinámica de Meta lleva una sola variable
 * (`checkoutfem.com/r/{{1}}`) en vez de una cadena con `&` adentro, que da
 * fricción en la revisión. La variante, la cantidad y el cupón los resuelve
 * `/r/[token]` contra la base y los pasa al checkout.
 */
export function linkRecuperacion(
  tipo: TipoCarrito,
  id: string,
  conDescuento = false
): string {
  return `${APP_URL}/r/${crearToken(tipo, id, conDescuento)}`;
}

// ── Supresión ───────────────────────────────────────────────────────────────

/**
 * ¿Este celular ya compró?
 *
 * Es la regla más importante del sistema: en los últimos 30 días el 44 % de
 * los checkouts de Mercado Pago sin pagar terminaron comprando por su cuenta.
 * Escribirle a esa gente un "no terminaste tu compra" cuando el pedido ya va
 * en camino quema la marca y provoca reportes de spam en WhatsApp.
 */
export async function yaCompro(
  supabase: SupabaseClient,
  telefonoE164: string,
  desde: Date
): Promise<boolean> {
  const { data, error } = await supabase.rpc("telefono_ya_compro", {
    p_celular: telefonoE164,
    p_desde: desde.toISOString(),
  });

  if (error) {
    // Ante la duda, no contactar: un mensaje de más a quien ya compró cuesta
    // mucho más que un mensaje de menos.
    console.error("[Carritos] Error verificando compra previa:", error);
    return true;
  }
  return Boolean(data);
}

/** Opt-out permanente reportado por el CRM. */
export async function estaSuprimido(
  supabase: SupabaseClient,
  telefonoE164: string
): Promise<boolean> {
  const { data } = await supabase
    .from("crm_supresiones")
    .select("telefono")
    .eq("telefono", telefonoE164)
    .maybeSingle();
  return Boolean(data);
}

// ── Forma del carrito que ve el CRM ─────────────────────────────────────────

export interface ProductoCarrito {
  nombre: string;
  variante: string | null;
  cantidad: number;
  precio: number;
}

export interface CarritoCRM {
  id: string;
  tipo: TipoCarrito;
  estado: string;
  nombre: string;
  nombre_completo: string;
  telefono: string;
  telefono_local: string;
  email: string | null;
  ciudad: string | null;
  departamento: string | null;
  productos: ProductoCarrito[];
  total: number;
  link_recuperacion: string;
  /** El mismo link, pero deja el cupón de recuperación ya aplicado. */
  link_recuperacion_descuento: string;
  /** Código del cupón que aplica ese link, para nombrarlo en el mensaje. */
  cupon_descuento: string;
  /** Porcentaje de ese cupón (10 = 10 %). */
  descuento_porcentaje: number;
  detectado_at: string;
  contactar_desde: string;
  mensajes_enviados: number;
  /** Recalculado en vivo: false si ya compró, se dio de baja o fue descartado. */
  debe_contactar: boolean;
}

/** Fila de `crm_carritos` tal como sale de Supabase. */
export interface FilaCarrito {
  id: string;
  tipo: TipoCarrito;
  origen_id: string;
  telefono: string;
  nombre: string | null;
  estado: string;
  detectado_at: string;
  mensajes_enviados: number;
}

interface DatosOrigen {
  nombre: string;
  apellido: string;
  email: string | null;
  ciudad: string | null;
  departamento: string | null;
  productos: ProductoCarrito[];
  total: number;
  variantId: number | null;
  qty: number | null;
}

export function armarCarrito(
  fila: FilaCarrito,
  origen: DatosOrigen,
  debeContactar: boolean
): CarritoCRM {
  const nombre = origen.nombre.trim();
  const completo = `${nombre} ${origen.apellido ?? ""}`.trim();
  const contactarDesde = new Date(
    new Date(fila.detectado_at).getTime() + ESPERA_PRIMER_MENSAJE_MIN * 60_000
  );

  return {
    id: fila.id,
    tipo: fila.tipo,
    estado: fila.estado,
    nombre,
    nombre_completo: completo,
    telefono: fila.telefono,
    telefono_local: soloDigitos(fila.telefono),
    email: origen.email,
    ciudad: origen.ciudad,
    departamento: origen.departamento,
    productos: origen.productos,
    total: origen.total,
    link_recuperacion: linkRecuperacion(fila.tipo, fila.origen_id),
    link_recuperacion_descuento: linkRecuperacion(fila.tipo, fila.origen_id, true),
    cupon_descuento: CUPON_RECUPERACION,
    descuento_porcentaje: Math.round((getCouponRate(CUPON_RECUPERACION) ?? 0) * 100),
    detectado_at: fila.detectado_at,
    contactar_desde: contactarDesde.toISOString(),
    mensajes_enviados: fila.mensajes_enviados,
    debe_contactar: debeContactar,
  };
}
