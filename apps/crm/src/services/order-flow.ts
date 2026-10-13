import { prisma } from '@/lib/prisma';
import { sePuedeEscribirPorWhatsApp } from '@/services/mastershop';
import { confirmarEnMastershop } from '@/services/mastershop-confirmar';
import { sendWhatsAppTemplate, sendWhatsAppMessage } from '@/services/whatsapp';
import {
  LINEA_POSTCOMPRA, registrarSalienteEnLinea, registrarPlantillaPostcompra,
} from '@/services/linea-postcompra';

/**
 * Motor del flujo de pedido: desde que la clienta compra hasta que le entregan.
 *
 * Mastershop manda el paso real en `eventName`, no en `id_status` (el 6 es un
 * paraguas que cubre tránsito, reparto, oficina y novedad). Además cada cambio
 * emite un segundo webhook genérico "Cambio de Estado del Pedido" que hay que
 * ignorar o todo saldría duplicado.
 *
 * Todo esto sale por la línea de POSTCOMPRA, no por la de atención general:
 * son dos números en la misma WABA, y las plantillas de este archivo son
 * justamente las que solo tienen sentido después de una compra.
 */
export type FlowStep =
  | 'POR_CONFIRMAR'
  | 'POR_ALISTAR'
  | 'EN_TRANSITO'
  | 'EN_REPARTO'
  | 'EN_OFICINA'
  | 'ENTREGADO'
  | 'NOVEDAD'
  | 'DEVOLUCION';

/** Paso del flujo a partir del evento de Mastershop. `null` = no dispara nada. */
export function stepFromEvent(eventName?: string, idStatus?: number): FlowStep | null {
  switch (eventName?.trim()) {
    case 'Pedido Creado':       return 'POR_CONFIRMAR';
    case 'Pedido Por Alistar':  return 'POR_ALISTAR';
    case 'Pedido En Tránsito':  return 'EN_TRANSITO';
    case 'Pedido En Reparto':   return 'EN_REPARTO';
    case 'Pedido En Oficina':   return 'EN_OFICINA';
    case 'Pedido Entregado':    return 'ENTREGADO';
    case 'Pedido con Novedad':  return 'NOVEDAD';
  }

  // «Pedido Por Alistar» NO EXISTE. Se creyó que sí por simetría con los demás
  // pasos, y por eso el mensaje de la guía —el que le dice a la clienta su
  // número de rastreo y la transportadora— nunca salió ni una vez, mientras
  // tránsito, reparto y entrega sí salían. Sobre 12 h de webhooks reales
  // Mastershop manda: Pedido Creado, En Tránsito, En Reparto, En Oficina,
  // Entregado, con Novedad, y dos genéricos. Ese paso no está.
  //
  // El estado «Por Alistar» (3) y «Por Recolectar» (4) llegan solo por el
  // evento genérico, y es justo ahí donde el pedido ya trae
  // `carrier_tracking_code`: comprobado, el 2 aún no tiene guía y el 3 ya sí.
  // Se dispara con cualquiera de los dos; el anti-duplicados de `runStep` evita
  // que el segundo mande el mensaje otra vez.
  if (idStatus === 3 || idStatus === 4) return 'POR_ALISTAR';

  // Devolución y cancelación solo llegan con el eventName genérico
  if (idStatus === 10) return 'DEVOLUCION';
  return null;
}

/**
 * Paso del flujo a partir de un CAMBIO REAL de estado, cuando Mastershop no
 * mandó el evento con nombre.
 *
 * El 12 de agosto de 2026 Mastershop dejó de emitir tres webhooks —«Pedido En
 * Tránsito», «Pedido Entregado» y «Cambio de Estado de la Transportadora»—
 * mientras seguía mandando los demás. Comprobado sobre 65.254 webhooks
 * guardados: los tres tienen su último registro ese día (18:37, 21:07 y 21:20)
 * y ni uno más desde entonces, mientras «Pedido Creado», «En Reparto» y «En
 * Oficina» siguen llegando cada pocos minutos.
 *
 * Como el paso se deducía SOLO del nombre del evento, los pasos 3 y 6 dejaron
 * de enviarse esa misma tarde. El pedido sí cambiaba de estado en el CRM
 * —porque eso se saca de `id_status`, que sigue llegando en el evento
 * genérico—, pero la clienta se quedaba sin el «va en camino» y sin el
 * «ya te llegó». Y de rebote se secó el acompañamiento postcompra, que nace
 * cuando se marca la entrega.
 *
 * Por eso el paso también se deduce de `id_status`, igual que ya se hacía con
 * «Por Alistar» (3 y 4) y con la devolución (10).
 *
 * PERO SOLO EN UNA TRANSICIÓN DE VERDAD, y esto es lo importante: el evento
 * genérico se repite muchas veces por pedido (6.408 en dos días), así que
 * deducir el paso de él sin más habría disparado «tu pedido va en camino» para
 * los ~1.000 pedidos que llevaban en tránsito desde hacía días. Quien llama
 * compara el estado anterior con el nuevo y solo entonces usa esta función.
 * Es la misma cautela que ya guarda el rescate de guías al no resucitar
 * pedidos de la semana pasada.
 */
export function stepFromStatusChange(idStatus?: number): FlowStep | null {
  switch (idStatus) {
    // 5 = Recolectada, 6 = En Tránsito. El 6 es un paraguas que cubre también
    // reparto, oficina y novedad, pero esos tres siguen llegando con su propio
    // nombre y tienen su propio paso; el anti-duplicados de `runStep` impide
    // que un pedido reciba dos veces el mismo mensaje.
    case 5:
    case 6: return 'EN_TRANSITO';
    case 8: return 'ENTREGADO';
    default: return null;
  }
}

