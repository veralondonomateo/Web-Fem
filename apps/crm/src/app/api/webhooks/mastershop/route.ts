import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { normalizePhone, appendStatusHistory } from '@/services/mastershop';
import { idStatusToCrm, stepFromEvent, stepFromStatusChange, runStep } from '@/services/order-flow';

/** Comparación en tiempo constante que no revienta con longitudes distintas. */
function sameSecret(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/**
 * Quién puede escribir en este endpoint.
 *
 * Mastershop **no firma** sus webhooks: comprobado sobre los primeros eventos
 * reales, ninguno traía `x-mastershop-signature`. Por eso la vía de la firma
 * HMAC no sirve aquí — activarla rechazaría el 100 % del tráfico legítimo.
 *
 * La alternativa con un emisor que no puede firmar es un token secreto en la
 * propia URL, que es lo único que Mastershop nos deja configurar. Queda en el
 * registro de accesos del servidor, cosa que una firma evita, pero es
 * infinitamente mejor que una URL pública que acepta cualquier POST.
 *
 * Las tres ramas, en orden:
 *  1. MASTERSHOP_WEBHOOK_TOKEN puesta → se exige `?token=` y tiene que cuadrar.
 *  2. Si no, MASTERSHOP_WEBHOOK_SECRET puesta → se exige firma HMAC válida
 *     (preparado por si algún día Mastershop firma).
 *  3. Ninguna de las dos → se acepta, avisando por consola. Es el estado de
 *     partida: así activar el token no corta el tráfico hasta que la URL nueva
 *     esté registrada en su panel.
 */
function authorize(req: NextRequest, rawBody: string): boolean {
  const token = process.env.MASTERSHOP_WEBHOOK_TOKEN;
  if (token) {
    const given = new URL(req.url).searchParams.get('token');
    return given !== null && sameSecret(given, token);
  }

  const secret = process.env.MASTERSHOP_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers.get('x-mastershop-signature');
    if (!signature) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    return sameSecret(signature.replace('sha256=', ''), expected);
  }

  console.warn('[Mastershop webhook] Sin MASTERSHOP_WEBHOOK_TOKEN: el endpoint acepta cualquier POST');
  return true;
}

// Estructura real del webhook de Mastershop
interface WebhookBody {
  eventName?: string;
  id_order?: number;
  id_status?: number;
  external_order_id?: string;
  customer?: {
    full_name: string;
    phone: string | number;
    default_address?: {
      city?: string;
      state?: string;
      address1?: string;
      address2?: string;
      zip?: string;
    };
  };
  order_logistics?: {
    carrier_tracking_code?: string;
    carrier_name?: string;
    url_tracking?: string;
  };
  order_transaction?: { total?: number; currency?: string };
  order_Items?: any[];
  date_created_order?: string;
  date_update_order?: string;
}

/**
 * Dirección de envío a partir del webhook. Hasta ahora no se guardaba y los 626
 * pedidos tenían `shippingAddress` en null, así que la plantilla de confirmación
 * no tenía con qué llenar {{3}} (dirección) ni {{4}} (ciudad).
 */
function buildShippingAddress(body: WebhookBody): Record<string, string> | null {
  const a = body.customer?.default_address;
  if (!a?.address1 && !a?.city) return null;

  return {
    address: [a.address1, a.address2].filter(Boolean).join(' — '),
    city: a.city ?? '',
    state: a.state ?? '',
    zip: a.zip ?? '',
  };
}

/**
 * Cabeceras que sirven para diagnosticar, sin guardar la petición entera.
 *
 * Interesa sobre todo saber si Mastershop firma: mientras
 * MASTERSHOP_WEBHOOK_SECRET esté vacío el endpoint acepta cualquier POST, y
 * para poder cerrarlo hay que comprobar antes que las firmas llegan de verdad.
 */
