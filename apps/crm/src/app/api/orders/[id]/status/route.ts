import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const { status, trackingNumber } = await req.json();
  const order = await prisma.order.update({
    where: { id: (await params).id },
    data: {
      status,
      trackingNumber,
      statusHistory: {
        push: { status, changedAt: new Date().toISOString(), changedBy: user.id },
      },
      ...(status === 'DELIVERED' && { deliveredAt: new Date() }),
    },
    include: { customer: true },
  });

  return NextResponse.json(order);
}
