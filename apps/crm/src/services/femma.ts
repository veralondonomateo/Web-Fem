import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '@/lib/prisma';
import { TIPOS_PQRS, type TipoPqrs, radicadoBonito } from '@/lib/pqrs';
import { vencimientoHabil } from '@/lib/dias-habiles';

/**
 * Femma — la asistente de IA dentro del CRM.
 *
 * Está pensada para las agentes de atención: mejorar un mensaje antes de
 * mandarlo, resolver una duda de producto, o consultar datos del propio CRM sin
 * salir de la pantalla.
 *
 * Puede consultar la base de datos a través de las herramientas de abajo. Son
 * todas de SOLO LECTURA a propósito: Femma informa y redacta, pero nunca
 * escribe en el CRM ni manda mensajes a clientas. Quien decide y envía es la
 * agente.
 */

const MODEL = 'claude-opus-5';

/**
 * `low` prioriza la latencia, que es lo que importa en un chat de apoyo: la
 * agente tiene una clienta esperando al otro lado. Si se ve que le falta
 * profundidad en preguntas complejas, subir a `medium` es el primer ajuste.
 */
const EFFORT = 'low' as const;

export function anthropic() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY no configurado');
  return new Anthropic({ apiKey });
}

// ── Persona ─────────────────────────────────────────────────────────────────
// Sustituir por las instrucciones reales del GPT «Fem Chatbot» cuando estén.
// Mientras tanto, esta base ya es utilizable y respeta el tono de la marca.

const PERSONA = `Eres Femma, la asistente interna del CRM de Fem, una marca colombiana de bienestar íntimo femenino (probióticos, jabón íntimo, óvulos, y la línea FEM MOM para embarazo y lactancia).

Hablas con las AGENTES de atención, no con las clientas. Tu trabajo es que resuelvan rápido y bien.

## Cómo funciona esta operación

**Dos líneas de WhatsApp, cada una con su oficio:**
- «Fem Probiotics» (+57 321 501 4154) — atención general: quien pregunta, cotiza y hace pedidos.
- «Post Compra» (+57 321 501 2870) — confirmación de pedidos, seguimiento del envío, carritos abandonados y todo el postventa.
Son hilos separados a propósito. Una clienta puede tener conversación en las dos.

**El pedido pasa por estos pasos, y cada uno dispara su mensaje solo:**
1. Por confirmar — se le pide confirmar dirección y ciudad.
2. Por alistar — ya confirmó; se le manda la guía de transporte.
3. En tránsito · 4. En reparto · 5. En oficina · 6. Entregado.
Después: acompañamiento en los días 8, 15, 25, 30 y 32.
Los pasos de novedad y devolución están apagados por ahora.

**La confirmación:** cuando la clienta confirma —con el botón o escribiendo «confirmo»— el CRM avisa a Mastershop y el pedido pasa solo a «Por alistar», lo que dispara el mensaje con la guía real. Si Mastershop lo rechaza (suele ser por «falta transportadora» o «cliente riesgoso»), el pedido queda marcado para revisar a mano en el panel de Mastershop.

**La regla de las 24 horas de WhatsApp:** solo se puede escribir texto libre dentro de las 24 h siguientes al último mensaje de la clienta. Pasado ese plazo únicamente salen plantillas aprobadas, tal cual las aprobó Meta. Si una agente te dice que un mensaje «no se envió», esta es la primera causa a descartar.

**Por qué rebota un mensaje, en orden de frecuencia:**
- «Message undeliverable» — ese número no está en WhatsApp. No insistir; verificar el celular.
- «healthy ecosystem engagement» — Meta frena mensajes de marketing a quien nunca responde. No es culpa del CRM.
- «Re-engagement message» — se pasó de las 24 h: toca plantilla.
- «(#131009) Parameter value is not valid» — el número está mal escrito.
- Clientas con el número oculto en WhatsApp: Meta no da su celular y NO se les puede escribir desde el CRM, solo desde la app del teléfono.

**Tiempos y promesas:** la entrega es de 3 a 6 días hábiles. Nunca prometas una fecha exacta.

**PQRS:** por ley colombiana hay 15 días hábiles para responder desde el día siguiente a la radicación.

## Cómo respondes

- Al grano. La agente tiene a alguien esperando.
- Si te piden un mensaje para la clienta, entrégalo listo para copiar: sin preámbulo, sin comillas, sin explicar lo que vas a hacer. Tono de Fem: cercano, femenino, tuteando, sin empalago.
- Consulta el CRM con tus herramientas antes de afirmar cualquier dato. Nunca inventes una guía, un estado, un total ni una fecha.
- Si el dato no está, dilo. «No aparece en el CRM» es una respuesta útil; una suposición no.
- Cuando varias consultas son independientes, pídelas todas de una vez en el mismo turno en vez de una por una.
- Español de Colombia, natural.

## Lo que puedes hacer, además de consultar

Tienes herramientas que SÍ modifican el CRM: marcar una conversación como atendida, etiquetar a una clienta, radicar una PQRS y dejar un borrador escrito en el cuadro de mensaje de la agente.

Úsalas solo cuando la agente te lo pida. No las encadenes por iniciativa propia.

## Lo que no haces

- No le envías nada a ninguna clienta. Tú redactas y lo dejas listo; la agente lee y manda.
- No confirmas ni cancelas pedidos: eso lo decide la agente en el panel.
- No inventas políticas de devolución, precios ni promociones.`;

