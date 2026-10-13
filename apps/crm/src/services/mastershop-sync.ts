import { prisma } from '@/lib/prisma';
import {
  listAllOrders,
  normalizePhone,
  mastershopStatusToCrm,
  MastershopOrder,
  ListOrdersFilter,
} from '@/services/mastershop';

export interface SyncResult {
  success: boolean;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  errors: number;
  /** Tramos de fechas que no se pudieron leer. Vacío = la ventana entera entró. */
  failedWindows: string[];
  /** Milisegundos, partidos en leer de Mastershop y escribir en la base. */
  timings: { fetchMs: number; writeMs: number; totalMs: number };
  syncedAt: string;
}

async function getIntegration() {
  let integration = await prisma.integrationConfig.findFirst({
    where: { platform: 'MASTERSHOP', isActive: true },
  });
  if (!integration) {
    integration = await prisma.integrationConfig.create({
      data: { platform: 'MASTERSHOP', name: 'Mastershop', credentials: {}, settings: {}, isActive: true },
    });
  }
  return integration;
}

// ============================================================
// Normalización: de la forma de Mastershop a la del CRM
// ============================================================

interface NormalizedOrder {
  externalId: string;
  orderNumber: string;
  phone: string;
  name: string;
  city: string | null;
  department: string | null;
  status: string;
  msStatus: string;
  carrier: string | null;
  tracking: string | null;
  total: number;
  currency: string;
  items: string;
  statusDetail: string | null;
  createdAt: Date;
  /** JSON listo para el campo jsonb, o null si Mastershop no mandó dirección. */
  shipping: string | null;
}

/**
 * Dirección de envío tal y como la leen las plantillas de WhatsApp
 * (`buildContext` en order-flow.ts usa `address` y `city`).
 *
 * El webhook ya la guardaba, pero el sync no: los pedidos que entraban por aquí
 * quedaban con `shippingAddress` en null y la plantilla de confirmación se
 * quedaba sin {{direccion}} ni {{ciudad}}.
 */
function buildShippingAddress(o: MastershopOrder): string | null {
  const c = o.clientInfo;
  const address = c?.address?.trim();
  const city = c?.city?.trim();
  if (!address && !city) return null;

  return JSON.stringify({
    address: address ?? '',
    city:    city ?? '',
    state:   c?.state?.trim() ?? '',
  });
}

function normalize(o: MastershopOrder): NormalizedOrder | null {
  // Sin teléfono no hay clienta a la que colgar el pedido, y `phone` es la
  // clave única de customers. Se descarta y se cuenta como error.
  if (!o.clientInfo?.phone) return null;

  const created = new Date(o.createdAt);

  return {
    externalId:   String(o.idOrder),
    orderNumber:  o.externalOrderId || String(o.idOrder),
    phone:        normalizePhone(o.clientInfo.phone),
    name:         o.clientInfo.fullName?.trim() || 'Sin nombre',
    city:         o.clientInfo.city || null,
    department:   o.clientInfo.state || null,
    status:       mastershopStatusToCrm(o.orderStatus),
    msStatus:     o.orderStatus,
    carrier:      o.carrierName || null,
    tracking:     o.carrierTrackingCode?.trim() || null,
    total:        o.totalOrder ?? o.totalProvider ?? 0,
    currency:     o.currency || 'COP',
    items:        JSON.stringify(o.items ?? []),
    statusDetail: o.lastCarrierStatusUpdate || null,
    createdAt:    isNaN(created.getTime()) ? new Date() : created,
    shipping:     buildShippingAddress(o),
  };
}

// ============================================================
// Escritura masiva
//
// La versión anterior hacía ~5 viajes a Postgres por pedido (upsert de
// clienta, búsqueda, update/create, corrección de fecha, upsert de guía).
// Con los ~1.100 pedidos que tiene esta cuenta al mes eso son más de 5.000
// idas y vueltas, que no caben en los 300 s de la función. Aquí se hace todo
// con un puñado de sentencias, sea cual sea el número de pedidos.
// ============================================================

/** Trocea para no armar sentencias descomunales ni comerse la memoria. */
const CHUNK = 1000;

function chunks<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * Inserta o actualiza todas las clientas de una tanda y devuelve teléfono → id.
 *
 * Hay que deduplicar por teléfono antes: Postgres rechaza un ON CONFLICT que
 * toque la misma fila dos veces en la misma sentencia. Se queda la aparición
 * del pedido más reciente, que es la que tiene los datos menos viejos.
 */