function auditHeaders(req: NextRequest): Record<string, string> {
  const keep = ['x-mastershop-signature', 'user-agent', 'content-type', 'x-forwarded-for'];
  const out: Record<string, string> = {};
  for (const k of keep) {
    const v = req.headers.get(k);
    if (v) out[k] = v;
  }
  // Nunca el token en sí, solo si venía: es lo que permite comprobar que la URL
  // nueva ya está registrada antes de hacerlo obligatorio.
  out['token-presente'] = new URL(req.url).searchParams.get('token') ? 'si' : 'no';
  return out;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!authorize(req, rawBody)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(rawBody) as WebhookBody;
  } catch {
    // Un cuerpo ilegible no es un fallo nuestro: se responde 400 y no se
    // reintenta. Antes esto reventaba con un 500 sin explicación.
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  await processMastershopEvent(body, auditHeaders(req)).catch(e => {
    console.error('[Mastershop webhook]', e);
  });

  return NextResponse.json({ received: true });
}

/**
 * Registra el evento y lo procesa, dejando siempre el resultado por escrito.
 *
 * Antes, si el procesado fallaba, la fila se quedaba en PENDING para siempre y
 * sin el motivo: 77 eventos acabaron así en dos días, indistinguibles de los
 * que aún estaban en vuelo. Ahora un fallo se marca FAILED con su mensaje.
 */
/**
 * Identifica el HECHO que reporta el evento, no el envío concreto.
 * Mastershop no manda un id de evento, así que se compone con lo que define
 * el cambio: qué pedido, a qué estado y por qué evento.
 */
function dedupeKeyOf(body: WebhookBody): string | null {
  if (!body.id_order) return null;
  return `${body.id_order}:${body.id_status ?? ''}:${body.eventName?.trim() ?? ''}`;
}

/** Ventana en la que dos envíos del mismo hecho se consideran el mismo evento. */
const DEDUPE_WINDOW_MIN = 15;

async function processMastershopEvent(body: WebhookBody, headers: Record<string, string> = {}) {
  const dedupeKey = dedupeKeyOf(body);

  // Mastershop reenvía cada cambio varias veces. Procesarlas todas no rompía
  // nada visible —los estados son idempotentes y los flujos tienen su propio
  // anti-duplicados— pero metía la misma entrada 4 o 5 veces en el historial
  // del pedido, y multiplicaba por cinco la escritura en la base.
  if (dedupeKey) {
    const yaVisto = await prisma.webhookEvent.findFirst({
      where: {
        platform: 'MASTERSHOP',
        dedupeKey,
        status: 'PROCESSED',
        createdAt: { gt: new Date(Date.now() - DEDUPE_WINDOW_MIN * 60_000) },
      },
      select: { id: true },
    });
    if (yaVisto) return;
  }

  const webhookEvent = await prisma.webhookEvent.create({
    data: {
      platform: 'MASTERSHOP',
      eventType: body.eventName ?? 'order.status_changed',
      status: 'PENDING',
      payload: body as any,
      headers,
      dedupeKey,
    },
  });

  try {
    await applyMastershopEvent(body, webhookEvent.id);
  } catch (e) {
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: 'FAILED',
        processedAt: new Date(),
        error: (e instanceof Error ? e.message : String(e)).slice(0, 500),
      },
    }).catch(() => { /* si ni esto entra, el log de consola es lo que queda */ });
    throw e;
  }
}

