import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { esCelularValido } from '@/services/mastershop';

export const dynamic = 'force-dynamic';

/**
 * Abre —o recupera— la conversación con una clienta, para poder escribirle
 * aunque nunca haya escrito ella primero.
 *
 * Antes solo existían conversaciones creadas por un mensaje entrante o por un
 * envío automático: para hablarle a alguien nuevo había que esperar a que
 * escribiera. Se acepta un id de clienta o un celular; si el celular no está
 * en el CRM, se crea la ficha.
 *
 * La conversación se abre en la línea de quien pregunta: una agente
 * restringida solo puede abrir en la suya, y la admin elige.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  if (user.role === 'ANALYST') return forbidden();

  const body = await req.json().catch(() => ({}));
  const customerId = String(body?.customerId ?? '').trim();
  const telefonoCrudo = String(body?.telefono ?? '').trim();
  const nombre = String(body?.nombre ?? '').trim();

  // La línea: la agente restringida no puede elegir; la admin sí, y si no
  // indica ninguna se usa la general, que es la de atención al público.
  let metaAccountId = user.metaAccountId;
  if (!metaAccountId) {
    const pedida = String(body?.metaAccountId ?? '').trim();
    if (pedida) {
      const existe = await prisma.metaAccount.findUnique({ where: { id: pedida }, select: { id: true } });
      if (!existe) return NextResponse.json({ error: 'Esa línea no existe.' }, { status: 400 });
      metaAccountId = pedida;
    } else {
      const general = await prisma.metaAccount.findFirst({
        where: { channel: 'WHATSAPP', accountId: process.env.WHATSAPP_PHONE_NUMBER_ID },
        select: { id: true },
      });
      metaAccountId = general?.id ?? null;
    }
  }

  let clienta = customerId
    ? await prisma.customer.findUnique({ where: { id: customerId } })
    : null;

  if (!clienta) {
    if (!telefonoCrudo) {
      return NextResponse.json({ error: 'Indica una clienta o un celular.' }, { status: 400 });
    }
    // Se normaliza a +57XXXXXXXXXX: es como se guardan todos los celulares y
    // como los espera WhatsApp. Sin esto, «3001234567» crearía una clienta
    // duplicada de una que ya existe como «+573001234567».
    const digitos = telefonoCrudo.replace(/\D/g, '');
    const telefono = '+' + (digitos.startsWith('57') ? digitos : `57${digitos}`);
    if (!esCelularValido(telefono)) {
      return NextResponse.json(
        { error: 'El celular no es válido. Debe ser un móvil colombiano de 10 dígitos.' },
        { status: 400 },
      );
    }
    clienta = await prisma.customer.findUnique({ where: { phone: telefono } })
      ?? await prisma.customer.create({
        data: {
          phone: telefono,
          name: nombre || 'Nuevo contacto',
          originChannel: 'WHATSAPP',
          status: 'NEW',
        },
      });
  }

  // Se reutiliza la última de esa línea aunque esté resuelta —y se reabre—:
  // crear un hilo nuevo dejaría la historia partida y la agente escribiría sin
  // ver lo que ya se habló con esa clienta.
  const existente = await prisma.conversation.findFirst({
    where: { customerId: clienta.id, channel: 'WHATSAPP', metaAccountId },
    orderBy: { lastMessageAt: 'desc' },
    select: { id: true, status: true },
  });
  if (existente) {
    if (existente.status === 'RESOLVED') {
      await prisma.conversation.update({ where: { id: existente.id }, data: { status: 'OPEN' } });
    }
    return NextResponse.json({ id: existente.id, creada: false });
  }

  // Igual que en el webhook: si dos personas la abren a la vez, el índice
  // único deja pasar a una y la otra recoge esa misma.
  const nueva = await prisma.conversation.create({
    data: {
      customerId: clienta.id,
      channel: 'WHATSAPP',
      metaAccountId,
      status: 'OPEN',
      // Nace leída: la abre la agente, no hay nada entrante que atender.
      isRead: true,
      lastMessageAt: new Date(),
    },
    select: { id: true },
  }).catch(async () => {
    const suya = await prisma.conversation.findFirst({
      where: { customerId: clienta!.id, channel: 'WHATSAPP', metaAccountId },
      select: { id: true },
    });
    if (!suya) throw new Error('No se pudo abrir la conversación');
    return suya;
  });

  return NextResponse.json({ id: nueva.id, creada: true });
}