async function upsertCustomers(orders: NormalizedOrder[]): Promise<Map<string, string>> {
  const latest = new Map<string, NormalizedOrder>();
  for (const o of orders) {
    const prev = latest.get(o.phone);
    if (!prev || o.createdAt > prev.createdAt) latest.set(o.phone, o);
  }

  const ids = new Map<string, string>();

  for (const batch of chunks(Array.from(latest.values()))) {
    const rows = await prisma.$queryRaw<{ id: string; phone: string }[]>`
      INSERT INTO customers (
        id, phone, name, city, department, status,
        first_purchase_at, last_purchase_at, first_contact_at, created_at, updated_at
      )
      SELECT gen_random_uuid()::text, t.phone, t.name, t.city, t.department, 'NEW'::"customer_status",
             t.created_at, t.created_at, now(), now(), now()
      FROM unnest(
        ${batch.map(o => o.phone)}::text[],
        ${batch.map(o => o.name)}::text[],
        ${batch.map(o => o.city)}::text[],
        ${batch.map(o => o.department)}::text[],
        ${batch.map(o => o.createdAt)}::timestamptz[]
      ) AS t(phone, name, city, department, created_at)
      ON CONFLICT (phone) DO UPDATE SET
        name       = EXCLUDED.name,
        city       = COALESCE(EXCLUDED.city, customers.city),
        department = COALESCE(EXCLUDED.department, customers.department),
        updated_at = now()
      RETURNING id, phone
    `;
    for (const r of rows) ids.set(r.phone, r.id);
  }

  return ids;
}

/** Entrada nueva del historial de estados, como jsonb. */
function historyEntry(o: NormalizedOrder): string {
  return JSON.stringify({
    status: o.status,
    mastershopStatus: o.msStatus,
    carrier: o.carrier,
    changedAt: new Date().toISOString(),
  });
}

async function insertOrders(rows: NormalizedOrder[], customerIds: Map<string, string>, integrationId: string) {
  for (const batch of chunks(rows)) {
    await prisma.$executeRaw`
      INSERT INTO orders (
        id, shopify_order_id, shopify_order_number, customer_id, integration_id,
        status, total_amount, currency, tracking_number, items, status_history,
        shipping_address, delivered_at, created_at, updated_at
      )
      SELECT gen_random_uuid()::text, t.external_id, t.order_number, t.customer_id, ${integrationId},
             t.status::"order_status", t.total::numeric, t.currency, t.tracking,
             t.items::jsonb, jsonb_build_array(t.history::jsonb),
             t.shipping::jsonb,
             CASE WHEN t.status = 'DELIVERED' THEN t.created_at END,
             t.created_at, now()
      FROM unnest(
        ${batch.map(o => o.externalId)}::text[],
        ${batch.map(o => o.orderNumber)}::text[],
        ${batch.map(o => customerIds.get(o.phone)!)}::text[],
        ${batch.map(o => o.status)}::text[],
        ${batch.map(o => o.total)}::double precision[],
        ${batch.map(o => o.currency)}::text[],
        ${batch.map(o => o.tracking)}::text[],
        ${batch.map(o => o.items)}::text[],
        ${batch.map(o => historyEntry(o))}::text[],
        ${batch.map(o => o.shipping)}::text[],
        ${batch.map(o => o.createdAt)}::timestamptz[]
      ) AS t(external_id, order_number, customer_id, status, total, currency, tracking, items, history, shipping, created_at)
      ON CONFLICT (shopify_order_id) DO NOTHING
    `;
  }
}

/**
 * Actualiza los pedidos que cambiaron.
 *
 * `status_history` es jsonb, así que el `{ push: … }` de Prisma no sirve (pisa
 * el historial). Aquí se concatena en SQL, rescatando de paso las filas que
 * quedaron con la forma corrompida `{ push: … }` de la versión antigua.
 */
async function updateOrders(rows: { o: NormalizedOrder; statusChanged: boolean }[]) {
  for (const batch of chunks(rows)) {
    await prisma.$executeRaw`
      UPDATE orders o SET
        status          = t.status::"order_status",
        total_amount    = CASE WHEN t.total > 0 THEN t.total::numeric ELSE o.total_amount END,
        tracking_number = COALESCE(t.tracking, o.tracking_number),
        delivered_at    = CASE WHEN t.status = 'DELIVERED' THEN COALESCE(o.delivered_at, now()) ELSE o.delivered_at END,
        created_at      = t.created_at,
        updated_at      = now(),
        -- Solo si falta: lo que ya haya llegado por webhook es más completo.
        shipping_address = COALESCE(o.shipping_address, t.shipping::jsonb),
        status_history  = CASE
          WHEN NOT t.status_changed THEN o.status_history
          ELSE (
            CASE
              WHEN jsonb_typeof(o.status_history) = 'array' THEN o.status_history
              WHEN o.status_history ? 'push' THEN jsonb_build_array(o.status_history -> 'push')
              ELSE '[]'::jsonb
            END || t.history::jsonb
          )
        END
      FROM unnest(
        ${batch.map(r => r.o.externalId)}::text[],
        ${batch.map(r => r.o.status)}::text[],
        ${batch.map(r => r.o.total)}::double precision[],
        ${batch.map(r => r.o.tracking)}::text[],
        ${batch.map(r => r.o.createdAt)}::timestamptz[],
        ${batch.map(r => historyEntry(r.o))}::text[],
        ${batch.map(r => r.statusChanged)}::boolean[],
        ${batch.map(r => r.o.shipping)}::text[]
      ) AS t(external_id, status, total, tracking, created_at, history, status_changed, shipping)
      WHERE o.shopify_order_id = t.external_id
    `;
  }
}