/**
 * Estado del pedido en el CRM. Ojo: el mapeo anterior estaba invertido
 * (6→RETURNED, 8→IN_TRANSIT, 9→IN_TRANSIT, 10→FAILED_DELIVERY). Verificado
 * contra 1.894 webhooks y 300 pedidos de la API: 1,2=Por Confirmar ·
 * 3=Por Alistar · 4=Por Recolectar · 5=Recolectada · 6=En Tránsito ·
 * 8=Entregada · 9=Cancelada · 10=Devuelta.
 *
 * El 5 faltaba, y no era inocuo: 913 webhooks se descartaron con «id_status
 * desconocido» en dos días. Se identificó consultando a la API el estado actual
 * de cinco pedidos cuyo último evento fue un 5 — los cinco, «Recolectada».
 */
export function idStatusToCrm(idStatus?: number, eventName?: string): string | undefined {
  if (eventName?.trim() === 'Pedido En Oficina')  return 'IN_DESTINATION';
  if (eventName?.trim() === 'Pedido con Novedad') return 'FAILED_DELIVERY';

  switch (idStatus) {
    case 1:
    case 2:  return 'PENDING_CONFIRMATION';
    case 3:
    case 4:  return 'PREPARING';
    // Recolectada: la transportadora ya lo tiene. El texto equivalente de la
    // API mapea a IN_TRANSIT, así que aquí igual.
    case 5:
    case 6:  return 'IN_TRANSIT';
    case 8:  return 'DELIVERED';
    case 9:  return 'CANCELLED';
    case 10: return 'RETURNED';
    default: return undefined;
  }
}

export const STEP_TRIGGER: Record<FlowStep, string> = {
  POR_CONFIRMAR: 'ORDER_CREATED',
  POR_ALISTAR:   'ORDER_DISPATCHED',
  EN_TRANSITO:   'ORDER_IN_TRANSIT',
  EN_REPARTO:    'ORDER_OUT_FOR_DELIVERY',
  EN_OFICINA:    'ORDER_AT_OFFICE',
  ENTREGADO:     'ORDER_DELIVERED',
  NOVEDAD:       'ORDER_NOVELTY',
  DEVOLUCION:    'ORDER_RETURNED',
};

export const STEP_LABEL: Record<FlowStep, string> = {
  POR_CONFIRMAR: 'Paso 1 · Por confirmar',
  POR_ALISTAR:   'Paso 2 · Por alistar',
  EN_TRANSITO:   'Paso 3 · En tránsito',
  EN_REPARTO:    'Paso 4 · En reparto',
  EN_OFICINA:    'Paso 5 · Entrega en oficina',
  ENTREGADO:     'Paso 6 · Entregado',
  NOVEDAD:       'Paso 7 · Novedad',
  DEVOLUCION:    'Paso 8 · Devolución',
};

/** Minutos de espera antes del recordatorio de confirmación y de escalar a humano. */
export const REMINDER_DELAY_MIN   = 90;
export const ESCALATION_DELAY_MIN = 120;

/**
 * Reintentos de un paso del flujo que falló al enviarse.
 *
 * La espera crece con cada intento (20, 40, 60 min…), que cubre tanto un
 * fallo pasajero de red como el caso real de una plantilla recién creada que
 * Meta todavía está revisando y que puede tardar un rato en aprobarse.
 */
const MAX_INTENTOS_PASO   = 4;
const ESPERA_REINTENTO_MIN = 20;

/**
 * Espera mientras Meta revisa una plantilla recién creada.
 *
 * Es distinto de un reintento: aquí no se ha intentado enviar nada, así que no
 * consume intentos. Meta suele tardar minutos, pero puede tardar horas; con
 * 30 min × 96 se aguanta hasta dos días antes de darse por vencido.
 */
const ESPERA_APROBACION_MIN  = 30;
const MAX_ESPERAS_APROBACION = 96;

/**
 * Cuándo se da por muerto un paso que quedó en «running».
 *
 * Un paso tarda segundos: crea la fila, habla con Meta y la cierra como
 * `sent` o `failed`. Pero si la función muere entremedias —se acaba el tiempo
 * de Vercel, se cae el proceso— la fila se queda en `running` para siempre. Y
 * como el anti-duplicados de abajo cuenta `running` como «ya atendido», ese
 * paso NO se volvía a intentar nunca: ni por un evento repetido de Mastershop,
 * ni por el rescate de guías del cron.
 *
 * Encontrado en producción: 4 pedidos colgados así, uno de ellos con la guía
 * ya generada y la clienta esperándola después de que el CRM le prometiera
 * «te avisamos apenas tengamos la guía».
 *
 * 10 minutos es de sobra: ninguna pasada legítima dura tanto —el cron entero
 * se corta a los 60 s— y deja margen para no pisar una que sí esté viva.
 */
const RUNNING_MUERTO_MIN = 10;

/** Hasta cuántos días atrás mira el rescate de guías. Ver el comentario allí. */
const DIAS_RESCATE_GUIA = 3;

interface OrderContext {
  firstName: string;
  /**
   * El nombre tal como lo dio la clienta, completo.
   *
   * Para saludar sirve el primero —«Hola María»—, pero la plantilla de
   * confirmación no saluda: le enseña sus datos para que los revise. Ahí
   * enseñarle «Nombre: María» cuando ella escribió «María Pérez Gómez» la deja
   * sin saber si el pedido va a su nombre completo, y se quejaban con razón.
   */
  fullName: string;
  phone: string;
  product: string;
  address: string;
  city: string;
  department: string;
  guide: string;
  carrier: string;
}

