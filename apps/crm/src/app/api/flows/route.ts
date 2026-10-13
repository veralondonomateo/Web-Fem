import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const flows = await prisma.flowTemplate.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { executions: true } } },
  });
  return NextResponse.json(flows);
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const body = await req.json();
  const flow = await prisma.flowTemplate.create({ data: body });
  return NextResponse.json(flow, { status: 201 });
}
