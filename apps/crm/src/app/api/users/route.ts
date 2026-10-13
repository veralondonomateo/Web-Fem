import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** Usuarias activas, para los selectores de asignación. */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const users = await prisma.crmUser.findMany({
    where: { isActive: true },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  });
  return NextResponse.json(users);
}