function buildContext(order: any): OrderContext {
  const items = Array.isArray(order.items) ? order.items : [];
  const addr  = (order.shippingAddress ?? {}) as Record<string, string>;
  // La transportadora vive en la guía de Mastershop, no en el pedido.
  const guide = order.mastershopGuides?.[0];

  return {
    firstName:  (order.customer?.name ?? '').trim().split(/\s+/)[0] || 'Hola',
    // Sin recortar nada: si el nombre guardado está mal, que lo vea y lo
    // corrija — para eso se le pregunta.
    fullName:   (order.customer?.name ?? '').trim().replace(/\s+/g, ' ') || 'Hola',
    phone:      order.customer?.phone || '',
    product:    items[0]?.name?.trim() || items[0]?.name_product?.trim() || 'tu pedido Fem',
    address:    addr.address || addr.address1 || 'la dirección registrada',
    city:       addr.city || order.customer?.city || 'tu ciudad',
    department: addr.department || order.customer?.department || 'tu departamento',
    guide:      order.trackingNumber || guide?.guideNumber || 'la guía asignada',
    carrier:    guide?.carrier || 'la transportadora',
  };
}

const ORDER_WITH_CONTEXT = {
  customer: true,
  mastershopGuides: { orderBy: { createdAt: 'desc' as const }, take: 1 },
} as const;

export type Producto = 'PROBIOTICOS' | 'FEM_MOM';

/**
 * FEM MOM tiene un flujo de postcompra distinto al del resto del catálogo
 * (probióticos, óvulos, jabón…) — la clienta está en lactancia, no en el
 * mismo proceso de bienestar íntimo. En Mastershop el producto aparece como
 * "FEM MOM" o "FEM MOM 2UND"; todo lo demás sigue el flujo por defecto.
 */
export function productoDelPedido(order: any): Producto {
  const items = Array.isArray(order.items) ? order.items : [];
  const esMom = items.some((it: any) =>
    `${it.name ?? ''} ${it.name_product ?? ''}`.toLowerCase().includes('fem mom'));
  return esMom ? 'FEM_MOM' : 'PROBIOTICOS';
}

/** Plantillas que manda cada paso, en orden — el nombre cambia según el producto. */
function templatesForStep(
  step: FlowStep, producto: Producto, c: OrderContext,
): { name: string; params: string[] }[] {
  const pre = producto === 'FEM_MOM' ? 'fmom' : 'fem';
  switch (step) {
    case 'POR_CONFIRMAR':
      // La versión de probióticos se quedó semanas en revisión de Meta y hubo
      // que rehacerla: la v2 salió aprobada y lleva ciudad en vez de teléfono,
      // así que los parámetros no son los mismos que los de FEM MOM.
      /**
       * Nombre COMPLETO y departamento: esta plantilla no saluda, muestra los
       * datos del envío para que la clienta los revise antes de despachar.
       *
       * La v3 es la v2 con una línea más —el departamento—. Hubo que rehacerla
       * porque una plantilla aprobada no admite variables nuevas, y sin el
       * departamento la clienta no podía verificar el destino: hay ciudades con
       * el mismo nombre en dos departamentos y ahí se pierden los envíos.
       */
      return producto === 'FEM_MOM'
        ? [{ name: 'fmom_confirmacion',   params: [c.fullName, c.address, c.city, c.department] }]
        : [{ name: 'fem_confirmacion_v3', params: [c.fullName, c.address, c.city, c.department] }];
    case 'POR_ALISTAR':
      return [{ name: `${pre}_preparacion_envio`, params: [c.carrier, c.guide] }];
    case 'EN_TRANSITO':
      return [{ name: `${pre}_en_transito`, params: [] }];
    case 'EN_REPARTO':
      return [{ name: `${pre}_en_reparto`, params: [] }];
    case 'EN_OFICINA':
      // La versión FEM MOM de esta plantilla salió rechazada como UTILITY
      // ("categoría incorrecta") y quedó reemplazada por la v2 en MARKETING.
      return [{ name: producto === 'FEM_MOM' ? 'fmom_en_oficina_v2' : `${pre}_en_oficina`, params: [c.carrier, c.guide] }];
    case 'ENTREGADO':
      // Antes mandaba un segundo mensaje aparte con la guía de uso; ahora el
      // enlace va como botón dentro de la misma plantilla.
      return [{ name: `${pre}_entregado`, params: [] }];
    case 'NOVEDAD':
      /**
       * Una sola plantilla para las dos marcas, y sin variables.
       *
       * `pedido_novedad`, que es lo que había aquí, nunca existió en Meta: era
       * un nombre puesto a la espera del copy. De las dos aprobadas que sí hay,
       * se usa la genérica y no `novedad_xfxgg4` por dos motivos: esa da por
       * hecho que la transportadora «no encontró la dirección», y una novedad
       * también es que no había nadie, que la clienta rechazó el paquete o que
       * la zona es de difícil acceso —decirle que su dirección está mal cuando
       * no lo está es peor que no escribirle—; y además se presenta como «Fem
       * Probiotics», que no es la marca de una clienta de FEM MOM.
       */
      return [{ name: 'presentanovedad_3wl43q', params: [] }];
    case 'DEVOLUCION':
      return [{ name: 'pedido_devolucion', params: [c.firstName] }];
  }
}

/**
 * Ejecuta un paso para un pedido: valida que el flujo esté activo, que no se
 * haya mandado ya, envía las plantillas y deja registro en FlowExecution.
 */
