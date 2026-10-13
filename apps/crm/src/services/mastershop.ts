import { Prisma } from '@prisma/client';

const BASE_URL = 'https://prod.api.mastershop.com/api';

export type MastershopOrderStatus =
  | 'Por Confirmar' | 'Pendiente'
  | 'Por Alistar'   | 'Por Recolectar'
  | 'En tránsito'   | 'En Tránsito'
  | 'Recolectada'
  | 'En reparto'    | 'En Reparto'
  | 'En oficina'    | 'En Oficina'
  | 'Entregada'     | 'Cancelada'
  | 'Devuelta'      | 'Reclamaciones';

export interface MastershopOrder {
  idOrder: number;
  externalOrderId: string | null;
  carrierTrackingCode: string;
  items: { name: string; quantity?: number; price?: number }[];
  lastCarrierStatusUpdate: string;
  clientInfo: {
    city: string;
    phone: string | number;
    state: string;
    address: string;
    fullName: string;
  };
  paymentMethod: 'cod' | 'transfer';
  totalOrder: number;
  totalProvider: number;
  currency: string;
  orderStatus: string;
  statusParent: string;
  carrierName: string;
  createdAt: string;
}

export const MASTERSHOP_TO_CRM_STATUS: Record<MastershopOrderStatus, string> = {
  'Por Confirmar':  'PENDING_CONFIRMATION',
  'Pendiente':      'PENDING_CONFIRMATION',
  'Por Alistar':    'PREPARING',
  'Por Recolectar': 'PREPARING',
  'Recolectada':    'IN_TRANSIT',
  'En tránsito':    'IN_TRANSIT',
  'En Tránsito':    'IN_TRANSIT',
  'En reparto':     'IN_TRANSIT',
  'En Reparto':     'IN_TRANSIT',
  'En oficina':     'IN_DESTINATION',
  'En Oficina':     'IN_DESTINATION',
  'Entregada':      'DELIVERED',
  'Cancelada':      'CANCELLED',
  'Devuelta':       'RETURNED',
  'Reclamaciones':  'FAILED_DELIVERY',
};

// Mapa normalizado en minúsculas para manejo robusto de variantes de capitalización
const STATUS_LOWER_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(MASTERSHOP_TO_CRM_STATUS).map(([k, v]) => [k.toLowerCase(), v])
);

export function mastershopStatusToCrm(raw: string): string {
  return MASTERSHOP_TO_CRM_STATUS[raw as MastershopOrderStatus]
    ?? STATUS_LOWER_MAP[raw.toLowerCase()]
    ?? 'PENDING_CONFIRMATION';
}

// Filtro aceptado por POST /orders/list. Sin startDate/finalDate la API
// solo devuelve los últimos ~7 días, por eso el sync siempre pasa un rango.
export interface ListOrdersFilter {
  orderStatusParent?: string;
  orderStatus?: MastershopOrderStatus;
  externalOrderId?: string;
  idOrder?: number;
  startDate?: string; // YYYY-MM-DD
  finalDate?: string; // YYYY-MM-DD
}

function getHeaders() {
  const apiKey = process.env.MASTERSHOP_API_KEY;
  if (!apiKey) throw new Error('MASTERSHOP_API_KEY no configurado');
  return { 'ms-api-key': apiKey, 'Content-Type': 'application/json' };
}

/**
 * La API ignora `limit` por encima de 50: pidas lo que pidas, devuelve 50. Medido
 * contra la cuenta real con 100, 200 y 500. Así que el tamaño de página es fijo
 * y la única forma de ir más rápido es pedir varias páginas a la vez.
 */
export const PAGE_SIZE = 50;

/**
 * Cada petición tarda ~12 s contra la cuenta real, y la latencia no depende de
 * la página ni del ancho de la ventana: es tiempo del servidor de Mastershop.
 * En secuencia, un mes de pedidos se iba a varios minutos.
 *
 * Medido sobre la misma ventana de 22 páginas (1.100 pedidos), varias corridas:
 *
 *   concurrencia  3 → 211 s  (4 reintentos)
 *   concurrencia  5 →  96 s  (2 reintentos)
 *   concurrencia  8 →  45-70 s  (0 reintentos)
 *   concurrencia 12 →  47 s  (0 reintentos)
 *   concurrencia 16 →  82 s  (2 reintentos — la API empieza a devolver 504)
 *
 * 12 es la meseta: por encima, los 504 y sus esperas cuestan más de lo que se
 * gana. Si algún día Mastershop aprieta el límite, bajar este número es lo
 * primero que hay que probar.
 */
const PAGE_CONCURRENCY = 12;

/** Tope duro por tramo: 400 × 50 = 20.000 pedidos. Ver el throw de listAllOrders. */
const MAX_PAGES = 400;

