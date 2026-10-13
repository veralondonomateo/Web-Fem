import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const limite = Math.min(parseInt(searchParams.get('limit') || '150'), 500);
  const where: any = {};
  if (status) where.status = status;

  /**
   * Antes se devolvían TODOS los carritos con sus relaciones: 1.201 filas,
   * 1,4 MB y segundo y medio de espera en una pantalla que solo muestra las
   * primeras tarjetas de cada columna. Ahora se limita, y los totales por
   * estado van aparte para que cada columna diga su tamaño real.
   */
  /**
   * Los totales salen de TODA la tabla, no de las filas que se acaban de
   * cargar. Las tarjetas de arriba se calculaban sobre las 150 traídas, así
   * que la pantalla decía «144 abiertos» habiendo 2.286, y «$18 millones
   * recuperables» habiendo $294 millones. Parecía que casi no entraban
   * carritos cuando entran ~200 al día.
   *
   * Va el dinero además del recuento porque «cuánto hay sin recuperar» es
   * justo el número por el que existe esta pantalla.
   */
  const agregados = await prisma.abandonedCart.groupBy({
    by: ['status'],
    _count: { _all: true },
    _sum: { totalAmount: true },
  });

  const porEstado = Object.fromEntries(agregados.map(x => [x.status, x._count._all]));
  const montoPorEstado = Object.fromEntries(
    agregados.map(x => [x.status, Number(x._sum.totalAmount ?? 0)]),
  );

  const carts = await prisma.abandonedCart.findMany({
    where,
    take: limite,
    orderBy: { createdAt: 'desc' },
    include: {
      customer: {
        select: {
          id: true, name: true, phone: true, city: true,
          // La conversación más reciente, para poder saltar desde el carrito a
          // la bandeja y ver qué se le ha escrito.
          conversations: {
            orderBy: { lastMessageAt: 'desc' },
            take: 1,
            select: { id: true, channel: true, status: true, lastMessageAt: true, _count: { select: { messages: true } } },
          },
        },
      },
    },
  });

  // Se aplana para que la página no tenga que saber de la forma de Prisma.
  const data = carts.map(({ customer, ...cart }) => {
    const conv = customer?.conversations?.[0];
    return {
      ...cart,
      customer: customer && {
        id: customer.id, name: customer.name, phone: customer.phone, city: customer.city,
      },
      conversation: conv
        ? { id: conv.id, channel: conv.channel, status: conv.status, messages: conv._count.messages }
        : null,
    };
  });

  return NextResponse.json({
    data,
    // `total` es cuántas se devuelven en esta página; `totalGeneral`, cuántas hay.
    total: data.length,
    totalGeneral: Object.values(porEstado).reduce((a, b) => a + b, 0),
    porEstado,
    montoPorEstado,
  });
}
