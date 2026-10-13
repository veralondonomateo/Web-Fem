import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { signMediaToken } from '@/services/media';
import { markMessageRead } from '@/services/whatsapp';

/** Cuántos mensajes se cargan de un chat. Ver el comentario en la consulta. */
const TOPE_MENSAJES = 300;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  /**
   * Las dos consultas van a la vez.
   *
   * Antes iban en fila —conversación, luego pedidos, luego marcar leída— y cada
   * una pagaba su viaje completo a la base: 2,4 s en total para 9 KB de
   * respuesta, en la ruta que la bandeja pide cada 8 segundos. Los pedidos se
   * piden por la relación en vez de por `customerId` justamente para no tener
   * que esperar a que llegue la conversación.
   */
  const [conversation, pedidos] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: (await params).id },
      include: {
        customer: true,
        agent:    { select: { id: true, name: true } },
        // Por qué número acusar la lectura: tiene que ser el mismo por el que
        // llegó el mensaje.
        metaAccount: { select: { accountId: true } },
        // Los últimos TOPE_MENSAJES, no la conversación entera. Hoy la más
        // larga tiene 69 y no cambia nada, pero un hilo que lleve meses abierto
        // acabaría trayendo miles en cada sondeo. Se piden del más nuevo al más
        // viejo para quedarse con la cola, y se le da la vuelta antes de salir.
        messages: {
          orderBy: { createdAt: 'desc' },
          take: TOPE_MENSAJES,
          include: {
            sentBy: { select: { id: true, name: true } },
            // Sin `data`: el binario se sirve aparte por /api/media/[id].
            media:  { select: { mimeType: true, filename: true, size: true } },
          },
        },
      },
    }),
    // Últimos pedidos de la clienta, con su guía. Van aquí para que la agente
    // vea el estado real en la misma pantalla del chat, sin abrir la ficha.
    prisma.order.findMany({
      where: { customer: { conversations: { some: { id: (await params).id } } } },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: {
        id: true, shopifyOrderNumber: true, shopifyOrderId: true, status: true,
        totalAmount: true, trackingNumber: true, createdAt: true, deliveredAt: true,
        confirmedAt: true, items: true,
        // La dirección de entrega no se pedía, y es lo primero que pregunta la
        // clienta —«¿a dónde me lo mandan?»—. La agente tenía que salirse del
        // CRM a mirarla en Mastershop.
        shippingAddress: true,
        mastershopGuides: {
          orderBy: { createdAt: 'desc' }, take: 1,
          select: { guideNumber: true, carrier: true, statusDetail: true, lastSyncedAt: true },
        },
      },
    }),
  ]);

  if (!conversation) return NextResponse.json({ error: 'Conversación no encontrada' }, { status: 404 });
  // No es solo un filtro de lista: sin esto, una agente restringida a una
  // línea podría entrar a otra escribiendo el id directamente en la URL.
  if (user.metaAccountId && conversation.metaAccountId !== user.metaAccountId) return forbidden();

  // Cada adjunto viaja con su URL ya firmada, lista para <img src>.
  // Se invierten porque se pidieron del más nuevo al más viejo.
  const messages = conversation.messages
    .slice()
    .reverse()
    .map(m =>
      m.media
        ? { ...m, media: { ...m.media, url: `/api/media/${m.id}?t=${signMediaToken(m.id)}` } }
        : m,
    );

  // Si se llegó al tope hay historia más atrás. Se dice cuánta, para que en
  // pantalla no parezca que la conversación empieza ahí.
  const anteriores = conversation.messages.length === TOPE_MENSAJES
    ? await prisma.message.count({ where: { conversationId: (await params).id } }) - TOPE_MENSAJES
    : 0;

  /**
   * Solo si de verdad estaba sin leer. Escribir en cada sondeo costaba otro
   * viaje a la base cada 8 segundos por cada agente con un chat abierto, para
   * dejarlo exactamente como ya estaba.
   *
   * Y es aquí, no al recibir, donde se le avisa a WhatsApp que se leyó: los
   * chulos azules deben aparecerle a la clienta cuando una agente abre su
   * chat, no en el segundo en que ella escribe. Marcar el último entrante basta
   * —Meta da por leídos todos los anteriores— y va sin bloquear la respuesta.
   */
  if (!conversation.isRead) {
    const ultimoEntrante = [...conversation.messages]
      .reverse()
      .find(m => m.direction === 'INBOUND' && m.externalId);

    await Promise.all([
      prisma.conversation.update({ where: { id: (await params).id }, data: { isRead: true } }),
      ultimoEntrante?.externalId
        ? markMessageRead(ultimoEntrante.externalId, conversation.metaAccount?.accountId ?? undefined)
            .catch(() => {})
        : Promise.resolve(),
    ]);
  }
  return NextResponse.json({ ...conversation, messages, pedidos, anteriores });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  if (user.metaAccountId) {
    const existente = await prisma.conversation.findUnique({
      where: { id: (await params).id }, select: { metaAccountId: true },
    });
    if (existente && existente.metaAccountId !== user.metaAccountId) return forbidden();
  }

  const { status, assignedTo, tags } = await req.json();
  const conversation = await prisma.conversation.update({
    where: { id: (await params).id },
    data: { status, assignedTo, tags },
    include: { agent: { select: { id: true, name: true } } },
  });
  return NextResponse.json(conversation);
}