async function applyMastershopEvent(body: WebhookBody, webhookEventId: string) {
  const webhookEvent = { id: webhookEventId };

  if (!body.id_order) {
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { status: 'IGNORED', processedAt: new Date(), error: 'Sin id_order' },
    });
    return;
  }

  const crmStatus = idStatusToCrm(body.id_status, body.eventName);
  if (!crmStatus) {
    await prisma.webhookEvent.update({
      where: { id: webhookEvent.id },
      data: { status: 'IGNORED', processedAt: new Date(), error: `id_status desconocido: ${body.id_status}` },
    });
    return;
  }

  const trackingNumber = body.order_logistics?.carrier_tracking_code?.trim() || null;
  const orderDate = body.date_created_order ? new Date(body.date_created_order) : new Date();
  const totalAmount = body.order_transaction?.total ?? 0;
  const currency = body.order_transaction?.currency ?? 'COP';

  const existingOrder = await prisma.order.findFirst({
    where: {
      OR: [
        { shopifyOrderId: String(body.id_order) },
        ...(trackingNumber ? [{ trackingNumber }] : []),
      ],
    },
    include: { customer: true },
  });

  let customerId: string;
  let orderId: string;
  // El estado que tenía el pedido ANTES de este evento. Es lo que distingue un
  // cambio de verdad de los muchos avisos genéricos que Mastershop repite del
  // mismo pedido sin que nada haya cambiado.
  const estadoAnterior: string | null = existingOrder?.status ?? null;

  if (!existingOrder) {
    if (!body.customer?.phone) {
      await prisma.webhookEvent.update({
        where: { id: webhookEvent.id },
        data: { status: 'IGNORED', processedAt: new Date(), error: 'Sin teléfono de cliente' },
      });
      return;
    }

    const phone = normalizePhone(body.customer.phone);
    const name = body.customer.full_name?.trim() || 'Sin nombre';
    const city = body.customer.default_address?.city || null;
    const department = body.customer.default_address?.state || null;
    const shippingAddress = buildShippingAddress(body);

    let integration = await prisma.integrationConfig.findFirst({
      where: { platform: 'MASTERSHOP', isActive: true },
    });
    if (!integration) {
      integration = await prisma.integrationConfig.create({
        data: { platform: 'MASTERSHOP', name: 'Mastershop', credentials: {}, settings: {}, isActive: true },
      });
    }

    const customer = await prisma.customer.upsert({
      where: { phone },
      create: {
        phone,
        name,
        city,
        department,
        status: 'NEW',
        firstPurchaseAt: orderDate,
        lastPurchaseAt: orderDate,
        updatedAt: new Date(),
      },
      update: {
        name,
        city: city ?? undefined,
        department: department ?? undefined,
        updatedAt: new Date(),
      },
    });

    /**
     * `upsert` y no `create`: Mastershop manda varios eventos del mismo pedido
     * casi a la vez y dos podían intentar crearlo a la par. El segundo chocaba
     * contra la clave única y el webhook quedaba marcado como fallido —11 solo
     * hoy—. Ningún pedido se perdía, porque el primero ya lo había guardado,
     * pero ensuciaba el registro de errores y escondía los fallos de verdad.
     */
    const newOrder = await prisma.order.upsert({
      where: { shopifyOrderId: String(body.id_order) },
      update: {
        status: crmStatus as any,
        ...(trackingNumber && { trackingNumber }),
        updatedAt: new Date(),
        ...(crmStatus === 'DELIVERED' && { deliveredAt: new Date() }),
      },
      create: {
        shopifyOrderId: String(body.id_order),
        shopifyOrderNumber: body.external_order_id || String(body.id_order),
        customerId: customer.id,
        integrationId: integration.id,
        status: crmStatus as any,
        totalAmount,
        currency,
        trackingNumber,
        items: body.order_Items ?? [],
        ...(shippingAddress && { shippingAddress }),
        // Entrada inicial del historial, igual que hace el sync. Sin esto los
        // pedidos que nacen por webhook empezaban con el historial vacío y la
        // primera fila de su cronología era ya un cambio de estado.
        statusHistory: [{
          status: crmStatus,
          idStatus: body.id_status,
          eventName: body.eventName,
          carrier: body.order_logistics?.carrier_name,
          changedAt: new Date().toISOString(),
        }],
        updatedAt: new Date(),
        ...(crmStatus === 'DELIVERED' && { deliveredAt: new Date() }),
      },
    });

    // Usar la fecha real del pedido de Mastershop
    await prisma.$executeRaw`
      UPDATE orders SET created_at = ${orderDate}::timestamptz WHERE id = ${newOrder.id}
    `;

    customerId = customer.id;
    orderId = newOrder.id;

    await prisma.$executeRaw`
      UPDATE customers SET
        total_orders = (SELECT COUNT(*) FROM orders WHERE customer_id = ${customer.id}),
        ltv = (SELECT COALESCE(SUM(total_amount), 0) FROM orders WHERE customer_id = ${customer.id}),
        first_purchase_at = (SELECT MIN(created_at) FROM orders WHERE customer_id = ${customer.id}),
        last_purchase_at = (SELECT MAX(created_at) FROM orders WHERE customer_id = ${customer.id}),
        status = CASE
          WHEN (SELECT COUNT(*) FROM orders WHERE customer_id = ${customer.id}) >= 3 THEN 'RECURRING'::"customer_status"
          WHEN (SELECT COUNT(*) FROM orders WHERE customer_id = ${customer.id}) >= 1 THEN 'ACTIVE'::"customer_status"
          ELSE 'NEW'::"customer_status"
        END
      WHERE id = ${customer.id}
    `;
  } else {
    customerId = existingOrder.customer.id;
    orderId = existingOrder.id;

    const shippingAddress = buildShippingAddress(body);

    await prisma.order.update({
      where: { id: existingOrder.id },
      data: {
        status: crmStatus as any,
        totalAmount: totalAmount || existingOrder.totalAmount,
        ...(shippingAddress && !existingOrder.shippingAddress && { shippingAddress }),
        statusHistory: appendStatusHistory(existingOrder.statusHistory, {
          status: crmStatus,
          idStatus: body.id_status,
          eventName: body.eventName,
          carrier: body.order_logistics?.carrier_name,
          changedAt: new Date().toISOString(),
        }),
        trackingNumber: trackingNumber ?? existingOrder.trackingNumber,
        ...(crmStatus === 'DELIVERED' && { deliveredAt: existingOrder.deliveredAt ?? new Date() }),
      },
    });
  }

  // Upsert MastershopGuide si hay guía
  if (trackingNumber) {
    const statusStr = String(body.id_status ?? '');
    const existingGuide = await prisma.mastershopGuide.findUnique({
      where: { guideNumber: trackingNumber },
      select: { events: true },
    });

    await prisma.mastershopGuide.upsert({
      where: { guideNumber: trackingNumber },
      create: {
        guideNumber: trackingNumber,
        orderId,
        customerId,
        carrier: body.order_logistics?.carrier_name ?? null,
        status: statusStr,
        statusDetail: null,
        lastSyncedAt: new Date(),
        events: [{
          status: statusStr,
          idStatus: body.id_status,
          eventName: body.eventName,
          changedAt: new Date().toISOString(),
        }] as any,
      },
      update: {
        status: statusStr,
        lastSyncedAt: new Date(),
        carrier: body.order_logistics?.carrier_name ?? undefined,
        ...(crmStatus === 'DELIVERED' && { deliveredAt: new Date() }),
        // `{ push: … }` no existe para campos Json: escribía el objeto literal y
        // borraba el historial (mismo bug que ya se corrigió en statusHistory).
        events: appendStatusHistory(existingGuide?.events, {
          status: statusStr,
          idStatus: body.id_status,
          eventName: body.eventName,
          changedAt: new Date().toISOString(),
        }),
      },
    });
  }

  /**
   * Flujo de pedido. El camino normal es el nombre del evento.
   *
   * Cuando Mastershop no manda el evento con nombre —desde el 12 de agosto de
   * 2026 no manda «Pedido En Tránsito» ni «Pedido Entregado»— el paso se deduce
   * del cambio de estado, pero solo si el estado CAMBIÓ de verdad. El aviso
   * genérico llega repetido para el mismo pedido, y sin esa comprobación el
   * arreglo habría mandado «tu pedido va en camino» a todos los que ya llevaban
   * días en tránsito.
   */
  const huboTransicion = estadoAnterior !== null && estadoAnterior !== crmStatus;
  const step = stepFromEvent(body.eventName, body.id_status)
    ?? (huboTransicion ? stepFromStatusChange(body.id_status) : null);
  if (step) {
    await runStep(orderId, step).catch(e => console.error('[Flujo] Falló el paso', step, e));
  }

  await prisma.webhookEvent.update({
    where: { id: webhookEvent.id },
    data: { status: 'PROCESSED', processedAt: new Date() },
  });
}
