import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Las líneas de WhatsApp que puede ver quien pregunta, con cuántas
 * conversaciones sin leer tiene cada una.
 *
 * Una agente restringida recibe solo la suya —así la bandeja no le pinta un
 * selector con una sola opción—; la admin las recibe todas para poder
 * alternar entre atención general y postcompra.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const cuentas = await prisma.metaAccount.findMany({
    where: {
      channel: 'WHATSAPP',
      isActive: true,
      ...(user.metaAccountId && { id: user.metaAccountId }),
    },
    select: { id: true, accountName: true, phoneNumber: true },
    orderBy: { createdAt: 'asc' },
  });

  // Un solo groupBy en vez de un count por línea: son pocas cuentas, pero esta
  // ruta la pide la bandeja cada vez que se refresca.
  const sinLeer = await prisma.conversation.groupBy({
    by: ['metaAccountId'],
    where: {
      isRead: false,
      status: { not: 'RESOLVED' },
      metaAccountId: { in: cuentas.map(c => c.id) },
    },
    _count: true,
  });
  const porLinea = new Map(sinLeer.map(x => [x.metaAccountId, x._count]));

  return NextResponse.json(
    cuentas.map(c => ({
      id: c.id,
      nombre: c.accountName || c.phoneNumber || 'Línea',
      telefono: c.phoneNumber,
      sinLeer: porLinea.get(c.id) ?? 0,
    })),
  );
}
