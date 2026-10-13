import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { sendWhatsAppMessage } from '@/services/whatsapp';

function verifyShopify(rawBody: string, hmacHeader: string | null): boolean {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return true;
  if (!hmacHeader) return false;
  const hash = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmacHeader), Buffer.from(hash));
  } catch {
    return false;
  }
}

const DISPATCHED_MSG = (guide: string) =>
  `¡Tu pedido Fem está en camino! 🚚 Guía: ${guide}. Tiempo estimado: 2-3 días hábiles.`;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!verifyShopify(rawBody, req.headers.get('x-shopify-hmac-sha256'))) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  processOrderFulfilled(rawBody).catch(e => console.error('[Shopify fulfilled]', e));
  return new NextResponse('OK', { status: 200 });
}

async function processOrderFulfilled(rawBody: string) {
  const shopifyOrder  = JSON.parse(rawBody);
  const trackingNumber = shopifyOrder.fulfillments?.[0]?.tracking_number;

  const order = await prisma.order.findFirst({ where: { shopifyOrderId: String(shopifyOrder.id) } });
  if (!order) return;

  await prisma.order.update({ where: { id: order.id }, data: { status: 'DISPATCHED', trackingNumber } });

  const customer = await prisma.customer.findUnique({ where: { id: order.customerId } });
  if (customer?.phone && trackingNumber) {
    await sendWhatsAppMessage(customer.phone, DISPATCHED_MSG(trackingNumber)).catch(() => {});
  }
}
