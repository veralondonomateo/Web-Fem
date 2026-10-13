import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import {
  agregarHistorialDevolucion, parsearMonto, fechaLimitePorDefecto, ESTADOS_SIN_PAGAR,
} from '@/lib/devoluciones';

export const dynamic = 'force-dynamic';

/**
 * Lista de devoluciones + el control mensual.
 *
 * El orden por defecto es el que necesita quien paga: primero lo PENDIENTE y,
 * dentro de eso, lo más viejo arriba —la clienta que lleva más tiempo
 * esperando su plata—. Lo ya resuelto va después, lo más reciente primero.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const p = req.nextUrl.searchParams;
  const estado = p.get('estado');
  const q = p.get('q')?.trim();

  const where: Record<string, unknown> = {};
  if (estado) where.estado = estado;
  if (q) {
    const soloDigitos = q.replace(/\D/g, '');
    where.OR = [
      { motivo:     { contains: q, mode: 'insensitive' } },
      { referencia: { contains: q, mode: 'insensitive' } },
      // El pago se busca por los datos con los que se hizo: quien concilia el
      // extracto tiene delante un titular y un número de cuenta, no un nombre
      // de clienta —que muchas veces ni siquiera es el mismo—.
      { titular:      { contains: q, mode: 'insensitive' } },
      { cedula:       { contains: q } },
      { numeroCuenta: { contains: q } },
      { contacto:     { contains: q } },
      { customer:   { name:  { contains: q, mode: 'insensitive' } } },
      { customer:   { phone: { contains: q } } },
      ...(soloDigitos ? [
        { consecutivo: Number(soloDigitos) },
        { pqrs: { radicado: Number(soloDigitos) } },
      ] : []),
    ];
  }

  const [lista, resumen, porMes] = await Promise.all([
    prisma.devolucion.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        pqrs:     { select: { id: true, radicado: true, subject: true, type: true, status: true, createdAt: true } },
      },
      // `estado` es un enum de Postgres y su orden es el de declaración:
      // PENDIENTE, LISTA_PARA_DEVOLVER, HECHA, RECHAZADA. Ordenar por él ya deja
      // arriba lo que no se ha pagado.
      orderBy: [{ estado: 'asc' }, { createdAt: 'asc' }],
      take: 300,
    }),

    prisma.devolucion.groupBy({
      by: ['estado'],
      _count: { _all: true },
      _sum: { monto: true },
    }),

    // Control mensual: cuántas y por cuánto se resolvieron cada mes. Se agrupa
    // por `resuelta_at` en hora Colombia, que es cuando la plata salió de
    // verdad —no cuando se radicó la solicitud, que puede ser de otro mes—.
    prisma.$queryRaw<{ mes: string; estado: string; n: bigint; total: number }[]>`
      SELECT to_char(date_trunc('month', resuelta_at AT TIME ZONE 'America/Bogota'), 'YYYY-MM') AS mes,
             estado::text AS estado,
             count(*)     AS n,
             COALESCE(sum(monto), 0)::float8 AS total
      FROM devoluciones
      WHERE resuelta_at IS NOT NULL
        AND resuelta_at >= now() - interval '12 months'
      GROUP BY 1, 2
      ORDER BY 1 DESC`,
  ]);

  const de = (e: string) => resumen.find(r => r.estado === e);
  const metricas = {
    pendientes:      de('PENDIENTE')?._count._all ?? 0,
    listas:          de('LISTA_PARA_DEVOLVER')?._count._all ?? 0,
    /**
     * Lo que la clienta está esperando, sin importar en qué paso esté.
     *
     * Suma los dos estados sin pagar y no solo PENDIENTE: en cuanto una
     * devolución pasa a «lista para devolver» sigue siendo plata que no ha
     * salido, y dejarla fuera haría que la cifra de arriba bajara sola cada vez
     * que alguien completa unos datos bancarios.
     */
    montoPendiente:  ESTADOS_SIN_PAGAR.reduce((t, e) => t + Number(de(e)?._sum.monto ?? 0), 0),
    hechas:          de('HECHA')?._count._all ?? 0,
    montoHecho:      Number(de('HECHA')?._sum.monto ?? 0),
    rechazadas:      de('RECHAZADA')?._count._all ?? 0,
  };

  return NextResponse.json({
    lista: lista.map(d => ({ ...d, monto: Number(d.monto) })),
    metricas,
    porMes: porMes.map(m => ({ ...m, n: Number(m.n), total: Number(m.total) })),
  });
}

