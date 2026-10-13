/**
 * Datos de demostración para ver el CRM funcionando sin conectarlo a nada.
 *
 *   ./_run.sh npx tsx scripts/seed-demo.ts
 *
 * Inventa clientas, pedidos, conversaciones, plantillas y carritos con formas
 * realistas (ciudades colombianas, estados de Mastershop, ventana de 60 días)
 * para que el dashboard y la bandeja tengan de qué hablar.
 *
 * SOLO CORRE CONTRA UNA BASE LOCAL. Si DATABASE_URL apunta a cualquier host que
 * no sea localhost, aborta: estos datos no pueden acabar mezclados con clientas
 * de verdad.
 */
import { PrismaClient } from '@prisma/client';

const url = process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error('Abortado: seed-demo solo corre contra una base local.');
  console.error(`DATABASE_URL apunta a: ${url.replace(/:[^:@]*@/, ':***@') || '(vacío)'}`);
  process.exit(1);
}

const prisma = new PrismaClient();

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);

const PRODUCTOS = [
  { name: 'Probiótico Vaginal Fem · 30 cápsulas', price: 129_000 },
  { name: 'Probiótico Vaginal Fem · Duo pack',    price: 219_000 },
  { name: 'Kit Bienestar Fem',                    price: 189_000 },
  { name: 'Gel Íntimo Fem',                       price:  89_000 },
];

const CLIENTAS = [
  { name: 'Valentina Restrepo Gómez', city: 'Medellín',     dep: 'Antioquia',        status: 'RECURRING', tags: ['vip', 'recompra'] },
  { name: 'Laura Camila Ospina',      city: 'Bogotá',       dep: 'Cundinamarca',     status: 'ACTIVE',    tags: [] },
  { name: 'Daniela Muñoz Arango',     city: 'Cali',         dep: 'Valle del Cauca',  status: 'RECURRING', tags: ['vip'] },
  { name: 'Sara Jiménez Torres',      city: 'Barranquilla', dep: 'Atlántico',        status: 'ACTIVE',    tags: ['confirmado-whatsapp'] },
  { name: 'Mariana Castaño Ruiz',     city: 'Bucaramanga',  dep: 'Santander',        status: 'AT_RISK',   tags: [] },
  { name: 'Juliana Herrera Vélez',    city: 'Medellín',     dep: 'Antioquia',        status: 'ACTIVE',    tags: ['prioridad'] },
  { name: 'Andrea Salazar Mesa',      city: 'Pereira',      dep: 'Risaralda',        status: 'NEW',       tags: [] },
  { name: 'Catalina Rojas Duque',     city: 'Bogotá',       dep: 'Cundinamarca',     status: 'RECURRING', tags: ['vip', 'recompra'] },
  { name: 'Paula Andrea Cardona',     city: 'Manizales',    dep: 'Caldas',           status: 'ACTIVE',    tags: [] },
  { name: 'Isabella Quintero Ramos',  city: 'Cartagena',    dep: 'Bolívar',          status: 'NEW',       tags: [] },
  { name: 'Natalia Franco Betancur',  city: 'Medellín',     dep: 'Antioquia',        status: 'AT_RISK',   tags: [] },
  { name: 'Manuela Zapata Ríos',      city: 'Cúcuta',       dep: 'Norte de Santander', status: 'ACTIVE',  tags: [] },
  { name: 'Camila Andrea Peña',       city: 'Bogotá',       dep: 'Cundinamarca',     status: 'LOST',      tags: [] },
  { name: 'Sofía Álvarez Londoño',    city: 'Cali',         dep: 'Valle del Cauca',  status: 'ACTIVE',    tags: ['confirmado-whatsapp'] },
];

/** Distribución de estados parecida a la real: la mayoría entrega. */
const ESTADOS = [
  'DELIVERED', 'DELIVERED', 'DELIVERED', 'DELIVERED', 'DELIVERED', 'DELIVERED',
  'IN_TRANSIT', 'IN_TRANSIT', 'PREPARING', 'PENDING_CONFIRMATION',
  'IN_DESTINATION', 'RETURNED', 'FAILED_DELIVERY', 'CANCELLED',
] as const;

const TRANSPORTADORAS = ['Interrapidísimo', 'Servientrega', 'Envía', 'Coordinadora'];

