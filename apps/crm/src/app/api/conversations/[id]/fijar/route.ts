import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Fija o suelta un chat en la bandeja de quien lo pide.
 *
 * Es de cada usuaria: lo que Lina quiere tener arriba no le aparece a Luciana.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const conversation = await prisma.conversation.findUnique({
    where: { id: (await params).id },
    select: { id: true, metaAccountId: true },
  });
  if (!conversation) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 });
  // No se puede fijar lo que no se puede ver.
  if (user.metaAccountId && conversation.metaAccountId !== user.metaAccountId) return forbidden();

  // Idempotente: fijar dos veces no falla ni duplica. La bandeja puede mandar
  // el mismo clic dos veces con la conexión lenta y no pasa nada.
  await prisma.conversationPin.upsert({
    where: { userId_conversationId: { userId: user.id, conversationId: (await params).id } },
    create: { userId: user.id, conversationId: (await params).id },
    update: {},
  });

  return NextResponse.json({ fijada: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  // `deleteMany` y no `delete`: soltar algo que ya no estaba fijado no es un
  // error que merezca romperle la pantalla a nadie.
  await prisma.conversationPin.deleteMany({
    where: { userId: user.id, conversationId: (await params).id },
  });

  return NextResponse.json({ fijada: false });
}
