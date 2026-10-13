import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const search = searchParams.get('search');
  const page   = parseInt(searchParams.get('page')  || '1');
  const limit  = Math.min(parseInt(searchParams.get('limit') || '1000'), 1000);
  const skip   = (page - 1) * limit;

  const where: any = {};
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { customer: { name:  { contains: search, mode: 'insensitive' } } },
      { customer: { phone: { contains: search } } },
      { shopifyOrderId:     { contains: search } },
      { shopifyOrderNumber: { contains: search } },
      { trackingNumber:     { contains: search } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where, skip, take: limit,
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { id: true, name: true, phone: true, city: true } } },
    }),
    prisma.order.count({ where }),
  ]);

  /**
   * Cuántos pedidos hay POR ESTADO en toda la base.
   *
   * El tablero agrupaba en el navegador los pedidos que le llegaban, y solo
   * llegaban los 1.000 más recientes: como los entregados y devueltos son de
   * días atrás, sus columnas mostraban «Sin pedidos» habiendo 11.054 y 1.094.
   * Con los totales aparte, cada columna dice su tamaño real aunque solo se
   * hayan traído las primeras tarjetas.
   */
  const porEstado = searchParams.get('conteos') === '1'
    ? Object.fromEntries(
        (await prisma.order.groupBy({ by: ['status'], _count: true }))
          .map(x => [x.status, x._count]),
      )
    : undefined;

  return NextResponse.json({ data: orders, total, porEstado });
}