/** Guías de Mastershop: una fila por número de guía, con su último estado. */
async function upsertGuides(rows: NormalizedOrder[], customerIds: Map<string, string>) {
  const withGuide = rows.filter(o => o.tracking);
  if (!withGuide.length) return;

  // Igual que con las clientas: sin deduplicar, el ON CONFLICT revienta.
  const latest = new Map<string, NormalizedOrder>();
  for (const o of withGuide) {
    const prev = latest.get(o.tracking!);
    if (!prev || o.createdAt > prev.createdAt) latest.set(o.tracking!, o);
  }

  for (const batch of chunks(Array.from(latest.values()))) {
    await prisma.$executeRaw`
      INSERT INTO mastershop_guides (
        id, guide_number, order_id, customer_id, carrier, status, status_detail,
        events, raw_data, last_synced_at, delivered_at, created_at, updated_at
      )
      SELECT gen_random_uuid()::text, t.guide, o.id, t.customer_id, t.carrier, t.ms_status, t.detail,
             jsonb_build_array(jsonb_build_object('status', t.ms_status, 'at', now())),
             '{}'::jsonb, now(),
             CASE WHEN t.status = 'DELIVERED' THEN now() END,
             now(), now()
      FROM unnest(
        ${batch.map(o => o.tracking!)}::text[],
        ${batch.map(o => o.externalId)}::text[],
        ${batch.map(o => customerIds.get(o.phone)!)}::text[],
        ${batch.map(o => o.carrier)}::text[],
        ${batch.map(o => o.msStatus)}::text[],
        ${batch.map(o => o.statusDetail)}::text[],
        ${batch.map(o => o.status)}::text[]
      ) AS t(guide, external_id, customer_id, carrier, ms_status, detail, status)
      JOIN orders o ON o.shopify_order_id = t.external_id
      ON CONFLICT (guide_number) DO UPDATE SET
        status         = EXCLUDED.status,
        status_detail  = EXCLUDED.status_detail,
        carrier        = COALESCE(EXCLUDED.carrier, mastershop_guides.carrier),
        last_synced_at = now(),
        delivered_at   = COALESCE(mastershop_guides.delivered_at, EXCLUDED.delivered_at),
        updated_at     = now()
    `;
  }
}

// Recalcula métricas de clientes a partir de sus pedidos reales
export async function recalcCustomerStats() {
  await prisma.$executeRaw`
    UPDATE customers c
    SET
      total_orders = sub.cnt,
      ltv = sub.ltv,
      first_purchase_at = sub.first_at,
      last_purchase_at = sub.last_at,
      status = CASE
        WHEN sub.cnt >= 3 THEN 'RECURRING'::"customer_status"
        WHEN sub.cnt >= 1 THEN 'ACTIVE'::"customer_status"
        ELSE 'NEW'::"customer_status"
      END
    FROM (
      SELECT o.customer_id, COUNT(*) AS cnt, COALESCE(SUM(o.total_amount), 0) AS ltv,
             MIN(o.created_at) AS first_at, MAX(o.created_at) AS last_at
      FROM orders o GROUP BY o.customer_id
    ) sub
    WHERE sub.customer_id = c.id
  `;
}

// ============================================================
// Lectura de Mastershop
// ============================================================

function isoDay(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString().slice(0, 10);
}

/**
 * La API responde 504 con rangos muy amplios: la ventana se parte en tramos de
 * 30 días. Si un tramo se cae del todo (agotados los reintentos), se apunta y
 * se sigue con los demás: es preferible entrar el 90 % de los pedidos y decir
 * qué falta, a perderlo todo por un tramo. El cron horario recoge el resto.
 */