export async function runStep(
  orderId: string, step: FlowStep, intento = 1, esperaPrevia = 0,
): Promise<void> {
  const flow = await prisma.flowTemplate.findFirst({
    where: { trigger: STEP_TRIGGER[step] as any },
  });
  if (!flow) { console.warn(`[Flujo] Sin FlowTemplate para ${step} — no se envía`); return; }
  if (!flow.isActive) return;

  // Anti-duplicados: Mastershop reenvía eventos y el sync horario puede repetir.
  // Cuenta también lo que está esperando reintento, o un evento repetido
  // adelantaría el envío saltándose la espera.
  //
  // `running` solo bloquea mientras de verdad esté corriendo: pasados
  // RUNNING_MUERTO_MIN se da por muerta la pasada que lo dejó así y el paso
  // puede volver a intentarse. Sin ese matiz, un proceso que se cayera a mitad
  // dejaba a la clienta sin ese mensaje para siempre.
  const vivoDesde = new Date(Date.now() - RUNNING_MUERTO_MIN * 60_000);
  const already = await prisma.flowExecution.findFirst({
    where: {
      orderId, flowTemplateId: flow.id,
      OR: [
        { status: { in: ['sent', 'scheduled'] } },
        { status: 'running', createdAt: { gt: vivoDesde } },
      ],
    },
  });
  if (already) return;

  // El cadáver se marca como fallido antes de reintentar: si se dejara en
  // `running` seguiría acumulándose en silencio y nadie sabría que hubo que
  // rescatar este paso.
  await prisma.flowExecution.updateMany({
    where: {
      orderId, flowTemplateId: flow.id,
      status: 'running', createdAt: { lte: vivoDesde },
    },
    data: { status: 'failed', completedAt: new Date() },
  });

  const order = await prisma.order.findUnique({ where: { id: orderId }, include: ORDER_WITH_CONTEXT });
  if (!order?.customer?.phone) return;
  // Hay ~206 clientas con el celular mal digitado en el origen (9 u 11 dígitos).
  // Intentarlo solo gasta cuota y baja la calificación del número emisor.
  if (!sePuedeEscribirPorWhatsApp(order.customer.phone)) {
    console.warn(`[Flujo] ${step} omitido: destino inválido ${order.customer.phone}`);
    return;
  }

  // Un reintento tardío no puede pedirle a la clienta que confirme sus datos
  // si el pedido ya salió de bodega o se canceló: el mensaje llegaría fuera de
  // contexto. Se cierra el intento en vez de reprogramarlo.
  if (step === 'POR_CONFIRMAR' && order.status !== 'PENDING_CONFIRMATION') {
    console.warn(`[Flujo] POR_CONFIRMAR omitido: el pedido ${orderId} ya está en ${order.status}`);
    return;
  }

  // Los pasos que citan el número de guía no salen hasta que Mastershop la
  // genere: mejor no mandar nada que mandar "la guía asignada". Sin marcar
  // ejecución, así el siguiente evento del pedido vuelve a intentarlo.
  const guide = order.trackingNumber || order.mastershopGuides?.[0]?.guideNumber;
  if (!guide && (['POR_ALISTAR', 'EN_TRANSITO', 'EN_OFICINA'] as FlowStep[]).includes(step)) {
    console.warn(`[Flujo] ${step} aplazado para el pedido ${orderId}: aún sin guía`);
    return;
  }

  // Si Meta todavía no aprueba la plantilla, ni se intenta: el envío fallaría
  // seguro con «Template name does not exist», gastaría uno de los pocos
  // reintentos y, al agotarlos, el pedido se quedaría sin su mensaje. Pasó de
  // verdad: 143 confirmaciones fallidas seguidas mientras `fem_confirmacion`
  // estaba en revisión. Esperar no cuesta nada —no hay llamada a la API— así
  // que se aguarda con paciencia y sin consumir intentos.
  const ctxPrevio = buildContext(order);
  const productoPrevio = productoDelPedido(order);
  const nombres = templatesForStep(step, productoPrevio, ctxPrevio).map(t => t.name);
  const listas = await prisma.messageTemplate.findMany({
    where: { name: { in: nombres }, status: 'APPROVED' },
    select: { name: true },
  });
  const faltan = nombres.filter(n => !listas.some(l => l.name === n));
  if (faltan.length) {
    const espera = Number(esperaPrevia) + 1;
    if (espera <= MAX_ESPERAS_APROBACION) {
      console.warn(`[Flujo] ${step} en espera: plantilla sin aprobar (${faltan.join(', ')})`);
      await prisma.flowExecution.create({
        data: {
          flowTemplateId: flow.id,
          customerId: order.customerId,
          orderId,
          status: 'scheduled',
          scheduledAt: new Date(Date.now() + ESPERA_APROBACION_MIN * 60_000),
          metadata: { step: 'REINTENTO', pasoOriginal: step, intento, espera },
        },
      });
    } else {
      console.error(`[Flujo] ${step} descartado: la plantilla ${faltan.join(', ')} nunca se aprobó`);
    }
    return;
  }

  const execution = await prisma.flowExecution.create({
    data: {
      flowTemplateId: flow.id,
      customerId: order.customerId,
      orderId,
      status: 'running',
      metadata: { step },
    },
  });

  const ctx  = buildContext(order);
  const producto = productoDelPedido(order);
  const sent: string[] = [];
  let failure: string | null = null;

  for (const tpl of templatesForStep(step, producto, ctx)) {
    try {
      const res = await sendWhatsAppTemplate(order.customer.phone, tpl.name, 'es', tpl.params, {}, LINEA_POSTCOMPRA);
      sent.push(tpl.name);
      await registrarPlantillaPostcompra(order.customerId, tpl.name, tpl.params, res?.messages?.[0]?.id);
    } catch (e) {
      failure = e instanceof Error ? e.message : 'Error desconocido';
      console.error(`[Flujo] ${step} · ${tpl.name} falló:`, failure);
      break;
    }
  }

  await prisma.flowExecution.update({
    where: { id: execution.id },
    data: {
      status: failure ? 'failed' : 'sent',
      completedAt: new Date(),
      metadata: { step, sent, intento, ...(failure && { error: failure }) },
    },
  });

  // Si falló, se reintenta: Mastershop manda cada evento una sola vez, así que
  // sin esto un fallo pasajero —o una plantilla que Meta aún no ha aprobado—
  // hacía que ese paso se perdiera para siempre, en silencio.
  if (failure && intento < MAX_INTENTOS_PASO) {
    await prisma.flowExecution.create({
      data: {
        flowTemplateId: flow.id,
        customerId: order.customerId,
        orderId,
        status: 'scheduled',
        scheduledAt: new Date(Date.now() + ESPERA_REINTENTO_MIN * intento * 60_000),
        metadata: { step: 'REINTENTO', pasoOriginal: step, intento: intento + 1 },
      },
    });
  }

  // Paso 1: si no contesta, recordatorio a los 90 minutos.
  if (step === 'POR_CONFIRMAR' && !failure) {
    await scheduleConfirmationReminder(orderId, order.customerId);
  }

  // Entregado: arranca el acompañamiento de los días 8, 15, 25, 30 y 32.
  if (step === 'ENTREGADO' && !failure) {
    await schedulePostcompra(orderId, order.customerId, order.deliveredAt ?? new Date());
  }
}

