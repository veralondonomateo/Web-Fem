import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Contadores del menú lateral. Antes eran números fijos escritos a mano
 * («Bandeja 3», «Carritos 5»), que mienten en cuanto el CRM tiene datos reales.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  try {
    const [inbox, carts, orders, pqrs] = await Promise.all([
      prisma.conversation.count({
        where: {
          isRead: false, status: { not: 'RESOLVED' },
          ...(user.metaAccountId && { metaAccountId: user.metaAccountId }),
        },
      }),
      prisma.abandonedCart.count({ where: { status: 'OPEN' } }),
      prisma.order.count({ where: { status: 'PENDING_CONFIRMATION' } }),
      prisma.pqrs.count({ where: { status: { in: ['ABIERTA', 'EN_PROCESO', 'ESPERANDO_CLIENTA'] } } }),
    ]);

    return NextResponse.json({ inbox, carts, orders, pqrs });
  } catch (e) {
    console.error('[stats/badges]', e);
    // Un fallo aquí no puede romper la navegación: se devuelven ceros.
    return NextResponse.json({ inbox: 0, carts: 0, orders: 0, pqrs: 0 });
  }
}