/** 504 esporádicos son lo normal en esta API; los transitorios se reintentan. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 5;
const REQUEST_TIMEOUT_MS = 90_000;

/** Un 4xx que no sea 408/425/429 no mejora por reintentarlo: aborta ya. */
class NonRetryableError extends Error {}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function listOrders(filter: ListOrdersFilter = {}, page = 1, limit = PAGE_SIZE): Promise<MastershopOrder[]> {
  let lastError: Error = new Error('Mastershop: la petición no llegó a intentarse');

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/orders/list?page=${page}&limit=${limit}`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(filter),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return await res.json();

      if (!RETRYABLE_STATUS.has(res.status)) {
        throw new NonRetryableError(`Mastershop API error: ${res.status}`);
      }
      lastError = new Error(`Mastershop API error: ${res.status} (página ${page})`);
    } catch (e) {
      if (e instanceof NonRetryableError) throw e;
      // Timeout del AbortSignal o caída de red: reintentable.
      lastError = e instanceof Error ? e : new Error(String(e));
    }

    if (attempt < MAX_ATTEMPTS) {
      // Exponencial con jitter: sin el jitter, las 8 páginas en vuelo
      // reintentarían todas a la vez y volverían a tumbar la API.
      await sleep(Math.min(1500 * 2 ** (attempt - 1), 15_000) + Math.random() * 500);
    }
  }

  throw lastError;
}

/**
 * Todas las páginas de un filtro, pidiéndolas en tandas paralelas.
 *
 * La API no dice cuántas páginas hay, así que se pide una tanda de
 * PAGE_CONCURRENCY y se corta en cuanto una vuelve incompleta o vacía. Se piden
 * como mucho PAGE_CONCURRENCY-1 páginas de más al final; salen vacías y cuestan
 * bastante menos que ir de una en una.
 */
export async function listAllOrders(filter: ListOrdersFilter = {}): Promise<MastershopOrder[]> {
  const all: MastershopOrder[] = [];
  let reachedEnd = false;

  for (let base = 1; base <= MAX_PAGES; base += PAGE_CONCURRENCY) {
    const pages: number[] = [];
    for (let i = 0; i < PAGE_CONCURRENCY && base + i <= MAX_PAGES; i++) pages.push(base + i);

    const batches = await Promise.all(pages.map(p => listOrders(filter, p, PAGE_SIZE)));

    for (const batch of batches) {
      if (!batch?.length) { reachedEnd = true; continue; }
      all.push(...batch);
      if (batch.length < PAGE_SIZE) reachedEnd = true;
    }
    if (reachedEnd) break;
  }

  // Salir por el tope y no por haber llegado al final significa que quedaron
  // pedidos sin leer. Devolverlos a medias sería peor que fallar: el sync
  // marcaría el tramo como completo y nadie volvería a mirarlo. Quien llama
  // parte la ventana en tramos lo bastante estrechos para que esto no pase.
  if (!reachedEnd) {
    throw new Error(
      `Mastershop: el tramo ${filter.startDate}→${filter.finalDate} supera las ${MAX_PAGES} páginas ` +
      `(${MAX_PAGES * PAGE_SIZE} pedidos). Hay que pedirlo en tramos más cortos.`,
    );
  }

  return all;
}

export function normalizePhone(raw: string | number): string {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('57') && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+57${digits}`;
  // Ni 10 dígitos ni 57+10. Se deja con el prefijo igualmente porque `phone` es
  // la clave única de la clienta y hace falta algo estable, pero el número NO
  // es válido: usa esCelularValido antes de intentar escribirle.
  return `+57${digits}`;
}

/**
 * Celular colombiano al que se puede escribir: +57 y 10 dígitos que empiezan por 3.
 *
 * Hace falta porque el dato de origen viene sucio: de 20.332 clientas, 206
 * llegaron de Mastershop con 9 u 11 dígitos (errores de digitación en el
 * pedido). `normalizePhone` les pone el +57 igual —necesita una clave estable—
 * y el resultado parece válido sin serlo.
 *
 * Intentar enviarles WhatsApp no solo falla: los envíos fallidos repetidos
 * bajan la calificación del número emisor, que hoy está en GREEN.
 */
export function esCelularValido(phone: string | null | undefined): boolean {
  return typeof phone === 'string' && /^\+573\d{9}$/.test(phone);
}

/**
 * ¿Se le puede mandar un WhatsApp a este destino?
 *
 * Es más amplio que `esCelularValido` a propósito, y la diferencia importa:
 * quien oculta su número no llega con celular sino con el identificador de Meta
 * («CO.1825897111735754»), y a ese SÍ se le puede escribir —va en `recipient`
 * en vez de en `to`, ver `whatsapp.ts`—.
 *
 * Comprobado contra la API el 31 de agosto de 2026, y no solo el texto libre:
 * una plantilla a un identificador de estos, con la ventana de 24 h CERRADA,
 * llegó y la clienta la leyó. Por eso los flujos de pedido ya no los excluyen.
 *
 * `esCelularValido` sigue existiendo y sigue siendo el correcto donde de verdad
 * hace falta un celular colombiano: crear una conversación escribiendo el
 * número a mano, o mandarle el pedido a Mastershop.
 */
export function sePuedeEscribirPorWhatsApp(destino: string | null | undefined): boolean {
  if (typeof destino !== 'string') return false;
  return esCelularValido(destino) || /^[A-Z]{2}\.\d+$/.test(destino);
}

export interface StatusHistoryEntry {
  status: string;
  changedAt: string;
  [key: string]: unknown;
}

/**
 * Agrega una entrada al historial de estados de un pedido.
 *
 * El campo `statusHistory` es Json (no un array escalar de Prisma), así que la
 * operación `{ push: … }` de Prisma NO funciona: escribe literalmente el objeto
 * y pisa el historial. Aquí leemos el valor actual, lo normalizamos a array
 * —rescatando además las entradas que quedaron corrompidas como `{ push: … }`—
 * y devolvemos el array completo listo para reescribir el campo.
 *
 * Se devuelve como InputJsonValue de Prisma para poder asignarlo directo al
 * campo Json (el tipo del array con índice `unknown` no encaja de otro modo).
 */
export function appendStatusHistory(current: unknown, entry: StatusHistoryEntry): Prisma.InputJsonValue {
  let history: StatusHistoryEntry[] = [];

  if (Array.isArray(current)) {
    history = current as StatusHistoryEntry[];
  } else if (current && typeof current === 'object') {
    // Forma corrompida por el bug anterior: { push: { … } }
    const salvaged = (current as { push?: StatusHistoryEntry }).push;
    if (salvaged) history = [salvaged];
  }

  return [...history, entry] as unknown as Prisma.InputJsonValue;
}
