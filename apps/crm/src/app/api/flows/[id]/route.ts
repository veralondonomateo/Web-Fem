import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const flow = await prisma.flowTemplate.findUnique({
    where: { id: (await params).id },
    include: { executions: { orderBy: { createdAt: 'desc' }, take: 20 } },
  });
  if (!flow) return NextResponse.json({ error: 'Flujo no encontrado' }, { status: 404 });
  return NextResponse.json(flow);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const body = await req.json();
  const flow = await prisma.flowTemplate.update({ where: { id: (await params).id }, data: body });
  return NextResponse.json(flow);
}
