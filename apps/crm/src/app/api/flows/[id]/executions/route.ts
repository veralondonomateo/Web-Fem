import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const executions = await prisma.flowExecution.findMany({
    where: { flowTemplateId: (await params).id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return NextResponse.json(executions);
}
