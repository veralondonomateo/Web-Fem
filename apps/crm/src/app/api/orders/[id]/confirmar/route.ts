import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { appendStatusHistory } from '@/services/mastershop';
import { runStep } from '@/services/order-flow';
import { confirmarEnMastershop } from '@/services/mastershop-confirmar';

export const dynamic = 'force-dynamic';

/**
 * Confirma un pedido desde el CRM y lo propaga a Mastershop.
 *
 * La confirmación viaja al disparador de automatización de Mastershop (ver
 * `mastershop-confirmar`), que marca el pedido como confirmado y lo pasa a
 * «Por Alistar» por su cuenta en unos segundos. Ese cambio vuelve por webhook
 * y es el que dispara el mensaje con la guía de transporte.
 *
 * Si esa llamada falla, la confirmación NO se guarda: dejarla marcada aquí
 * mientras Mastershop la ignora es peor que no confirmar, porque el pedido
 * desaparece de la lista de pendientes y nadie lo alista.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  if (user.role === 'ANALYST') return forbidden();

  const pedido = await prisma.order.findUnique({ where: { id: (await params).id } });
  if (!pedido) return NextResponse.json({ error: 'Pedido no encontrado' }, { status: 404 });

  if (pedido.confirmedAt) {
    return NextResponse.json({ error: 'Este pedido ya estaba confirmado.' }, { status: 409 });
  }
  if (pedido.status !== 'PENDING_CONFIRMATION') {
    return NextResponse.json(
      { error: `El pedido ya avanzó a ${pedido.status}; no hace falta confirmarlo.` },
      { status: 409 },
    );
  }

  // Primero Mastershop: si esto falla, no se toca el CRM.
  if (!pedido.shopifyOrderId) {
    return NextResponse.json(
      { error: 'El pedido no tiene id de Mastershop; no se puede confirmar allá.' }, { status: 409 });
  }
  try {
    await confirmarEnMastershop(pedido.shopifyOrderId);
  } catch (e) {
    console.error('[Confirmar] Mastershop rechazó la confirmación', e);
    return NextResponse.json(
      { error: 'No se pudo confirmar en Mastershop. Vuelve a intentarlo en un momento.' },
      { status: 502 });
  }

  const actualizado = await prisma.order.update({
    where: { id: (await params).id },
    data: {
      status: 'CONFIRMED',
      confirmedAt: new Date(),
      statusHistory: appendStatusHistory(pedido.statusHistory, {
        status: 'CONFIRMED',
        changedAt: new Date().toISOString(),
        origen: 'CRM',
        confirmadaPor: user.name,
      }),
    },
    select: {
      id: true, status: true, confirmedAt: true, shopifyOrderNumber: true, shopifyOrderId: true,
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: user.id,
      action: 'ORDER_CONFIRMED',
      resource: 'order',
      metadata: { orderId: (await params).id, numero: actualizado.shopifyOrderNumber ?? actualizado.shopifyOrderId },
    },
  }).catch(() => { /* el registro de actividad no puede tumbar la confirmación */ });

  // Si el flujo del paso 1 está encendido, esto lo dispara igual que si la
  // clienta hubiera tocado «Confirmar» en el WhatsApp.
  runStep((await params).id, 'POR_ALISTAR').catch(e =>
    console.error('[Confirmar] no se pudo disparar el flujo', e));

  return NextResponse.json(actualizado);
}