/** Un paso del acompañamiento posterior a la entrega, y a los cuántos días sale. */
const DIAS_POSTCOMPRA = [
  { dias: 8,  etapa: 'post_8d'  },
  { dias: 15, etapa: 'post_15d' },
  { dias: 25, etapa: 'post_25d' },
  { dias: 30, etapa: 'post_30d' },
  { dias: 32, etapa: 'post_32d' },
] as const;

type EtapaPostcompra = (typeof DIAS_POSTCOMPRA)[number]['etapa'];

/** Qué plantilla manda cada etapa del acompañamiento, según el producto. */
function plantillaPostcompra(etapa: EtapaPostcompra, producto: Producto): string {
  const pre = producto === 'FEM_MOM' ? 'fmom' : 'fem';
  const sufijo: Record<EtapaPostcompra, string> = {
    post_8d:  'acompanamiento_8d',
    post_15d: 'valor_15d',
    post_25d: 'feedback_25d',
    post_30d: 'postcompra_30d',
    post_32d: 'postcompra_32d',
  };
  return `${pre}_${sufijo[etapa]}`;
}

/**
 * Programa los 5 mensajes del acompañamiento posterior a la entrega.
 * Idempotente: si el pedido ya tiene alguno programado o enviado, no lo repite
 * (Mastershop puede reenviar el evento "Entregado" más de una vez).
 */
async function schedulePostcompra(orderId: string, customerId: string, deliveredAt: Date) {
  const flow = await prisma.flowTemplate.findFirst({ where: { trigger: 'DAYS_AFTER_DELIVERY' as any } });
  if (!flow?.isActive) return;

  const yaProgramadas = await prisma.flowExecution.findMany({
    where: { orderId, flowTemplateId: flow.id, status: { in: ['scheduled', 'sent'] } },
    select: { metadata: true },
  });
  const etapasCubiertas = new Set(yaProgramadas.map(e => (e.metadata as any)?.etapa));

  for (const { dias, etapa } of DIAS_POSTCOMPRA) {
    if (etapasCubiertas.has(etapa)) continue;
    const cuando = new Date(deliveredAt.getTime() + dias * 86_400_000);

    // Solo se programa lo que todavía está por venir. Si el evento «Entregado»
    // llega tarde —Mastershop reenvía, o se reprocesa un pedido viejo—, las
    // etapas cuya fecha ya pasó saldrían TODAS juntas en la siguiente pasada
    // del cron: a una clienta que recibió hace 20 días le caerían el mensaje
    // del día 8 y el del día 15 con segundos de diferencia. Preguntarle hoy
    // «¿cómo vas a los 8 días?» tampoco tendría sentido, así que se omiten.
    if (cuando.getTime() <= Date.now()) continue;

    await prisma.flowExecution.create({
      data: {
        flowTemplateId: flow.id,
        customerId,
        orderId,
        status: 'scheduled',
        scheduledAt: cuando,
        metadata: { step: 'POSTCOMPRA', etapa },
      },
    });
  }
}

/** Deja el mensaje saliente en la conversación para que se vea en la bandeja. */
/** Programa el recordatorio de confirmación (lo ejecuta /api/cron/flows). */
async function scheduleConfirmationReminder(orderId: string, customerId: string) {
  const flow = await prisma.flowTemplate.findFirst({
    where: { trigger: 'CONFIRMATION_REMINDER' as any },
  });
  if (!flow?.isActive) return;

  const pending = await prisma.flowExecution.findFirst({
    where: { orderId, flowTemplateId: flow.id, status: { in: ['scheduled', 'sent'] } },
  });
  if (pending) return;

  await prisma.flowExecution.create({
    data: {
      flowTemplateId: flow.id,
      customerId,
      orderId,
      status: 'scheduled',
      scheduledAt: new Date(Date.now() + REMINDER_DELAY_MIN * 60_000),
      metadata: { step: 'RECORDATORIO', stage: 'reminder' },
    },
  });
}

/**
 * La clienta tocó un botón de la plantilla de confirmación.
 * Devuelve true si el botón se reconoció y se atendió.
 */
/**
 * ¿Este texto es una confirmación de pedido?
 *
 * Del botón basta con reconocerlo: solo se toca a propósito.
 *
 * Escrito a mano hay que ser estricto, y no lo era. Bastaba con que el mensaje
 * contuviera «confirm» EN CUALQUIER SITIO, así que la clienta que escribía
 * «por favor me puedes confirmar quién firmó que recibió mi pedido» —una queja
 * de entrega— recibía «¡Gracias, hermosa! Recibimos tu confirmación» y se
 * quedaba sin que nadie leyera su queja. Medido sobre los 243 acuses enviados
 * desde el 12 de agosto: 116 eran falsos, casi la mitad.
 *
 * Y el daño no acababa ahí. Ese acuse deja la conversación con la última
 * palabra puesta por nosotros, así que desaparece de «Sin responder»: la queja
 * no solo quedaba sin contestar, quedaba invisible.
 *
 * La regla ahora es la que separa las dos cosas de verdad: una confirmación es
 * CORTA, dice «confirm» y no pregunta nada. Quien escribe una frase larga, hace
 * una pregunta o usa «cuándo/cuánto/quién/por qué» está hablando de otra cosa,
 * aunque la palabra aparezca. Verificado contra los mensajes reales: acierta en
 * los 16 casos de producción que se revisaron, la regla vieja acertaba 7.
 *
 * Preferir el falso negativo es deliberado: si no se reconoce, la clienta queda
 * en la bandeja y una persona la atiende. Al revés se le contesta cualquier
 * cosa y se pierde el hilo.
 */
