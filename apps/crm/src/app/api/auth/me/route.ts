import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  if (user.id === 'demo') {
    return NextResponse.json({ id: 'demo', name: 'Demo Admin', email: 'admin@fem.com.co', role: 'ADMIN' });
  }

  const dbUser = await prisma.crmUser.findUnique({
    where: { id: user.id },
    select: { id: true, name: true, email: true, role: true, avatar: true },
  });
  return NextResponse.json(dbUser);
}
