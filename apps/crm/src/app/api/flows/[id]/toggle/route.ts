import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const current = await prisma.flowTemplate.findUnique({ where: { id: (await params).id } });
  if (!current) return NextResponse.json({ error: 'Flujo no encontrado' }, { status: 404 });

  const flow = await prisma.flowTemplate.update({
    where: { id: (await params).id },
    data: { isActive: !current.isActive },
  });
  return NextResponse.json(flow);
}