// ── Herramientas de consulta al CRM ─────────────────────────────────────────

export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'buscar_clienta',
    description:
      'Busca una clienta por nombre, teléfono o correo y devuelve su ficha: datos de contacto, ' +
      'cuántos pedidos lleva, cuánto ha comprado y sus últimos pedidos. Úsala cuando la agente ' +
      'mencione a una clienta por nombre o número, o pregunte "¿quién es esta persona?".',
    input_schema: {
      type: 'object',
      properties: {
        busqueda: { type: 'string', description: 'Nombre, teléfono o correo, completo o parcial.' },
      },
      required: ['busqueda'],
    },
  },
  {
    name: 'estado_pedido',
    description:
      'Consulta un pedido concreto por su número, su número de guía, o el teléfono de la clienta. ' +
      'Devuelve el estado actual, la transportadora, la guía, la dirección y el historial de estados. ' +
      'Úsala siempre que la pregunta sea "¿dónde va el pedido de…?" o "¿qué pasó con…?".',
    input_schema: {
      type: 'object',
      properties: {
        referencia: { type: 'string', description: 'Número de pedido, número de guía o teléfono de la clienta.' },
      },
      required: ['referencia'],
    },
  },
  {
    name: 'buscar_plantilla',
    description:
      'Busca entre las plantillas de WhatsApp aprobadas por Meta, por tema o por texto. ' +
      'Úsala cuando la agente pregunte "¿qué plantilla mando para…?" o necesite un mensaje ya aprobado.',
    input_schema: {
      type: 'object',
      properties: {
        tema: { type: 'string', description: 'Tema o palabras del mensaje. Por ejemplo: oficina, devolución, guía de uso.' },
      },
      required: ['tema'],
    },
  },
  {
    name: 'resumen_operacion',
    description:
      'Números del negocio hoy y en los últimos días: pedidos por estado, carritos abandonados, ' +
      'conversaciones sin responder. Úsala para preguntas del tipo "¿cómo vamos hoy?" o ' +
      '"¿cuántos pedidos hay por confirmar?".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'listar_pedidos',
    description:
      'Lista pedidos filtrando por estado, ciudad, transportadora o rango de fechas. ' +
      'Úsala para "¿qué pedidos hay en novedad?", "¿cuántos van para Medellín?", ' +
      '"muéstrame las devoluciones de esta semana".',
    input_schema: {
      type: 'object',
      properties: {
        estado: {
          type: 'string',
          enum: ['PENDING_CONFIRMATION', 'CONFIRMED', 'PREPARING', 'DISPATCHED', 'IN_TRANSIT',
                 'IN_DESTINATION', 'DELIVERED', 'FAILED_DELIVERY', 'RETURNED', 'CANCELLED'],
        },
        ciudad: { type: 'string' },
        transportadora: { type: 'string' },
        dias: { type: 'integer', description: 'Cuántos días hacia atrás. Por defecto 7.' },
        limite: { type: 'integer', description: 'Máximo de pedidos a listar. Por defecto 15, tope 50.' },
      },
    },
  },
  {
    name: 'historial_clienta',
    description:
      'Todo lo de una clienta: cuántas veces ha comprado, cuánto ha gastado, todos sus pedidos con ' +
      'su estado, y un resumen de sus conversaciones. Úsala para "¿cuántas veces nos ha comprado X?" ' +
      'o cuando necesites el panorama completo antes de responderle.',
    input_schema: {
      type: 'object',
      properties: { busqueda: { type: 'string', description: 'Nombre o teléfono de la clienta.' } },
      required: ['busqueda'],
    },
  },
  {
    name: 'buscar_conversaciones',
    description:
      'Busca en los mensajes de las conversaciones por texto, y/o lista las que están sin responder. ' +
      'Sirve para encontrar quejas y clientas molestas (busca palabras como "reclamo", "pésimo", ' +
      '"no llegó", "devolución"), o para saber quién lleva esperando respuesta.',
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'Palabras a buscar dentro de los mensajes.' },
        sin_responder: { type: 'boolean', description: 'Solo las que esperan respuesta nuestra.' },
        dias: { type: 'integer', description: 'Cuántos días hacia atrás. Por defecto 7.' },
      },
    },
  },
  {
    name: 'metricas',
    description:
      'Cifras agregadas de un periodo: ventas, tasa de entrega, cancelaciones, devoluciones, ' +
      'ciudades y productos que más se mueven, y recuperación de carritos. Úsala para preguntas ' +
      'de análisis: "¿cómo nos fue esta semana?", "¿cuál es la tasa de entrega?", "¿dónde vendemos más?".',
    input_schema: {
      type: 'object',
      properties: { dias: { type: 'integer', description: 'Periodo a analizar. Por defecto 30.' } },
    },
  },
  {
    name: 'estado_carritos',
    description:
      'Carritos abandonados: cuántos hay abiertos, recuperados y perdidos, cuántos mensajes se han ' +
      'mandado y cuánto dinero representan. Úsala para "¿cómo va la recuperación de carritos?".',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'estado_pqrs',
    description:
      'Peticiones, quejas, reclamos y sugerencias: cuántas hay pendientes, cuáles están vencidas o ' +
      'a punto de vencer el plazo legal de 15 días hábiles, y el detalle de las más urgentes. ' +
      'Acepta una búsqueda opcional por radicado, clienta o asunto. Úsala para "¿cuántos reclamos ' +
      'tenemos?", "¿hay PQRS vencidas?", "¿cómo va la queja de tal clienta?".',
    input_schema: {
      type: 'object',
      properties: {
        busqueda: { type: 'string', description: 'Radicado, nombre de clienta o tema (opcional).' },
      },
    },
  },
  // ── Las que SÍ modifican el CRM ──────────────────────────────────────────
  // Todas son reversibles a mano y ninguna le escribe a una clienta: eso lo
  // decide la agente. Se separan del resto para que quede claro al leerlas.
  {
    name: 'marcar_resuelta',
    description: 'Marca una conversación como atendida. Úsala solo si la agente lo pide. Si vuelve a escribir la clienta, se reabre sola.',
    input_schema: {
      type: 'object',
      properties: {
        busqueda: { type: 'string', description: 'Nombre o celular de la clienta cuya conversación hay que cerrar.' },
      },
      required: ['busqueda'],
    },
  },
  {
    name: 'etiquetar_clienta',
    description: 'Le pone una etiqueta a la ficha de una clienta, por ejemplo «prioridad», «mayorista» o «revisar-pago».',
    input_schema: {
      type: 'object',
      properties: {
        busqueda: { type: 'string', description: 'Nombre o celular de la clienta.' },
        etiqueta: { type: 'string', description: 'La etiqueta, en minúsculas y sin espacios (usa guiones).' },
      },
      required: ['busqueda', 'etiqueta'],
    },
  },
  {
    name: 'crear_pqrs',
    description: 'Radica una PQRS. Empieza a correr el plazo legal de 15 días hábiles, así que úsala solo cuando la agente lo pida.',
    input_schema: {
      type: 'object',
      properties: {
        busqueda: { type: 'string', description: 'Nombre o celular de la clienta.' },
        tipo: { type: 'string', enum: ['PETICION', 'QUEJA', 'RECLAMO', 'SUGERENCIA', 'FELICITACION'] },
        asunto: { type: 'string', description: 'Resumen en una línea.' },
        descripcion: { type: 'string', description: 'Qué pasó, en detalle.' },
        prioridad: { type: 'string', enum: ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] },
      },
      required: ['busqueda', 'tipo', 'asunto', 'descripcion'],
    },
  },
  {
    name: 'poner_borrador',
    description: 'Deja un texto escrito en el cuadro de mensaje de la agente, en la conversación que tiene abierta. No lo envía: ella lo lee, lo ajusta si quiere y lo manda. Úsala cuando redactes una respuesta para la clienta.',
    input_schema: {
      type: 'object',
      properties: {
        texto: { type: 'string', description: 'El mensaje para la clienta, listo para enviar.' },
      },
      required: ['texto'],
    },
  },
];