export function esConfirmacion(texto: string, esBoton: boolean): boolean {
  const t = texto.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  if (esBoton) return /\bconfirm/.test(t) || /^s[i]\b/.test(t);

  // Una pregunta nunca es una confirmación.
  if (/[?¿]/.test(t)) return false;
  // Ni una frase que pide o niega algo, aunque lleve la palabra.
  if (/\b(cuando|cuanto|cuanta|cuantos|quien|donde|como|porque|no|nunca|todavia|aun)\b/.test(t)) return false;

  const palabras = t.replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!palabras.length || palabras.length > 5) return false;

  return /\bconfirm/.test(t);
}

export async function handleConfirmationButton(
  customerId: string, buttonText: string, lineaEntrante?: string, esBoton = true,
): Promise<boolean> {
  const text = buttonText.trim().toLowerCase();
  const order = await prisma.order.findFirst({
    where: { customerId, status: { in: ['PENDING_CONFIRMATION', 'PREPARING'] } },
    orderBy: { createdAt: 'desc' },
    include: { customer: true },
  });

  if (!order) {
    /**
     * Confirmó, pero su pedido ya no está esperando confirmación —lo más común
     * es que Mastershop lo cancelara justo por no haberla recibido a tiempo—.
     *
     * Antes esto se devolvía en silencio: la clienta hacía su parte, no recibía
     * ni una palabra, y su pedido se caía sin que nadie se enterara. Medido en
     * producción: 516 pedidos cancelados de clientas que sí habían confirmado.
     * Ahora se le contesta y queda marcado para que una persona lo recupere.
     */
    if (esConfirmacion(text, esBoton)) {
      const suyo = await prisma.order.findFirst({
        where: { customerId }, orderBy: { createdAt: 'desc' }, include: { customer: true },
      });
      if (suyo) {
        await responderYRegistrar(suyo, lineaEntrante,
          '¡Gracias, hermosa! 💕 Recibimos tu confirmación. Una asesora la está revisando ' +
          'y te escribe enseguida para dejar tu pedido listo 🌸');
        await tagCustomer(customerId, 'prioridad');
        await flagForHuman(customerId,
          'Confirmó su pedido pero ya no estaba «por confirmar» —probablemente cancelado por demora—: revisar si se puede reactivar');
        return true;
      }
    }
    return false;
  }

  // Cualquiera de los dos botones cancela el recordatorio pendiente.
  await cancelPendingReminders(order.id);

  // El texto tiene que coincidir con el botón REAL de la plantilla, que dice
  // «Sí, confirmo» — no «Confirmar». Antes esto comparaba con startsWith
  // ('confirmar') y por eso el botón de confirmación no hacía absolutamente
  // nada: la clienta lo tocaba y el pedido seguía sin confirmar.
  // Se acepta también texto escrito a mano («si confirmo», «confirmo», «si»).
  if (esConfirmacion(text, esBoton)) {
    // Se propaga a Mastershop, que al confirmarlo lo pasa a «Por Alistar» solo
    // y con eso dispara el mensaje de la guía. Si falla, se le responde igual
    // —la clienta hizo su parte y merece respuesta— pero queda marcada para
    // que una persona lo revise, en vez de darlo por hecho en silencio.
    let enMastershop = true;
    if (order.shopifyOrderId) {
      try {
        await confirmarEnMastershop(order.shopifyOrderId);
      } catch (e) {
        enMastershop = false;
        console.error('[Flujo] No se pudo confirmar en Mastershop', order.shopifyOrderId, e);
      }
    }

    await prisma.order.update({
      where: { id: order.id },
      data: { confirmedAt: new Date() },
    });
    await responderYRegistrar(order, lineaEntrante,
      '¡Perfecto, hermosa! 💕 Ya confirmamos tus datos y tu pedido pasa a preparación. ' +
      'Te avisamos apenas tengamos la guía de transporte 📦✨');
    await tagCustomer(customerId, 'confirmado-whatsapp');
    if (!enMastershop) {
      await tagCustomer(customerId, 'revisar-confirmacion');
      await flagForHuman(customerId,
        'La clienta confirmó pero Mastershop no aceptó la confirmación — pasarlo a «Por Alistar» a mano');
    }
    return true;
  }

  if (text.includes('duda') || text.includes('humano') || text.includes('ayuda')) {
    await responderYRegistrar(order, lineaEntrante,
      'Claro que sí, hermosa 💗 Cuéntanos qué dato necesitas cambiar o qué duda tienes ' +
      'y una de nuestras asesoras te ayuda enseguida 🌸');
    await tagCustomer(customerId, 'prioridad');
    await flagForHuman(customerId, 'La clienta pidió ayuda desde la plantilla de confirmación');
    return true;
  }

  return false;
}

/**
 * Responde a la clienta con texto libre y lo deja en la bandeja.
 *
 * Va sin plantilla a propósito: tocar un botón cuenta como mensaje entrante,
 * así que abre la ventana de 24 horas de atención y dentro de ella WhatsApp
 * permite texto libre. Antes esto mandaba las plantillas `confirmacion_recibida`
 * y `confirmacion_dudas`, que nunca existieron en Meta — la respuesta fallaba
 * siempre en silencio.
 */
async function responderYRegistrar(order: any, lineaEntrante: string | undefined, texto: string) {
  // Se responde por la línea DONDE ESCRIBIÓ la clienta, no siempre por
  // postcompra. La ventana de 24 horas que abre su mensaje pertenece a ese
  // número: contestar por el otro es escribir fuera de ventana y WhatsApp lo
  // rechaza. Pasó de verdad — una clienta confirmó por el número general y no
  // recibió ninguna respuesta.
  const linea = lineaEntrante || LINEA_POSTCOMPRA;
  try {
    const res = await sendWhatsAppMessage(order.customer.phone, texto, undefined, linea);
    await registrarSalienteEnLinea(order.customerId, linea, texto, res?.messages?.[0]?.id);
  } catch (e) {
    console.error('[Flujo] No se pudo responder al botón de confirmación:', e);
  }
}

