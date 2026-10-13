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

const COD_MSG = (name: string, address: string) =>
  `Hola ${name} 💗 Recibimos tu pedido Fem. ¿Estarás disponible en ${address}? Responde SÍ para confirmar o NO si necesitas cambiar algo.`;

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  if (!verifyShopify(rawBody, req.headers.get('x-shopify-hmac-sha256'))) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  processOrderCreate(rawBody).catch(e => console.error('[Shopify create]', e));
  return new NextResponse('OK', { status: 200 });
}

async function processOrderCreate(rawBody: string) {
  const shopifyOrder = JSON.parse(rawBody);
  const phone = shopifyOrder.billing_address?.phone || shopifyOrder.shipping_address?.phone;
  const email = shopifyOrder.email;
  const name  = `${shopifyOrder.billing_address?.first_name || ''} ${shopifyOrder.billing_address?.last_name || ''}`.trim();
  const normalizedPhone = phone ? `+57${phone.replace(/\D/g, '')}` : null;

  let customer = normalizedPhone
    ? await prisma.customer.findUnique({ where: { phone: normalizedPhone } })
    : null;

  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        phone: normalizedPhone ?? `unknown_${Date.now()}`,
        email,
        name: name || 'Cliente Shopify',
        city:       shopifyOrder.shipping_address?.city,
        department: shopifyOrder.shipping_address?.province,
        originChannel: 'WHATSAPP',
        status: 'NEW',
        firstPurchaseAt: new Date(),
        lastPurchaseAt:  new Date(),
      },
    });
  } else {
    // El correo del checkout se estaba perdiendo: solo se guardaba al CREAR la
    // ficha, y la clienta que ya escribió por WhatsApp llega aquí con ficha
    // hecha y sin correo. Se rellena solo si falta, para no pisar uno corregido
    // a mano ni el que ya trajo el carrito abandonado.
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        lastPurchaseAt: new Date(),
        totalOrders: { increment: 1 },
        ...(email && !customer.email ? { email } : {}),
      },
    });
  }

  /**
   * `upsert`: Shopify reenvía el mismo pedido si tardamos en responderle, y el
   * reintento chocaba contra la clave única dejando el webhook como fallido.
   * El pedido no se perdía —el primero ya estaba— pero ensuciaba el registro.
   */
  await prisma.order.upsert({
    where: { shopifyOrderId: String(shopifyOrder.id) },
    update: {},
    create: {
      shopifyOrderId:     String(shopifyOrder.id),
      shopifyOrderNumber: shopifyOrder.name,
      customerId:    customer.id,
      status:        'PENDING_CONFIRMATION',
      totalAmount:   parseFloat(shopifyOrder.total_price),
      shippingAddress: shopifyOrder.shipping_address,
      items: shopifyOrder.line_items?.map((i: any) => ({ name: i.name, quantity: i.quantity, price: parseFloat(i.price) })) || [],
    },
  });

  if (normalizedPhone) {
    const addr = `${shopifyOrder.shipping_address?.address1 || ''}, ${shopifyOrder.shipping_address?.city || ''}`;
    await sendWhatsAppMessage(normalizedPhone, COD_MSG(name || 'Cliente', addr)).catch(() => {});
  }
}