const NO_ENCONTRADO = 'Sin resultados en el CRM.';

/** Nombres de las herramientas que modifican el CRM, para poder auditarlas. */
export const HERRAMIENTAS_QUE_ACTUAN = new Set([
  'marcar_resuelta', 'etiquetar_clienta', 'crear_pqrs', 'poner_borrador',
]);

/** Ejecuta una herramienta. Las de `HERRAMIENTAS_QUE_ACTUAN` sí modifican datos. */
export async function ejecutarHerramienta(nombre: string, input: any): Promise<string> {
  try {
    switch (nombre) {
      case 'buscar_clienta':   return await buscarClienta(String(input?.busqueda ?? ''));
      case 'estado_pedido':    return await estadoPedido(String(input?.referencia ?? ''));
      case 'buscar_plantilla': return await buscarPlantilla(String(input?.tema ?? ''));
      case 'resumen_operacion': return await resumenOperacion();
      case 'listar_pedidos':   return await listarPedidos(input ?? {});
      case 'historial_clienta': return await historialClienta(String(input?.busqueda ?? ''));
      case 'buscar_conversaciones': return await buscarConversaciones(input ?? {});
      case 'metricas':         return await metricas(Number(input?.dias) || 30);
      case 'estado_carritos':  return await estadoCarritos();
      case 'estado_pqrs':      return await estadoPqrs(String(input?.busqueda ?? ''));
      case 'marcar_resuelta':  return await marcarResuelta(String(input?.busqueda ?? ''));
      case 'etiquetar_clienta': return await etiquetarClienta(String(input?.busqueda ?? ''), String(input?.etiqueta ?? ''));
      case 'crear_pqrs':       return await crearPqrs(input ?? {});
      // El borrador no toca la base: lo pinta el navegador. Aquí solo se
      // confirma, y la ruta se encarga de avisarle a la pantalla.
      case 'poner_borrador':   return 'Borrador puesto en el cuadro de mensaje de la agente.';
      default: return `Herramienta desconocida: ${nombre}`;
    }
  } catch (e) {
    console.error('[Femma] herramienta', nombre, e);
    return `No se pudo consultar el CRM: ${e instanceof Error ? e.message : 'error'}`;
  }
}

