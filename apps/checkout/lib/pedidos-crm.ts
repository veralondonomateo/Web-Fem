/**
 * Forma del pedido despachado que ve el CRM.
 *
 * Existe por un problema concreto de operación: cuando el pedido sale por
 * Sendura, ellos llaman a la clienta desde un número que no conoce para
 * coordinar la entrega. Mucha gente se asusta —"¿de dónde sacaron mi
 * teléfono?"— y desconfía o rechaza el pedido. El CRM le escribe antes por
 * WhatsApp avisándole de que esa llamada va a llegar.
 *
 * Los pedidos que salen por Shopify ya tienen su propio flujo en el CRM, así
 * que aquí viajan igual pero marcados: quien consume decide qué hacer con cada
 * transportadora.
 */

export type Transportadora = "sendura" | "shopify";

export interface ProductoPedido {
  nombre: string;
  variante: string | null;
  cantidad: number;
  precio: number;
}

export interface ClientePedido {
  nombre: string;
  nombre_completo: string;
  /** Tal como lo escribió la clienta. */
  telefono: string;
  /** Solo dígitos, listo para WhatsApp. */
  telefono_local: string;
  email: string | null;
  cedula: string | null;
  direccion: string | null;
  complemento: string | null;
  ciudad: string | null;
  departamento: string | null;
}

export interface PedidoCRM {
  id: string;
  /** `sendura` o `shopify`. Nunca es null: solo entran pedidos ya despachados. */
  transportadora: Transportadora;
  /** Número de guía de Sendura. Null cuando salió por Shopify. */
  guia: string | null;
  /** Referencia del operador: id de Sendura o número de orden de Shopify. */
  referencia_operador: string;
  cliente: ClientePedido;
  productos: ProductoPedido[];
  subtotal: number;
  envio: number;
  descuento: number;
  cupon: string | null;
  total: number;
  /** `contraentrega` o `anticipado`. */
  metodo_pago: "contraentrega" | "anticipado";
  creado_at: string;
  despachado_at: string;
  /** Cuándo el CRM avisó a la clienta, si ya lo hizo. */
  avisado_at: string | null;
  /**
   * ¿Hay que mandarle el aviso de WhatsApp?
   *
   * Solo los de Sendura y solo si nadie los avisó todavía. Se recalcula en cada
   * lectura para que un CRM que perdió su cursor y vuelve a recorrer la cola no
   * escriba dos veces a la misma persona.
   */
  debe_avisar: boolean;
}

/** Fila de `orders` con lo que necesita la cola. */
export interface FilaPedido {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  cedula: string | null;
  phone: string | null;
  address: string | null;
  complement: string | null;
  city: string | null;
  state: string | null;
  payment_method: string | null;
  subtotal: number | null;
  shipping: number | null;
  discount: number | null;
  coupon_code: string | null;
  total: number | null;
  created_at: string;
  despachado_at: string | null;
  despacho_secuencia: number;
  crm_avisado_at: string | null;
  sendura_order_id: string | null;
  sendura_guia: string | null;
  shopify_order_id: number | string | null;
}

const soloDigitos = (t: string | null) => String(t ?? "").replace(/\D/g, "");

export function armarPedido(
  fila: FilaPedido,
  productos: ProductoPedido[]
): PedidoCRM {
  const transportadora: Transportadora = fila.sendura_order_id ? "sendura" : "shopify";
  const nombre = (fila.first_name ?? "").trim();

  return {
    id: fila.id,
    transportadora,
    guia: fila.sendura_guia ?? null,
    referencia_operador: String(fila.sendura_order_id ?? fila.shopify_order_id ?? ""),
    cliente: {
      nombre,
      nombre_completo: `${nombre} ${fila.last_name ?? ""}`.trim(),
      telefono: fila.phone ?? "",
      telefono_local: soloDigitos(fila.phone),
      email: fila.email,
      cedula: fila.cedula,
      direccion: fila.address,
      complemento: fila.complement,
      ciudad: fila.city,
      departamento: fila.state,
    },
    productos,
    subtotal: Number(fila.subtotal ?? 0),
    envio: Number(fila.shipping ?? 0),
    descuento: Number(fila.discount ?? 0),
    cupon: fila.coupon_code,
    total: Number(fila.total ?? 0),
    // En la base es "mercadopago"; para el CRM se nombra como en el checkout.
    metodo_pago: fila.payment_method === "contraentrega" ? "contraentrega" : "anticipado",
    creado_at: fila.created_at,
    despachado_at: fila.despachado_at ?? fila.created_at,
    avisado_at: fila.crm_avisado_at,
    debe_avisar: transportadora === "sendura" && !fila.crm_avisado_at,
  };
}

/** Columnas que hay que pedirle a Supabase para armar el pedido. */
export const COLUMNAS_PEDIDO = `
  id, first_name, last_name, email, cedula, phone, address, complement, city, state,
  payment_method, subtotal, shipping, discount, coupon_code, total, created_at,
  despachado_at, despacho_secuencia, crm_avisado_at,
  sendura_order_id, sendura_guia, shopify_order_id
`.replace(/\s+/g, " ").trim();
