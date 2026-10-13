import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { runMastershopSync } from '@/services/mastershop-sync';
import { getAuthUser } from '@/lib/auth-server';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Sync manual desde la UI. El cron (/api/cron/sync) hace esto mismo
// automáticamente; este endpoint queda para forzar una corrida inmediata.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user || user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  if (!process.env.MASTERSHOP_API_KEY) {
    return NextResponse.json({ error: 'MASTERSHOP_API_KEY no configurado en variables de entorno' }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));

  try {
    const result = await runMastershopSync({
      filter: body.filter,
      days: body.days,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[sync/mastershop]', err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  const integration = await prisma.integrationConfig.findFirst({
    where: { platform: 'MASTERSHOP' },
    select: { lastSyncAt: true, isActive: true },
  });

  const [customerCount, orderCount, guideCount] = await Promise.all([
    prisma.customer.count(),
    prisma.order.count(),
    prisma.mastershopGuide.count(),
  ]);

  return NextResponse.json({
    lastSyncAt: integration?.lastSyncAt ?? null,
    isConfigured: !!process.env.MASTERSHOP_API_KEY,
    customers: customerCount,
    orders: orderCount,
    guides: guideCount,
  });
}
