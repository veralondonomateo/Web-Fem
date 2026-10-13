/**
 * Cliente de la API de carritos abandonados del checkout propio de Fem.
 *
 * El checkout detecta el carrito, aplica sus reglas de supresión (ya compró,
 * pidió no ser contactada, sin celular) y lo deja en una cola. Aquí solo se
 * lee esa cola y se reporta qué hizo el CRM con cada carrito.
 *
 * Documentación: https://checkoutfem.com  ·  todas las rutas piden CHECKOUT_API_KEY.
 */

const BASE_URL = process.env.CHECKOUT_API_URL || 'https://checkoutfem.com/api/crm';
const TIMEOUT_MS = 30_000;

export type TipoCarrito = 'pago_no_completado' | 'datos_parciales';

export type MotivoNoContactar =
  | 'ya_compro' | 'opt_out' | 'estado_recuperado' | 'estado_perdido' | null;

export interface ProductoCarrito {
  nombre: string;
  variante?: string | null;
  cantidad?: number;
  precio?: number;
  /** Solo en lo que devuelve el link: la variante concreta que abrirá. */
  variant_id?: number;
}

/**
 * Qué va a abrir de verdad el link de recuperación.
 *
 * Lo añadió el checkout después de un fallo que costó meses de mensajes: el
 * link no reconstruía el carrito y caía en un producto por defecto, así que el
 * recordatorio nombraba un combo y la clienta aterrizaba en un probiótico
 * suelto. Ver `docs/checkout-link-recuperacion.md`.
 *
 * `coincide` es el campo que importa: lo pone el checkout comparando lo que
 * abrirá el link contra el carrito que él mismo reporta. Si es false, el
 * mensaje se contradiría con la página y NO se manda.
 */
export interface LinkRestaura {
  disponible: boolean;
  /** Código corto cuando no se puede abrir: `ya_comprado`, etc. */
  motivo: string | null;
  productos: ProductoCarrito[];
  subtotal?: number;
  cupon?: string | null;
  descuento?: number;
  total?: number;
  coincide: boolean;
}

export interface CarritoCheckout {
  id: string;
  tipo: TipoCarrito;
  estado: string;
  nombre: string;
  nombre_completo?: string;
  telefono: string;
  telefono_local?: string;
  email?: string | null;
  ciudad?: string | null;
  departamento?: string | null;
  productos: ProductoCarrito[];
  total?: number;
  link_recuperacion: string;
  link_recuperacion_descuento?: string;
  cupon_descuento?: string;
  descuento_porcentaje?: number;
  detectado_at: string;
  contactar_desde: string;
  mensajes_enviados: number;
  debe_contactar: boolean;
  motivo_no_contactar?: MotivoNoContactar;
  /** Lo que abrirá `link_recuperacion`. Solo en el detalle, no en la cola. */
  link_restaura?: LinkRestaura;
  /** Lo mismo para `link_recuperacion_descuento`. */
  link_descuento_restaura?: LinkRestaura;
}

export interface PaginaCarritos {
  carritos: CarritoCheckout[];
  cursor: number | null;
  cantidad: number;
  hay_mas: boolean;
}

/** Eventos que el CRM reporta al checkout. Sin esto no hay métricas ni bajas. */
export type EventoCarrito =
  | 'mensaje_enviado' | 'respondio' | 'recuperado' | 'opt_out' | 'descartado';

export class CheckoutNoConfigurado extends Error {}

