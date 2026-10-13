import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

// Los pedidos se guardan en UTC; el negocio opera en hora Colombia (UTC-5).
// Todos los agrupamientos por fecha se hacen en America/Bogota.
const TZ_OFFSET = '-05:00';

type Granularity = 'day' | 'week' | 'month';

function parseDay(s: string | null): string | null {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function colombiaToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);

  const granularity: Granularity = (['day', 'week', 'month'] as const).find(
    g => g === searchParams.get('granularity')
  ) ?? 'day';

  // Rango: from/to explícitos (fechas Colombia) o period como fallback
  let from = parseDay(searchParams.get('from'));
  let to = parseDay(searchParams.get('to'));
  if (!from || !to) {
    const period = searchParams.get('period') || '30d';
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    to = colombiaToday();
    from = new Date(new Date(`${to}T12:00:00Z`).getTime() - days * 86_400_000)
      .toISOString().slice(0, 10);
  }
  if (from > to) [from, to] = [to, from];

  const sinceUtc = new Date(`${from}T00:00:00${TZ_OFFSET}`);
  const untilUtc = new Date(`${to}T23:59:59.999${TZ_OFFSET}`);
  const inRange = { gte: sinceUtc, lte: untilUtc };

  try {
    const [
      totalOrders, deliveredOrders, returnedOrders, pendingOrders,
      totalRevenue, newCustomers, recurringCustomers, totalCustomers,
      atRiskCustomers, ordersByStatus,
    ] = await Promise.all([
      prisma.order.count({ where: { createdAt: inRange } }),
      prisma.order.count({ where: { status: 'DELIVERED', createdAt: inRange } }),
      prisma.order.count({ where: { status: 'RETURNED', createdAt: inRange } }),
      prisma.order.count({ where: { status: { in: ['PENDING_CONFIRMATION', 'PREPARING'] }, createdAt: inRange } }),
      prisma.order.aggregate({ where: { createdAt: inRange }, _sum: { totalAmount: true } }),
      prisma.customer.count({ where: { firstPurchaseAt: inRange } }),
      prisma.customer.count({ where: { status: 'RECURRING' } }),
      prisma.customer.count(),
      prisma.customer.count({ where: { status: 'AT_RISK' } }),
      prisma.order.groupBy({ by: ['status'], where: { createdAt: inRange }, _count: true, _sum: { totalAmount: true } }),
    ]);

    // Serie temporal en hora Colombia, con huecos rellenados en cero
    const series: { bucket: Date; orders: number; revenue: number }[] = await prisma.$queryRaw`
      WITH buckets AS (
        SELECT generate_series(
          date_trunc(${granularity}, ${from}::timestamp),
          date_trunc(${granularity}, ${to}::timestamp),
          ('1 ' || ${granularity})::interval
        ) AS bucket
      ), data AS (
        SELECT
          date_trunc(${granularity}, created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota') AS bucket,
          COUNT(*)::int AS orders,
          COALESCE(SUM(total_amount)::float, 0) AS revenue
        FROM orders
        WHERE created_at >= ${sinceUtc} AND created_at <= ${untilUtc}
        GROUP BY 1
      )
      SELECT b.bucket, COALESCE(d.orders, 0)::int AS orders, COALESCE(d.revenue, 0)::float AS revenue
      FROM buckets b LEFT JOIN data d USING (bucket)
      ORDER BY b.bucket ASC
    `;

    const ordersByCity: any[] = await prisma.$queryRaw`
      SELECT c.city, COUNT(*)::int AS orders
      FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.created_at >= ${sinceUtc} AND o.created_at <= ${untilUtc}
        AND c.city IS NOT NULL AND c.city != ''
      GROUP BY c.city
      ORDER BY orders DESC
      LIMIT 8
    `;

    let openConversations = 0;
    let resolvedConversations = 0;
    try {
      [openConversations, resolvedConversations] = await Promise.all([
        prisma.conversation.count({ where: { status: 'OPEN' } }),
        prisma.conversation.count({ where: { status: 'RESOLVED', updatedAt: inRange } }),
      ]);
    } catch {}

    const avgOrderValue = totalOrders > 0 ? Number(totalRevenue._sum.totalAmount || 0) / totalOrders : 0;
    const deliveryRate  = totalOrders > 0 ? (deliveredOrders / totalOrders) * 100 : 0;
    const returnRate    = totalOrders > 0 ? (returnedOrders  / totalOrders) * 100 : 0;
    const repurchaseRate = totalCustomers > 0 ? (recurringCustomers / totalCustomers) * 100 : 0;

    const fmtLabel = (d: Date) => {
      const iso = d.toISOString().slice(0, 10);
      const [y, m, day] = iso.split('-').map(Number);
      const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
      if (granularity === 'month') return `${MONTHS[m - 1]} ${y}`;
      return `${day} ${MONTHS[m - 1]}`;
    };

    return NextResponse.json({
      range: { from, to, granularity },
      sales: {
        totalOrders, deliveredOrders, returnedOrders, pendingOrders,
        totalRevenue: Number(totalRevenue._sum.totalAmount || 0),
        avgOrderValue, deliveryRate, returnRate,
        ordersByStatus: ordersByStatus.map(s => ({
          status: s.status,
          count: s._count,
          revenue: Number(s._sum.totalAmount || 0),
        })),
        series: series.map(r => ({
          date: new Date(r.bucket).toISOString().slice(0, 10),
          label: fmtLabel(new Date(r.bucket)),
          orders: Number(r.orders),
          revenue: Number(r.revenue),
        })),
        ordersByCity: ordersByCity.map(c => ({ city: c.city, orders: Number(c.orders) })),
      },
      customers: { total: totalCustomers, newCustomers, recurringCustomers, atRiskCustomers, repurchaseRate },
      messaging: { openConversations, resolvedConversations },
    });
  } catch (e) {
    console.error('[Analytics]', e);
    return NextResponse.json({ error: 'Error al cargar analytics' }, { status: 500 });
  }
}
