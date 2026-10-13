import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { guardarCarrito } from '@/services/cart-recovery';
import { CarritoCheckout } from '@/services/checkout-fem';

export const dynamic = 'force-dynamic';

/**
 * Carritos abandonados que empuja el checkout en cuanto los detecta.
 *
 * Es el camino rápido; la red de seguridad es la lectura de la cola por cursor
 * en el cron. Si esto falla, el carrito sigue en la cola y entra igual, así que
 * aquí conviene responder 200 en cuanto esté guardado y no complicarse.
 */

function firmaValida(cuerpo: string, req: NextRequest): boolean {
  const secreto = process.env.CHECKOUT_WEBHOOK_SECRET;
  if (!secreto) {
    console.warn('[Carritos webhook] Sin CHECKOUT_WEBHOOK_SECRET: se acepta cualquier POST');
    return true;
  }

  const ts = req.headers.get('x-fem-timestamp');
  const firma = req.headers.get('x-fem-firma');
  if (!ts || !firma) return false;

  // Rechaza reenvíos de una petición capturada hace rato.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

  const esperada = 'sha256=' + crypto.createHmac('sha256', secreto).update(`${ts}.${cuerpo}`).digest('hex');
  const a = Buffer.from(esperada);
  const b = Buffer.from(firma);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const cuerpo = await req.text();

  if (!firmaValida(cuerpo, req)) {
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 });
  }

  let payload: { evento?: string; carrito?: CarritoCheckout };
  try {
    payload = JSON.parse(cuerpo);
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const carrito = payload.carrito;
  if (!carrito?.id) {
    return NextResponse.json({ error: 'Falta el carrito' }, { status: 400 });
  }

  const evento = await prisma.webhookEvent.create({
    data: {
      platform: 'CHECKOUT',
      eventType: payload.evento ?? 'carrito_abandonado',
      status: 'PENDING',
      payload: payload as any,
      headers: { 'x-fem-evento-id': req.headers.get('x-fem-evento-id') ?? '' },
      // El checkout reintenta hasta 5 veces: el id del carrito basta para que
      // un reenvío no vuelva a procesarse.
      dedupeKey: carrito.id,
    },
  });

  try {
    let cfg = await prisma.integrationConfig.findFirst({ where: { platform: 'CHECKOUT', isActive: true } });
    if (!cfg) {
      cfg = await prisma.integrationConfig.create({
        data: { platform: 'CHECKOUT', name: 'Checkout Fem', credentials: {}, settings: {}, isActive: true },
      });
    }

    const guardado = await guardarCarrito(carrito, cfg.id);

    await prisma.webhookEvent.update({
      where: { id: evento.id },
      data: guardado
        ? { status: 'PROCESSED', processedAt: new Date() }
        : { status: 'IGNORED', processedAt: new Date(), error: 'Carrito sin teléfono' },
    });
  } catch (e) {
    await prisma.webhookEvent.update({
      where: { id: evento.id },
      data: {
        status: 'FAILED',
        processedAt: new Date(),
        error: (e instanceof Error ? e.message : String(e)).slice(0, 500),
      },
    }).catch(() => {});
    console.error('[Carritos webhook]', e);
    // 5xx para que el checkout reintente.
    return NextResponse.json({ error: 'Error al guardar' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