const PLANTILLAS = [
  { name: 'pedido_por_confirmar',   cat: 'CONFIRMATION', body: 'Hola {{1}} 💗 Recibimos tu pedido de {{2}}. Lo enviamos a {{3}}, {{4}}. ¿Confirmamos el despacho?' },
  { name: 'pedido_despachado',      cat: 'LOGISTICS',    body: '¡Tu pedido Fem ya salió! 📦 Guía {{1}} con {{2}}. Te avisamos en cada paso.' },
  { name: 'pedido_en_transito',     cat: 'LOGISTICS',    body: '{{1}}, tu pedido va en camino 🚚 Guía {{2}} · {{3}}.' },
  { name: 'pedido_en_reparto',      cat: 'LOGISTICS',    body: '{{1}}, hoy te entregan 💗 Ten el teléfono a la mano.' },
  { name: 'pedido_entrega_oficina', cat: 'LOGISTICS',    body: '{{1}}, tu pedido quedó en oficina de {{2}}. Reclámalo con tu documento y la guía {{3}}.' },
  { name: 'pedido_entregado',       cat: 'LOGISTICS',    body: '{{1}}, ¡tu {{2}} ya está contigo! Cualquier duda escríbenos por aquí.' },
  { name: 'guia_de_uso',            cat: 'SUPPORT',      body: 'Te dejamos la guía de uso: una cápsula al día, preferiblemente en la noche, durante 30 días.' },
  { name: 'pedido_novedad',         cat: 'LOGISTICS',    body: '{{1}}, hubo una novedad con tu entrega. ¿Nos confirmas la dirección y un teléfono de contacto?' },
  { name: 'pedido_devolucion',      cat: 'SUPPORT',      body: '{{1}}, tu pedido volvió a bodega. ¿Nos cuentas qué pasó para poder ayudarte?' },
  { name: 'pedido_recordatorio_confirmacion', cat: 'CONFIRMATION', body: 'Seguimos con tu {{1}} listo para {{2}}, {{3}}. ¿Lo despachamos hoy?' },
  { name: 'confirmacion_recibida',  cat: 'CONFIRMATION', body: '¡Listo! Ya lo dejamos en alistamiento 💗' },
  { name: 'confirmacion_dudas',     cat: 'SUPPORT',      body: 'Claro que sí, una asesora te escribe en un momento.' },
  { name: 'recompra_30_dias',       cat: 'REPURCHASE',   body: '{{1}}, ya casi terminas tu tratamiento. ¿Te enviamos el siguiente mes?' },
];

/** Conversaciones con textura: cada una cuenta algo distinto. */
const CHARLAS: { idx: number; canal: 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK'; leida: boolean; tags: string[]; msgs: [string, 'IN' | 'OUT' | 'NOTA', number][] }[] = [
  {
    idx: 5, canal: 'WHATSAPP', leida: false, tags: ['prioridad'],
    msgs: [
      ['Hola, compré el probiótico hace 3 días y no me ha llegado nada 😔', 'IN', 0.35],
      ['Hola Juliana 💗 Reviso ya mismo tu pedido.', 'OUT', 0.3],
      ['Tu guía es 240119887 con Interrapidísimo, aparece en reparto para hoy.', 'OUT', 0.28],
      ['⚑ La clienta pidió ayuda desde la plantilla de confirmación', 'NOTA', 0.27],
      ['Ay menos mal, gracias! Es que me preocupé', 'IN', 0.2],
    ],
  },
  {
    idx: 0, canal: 'WHATSAPP', leida: false, tags: ['vip'],
    msgs: [
      ['¿El probiótico se puede tomar con anticonceptivos?', 'IN', 0.9],
      ['Sí Valentina, no hay interacción. Se toma una cápsula en la noche 💗', 'OUT', 0.85],
      ['Perfecto, entonces mándame el duo pack', 'IN', 0.6],
    ],
  },
  {
    idx: 3, canal: 'WHATSAPP', leida: true, tags: ['confirmado-whatsapp'],
    msgs: [
      ['Hola Sara 💗 Recibimos tu pedido de Probiótico Vaginal Fem · 30 cápsulas.', 'OUT', 2.4],
      ['Confirmar pedido', 'IN', 2.2],
      ['¡Listo! Ya lo dejamos en alistamiento 💗', 'OUT', 2.15],
    ],
  },
  {
    idx: 9, canal: 'INSTAGRAM', leida: false, tags: [],
    msgs: [
      ['hola! vi el post, cuánto vale el kit?', 'IN', 0.12],
    ],
  },
  {
    idx: 7, canal: 'WHATSAPP', leida: true, tags: ['recompra'],
    msgs: [
      ['Catalina, ya casi terminas tu tratamiento. ¿Te enviamos el siguiente mes?', 'OUT', 5],
      ['Sí porfa, a la misma dirección', 'IN', 4.8],
      ['Pedido creado ✨ Te llega en 2-3 días hábiles.', 'OUT', 4.7],
    ],
  },
  {
    idx: 1, canal: 'FACEBOOK', leida: true, tags: [],
    msgs: [
      ['Buenas, hacen envíos a Bogotá?', 'IN', 8],
      ['¡Claro que sí! Envío a toda Colombia, pago contra entrega 💗', 'OUT', 7.9],
    ],
  },
  {
    idx: 11, canal: 'WHATSAPP', leida: false, tags: [],
    msgs: [
      ['📷 Foto', 'IN', 1.1],
      ['Me salió esto en la caja, es normal?', 'IN', 1.05],
    ],
  },
];