const dinero = (n: unknown) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
    .format(Number(n ?? 0));

const fecha = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '—');

/** Solo dígitos, para que "300 123 4567" encuentre a +573001234567. */
const soloDigitos = (s: string) => s.replace(/\D/g, '');

/**
 * Filtro de nombre por palabras sueltas, todas obligatorias.
 *
 * Buscar la frase completa fallaba con los nombres tal y como llegan de
 * Mastershop: "liliana   gordon llanos" tiene espacios dobles, así que
 * `contains 'liliana gordon'` no encontraba a nadie. Exigiendo cada palabra
 * por separado, "liliana gordon" la encuentra igual, y además funciona si la
 * agente escribe el nombre y el apellido en otro orden.
 */
function filtroNombre(q: string) {
  const palabras = q.trim().split(/\s+/).filter(p => p.length >= 2);
  if (!palabras.length) return null;
  return { AND: palabras.map(p => ({ name: { contains: p, mode: 'insensitive' as const } })) };
}

async function buscarClienta(busqueda: string): Promise<string> {
  const q = busqueda.trim();
  if (q.length < 3) return 'La búsqueda es demasiado corta.';
  const digitos = soloDigitos(q);

  const clientas = await prisma.customer.findMany({
    where: {
      OR: [
        ...(filtroNombre(q) ? [filtroNombre(q)!] : []),
        { email: { contains: q, mode: 'insensitive' } },
        ...(digitos.length >= 6 ? [{ phone: { contains: digitos } }] : []),
      ],
    },
    take: 5,
    orderBy: { lastPurchaseAt: 'desc' },
    include: { orders: { orderBy: { createdAt: 'desc' }, take: 5 } },
  });

  if (!clientas.length) return NO_ENCONTRADO;

  return clientas
    .map(c =>
      [
        `${c.name} · ${c.phone}${c.city ? ` · ${c.city}` : ''}`,
        `  estado: ${c.status} · ${c.totalOrders} pedido(s) · total comprado ${dinero(c.ltv)}`,
        `  última compra: ${fecha(c.lastPurchaseAt)}`,
        ...c.orders.map(o => `  · pedido ${o.shopifyOrderNumber ?? o.shopifyOrderId} — ${o.status} — ${dinero(o.totalAmount)} — ${fecha(o.createdAt)}`),
      ].join('\n'),
    )
    .join('\n\n');
}

