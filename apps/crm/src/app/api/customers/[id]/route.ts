import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const customer = await prisma.customer.findUnique({
    where: { id: (await params).id },
    include: {
      orders:        { orderBy: { createdAt: 'desc' } },
      conversations: { orderBy: { lastMessageAt: 'desc' }, include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } } },
    },
  });
  if (!customer) return NextResponse.json({ error: 'Cliente no encontrado' }, { status: 404 });
  return NextResponse.json(customer);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const { tags, notes, status, phone, email } = await req.json();

  /**
   * Guardar el correo que la clienta da por el chat.
   *
   * Solo una de cada diez fichas tiene correo —el resto llegó por WhatsApp, que
   * no lo trae—, y sin él la agente no puede buscarla por ahí ni mandarle la
   * factura. Cuando la clienta lo escribe en la conversación, esto lo deja
   * guardado en vez de que se pierda en el hilo.
   */
  if (email !== undefined) {
    const limpio = String(email ?? '').trim().toLowerCase();
    if (limpio && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(limpio)) {
      return NextResponse.json({ error: 'Ese correo no parece válido.' }, { status: 400 });
    }
    const actualizada = await prisma.customer.update({
      where: { id: (await params).id },
      data: { email: limpio || null },
    });
    return NextResponse.json(actualizada);
  }

  /**
   * Ponerle el celular a una clienta que llegó con el número oculto.
   *
   * Cuando Meta no manda el teléfono, la ficha se guarda con la identidad
   * («CO.123…»). Responderle sí se puede —va por `recipient`—, pero lo
   * automático (pedido, envío, carrito) necesita un celular. Muchas lo escriben
   * número en el chat: con esto la agente lo asigna y la conversación vuelve a
   * funcionar, en vez de tener que irse al celular a responderle.
   */
  if (phone !== undefined) {
    const digitos = String(phone).replace(/\D/g, '');
    const normalizado = '+' + (digitos.startsWith('57') ? digitos : `57${digitos}`);
    if (!/^\+573\d{9}$/.test(normalizado)) {
      return NextResponse.json(
        { error: 'Ese no es un celular colombiano válido. Debe empezar por 3 y tener 10 dígitos.' },
        { status: 400 },
      );
    }

    // Si el número ya es de otra ficha, no se pisa: se avisa, porque unir dos
    // clientas es una decisión con consecuencias y no algo que deba pasar solo.
    const ocupado = await prisma.customer.findUnique({
      where: { phone: normalizado },
      select: { id: true, name: true },
    });
    if (ocupado && ocupado.id !== (await params).id) {
      return NextResponse.json(
        { error: `Ese número ya es de ${ocupado.name}. Revisa si son la misma persona antes de asignarlo.` },
        { status: 409 },
      );
    }

    const actualizada = await prisma.customer.update({
      where: { id: (await params).id },
      data: { phone: normalizado, ...(tags && { tags }), ...(notes && { notes }), ...(status && { status }) },
    });
    return NextResponse.json(actualizada);
  }

  const customer = await prisma.customer.update({
    where: { id: (await params).id },
    data: { tags, notes, status },
  });
  return NextResponse.json(customer);
}
