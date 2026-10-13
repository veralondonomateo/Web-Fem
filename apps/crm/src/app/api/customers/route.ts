import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);
  const search = searchParams.get('search');
  const status = searchParams.get('status');
  const page   = parseInt(searchParams.get('page')  || '1');
  const limit  = Math.min(parseInt(searchParams.get('limit') || '1000'), 1000);
  const skip   = (page - 1) * limit;

  const where: any = {};
  if (search) {
    where.OR = [
      { name:  { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (status) where.status = status;

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where, skip, take: limit,
      orderBy: { lastPurchaseAt: 'desc' },
      include: { _count: { select: { orders: true, conversations: true } } },
    }),
    prisma.customer.count({ where }),
  ]);

  return NextResponse.json({ data: customers, total, page, limit });
}
