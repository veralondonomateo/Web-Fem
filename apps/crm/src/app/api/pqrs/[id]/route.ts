import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import {
  ESTADOS_PQRS, EstadoPqrs, PRIORIDADES_PQRS, semaforoDe, agregarHistorial,
} from '@/lib/pqrs';

export const dynamic = 'force-dynamic';

/**
 * El monto de la devolución es un Decimal de Prisma: al serializarlo sale como
 * cadena y la pantalla lo pintaría como texto. Se normaliza a número aquí, en
 * el único sitio por el que salen las dos respuestas.
 */
function conMonto<T extends { devolucion?: { monto: unknown } | null }>(pqrs: T) {
  return {
    ...pqrs,
    devolucion: pqrs.devolucion ? { ...pqrs.devolucion, monto: Number(pqrs.devolucion.monto) } : null,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const pqrs = await prisma.pqrs.findUnique({
    where: { id: (await params).id },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true, city: true } },
      agent:    { select: { id: true, name: true } },
      devolucion: { select: { id: true, consecutivo: true, monto: true, estado: true, createdAt: true } },
    },
  });
  if (!pqrs) return NextResponse.json({ error: 'PQRS no encontrada.' }, { status: 404 });

  return NextResponse.json({ ...conMonto(pqrs), ...semaforoDe(pqrs.status as EstadoPqrs, pqrs.dueAt) });
}

/**
 * Actualiza una PQRS: estado, prioridad, asignación, comentario o resolución.
 * Cada cambio queda en la bitácora con quién y cuándo.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const pqrs = await prisma.pqrs.findUnique({ where: { id: (await params).id } });
  if (!pqrs) return NextResponse.json({ error: 'PQRS no encontrada.' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  let historial = pqrs.history;

  if (body.comentario?.trim()) {
    historial = agregarHistorial(historial, {
      por: user.name, tipo: 'comentario', texto: body.comentario.trim(),
    }) as unknown as typeof historial;
    if (!pqrs.firstResponseAt) data.firstResponseAt = new Date();
  }

  if (body.prioridad && body.prioridad !== pqrs.priority) {
    if (!PRIORIDADES_PQRS.includes(body.prioridad)) {
      return NextResponse.json({ error: 'Prioridad inválida.' }, { status: 400 });
    }
    data.priority = body.prioridad;
    historial = agregarHistorial(historial, {
      por: user.name, tipo: 'prioridad', texto: `Prioridad: ${pqrs.priority} → ${body.prioridad}`,
    }) as unknown as typeof historial;
  }

  if (body.assignedTo !== undefined && body.assignedTo !== pqrs.assignedTo) {
    const destino = body.assignedTo
      ? await prisma.crmUser.findUnique({ where: { id: body.assignedTo }, select: { name: true } })
      : null;
    if (body.assignedTo && !destino) {
      return NextResponse.json({ error: 'Esa usuaria no existe.' }, { status: 400 });
    }
    data.assignedTo = body.assignedTo || null;
    historial = agregarHistorial(historial, {
      por: user.name, tipo: 'asignacion',
      texto: destino ? `Asignada a ${destino.name}` : 'Quedó sin asignar',
    }) as unknown as typeof historial;
  }

  if (body.estado && body.estado !== pqrs.status) {
    if (!ESTADOS_PQRS[body.estado as EstadoPqrs]) {
      return NextResponse.json({ error: 'Estado inválido.' }, { status: 400 });
    }
    // Para resolver hay que decir QUÉ se resolvió: es lo que queda de cara a
    // la SIC si la clienta escala, y lo que otra agente lee mañana.
    if (body.estado === 'RESUELTA') {
      const resolucion = String(body.resolucion ?? '').trim();
      if (!resolucion) {
        return NextResponse.json(
          { error: 'Para marcarla resuelta escribe la resolución: qué se le respondió a la clienta.' },
          { status: 400 },
        );
      }
      data.resolution = resolucion;
      data.resolvedAt = new Date();
      historial = agregarHistorial(historial, {
        por: user.name, tipo: 'resolucion', texto: resolucion,
      }) as unknown as typeof historial;
    }
    if (body.estado === 'CERRADA') data.closedAt = new Date();
    data.status = body.estado;
    historial = agregarHistorial(historial, {
      por: user.name, tipo: 'estado',
      texto: `${ESTADOS_PQRS[pqrs.status as EstadoPqrs]} → ${ESTADOS_PQRS[body.estado as EstadoPqrs]}`,
    }) as unknown as typeof historial;
  }

  if (!Object.keys(data).length && historial === pqrs.history) {
    return NextResponse.json({ error: 'Nada que actualizar.' }, { status: 400 });
  }

  const actualizada = await prisma.pqrs.update({
    where: { id: (await params).id },
    data: { ...data, history: historial as object },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true, city: true } },
      agent:    { select: { id: true, name: true } },
      devolucion: { select: { id: true, consecutivo: true, monto: true, estado: true, createdAt: true } },
    },
  });

  await prisma.activityLog.create({
    data: {
      userId: user.id, action: 'PQRS_ACTUALIZADA', resource: 'pqrs',
      metadata: { pqrsId: pqrs.id, radicado: pqrs.radicado, cambios: Object.keys(data) },
    },
  }).catch(() => {});

  return NextResponse.json({
    ...conMonto(actualizada),
    ...semaforoDe(actualizada.status as EstadoPqrs, actualizada.dueAt),
  });
}
