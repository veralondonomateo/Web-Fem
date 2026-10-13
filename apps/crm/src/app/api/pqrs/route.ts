import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { vencimientoHabil } from '@/lib/dias-habiles';
import {
  TIPOS_PQRS, TipoPqrs, ESTADOS_VIVOS, semaforoDe, agregarHistorial, EstadoPqrs,
} from '@/lib/pqrs';

export const dynamic = 'force-dynamic';

/**
 * Lista de PQRS con su semáforo de vencimiento, ordenada por urgencia real:
 * primero lo vencido, luego lo que menos plazo tiene. Las resueltas van al
 * final, más recientes primero.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const p = req.nextUrl.searchParams;
  const estado = p.get('estado');
  const tipo = p.get('tipo');
  const q = p.get('q')?.trim();

  const where: Record<string, unknown> = {};
  if (estado === 'vivas') where.status = { in: ESTADOS_VIVOS };
  else if (estado) where.status = estado;
  if (tipo) where.type = tipo;
  if (q) {
    where.OR = [
      { subject: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { customer: { name: { contains: q, mode: 'insensitive' } } },
      ...(Number(q.replace(/\D/g, '')) ? [{ radicado: Number(q.replace(/\D/g, '')) }] : []),
    ];
  }

  const [lista, vivas, vencidas, porVencer, resueltasMes, cerradas] = await Promise.all([
    prisma.pqrs.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        agent:    { select: { id: true, name: true } },
        // Para que el detalle sepa si este radicado ya tiene devolución abierta
        // y ofrezca verla en vez de crear una segunda.
        devolucion: { select: { id: true, consecutivo: true, monto: true, estado: true, createdAt: true } },
      },
      orderBy: [{ dueAt: 'asc' }],
      take: 300,
    }),
    prisma.pqrs.count({ where: { status: { in: ESTADOS_VIVOS } } }),
    prisma.pqrs.count({ where: { status: { in: ESTADOS_VIVOS }, dueAt: { lt: new Date() } } }),
    prisma.pqrs.count({
      where: {
        status: { in: ESTADOS_VIVOS },
        dueAt: { gte: new Date(), lt: new Date(Date.now() + 5 * 86_400_000) },
      },
    }),
    prisma.pqrs.count({
      where: {
        status: { in: ['RESUELTA', 'CERRADA'] },
        resolvedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
    }),
    prisma.pqrs.findMany({
      where: { status: { in: ['RESUELTA', 'CERRADA'] }, resolvedAt: { not: null } },
      select: { dueAt: true, resolvedAt: true },
      take: 500, orderBy: { resolvedAt: 'desc' },
    }),
  ]);

  const conSemaforo = lista.map(x => ({
    ...x,
    devolucion: x.devolucion ? { ...x.devolucion, monto: Number(x.devolucion.monto) } : null,
    ...semaforoDe(x.status as EstadoPqrs, x.dueAt),
  }));
  // Urgencia real: vivas por plazo ascendente (ya viene así), resueltas al final.
  conSemaforo.sort((a, b) => {
    const va = a.semaforo === 'resuelta' ? 1 : 0;
    const vb = b.semaforo === 'resuelta' ? 1 : 0;
    if (va !== vb) return va - vb;
    if (va === 1) return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  });

  const aTiempo = cerradas.filter(c => c.resolvedAt! <= c.dueAt).length;

  return NextResponse.json({
    lista: conSemaforo,
    metricas: {
      vivas, vencidas, porVencer, resueltasMes,
      pctATiempo: cerradas.length ? Math.round((aTiempo / cerradas.length) * 100) : null,
    },
  });
}

/** Radica una PQRS nueva. El vencimiento legal se calcula solo. */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const body = await req.json().catch(() => null);
  const tipo = body?.tipo as TipoPqrs;
  const asunto = String(body?.asunto ?? '').trim();
  const descripcion = String(body?.descripcion ?? '').trim();
  const customerId = String(body?.customerId ?? '');

  if (!TIPOS_PQRS[tipo]) return NextResponse.json({ error: 'Tipo de PQRS inválido.' }, { status: 400 });
  if (!asunto) return NextResponse.json({ error: 'Falta el asunto.' }, { status: 400 });
  if (!descripcion) return NextResponse.json({ error: 'Falta la descripción.' }, { status: 400 });

  const clienta = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!clienta) return NextResponse.json({ error: 'Clienta no encontrada.' }, { status: 404 });

  const regla = TIPOS_PQRS[tipo];
  const ahora = new Date();

  const pqrs = await prisma.pqrs.create({
    data: {
      type: tipo,
      priority: (body?.prioridad && ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'].includes(body.prioridad))
        ? body.prioridad : regla.prioridad,
      subject: asunto,
      description: descripcion,
      customerId,
      conversationId: body?.conversationId || null,
      orderId: body?.orderId || null,
      assignedTo: body?.assignedTo || user.id,
      createdById: user.id,
      createdByName: user.name,
      dueAt: vencimientoHabil(ahora, regla.diasHabiles),
      history: agregarHistorial([], {
        por: user.name, tipo: 'creacion',
        texto: `Radicada como ${regla.etiqueta.toLowerCase()} — plazo legal de ${regla.diasHabiles} días hábiles.`,
      }) as unknown as object,
    },
    include: { customer: { select: { id: true, name: true, phone: true } } },
  });

  await prisma.activityLog.create({
    data: {
      userId: user.id, action: 'PQRS_CREADA', resource: 'pqrs',
      metadata: { pqrsId: pqrs.id, radicado: pqrs.radicado, tipo },
    },
  }).catch(() => {});

  return NextResponse.json(pqrs, { status: 201 });
}