export async function cancelPendingReminders(orderId: string) {
  await prisma.flowExecution.updateMany({
    where: { orderId, status: 'scheduled' },
    data: { status: 'cancelled', completedAt: new Date() },
  });
}

async function tagCustomer(customerId: string, tag: string) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer || customer.tags.includes(tag)) return;
  await prisma.customer.update({
    where: { id: customerId },
    data: { tags: { push: tag } },
  });
}

/** Marca la conversación como no leída y con prioridad para que la atienda una persona. */
async function flagForHuman(customerId: string, reason: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { customerId, channel: 'WHATSAPP', status: { not: 'RESOLVED' } },
    orderBy: { lastMessageAt: 'desc' },
  });
  if (!conversation) return;

  const tags = conversation.tags.includes('prioridad')
    ? conversation.tags
    : [...conversation.tags, 'prioridad'];

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { tags, isRead: false, status: 'OPEN' },
  });
  await prisma.message.create({
    data: {
      conversationId: conversation.id,
      direction: 'OUTBOUND',
      content: `⚑ ${reason}`,
      isInternal: true,
      status: 'SENT',
    },
  });
}

/**
 * Procesa los pasos programados que ya vencieron. Lo llama /api/cron/flows.
 * Devuelve cuántos atendió.
 */
/**
 * Rescata los pedidos que se quedaron sin su mensaje de guía.
 *
 * El paso «Por alistar» —el que le manda a la clienta la transportadora y el
 * número de guía— se dispara con un aviso de Mastershop. Pero ese aviso no
 * siempre llega: hay pedidos que saltan de «creado» directo a «en tránsito» y
 * el mensaje se lo salta entero. Medido en producción: 61 pedidos con guía
 * asignada y la clienta sin enterarse, algunos de hace días. Es justo el
 * mensaje que evita que piensen que les robamos el dinero.
 *
 * Así que no se depende solo del aviso: si el pedido está confirmado, ya tiene
 * número de guía y todavía va en camino, se manda. Se excluyen los entregados
 * —a esas alturas el mensaje confunde— y los cancelados o devueltos.
 *
 * `runStep` ya trae su propio anti-duplicados, así que un pedido que sí recibió
 * el aviso de Mastershop no lo recibe dos veces.
 */
export async function rescatarGuiasPendientes(): Promise<number> {
  const pendientes = await prisma.order.findMany({
    where: {
      trackingNumber: { not: null },
      status: { in: ['PREPARING', 'IN_TRANSIT', 'IN_DESTINATION'] },
      // Nada recién confirmado: se le da margen al aviso de Mastershop, que es
      // el camino normal y llega en minutos.
      updatedAt: { lte: new Date(Date.now() - 30 * 60_000) },
      // Confirmado, y no hace mucho: el rescate tapa un aviso perdido hace poco,
      // no resucita pedidos de la semana pasada. Hay uno del 7 de agosto que
      // lleva días en tránsito; mandarle ahora «tu guía ya fue generada, entrega
      // en 3 a 6 días hábiles» confundiría a la clienta más que ayudarla.
      // El `gte` ya implica que no sea nulo.
      confirmedAt: { gte: new Date(Date.now() - DIAS_RESCATE_GUIA * 24 * 3_600_000) },
      // Solo cuentan los intentos que llegaron a buen puerto o siguen en cola.
      // Antes bastaba con que EXISTIERA una fila de POR_ALISTAR, del estado que
      // fuera, para descartar el pedido: un paso que murió a medias y quedó en
      // `running` tapaba su propio rescate, que es justo lo que este rescate
      // existe para evitar. La clienta se quedaba sin su guía y sin que ningún
      // camino pudiera recuperarla.
      flowExecutions: {
        none: {
          metadata: { path: ['step'], equals: 'POR_ALISTAR' },
          status: { in: ['sent', 'scheduled'] },
        },
      },
    },
    select: { id: true },
    take: 40,
  });

  let enviados = 0;
  for (const o of pendientes) {
    try {
      await runStep(o.id, 'POR_ALISTAR');
      enviados++;
    } catch (e) {
      console.error('[Flujo] No se pudo rescatar la guía del pedido', o.id, e);
    }
  }
  if (enviados) console.log(`[Flujo] Guías rescatadas: ${enviados}`);
  return enviados;
}

