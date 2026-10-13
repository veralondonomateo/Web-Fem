/**
 * Cliente de la API de Sendura (última milla).
 *
 * Solo lo usa el entorno de pruebas (`/pruebas` y `/admin/pruebas`). Ningún
 * proceso de producción lo importa.
 *
 * Dos comportamientos de su API obligan a ser estrictos antes de llamar:
 *
 * 1. Los SKU desconocidos **se ignoran en silencio**. Su documentación dice
 *    que solo rechaza el payload si *ninguno* de los SKU existe; si mandas
 *    tres productos y solo uno está en su inventario, responde 201 con guía y
 *    despacha un pedido incompleto. Por eso `resolverItemsSendura` exige que
 *    todos los items tengan SKU antes de intentar el envío.
 *
 * 2. Si se omite `total_price` lo autocalcula desde los items, y ese cálculo
 *    no conoce el envío ni el descuento. Siempre se manda explícito.
 */

const SENDURA_URL =
  process.env.SENDURA_API_URL ?? "https://sendura.edgasanc.com/api/v1/orders";

/** Margen antes de cortar la llamada. Ver la nota sobre timeouts más abajo. */
const TIMEOUT_MS = 20_000;

export interface SenduraItem {
  sku: string;
  name: string;
  quantity: number;
  price?: number;
}

export interface SenduraOrderInput {
  order_number?: string;
  shopify_id?: string;
  customer_name: string;
  customer_email?: string;
  customer_phone?: string;
  shipping_address_1: string;
  shipping_address_2?: string;
  shipping_city: string;
  shipping_province: string;
  shipping_country: string;
  notes?: string;
  total_price?: number;
  financial_status?: "paid" | "pending";
  items: SenduraItem[];
}

export interface SenduraOk {
  status: "success";
  message?: string;
  order_id: number | string;
  order_number?: string;
  guia_number?: string;
}

/**
 * Motivo del fallo, ya clasificado.
 *
 * `transitorio` es el único que en producción justificaría un reintento, y
 * aun así hay que tener cuidado: un timeout puede significar que la guía sí
 * se creó y la respuesta se perdió. Sendura no expone un endpoint de consulta
 * para desempatar, así que reintentar a ciegas puede producir dos despachos.
 */
export type SenduraMotivo =
  | "cobertura"
  | "sku"
  | "validacion"
  | "auth"
  | "transitorio"
  | "desconocido";

export class SenduraError extends Error {
  constructor(
    message: string,
    readonly motivo: SenduraMotivo,
    readonly httpStatus: number | null,
    readonly respuesta: unknown
  ) {
    super(message);
    this.name = "SenduraError";
  }
}

function clasificar(httpStatus: number, mensaje: string): SenduraMotivo {
  if (httpStatus === 401) return "auth";
  if (httpStatus >= 500) return "transitorio";
  if (httpStatus === 422) {
    if (/cobertura/i.test(mensaje)) return "cobertura";
    if (/sku/i.test(mensaje)) return "sku";
    return "validacion";
  }
  return "desconocido";
}

/** Crea la orden en Sendura. Lanza `SenduraError` con el motivo clasificado. */
export async function crearOrdenSendura(
  input: SenduraOrderInput
): Promise<{ ok: SenduraOk; httpStatus: number }> {
  const token = process.env.SENDURA_TOKEN;
  if (!token) {
    throw new SenduraError("Falta SENDURA_TOKEN en el entorno", "auth", null, null);
  }

  const controlador = new AbortController();
  const corte = setTimeout(() => controlador.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(SENDURA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: controlador.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new SenduraError(
      `No hubo respuesta de Sendura (${msg}). Puede que la guía sí se haya creado: verificar en su panel antes de reintentar.`,
      "transitorio",
      null,
      null
    );
  } finally {
    clearTimeout(corte);
  }

  const texto = await res.text();
  let cuerpo: unknown = texto;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    /* Sendura devolvió algo que no es JSON — se conserva el texto crudo */
  }

  const mensaje =
    (cuerpo as { message?: string } | null)?.message ?? texto.slice(0, 300);

  if (!res.ok) {
    throw new SenduraError(mensaje, clasificar(res.status, mensaje), res.status, cuerpo);
  }

  const ok = cuerpo as SenduraOk;
  if (ok?.status !== "success") {
    throw new SenduraError(mensaje || "Respuesta inesperada", "desconocido", res.status, cuerpo);
  }

  return { ok, httpStatus: res.status };
}

// ── Resolución de SKU ──────────────────────────────────────────────────────
export interface ItemPedido {
  name: string;
  variant?: string | null;
  price: number;
  quantity: number;
  shopifyVariantId?: number | null;
}

export interface ItemResuelto extends ItemPedido {
  sku: string | null;
}

/**
 * Empareja cada item con su SKU de Shopify a través del ID de variante.
 *
 * El ID de variante es el enlace fiable: sobrevive renombres del producto, y
 * el SKU sí se repite entre productos (el 117700 lo comparten el jabón y un
 * combo). Si el ID no está en el catálogo, el item queda sin SKU y el pedido
 * completo se descarta para Sendura — nunca se manda a medias.
 */
export function resolverItemsSendura(
  items: ItemPedido[],
  catalogo: Array<{ variants: Array<{ id: number; sku: string }> }>
): { items: ItemResuelto[]; faltantes: string[] } {
  const porVariante = new Map<number, string>();
  for (const producto of catalogo) {
    for (const v of producto.variants) {
      if (v.sku) porVariante.set(v.id, v.sku);
    }
  }

  const resueltos = items.map((item) => ({
    ...item,
    sku: item.shopifyVariantId ? porVariante.get(item.shopifyVariantId) ?? null : null,
  }));

  const faltantes = resueltos
    .filter((i) => !i.sku)
    .map((i) => `${i.name}${i.variant ? ` – ${i.variant}` : ""}`);

  return { items: resueltos, faltantes };
}