/**
 * Abre una devolución para una PQRS. Nace PENDIENTE: registrarla es decir
 * «hay que devolver esto», no «ya se devolvió».
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const pqrsId = String(body?.pqrsId ?? '');
  const motivo = String(body?.motivo ?? '').trim();
  const monto = parsearMonto(body?.monto);

  // Los datos del pago son opcionales: la clienta rara vez los da en el primer
  // mensaje y exigirlos aquí solo lograría que la devolución no se registrara.
  // Se completan después desde la propia devolución.
  const texto = (v: unknown) => {
    const t = String(v ?? '').trim();
    return t ? t.slice(0, 200) : null;
  };
  const fechaLimite = new Date(String(body?.fechaLimite || fechaLimitePorDefecto()));

  if (!pqrsId) return NextResponse.json({ error: 'Falta el radicado del que sale la devolución.' }, { status: 400 });
  if (monto === null) return NextResponse.json({ error: 'El monto tiene que ser un número mayor que cero.' }, { status: 400 });
  if (!motivo) return NextResponse.json({ error: 'Escribe en una línea por qué se devuelve.' }, { status: 400 });

  const pqrs = await prisma.pqrs.findUnique({
    where: { id: pqrsId },
    select: { id: true, radicado: true, customerId: true, orderId: true },
  });
  if (!pqrs) return NextResponse.json({ error: 'Esa PQRS no existe.' }, { status: 404 });

  // Una PQRS, una devolución. Si hiciera falta otra se radica una PQRS nueva y
  // así el motivo vuelve a quedar escrito en vez de acumularse en la misma fila.
  const yaHay = await prisma.devolucion.findUnique({
    where: { pqrsId },
    select: { consecutivo: true },
  });
  if (yaHay) {
    return NextResponse.json(
      { error: 'Ese radicado ya tiene una devolución abierta. Ábrela desde la pestaña Devoluciones.' },
      { status: 409 },
    );
  }

  const devolucion = await prisma.devolucion.create({
    data: {
      pqrsId,
      customerId: pqrs.customerId,
      orderId: body?.orderId || pqrs.orderId || null,
      monto,
      motivo,
      notas: texto(body?.notas),
      titular:      texto(body?.titular),
      cedula:       texto(body?.cedula),
      contacto:     texto(body?.contacto),
      entidad:      texto(body?.entidad),
      tipoCuenta:   texto(body?.tipoCuenta),
      numeroCuenta: texto(body?.numeroCuenta),
      fechaLimite:  Number.isNaN(fechaLimite.getTime()) ? null : fechaLimite,
      solicitadaPorId: user.id,
      solicitadaPorName: user.name,
      history: agregarHistorialDevolucion([], {
        por: user.name,
        tipo: 'creacion',
        texto: `Devolución abierta por $${monto.toLocaleString('es-CO')} — ${motivo}`,
      }) as unknown as object,
    },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      pqrs:     { select: { id: true, radicado: true, subject: true, type: true, status: true, createdAt: true } },
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: user.id, action: 'DEVOLUCION_ABIERTA', resource: 'devoluciones',
      metadata: { devolucionId: devolucion.id, consecutivo: devolucion.consecutivo, radicado: pqrs.radicado, monto },
    },
  }).catch(() => {});

  return NextResponse.json({ ...devolucion, monto: Number(devolucion.monto) }, { status: 201 });
}