async function main() {
  console.log('Limpiando datos anteriores…');
  await prisma.$executeRaw`
    TRUNCATE message_media, messages, conversations, flow_executions, abandoned_carts,
             mastershop_guides, orders, customers, message_templates, activity_logs,
             webhook_events, meta_accounts RESTART IDENTITY CASCADE
  `;

  // ── Clientas ───────────────────────────────────────────────────────────
  const clientas = [];
  for (let i = 0; i < CLIENTAS.length; i++) {
    const c = CLIENTAS[i];
    clientas.push(await prisma.customer.create({
      data: {
        phone: `+5730${String(11_000_000 + i * 7_351).padStart(8, '0')}`,
        email: `${c.name.split(' ')[0].toLowerCase()}${i}@correo.com`,
        name: c.name,
        city: c.city,
        department: c.dep,
        originChannel: i % 5 === 0 ? 'INSTAGRAM' : 'WHATSAPP',
        status: c.status as any,
        tags: c.tags,
        firstContactAt: ago(60 - i * 2),
      },
    }));
  }
  console.log(`${clientas.length} clientas`);

  const integration = await prisma.integrationConfig.upsert({
    where: { platform_name: { platform: 'MASTERSHOP', name: 'Mastershop' } },
    create: { platform: 'MASTERSHOP', name: 'Mastershop', isActive: true, lastSyncAt: new Date(Date.now() - 25 * 60_000) },
    update: { lastSyncAt: new Date(Date.now() - 25 * 60_000) },
  });

  // ── Pedidos repartidos en 60 días ──────────────────────────────────────
  let n = 0;
  for (let d = 59; d >= 0; d--) {
    // Más pedidos entre semana; algunos días sin nada, como en la vida real.
    const dow = ago(d).getDay();
    const cuantos = dow === 0 ? 0 : (d % 3 === 0 ? 2 : 1);

    for (let k = 0; k < cuantos; k++) {
      const cliente  = clientas[(d * 3 + k) % clientas.length];
      const producto = PRODUCTOS[(d + k) % PRODUCTOS.length];
      const cantidad = (d + k) % 5 === 0 ? 2 : 1;
      const estado   = d < 4 ? 'PENDING_CONFIRMATION' : ESTADOS[(d * 2 + k) % ESTADOS.length];
      const guia     = `2401${String(10_000 + n).padStart(6, '0')}`;
      const creado   = ago(d);

      const pedido = await prisma.order.create({
        data: {
          shopifyOrderId: `demo-${n}`,
          shopifyOrderNumber: `#${2400 + n}`,
          customerId: cliente.id,
          integrationId: integration.id,
          status: estado as any,
          totalAmount: producto.price * cantidad,
          currency: 'COP',
          trackingNumber: estado === 'PENDING_CONFIRMATION' ? null : guia,
          shippingAddress: { address: `Calle ${10 + (n % 80)} # ${n % 60}-${n % 40}`, city: cliente.city },
          items: [{ name: producto.name, quantity: cantidad, price: producto.price }],
          statusHistory: [{ status: estado, changedAt: creado.toISOString() }],
          confirmedAt: ['PENDING_CONFIRMATION'].includes(estado) ? null : creado,
          ...(estado === 'DELIVERED' && { deliveredAt: ago(Math.max(0, d - 3)) }),
        },
      });

      // La fecha real la manda Mastershop; Prisma pondría la de creación.
      await prisma.$executeRaw`UPDATE orders SET created_at = ${creado}::timestamptz WHERE id = ${pedido.id}`;

      if (estado !== 'PENDING_CONFIRMATION') {
        await prisma.mastershopGuide.create({
          data: {
            guideNumber: guia,
            orderId: pedido.id,
            customerId: cliente.id,
            carrier: TRANSPORTADORAS[n % TRANSPORTADORAS.length],
            status: estado,
            originCity: 'Medellín',
            destinationCity: cliente.city,
            lastSyncedAt: new Date(),
          },
        });
      }
      n++;
    }
  }
  console.log(`${n} pedidos`);

  // Métricas de clienta calculadas desde sus pedidos reales
  await prisma.$executeRaw`
    UPDATE customers c SET
      total_orders = s.cnt, ltv = s.ltv,
      first_purchase_at = s.first_at, last_purchase_at = s.last_at
    FROM (
      SELECT customer_id, COUNT(*) cnt, SUM(total_amount) ltv,
             MIN(created_at) first_at, MAX(created_at) last_at
      FROM orders GROUP BY customer_id
    ) s WHERE s.customer_id = c.id
  `;

  // ── Plantillas ─────────────────────────────────────────────────────────
  for (const t of PLANTILLAS) {
    await prisma.messageTemplate.create({
      data: {
        name: t.name,
        category: t.cat as any,
        content: t.body,
        variables: (t.body.match(/\{\{\d+\}\}/g) ?? []).map(s => `var${s.replace(/\D/g, '')}`),
        status: t.name === 'recompra_30_dias' ? 'PENDING' : 'APPROVED',
        channels: ['WHATSAPP'],
        language: 'es',
      },
    });
  }
  console.log(`${PLANTILLAS.length} plantillas`);

  // ── Conversaciones ─────────────────────────────────────────────────────
  for (const ch of CHARLAS) {
    const cliente = clientas[ch.idx];
    const ultimo  = ago(ch.msgs[ch.msgs.length - 1][2]);

    const conv = await prisma.conversation.create({
      data: {
        customerId: cliente.id,
        channel: ch.canal,
        status: ch.leida ? 'RESOLVED' : 'OPEN',
        isRead: ch.leida,
        tags: ch.tags,
        lastMessageAt: ultimo,
      },
    });

    for (const [texto, tipo, dias] of ch.msgs) {
      const m = await prisma.message.create({
        data: {
          conversationId: conv.id,
          direction: tipo === 'IN' ? 'INBOUND' : 'OUTBOUND',
          content: texto,
          contentType: texto.startsWith('📷') ? 'image' : 'text',
          isInternal: tipo === 'NOTA',
          status: tipo === 'IN' ? 'DELIVERED' : 'READ',
        },
      });
      await prisma.$executeRaw`UPDATE messages SET created_at = ${ago(dias)}::timestamptz WHERE id = ${m.id}`;
    }
  }
  console.log(`${CHARLAS.length} conversaciones`);

  // ── Carritos abandonados ───────────────────────────────────────────────
  for (let i = 0; i < 5; i++) {
    const cliente  = clientas[(i * 3) % clientas.length];
    const producto = PRODUCTOS[i % PRODUCTOS.length];
    await prisma.abandonedCart.create({
      data: {
        externalId: `demo-cart-${i}`,
        customerId: cliente.id,
        email: cliente.email,
        phone: cliente.phone,
        status: i === 4 ? 'RECOVERED' : 'OPEN',
        checkoutUrl: `https://fem.com.co/checkout/demo-${i}`,
        totalAmount: producto.price,
        lineItems: [{ name: producto.name, quantity: 1, price: producto.price }],
        reminderCount: i % 3,
        abandonedAt: ago(i * 0.7 + 0.2),
      },
    });
  }
  console.log('5 carritos abandonados');

  console.log('\nDatos de demostración listos.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