function headers(): Record<string, string> {
  const key = process.env.CHECKOUT_API_KEY;
  if (!key) throw new CheckoutNoConfigurado('CHECKOUT_API_KEY no configurado');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

/** 404 no se reintenta; 5xx sí. Igual criterio que con Mastershop. */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

async function pedir<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  let ultimo: Error = new Error('checkout: sin intentos');

  for (let intento = 1; intento <= MAX_ATTEMPTS; intento++) {
    try {
      const res = await fetch(`${BASE_URL}${ruta}`, {
        ...init,
        headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (res.ok) return (await res.json()) as T;

      const cuerpo = await res.text().catch(() => '');
      const detalle = cuerpo.slice(0, 200);

      if (!RETRYABLE.has(res.status)) {
        throw new NoReintentable(`checkout ${res.status} en ${ruta}: ${detalle}`);
      }
      ultimo = new Error(`checkout ${res.status} en ${ruta}: ${detalle}`);
    } catch (e) {
      if (e instanceof NoReintentable || e instanceof CheckoutNoConfigurado) throw e;
      ultimo = e instanceof Error ? e : new Error(String(e));
    }

    if (intento < MAX_ATTEMPTS) {
      await new Promise(r => setTimeout(r, Math.min(1000 * 2 ** (intento - 1), 8000) + Math.random() * 400));
    }
  }

  throw ultimo;
}

class NoReintentable extends Error {}

/** Una página de la cola. Guarda el cursor para la siguiente llamada. */
export function listarCarritos(opts: { cursor?: number | null; limite?: number } = {}) {
  const p = new URLSearchParams({ limite: String(opts.limite ?? 100) });
  if (opts.cursor) p.set('cursor', String(opts.cursor));
  return pedir<PaginaCarritos>(`/carritos?${p}`);
}

/**
 * Detalle en vivo. Hay que llamarlo JUSTO ANTES de cada mensaje: durante la
 * espera la clienta pudo comprar sola. Según el checkout, 4 de cada 10 que no
 * completan el pago terminan comprando; escribirles entonces quema la marca.
 */
export function obtenerCarrito(id: string) {
  return pedir<CarritoCheckout>(`/carritos/${id}`);
}

export function reportarEvento(id: string, evento: EventoCarrito, nota?: string) {
  return pedir<unknown>(`/carritos/${id}/eventos`, {
    method: 'POST',
    body: JSON.stringify(nota ? { evento, nota } : { evento }),
  });
}

// ── Pedidos despachados (aviso de Sendura) ─────────────────────────────────
//
// Cola aparte de la de carritos y con otra naturaleza: aquí no hay nadie que
// dejara de comprar. Son pedidos confirmados y ya despachados a los que hay que
// avisarles de que Sendura va a llamarlos, porque una llamada de un número
// desconocido asusta y hay quien rechaza el pedido por eso.

export type TransportadoraPedido = 'sendura' | 'shopify';

export interface PedidoDespachado {
  id: string;
  transportadora: TransportadoraPedido;
  guia?: string | null;
  referencia_operador?: string | null;
  cliente: {
    nombre: string;
    nombre_completo?: string;
    telefono: string;
    telefono_local?: string;
    email?: string | null;
    cedula?: string | null;
    direccion?: string | null;
    complemento?: string | null;
    ciudad?: string | null;
    departamento?: string | null;
  };
  productos: ProductoCarrito[];
  subtotal?: number;
  envio?: number;
  descuento?: number;
  cupon?: string | null;
  total?: number;
  metodo_pago?: string;
  creado_at: string;
  despachado_at: string;
  avisado_at: string | null;
  debe_avisar: boolean;
}

export interface PaginaPedidos {
  pedidos: PedidoDespachado[];
  cursor: number | null;
  cantidad: number;
  hay_mas: boolean;
}

export function listarPedidos(opts: {
  cursor?: number | null; limite?: number;
  transportadora?: TransportadoraPedido; desde?: string;
} = {}) {
  const p = new URLSearchParams({ limite: String(opts.limite ?? 50) });
  if (opts.transportadora) p.set('transportadora', opts.transportadora);
  if (opts.cursor) p.set('cursor', String(opts.cursor));
  if (opts.desde) p.set('desde', opts.desde);
  return pedir<PaginaPedidos>(`/pedidos?${p}`);
}

/**
 * El pedido con `debe_avisar` recalculado. Obligatorio JUSTO ANTES de escribir:
 * si otro proceso ya avisó viene en false, y sin esta llamada un reintento de
 * una tanda le escribe dos veces a la misma clienta.
 */
export function obtenerPedido(id: string) {
  return pedir<PedidoDespachado>(`/pedidos/${id}`);
}

/**
 * Sella `avisado_at`. Hay que llamarlo SIEMPRE después de enviar: es lo único
 * que impide repetir el aviso si nuestro cursor se pierde. Si ya estaba avisado
 * responde `ya_estaba: true` y no pisa la hora original.
 */
export function reportarAvisoPedido(id: string) {
  return pedir<{ ok: boolean; ya_estaba?: boolean }>(`/pedidos/${id}/eventos`, {
    method: 'POST',
    body: JSON.stringify({ evento: 'aviso_enviado' }),
  });
}

/** El token que va después de /r/ — es lo que consume el botón de la plantilla. */
export function tokenDeLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const m = link.match(/\/r\/([^/?#]+)/);
  return m ? m[1] : null;
}