export async function processScheduled(): Promise<{ reminders: number; escalations: number }> {
  const due = await prisma.flowExecution.findMany({
    where: { status: 'scheduled', scheduledAt: { lte: new Date() } },
    include: { order: { include: ORDER_WITH_CONTEXT } },
    take: 100,
  });

  let reminders = 0;
  let escalations = 0;

  for (const exec of due) {
    const order = exec.order;
    const meta = exec.metadata as any;
    const stage = meta?.stage;
    const step  = meta?.step;

    if (!order) {
      await prisma.flowExecution.update({
        where: { id: exec.id },
        data: { status: 'cancelled', completedAt: new Date() },
      });
      continue;
    }

    // El acompañamiento posterior a la entrega es un flujo aparte: no aplica
    // la regla de "ya confirmó / avanzó" de abajo, que es específica del
    // recordatorio de confirmación. Un pedido entregado NUNCA está en
    // PENDING_CONFIRMATION —si se aplicara esa regla aquí, los 5 mensajes de
    // postcompra se cancelarían solos apenas se crearan.
    if (step === 'POSTCOMPRA') {
      await procesarPostcompra(exec, order);
      continue;
    }

    // Reintento de un paso que falló al enviarse.
    if (step === 'REINTENTO') {
      const pasoOriginal = meta?.pasoOriginal as FlowStep | undefined;
      // Se cierra ANTES de reintentar, y como 'cancelled', no 'sent': esta fila
      // es solo la marca del reintento, no un mensaje que salió. Además el
      // anti-duplicados de runStep bloquea 'sent'/'running'/'scheduled', así
      // que dejarla en cualquiera de esos estados haría que el reintento se
      // retirara sin llegar a intentarlo.
      await prisma.flowExecution.update({
        where: { id: exec.id },
        data: { status: 'cancelled', completedAt: new Date() },
      });
      if (pasoOriginal) {
        await runStep(exec.orderId!, pasoOriginal, Number(meta?.intento ?? 2), Number(meta?.espera ?? 0))
          .catch(e => console.error('[Flujo] Reintento falló', pasoOriginal, e));
      }
      continue;
    }

    // Recordatorio de confirmación: si ya confirmó o el pedido avanzó, sobra.
    if (order.confirmedAt || order.status !== 'PENDING_CONFIRMATION') {
      await prisma.flowExecution.update({
        where: { id: exec.id },
        data: { status: 'cancelled', completedAt: new Date() },
      });
      continue;
    }

    if (stage === 'reminder') {
      const ctx = buildContext(order);
      const params = [ctx.product, ctx.address, ctx.city];
      let failed = false;

      try {
        const res = await sendWhatsAppTemplate(
          order.customer.phone, 'pedido_recordatorio_confirmacion', 'es', params, {}, LINEA_POSTCOMPRA,
        );
        await registrarPlantillaPostcompra(order.customerId, 'pedido_recordatorio_confirmacion',
          params, res?.messages?.[0]?.id);
        reminders++;
      } catch (e) {
        failed = true;
        console.error('[Flujo] Recordatorio falló:', e);
      }

      // Si falla (p. ej. la plantilla sigue en revisión), se reintenta en 30 min
      // hasta 3 veces en vez de perder el recordatorio.
      const attempts = Number((exec.metadata as any)?.attempts ?? 0) + 1;
      if (failed && attempts < 3) {
        await prisma.flowExecution.update({
          where: { id: exec.id },
          data: {
            scheduledAt: new Date(Date.now() + 30 * 60_000),
            metadata: { step: 'RECORDATORIO', stage: 'reminder', attempts },
          },
        });
        continue;
      }

      await prisma.flowExecution.update({
        where: { id: exec.id },
        data: {
          status: failed ? 'failed' : 'sent',
          completedAt: new Date(),
          metadata: { step: 'RECORDATORIO', stage: 'reminder', attempts },
        },
      });

      // Sigue sin responder: escalar a una persona en 2 horas.
      await prisma.flowExecution.create({
        data: {
          flowTemplateId: exec.flowTemplateId,
          customerId: exec.customerId,
          orderId: exec.orderId,
          status: 'scheduled',
          scheduledAt: new Date(Date.now() + ESCALATION_DELAY_MIN * 60_000),
          metadata: { step: 'RECORDATORIO', stage: 'escalation' },
        },
      });
    }

    if (stage === 'escalation') {
      await tagCustomer(order.customerId, 'prioridad');
      await flagForHuman(order.customerId,
        'No respondió a la confirmación ni al recordatorio — atender con prioridad');
      await prisma.flowExecution.update({
        where: { id: exec.id },
        data: { status: 'sent', completedAt: new Date() },
      });
      escalations++;
    }
  }

  return { reminders, escalations };
}

/**
 * Manda una etapa del acompañamiento posterior a la entrega.
 *
 * Se cancela si el pedido se devolvió o canceló después de entregado —no
 * tiene sentido preguntarle a alguien cómo le va con un producto que devolvió—,
 * pero SÍ se manda estando DELIVERED, que es el estado normal y esperado.
 */
async function procesarPostcompra(exec: { id: string; metadata: unknown }, order: any) {
  const etapa = (exec.metadata as any)?.etapa as EtapaPostcompra | undefined;

  if (!etapa || order.status === 'RETURNED' || order.status === 'CANCELLED') {
    await prisma.flowExecution.update({
      where: { id: exec.id },
      data: { status: 'cancelled', completedAt: new Date() },
    });
    return;
  }
  if (!order.customer?.phone || !sePuedeEscribirPorWhatsApp(order.customer.phone)) return;

  // Seguro de espaciado, la misma lección que dejaron los carritos: si el cron
  // estuvo caído un par de días, dos etapas pueden vencer a la vez y a la
  // clienta le caerían dos mensajes casi juntos. Se exige un mínimo real de
  // seis horas desde el último mensaje del flujo a este mismo pedido; el que
  // se salta no se pierde, se reintenta en la siguiente pasada.
  const anterior = await prisma.flowExecution.findFirst({
    where: { orderId: order.id, status: 'sent', completedAt: { not: null } },
    orderBy: { completedAt: 'desc' },
    select: { completedAt: true },
  });
  if (anterior?.completedAt && Date.now() - anterior.completedAt.getTime() < 6 * 3_600_000) return;

  const producto = productoDelPedido(order);
  const nombrePlantilla = plantillaPostcompra(etapa, producto);

  try {
    const res = await sendWhatsAppTemplate(order.customer.phone, nombrePlantilla, 'es', [], {}, LINEA_POSTCOMPRA);
    await registrarPlantillaPostcompra(order.customerId, nombrePlantilla, [], res?.messages?.[0]?.id);
    await prisma.flowExecution.update({
      where: { id: exec.id },
      data: { status: 'sent', completedAt: new Date() },
    });
  } catch (e) {
    console.error(`[Flujo] Postcompra ${etapa} falló:`, e);
    await prisma.flowExecution.update({
      where: { id: exec.id },
      data: {
        status: 'failed', completedAt: new Date(),
        metadata: { step: 'POSTCOMPRA', etapa, error: e instanceof Error ? e.message : String(e) },
      },
    });
  }
}