async function listOrdersInWindow(days: number): Promise<{ orders: MastershopOrder[]; failed: string[] }> {
  // Esta cuenta mueve ~780 pedidos al día. A 50 por página, 30 días serían 468
  // páginas: por encima del tope de listAllOrders. En tramos de 7 días son ~110,
  // con margen de sobra, y de paso un tramo caído no se lleva un mes entero.
  const CHUNK_DAYS = 7;
  const DAY = 86_400_000;
  const byId = new Map<number, MastershopOrder>();
  const failed: string[] = [];

  for (let hi = days; hi > 0; hi -= CHUNK_DAYS) {
    const lo = Math.max(hi - CHUNK_DAYS, -1); // -1 → mañana, para cubrir hoy
    const filter: ListOrdersFilter = { startDate: isoDay(-hi * DAY), finalDate: isoDay(-lo * DAY) };
    try {
      for (const o of await listAllOrders(filter)) byId.set(o.idOrder, o);
    } catch (e) {
      console.error(`[Mastershop sync] tramo ${filter.startDate}→${filter.finalDate}:`, e);
      failed.push(`${filter.startDate}→${filter.finalDate}`);
    }
  }

  return { orders: Array.from(byId.values()), failed };
}

/**
 * Sincroniza pedidos de Mastershop → CRM.
 * Sin filtro explícito cubre los últimos `days` días (la API sin rango
 * solo devuelve ~7 días). Los webhooks cubren el tiempo real; este sync
 * es la red de seguridad que corrige cualquier evento perdido.
 */
export async function runMastershopSync(opts: { filter?: ListOrdersFilter; days?: number } = {}): Promise<SyncResult> {
  const startedAt = Date.now();
  const integration = await getIntegration();

  let raw: MastershopOrder[];
  let failedWindows: string[] = [];

  if (opts.filter) {
    raw = await listAllOrders(opts.filter);
  } else {
    const r = await listOrdersInWindow(opts.days ?? 30);
    raw = r.orders;
    failedWindows = r.failed;
  }

  const fetchMs = Date.now() - startedAt;
  const writeStart = Date.now();

  // Deduplicar por idOrder: dos tramos solapados pueden traer el mismo pedido.
  const byExternalId = new Map<string, NormalizedOrder>();
  let errors = 0;
  for (const o of raw) {
    const n = normalize(o);
    if (!n) { errors++; continue; }
    byExternalId.set(n.externalId, n);
  }
  const orders = Array.from(byExternalId.values());

  let created = 0, updated = 0, unchanged = 0;

  if (orders.length) {
    const customerIds = await upsertCustomers(orders);

    // Un solo viaje para saber qué ya existe y con qué valores.
    const existing = new Map<string, { status: string; tracking: string | null; createdAt: Date; hasAddress: boolean }>();
    for (const batch of chunks(orders.map(o => o.externalId), 5000)) {
      const found = await prisma.order.findMany({
        where: { shopifyOrderId: { in: batch } },
        select: { shopifyOrderId: true, status: true, trackingNumber: true, createdAt: true, shippingAddress: true },
      });
      for (const f of found) {
        existing.set(f.shopifyOrderId!, {
          status: f.status,
          tracking: f.trackingNumber,
          createdAt: f.createdAt,
          hasAddress: f.shippingAddress !== null,
        });
      }
    }

    const toInsert: NormalizedOrder[] = [];
    const toUpdate: { o: NormalizedOrder; statusChanged: boolean }[] = [];

    for (const o of orders) {
      const prev = existing.get(o.externalId);
      if (!prev) { toInsert.push(o); continue; }

      const statusChanged   = prev.status !== o.status;
      const trackingChanged = o.tracking !== null && o.tracking !== prev.tracking;
      // Mastershop es la fuente de verdad de la fecha real del pedido.
      const dateWrong       = Math.abs(prev.createdAt.getTime() - o.createdAt.getTime()) > 60_000;
      // Autocura los pedidos que se cargaron antes de que el sync guardara la
      // dirección: sin ella la plantilla de confirmación va coja.
      const addressMissing  = o.shipping !== null && !prev.hasAddress;

      if (statusChanged || trackingChanged || dateWrong || addressMissing) toUpdate.push({ o, statusChanged });
      else unchanged++;
    }

    await insertOrders(toInsert, customerIds, integration.id);
    await updateOrders(toUpdate);
    created = toInsert.length;
    updated = toUpdate.length;

    // Las guías necesitan que los pedidos ya existan (se unen por shopify_order_id).
    await upsertGuides(orders, customerIds);
    await recalcCustomerStats();
  }

  await prisma.integrationConfig.update({
    where: { id: integration.id },
    data: { lastSyncAt: new Date() },
  });

  return {
    success: failedWindows.length === 0,
    total: orders.length,
    created,
    updated,
    unchanged,
    errors,
    failedWindows,
    timings: { fetchMs, writeMs: Date.now() - writeStart, totalMs: Date.now() - startedAt },
    syncedAt: new Date().toISOString(),
  };
}