async function estadoPedido(referencia: string): Promise<string> {
  const q = referencia.trim();
  if (!q) return 'Falta la referencia del pedido.';
  const digitos = soloDigitos(q);

  const pedido = await prisma.order.findFirst({
    where: {
      OR: [
        { shopifyOrderNumber: q },
        { shopifyOrderId: q },
        { trackingNumber: q },
        ...(digitos.length >= 7 ? [{ customer: { phone: { contains: digitos } } }] : []),
      ],
    },
    orderBy: { createdAt: 'desc' },
    include: { customer: true, mastershopGuides: { orderBy: { createdAt: 'desc' }, take: 1 } },
  });

  if (!pedido) return NO_ENCONTRADO;

  const dir = (pedido.shippingAddress ?? {}) as Record<string, string>;
  const guia = pedido.mastershopGuides[0];
  const items = Array.isArray(pedido.items) ? (pedido.items as any[]) : [];
  const historial = Array.isArray(pedido.statusHistory) ? (pedido.statusHistory as any[]) : [];

  return [
    `Pedido ${pedido.shopifyOrderNumber ?? pedido.shopifyOrderId}`,
    `clienta: ${pedido.customer.name} · ${pedido.customer.phone}`,
    `estado: ${pedido.status}`,
    `total: ${dinero(pedido.totalAmount)} · creado ${fecha(pedido.createdAt)}`,
    pedido.trackingNumber ? `guía: ${pedido.trackingNumber}${guia?.carrier ? ` (${guia.carrier})` : ''}` : 'guía: aún sin asignar',
    dir.address ? `dirección: ${dir.address}, ${dir.city ?? ''} ${dir.state ?? ''}`.trim() : 'dirección: no registrada',
    pedido.deliveredAt ? `entregado: ${fecha(pedido.deliveredAt)}` : '',
    items.length ? `productos: ${items.map(i => i?.name).filter(Boolean).join(', ')}` : '',
    historial.length
      ? `historial: ${historial.slice(-5).map(h => `${h.status ?? h.mastershopStatus ?? '?'} (${String(h.changedAt ?? '').slice(0, 10)})`).join(' → ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function buscarPlantilla(tema: string): Promise<string> {
  const q = tema.trim();
  if (q.length < 3) return 'El tema es demasiado corto.';

  const plantillas = await prisma.messageTemplate.findMany({
    where: {
      status: 'APPROVED',
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { content: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: 6,
    orderBy: { name: 'asc' },
  });

  if (!plantillas.length) return `${NO_ENCONTRADO} No hay plantilla aprobada que hable de "${q}".`;

  return plantillas
    .map(p => `${p.name} (${p.category}${p.variables.length ? `, ${p.variables.length} variable(s)` : ''})\n  ${p.content.replace(/\s+/g, ' ').slice(0, 220)}`)
    .join('\n\n');
}

async function resumenOperacion(): Promise<string> {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);

  const [porEstado, hoyCount, carritos, sinLeer, ultimoSync] = await Promise.all([
    prisma.order.groupBy({ by: ['status'], _count: true }),
    prisma.order.count({ where: { createdAt: { gte: hoy } } }),
    prisma.abandonedCart.count({ where: { status: 'OPEN' } }),
    prisma.conversation.count({ where: { isRead: false, status: { not: 'RESOLVED' } } }),
    prisma.integrationConfig.findFirst({ where: { platform: 'MASTERSHOP' }, select: { lastSyncAt: true } }),
  ]);

  return [
    `Pedidos hoy: ${hoyCount}`,
    `Por estado: ${porEstado.map(e => `${e.status} ${e._count}`).join(' · ')}`,
    `Carritos abandonados abiertos: ${carritos}`,
    `Conversaciones sin leer: ${sinLeer}`,
    `Última sincronización con Mastershop: ${ultimoSync?.lastSyncAt?.toISOString().slice(0, 16).replace('T', ' ') ?? 'nunca'}`,
  ].join('\n');
}

const desdeHace = (dias: number) => new Date(Date.now() - dias * 86_400_000);

async function listarPedidos(f: any): Promise<string> {
  const dias = Math.min(Math.max(Number(f.dias) || 7, 1), 365);
  const limite = Math.min(Math.max(Number(f.limite) || 15, 1), 50);

  const where: any = { createdAt: { gte: desdeHace(dias) } };
  if (f.estado) where.status = f.estado;
  if (f.ciudad) where.customer = { city: { contains: String(f.ciudad), mode: 'insensitive' } };
  if (f.transportadora) {
    where.mastershopGuides = { some: { carrier: { contains: String(f.transportadora), mode: 'insensitive' } } };
  }

  const [total, pedidos] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where, take: limite, orderBy: { createdAt: 'desc' },
      include: { customer: { select: { name: true, phone: true, city: true } } },
    }),
  ]);

  if (!total) return `${NO_ENCONTRADO} No hay pedidos con esos filtros en los últimos ${dias} días.`;

  return [
    `${total} pedido(s) en los últimos ${dias} días. Se muestran ${pedidos.length}:`,
    ...pedidos.map(o =>
      `· ${o.shopifyOrderNumber ?? o.shopifyOrderId} — ${o.status} — ${o.customer.name} (${o.customer.city ?? 'sin ciudad'}) — ${dinero(o.totalAmount)} — ${fecha(o.createdAt)}`),
  ].join('\n');
}

async function historialClienta(busqueda: string): Promise<string> {
  const q = busqueda.trim();
  if (q.length < 3) return 'La búsqueda es demasiado corta.';
  const digitos = soloDigitos(q);

  const c = await prisma.customer.findFirst({
    where: {
      OR: [
        ...(filtroNombre(q) ? [filtroNombre(q)!] : []),
        ...(digitos.length >= 6 ? [{ phone: { contains: digitos } }] : []),
      ],
    },
    orderBy: { lastPurchaseAt: 'desc' },
    include: {
      orders: { orderBy: { createdAt: 'desc' }, take: 30 },
      conversations: {
        orderBy: { lastMessageAt: 'desc' }, take: 3,
        include: { messages: { orderBy: { createdAt: 'desc' }, take: 4 } },
      },
    },
  });

  if (!c) return NO_ENCONTRADO;

  const porEstado = c.orders.reduce<Record<string, number>>((acc, o) => {
    acc[o.status] = (acc[o.status] ?? 0) + 1; return acc;
  }, {});

  return [
    `${c.name} · ${c.phone}${c.city ? ` · ${c.city}` : ''}${c.email ? ` · ${c.email}` : ''}`,
    `Clasificación: ${c.status} · ${c.totalOrders} compra(s) · total ${dinero(c.ltv)}`,
    `Primera compra: ${fecha(c.firstPurchaseAt)} · última: ${fecha(c.lastPurchaseAt)}`,
    `Pedidos por estado: ${Object.entries(porEstado).map(([e, n]) => `${e} ${n}`).join(' · ') || '—'}`,
    '',
    'Pedidos:',
    ...c.orders.slice(0, 12).map(o =>
      `· ${o.shopifyOrderNumber ?? o.shopifyOrderId} — ${o.status} — ${dinero(o.totalAmount)} — ${fecha(o.createdAt)}${o.trackingNumber ? ` — guía ${o.trackingNumber}` : ''}`),
    c.orders.length > 12 ? `  (y ${c.orders.length - 12} más)` : '',
    '',
    c.conversations.length ? 'Conversaciones recientes:' : 'No ha escrito nunca por WhatsApp.',
    ...c.conversations.flatMap(cv => [
      `· ${cv.channel} — ${cv.status} — último mensaje ${fecha(cv.lastMessageAt)}`,
      ...cv.messages.reverse().map(m => `    ${m.direction === 'INBOUND' ? 'Ella' : 'Nosotras'}: ${m.content.slice(0, 120)}`),
    ]),
  ].filter(Boolean).join('\n');
}

async function buscarConversaciones(f: any): Promise<string> {
  const dias = Math.min(Math.max(Number(f.dias) || 7, 1), 365);
  const texto = String(f.texto ?? '').trim();
  const desde = desdeHace(dias);

  if (texto) {
    const mensajes = await prisma.message.findMany({
      where: { content: { contains: texto, mode: 'insensitive' }, createdAt: { gte: desde }, direction: 'INBOUND' },
      take: 20, orderBy: { createdAt: 'desc' },
      include: { conversation: { include: { customer: { select: { name: true, phone: true } } } } },
    });
    if (!mensajes.length) return `${NO_ENCONTRADO} Nadie escribió "${texto}" en los últimos ${dias} días.`;

    return [
      `${mensajes.length} mensaje(s) con "${texto}" en los últimos ${dias} días:`,
      ...mensajes.map(m =>
        `· ${m.conversation.customer.name} (${m.conversation.customer.phone}) — ${fecha(m.createdAt)} — estado ${m.conversation.status}\n    "${m.content.slice(0, 160)}"`),
    ].join('\n');
  }

  // Sin texto: las que esperan respuesta nuestra.
  const pendientes = await prisma.conversation.findMany({
    where: { status: { not: 'RESOLVED' }, isRead: false, lastMessageAt: { gte: desde } },
    take: 20, orderBy: { lastMessageAt: 'asc' },
    include: {
      customer: { select: { name: true, phone: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  if (!pendientes.length) return 'No hay conversaciones esperando respuesta. Todo al día.';

  return [
    `${pendientes.length} conversación(es) esperando respuesta, de la más antigua a la más reciente:`,
    ...pendientes.map(c => {
      const horas = c.lastMessageAt ? Math.round((Date.now() - c.lastMessageAt.getTime()) / 3_600_000) : 0;
      return `· ${c.customer.name} (${c.customer.phone}) — esperando ${horas} h\n    "${(c.messages[0]?.content ?? '').slice(0, 140)}"`;
    }),
  ].join('\n');
}

async function metricas(dias: number): Promise<string> {
  const d = Math.min(Math.max(dias, 1), 365);
  const desde = desdeHace(d);
  const enRango = { gte: desde };

  const [porEstado, totales, ciudades, nuevas, recurrentes, carritos] = await Promise.all([
    prisma.order.groupBy({ by: ['status'], where: { createdAt: enRango }, _count: true, _sum: { totalAmount: true } }),
    prisma.order.aggregate({ where: { createdAt: enRango }, _count: true, _sum: { totalAmount: true }, _avg: { totalAmount: true } }),
    prisma.customer.groupBy({
      by: ['city'], where: { orders: { some: { createdAt: enRango } } },
      _count: true, orderBy: { _count: { city: 'desc' } }, take: 8,
    }),
    prisma.customer.count({ where: { firstPurchaseAt: enRango } }),
    prisma.customer.count({ where: { status: 'RECURRING' } }),
    prisma.abandonedCart.groupBy({ by: ['status'], where: { createdAt: enRango }, _count: true }),
  ]);

  const n = (estado: string) => porEstado.find(e => e.status === estado)?._count ?? 0;
  const cerrados = n('DELIVERED') + n('RETURNED') + n('CANCELLED') + n('FAILED_DELIVERY');
  const tasa = cerrados ? Math.round((n('DELIVERED') / cerrados) * 100) : 0;

  return [
    `Últimos ${d} días`,
    `Pedidos: ${totales._count} · facturado ${dinero(totales._sum.totalAmount)} · ticket medio ${dinero(totales._avg.totalAmount)}`,
    `Por estado: ${porEstado.map(e => `${e.status} ${e._count}`).join(' · ')}`,
    `Tasa de entrega (sobre pedidos ya cerrados): ${tasa}% — ${n('DELIVERED')} entregados de ${cerrados}`,
    `Cancelados ${n('CANCELLED')} · devueltos ${n('RETURNED')} · entregas fallidas ${n('FAILED_DELIVERY')}`,
    `Clientas nuevas en el periodo: ${nuevas} · recurrentes en total: ${recurrentes}`,
    `Ciudades con más compras: ${ciudades.map(c => `${c.city ?? 'sin ciudad'} ${c._count}`).join(' · ')}`,
    `Carritos del periodo: ${carritos.map(c => `${c.status} ${c._count}`).join(' · ') || 'ninguno'}`,
  ].join('\n');
}

async function estadoCarritos(): Promise<string> {
  const [porEstado, conMensajes, valor] = await Promise.all([
    prisma.abandonedCart.groupBy({ by: ['status'], _count: true, _sum: { totalAmount: true } }),
    prisma.abandonedCart.groupBy({ by: ['reminderCount'], _count: true, orderBy: { reminderCount: 'asc' } }),
    prisma.abandonedCart.aggregate({ where: { status: 'OPEN' }, _sum: { totalAmount: true } }),
  ]);

  const total = porEstado.reduce((s, e) => s + e._count, 0);
  const recuperados = porEstado.find(e => e.status === 'RECOVERED')?._count ?? 0;

  return [
    `Carritos abandonados: ${total} en total`,
    ...porEstado.map(e => `· ${e.status}: ${e._count} — ${dinero(e._sum.totalAmount)}`),
    `Recuperación: ${total ? Math.round((recuperados / total) * 100) : 0}%`,
    `Dinero en juego (abiertos): ${dinero(valor._sum.totalAmount)}`,
    `Mensajes enviados: ${conMensajes.map(m => `${m.reminderCount} mensaje(s) → ${m._count} carrito(s)`).join(' · ')}`,
  ].join('\n');
}

async function estadoPqrs(busqueda: string): Promise<string> {
  const { ESTADOS_VIVOS, semaforoDe, radicadoBonito } = await import('@/lib/pqrs');

  const where: any = {};
  if (busqueda.trim()) {
    const num = Number(busqueda.replace(/\D/g, ''));
    where.OR = [
      { subject: { contains: busqueda, mode: 'insensitive' } },
      { customer: { name: { contains: busqueda, mode: 'insensitive' } } },
      ...(num ? [{ radicado: num }] : []),
    ];
  } else {
    where.status = { in: ESTADOS_VIVOS };
  }

  const [lista, vivas, vencidas] = await Promise.all([
    prisma.pqrs.findMany({
      where,
      include: { customer: { select: { name: true } }, agent: { select: { name: true } } },
      orderBy: { dueAt: 'asc' },
      take: 15,
    }),
    prisma.pqrs.count({ where: { status: { in: ESTADOS_VIVOS } } }),
    prisma.pqrs.count({ where: { status: { in: ESTADOS_VIVOS }, dueAt: { lt: new Date() } } }),
  ]);
  if (!lista.length) return NO_ENCONTRADO;

  const linea = (p: (typeof lista)[number]) => {
    const { semaforo, diasRestantes } = semaforoDe(p.status as any, p.dueAt);
    const plazo =
      semaforo === 'resuelta' ? p.status :
      semaforo === 'vencida' ? `VENCIDA hace ${Math.abs(diasRestantes)} días hábiles` :
      `vence en ${diasRestantes} días hábiles`;
    return `· ${radicadoBonito(p.radicado, p.createdAt)} [${p.type}/${p.priority}] ${p.subject} — ` +
      `${p.customer.name} — ${p.status} — ${plazo}` +
      (p.agent ? ` — atiende ${p.agent.name}` : '') +
      (p.resolution ? ` — resolución: ${p.resolution}` : '');
  };

  return [
    `PQRS pendientes: ${vivas} (${vencidas} con el plazo legal VENCIDO)`,
    `El plazo legal es de 15 días hábiles; vencerse implica silencio administrativo positivo.`,
    ...lista.map(linea),
  ].join('\n');
}

// ── Armado de la petición ───────────────────────────────────────────────────

export interface TurnoChat {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * El bloque de sistema va con `cache_control`: la persona y el catálogo de
 * herramientas no cambian entre mensajes, así que a partir de la segunda
 * consulta se leen de caché a una décima parte del precio.
 */
export function construirSystem(contexto?: string): Anthropic.TextBlockParam[] {
  const bloques: Anthropic.TextBlockParam[] = [
    { type: 'text', text: PERSONA, cache_control: { type: 'ephemeral' } },
  ];
  // El contexto de la conversación abierta va DESPUÉS del punto de caché:
  // cambia en cada consulta y si fuera antes invalidaría todo lo cacheado.
  if (contexto?.trim()) {
    bloques.push({ type: 'text', text: `\nContexto de la pantalla donde está la agente ahora mismo:\n${contexto.trim()}` });
  }
  return bloques;
}

export const PARAMETROS = {
  model: MODEL,
  max_tokens: 4096,
  output_config: { effort: EFFORT },
} as const;

// ── Herramientas que modifican el CRM ───────────────────────────────────────
//
// Todas empiezan resolviendo a UNA clienta. Si la búsqueda devuelve varias no
// se elige por su cuenta: se le devuelve la lista a Femma para que pregunte.
// Actuar sobre la persona equivocada es peor que dar un rodeo.

async function unaClienta(busqueda: string) {
  const q = busqueda.trim();
  if (q.length < 3) return { error: 'La búsqueda es demasiado corta.' };
  const digitos = soloDigitos(q);
  const cs = await prisma.customer.findMany({
    where: {
      OR: [
        ...(filtroNombre(q) ? [filtroNombre(q)!] : []),
        { email: { contains: q, mode: 'insensitive' } },
        ...(digitos.length >= 6 ? [{ phone: { contains: digitos } }] : []),
      ],
    },
    take: 6,
    select: { id: true, name: true, phone: true, tags: true },
  });
  if (!cs.length) return { error: NO_ENCONTRADO };
  if (cs.length > 1) {
    return {
      error: 'Hay varias clientas que coinciden; pregúntale a la agente cuál es:\n'
        + cs.map(c => `  · ${c.name} — ${c.phone}`).join('\n'),
    };
  }
  return { clienta: cs[0] };
}

async function marcarResuelta(busqueda: string): Promise<string> {
  const { clienta, error } = await unaClienta(busqueda);
  if (error) return error;
  const abiertas = await prisma.conversation.findMany({
    where: { customerId: clienta!.id, status: { not: 'RESOLVED' } },
    select: { id: true },
  });
  if (!abiertas.length) return `${clienta!.name} no tiene conversaciones abiertas.`;
  await prisma.conversation.updateMany({
    where: { id: { in: abiertas.map(c => c.id) } },
    data: { status: 'RESOLVED' },
  });
  return `Listo: ${abiertas.length} conversación(es) de ${clienta!.name} quedaron marcadas como atendidas. Si vuelve a escribir, se reabren solas.`;
}

async function etiquetarClienta(busqueda: string, etiqueta: string): Promise<string> {
  const tag = etiqueta.trim().toLowerCase().replace(/\s+/g, '-');
  if (!tag) return 'Falta la etiqueta.';
  const { clienta, error } = await unaClienta(busqueda);
  if (error) return error;
  if (clienta!.tags.includes(tag)) return `${clienta!.name} ya tenía la etiqueta «${tag}».`;
  await prisma.customer.update({
    where: { id: clienta!.id },
    data: { tags: { push: tag } },
  });
  return `Etiqueta «${tag}» puesta a ${clienta!.name}.`;
}

async function crearPqrs(input: any): Promise<string> {
  const tipo = String(input?.tipo ?? '') as TipoPqrs;
  const asunto = String(input?.asunto ?? '').trim();
  const descripcion = String(input?.descripcion ?? '').trim();
  if (!TIPOS_PQRS[tipo]) return 'Tipo de PQRS inválido.';
  if (!asunto || !descripcion) return 'Falta el asunto o la descripción.';

  const { clienta, error } = await unaClienta(String(input?.busqueda ?? ''));
  if (error) return error;

  const regla = TIPOS_PQRS[tipo];
  const prioridad = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'].includes(input?.prioridad)
    ? input.prioridad : regla.prioridad;
  const ahora = new Date();

  const pqrs = await prisma.pqrs.create({
    data: {
      type: tipo, priority: prioridad, subject: asunto, description: descripcion,
      customerId: clienta!.id,
      createdByName: 'Femma',
      dueAt: vencimientoHabil(ahora, regla.diasHabiles),
      history: [{
        por: 'Femma', tipo: 'creacion', at: ahora.toISOString(),
        texto: `Radicada por Femma a petición de una agente — plazo legal de ${regla.diasHabiles} días hábiles.`,
      }] as unknown as object,
    },
    select: { radicado: true, createdAt: true, dueAt: true },
  });

  return `PQRS ${radicadoBonito(pqrs.radicado, pqrs.createdAt)} radicada para ${clienta!.name}. `
    + `Vence el ${fecha(pqrs.dueAt)} (${regla.diasHabiles} días hábiles).`;
}
