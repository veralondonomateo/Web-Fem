/**
 * Aviso de Sendura: «te van a llamar, y son ellos».
 *
 * POR QUÉ EXISTE
 *
 * Cuando un pedido sale por Sendura, ellos llaman a la clienta desde un número
 * que no conoce para coordinar la entrega. Mucha gente se asusta —«¿de dónde
 * sacaron mi teléfono?»—, desconfía y hasta rechaza el pedido. Este mensaje
 * llega antes que esa llamada y dice quiénes son.
 *
 * Nombrar a Sendura es TODO el punto. Un aviso genérico de «tu pedido va en
 * camino» no evita nada: lo que desactiva el susto es que la clienta reconozca
 * el nombre cuando le suene el teléfono.
 *
 * EN QUÉ SE DIFERENCIA DE LOS CARRITOS
 *
 * Es otra cola y otra naturaleza. Aquí no hay nadie que dejara de comprar: son
 * pedidos confirmados y despachados. Y no es una secuencia —un pedido, un
 * aviso—. Si la misma clienta hace dos pedidos, recibe dos avisos.
 *
 * Solo los de `sendura`: los que salen por Shopify ya tienen su propio flujo.
 */
import { prisma } from '@/lib/prisma';
import { sendWhatsAppTemplate } from '@/services/whatsapp';
import { LINEA_POSTCOMPRA, registrarPlantillaEnLinea } from '@/services/linea-postcompra';
import { sePuedeEscribirPorWhatsApp, normalizePhone } from '@/services/mastershop';
import {
  listarPedidos, obtenerPedido, reportarAvisoPedido,
  PedidoDespachado, CheckoutNoConfigurado,
} from '@/services/checkout-fem';

/** La plantilla aprobada del aviso. Lleva el nombre de la clienta en {{1}}. */
export const PLANTILLA_AVISO = 'aviso_sendura';

/** Cuántos se leen y cuántos se avisan por pasada del cron (cada minuto). */
const TOPE_LECTURA = 50;
const TOPE_ENVIO = 20;

/**
 * Franja en la que se avisa, hora de Colombia.
 *
 * La documentación no bloquea la noche —el aviso pierde su sentido si llega
 * después de la llamada— pero sí pide no escribir de madrugada. Se abre más que
 * en carritos (7 a 22 en vez de 8 a 20) porque aquí llegar tarde es peor que
 * llegar a una hora incómoda: lo que se está evitando es una llamada que
 * sorprende.
 */
const HORA_INICIO = 7;
const HORA_FIN = 22;

export function horaDeAvisar(ahora = new Date()): boolean {
  const horaCol = new Date(ahora.getTime() - 5 * 3_600_000).getUTCHours();
  return horaCol >= HORA_INICIO && horaCol < HORA_FIN;
}

async function integracion() {
  const cfg = await prisma.integrationConfig.findFirst({
    where: { platform: 'CHECKOUT', isActive: true },
  });
  if (!cfg) throw new CheckoutNoConfigurado('La integración del checkout no está configurada');
  return cfg;
}

export interface ResultadoAvisos {
  leidos: number;
  avisados: number;
  omitidos: number;
  errores: number;
  fueraDeHorario: boolean;
  /** La plantilla todavía no está aprobada por Meta: no se leyó la cola. */
  sinPlantilla?: boolean;
  detalle: string[];
}

/**
 * Lee la cola de pedidos despachados por Sendura y avisa a quien falte.
 *
 * El cursor vive en los ajustes de la integración, igual que el de carritos: es
 * lo que evita releer la cola entera y volver a avisar a todo el mundo si el
 * proceso se reinicia.
 */
export async function procesarAvisosSendura(): Promise<ResultadoAvisos> {
  const res: ResultadoAvisos = {
    leidos: 0, avisados: 0, omitidos: 0, errores: 0, fueraDeHorario: false, detalle: [],
  };

  const cfg = await integracion();
  const ajustes = (cfg.settings ?? {}) as Record<string, unknown>;

  /**
   * Antes de nada, los rezagados: enviados cuyo reporte al checkout falló.
   *
   * Va primero y siempre, incluso fuera de horario, porque no manda ningún
   * mensaje —solo cierra el círculo—. Mientras uno de estos siga sin sellar, el
   * checkout lo devolverá como pendiente en cada pasada.
   */
  await reintentarReportes(res);

  if (!horaDeAvisar()) {
    res.fueraDeHorario = true;
    return res;
  }

  /**
   * Sin plantilla aprobada no se lee la cola, y eso es lo importante: si se
   * leyera, el cursor avanzaría sobre pedidos a los que no se pudo avisar y
   * esos avisos se perderían para siempre. Mejor esperar con la cola quieta.
   */
  const plantilla = await prisma.messageTemplate.findFirst({
    where: { name: PLANTILLA_AVISO, status: 'APPROVED' },
    select: { id: true },
  });
  if (!plantilla) {
    res.sinPlantilla = true;
    return res;
  }

  const cursor = typeof ajustes.cursorPedidos === 'number' ? ajustes.cursorPedidos : null;

  /**
   * El punto de partida, y aquí estuvo el fallo que lo dejó mudo tres días.
   *
   * La idea era correcta: la primera vez se pide «desde ahora», para no avisar
   * de pedidos despachados antes de que esto existiera —la llamada de Sendura ya
   * ocurrió y el aviso solo confundiría—. Lo que estaba mal era calcular ese
   * «ahora» EN CADA PASADA. Como el checkout solo devuelve cursor cuando hay
   * resultados, y pedir «despachados desde este preciso instante» nunca devuelve
   * ninguno, el cursor se quedaba en null para siempre y la consulta volvía a
   * empezar de cero cada minuto. La cola tenía 121 pedidos de hoy y el CRM leía 0.
   *
   * Ahora el instante de arranque se guarda la primera vez y no se vuelve a
   * mover. Deja de ser un blanco móvil.
   */
  let desde = typeof ajustes.pedidosDesde === 'string' ? ajustes.pedidosDesde : null;
  if (!cursor && !desde) {
    desde = new Date().toISOString();
    await prisma.integrationConfig.update({
      where: { id: cfg.id },
      data: { settings: { ...ajustes, pedidosDesde: desde } },
    });
  }

  const pagina = await listarPedidos({
    cursor,
    transportadora: 'sendura',
    limite: TOPE_LECTURA,
    ...(cursor ? {} : { desde: desde! }),
  });
  res.leidos = pagina.pedidos.length;

  // El cursor se guarda aunque no se avise a nadie: lo leído, leído está.
  await prisma.integrationConfig.update({
    where: { id: cfg.id },
    data: {
      settings: { ...ajustes, pedidosDesde: desde, cursorPedidos: pagina.cursor ?? cursor },
      lastSyncAt: new Date(),
    },
  });

  for (const pedido of pagina.pedidos) {
    if (res.avisados >= TOPE_ENVIO) break;
    try {
      await avisarUno(pedido, res);
    } catch (e) {
      res.errores++;
      const motivo = e instanceof Error ? e.message : String(e);
      res.detalle.push(`${pedido.id.slice(0, 8)}: ${motivo.slice(0, 120)}`);
      console.error('[Sendura] fallo avisando', pedido.id, motivo);
      if (e instanceof CheckoutNoConfigurado) break;
    }
  }

  return res;
}

async function avisarUno(pedido: PedidoDespachado, res: ResultadoAvisos) {
  // Solo Sendura. Los de Shopify vienen marcados en la misma cola y ya tienen
  // su flujo propio en el CRM; avisarles sería duplicarles el mensaje.
  if (pedido.transportadora !== 'sendura') { res.omitidos++; return; }

  // Uno por pedido. Si ya hay fila, este pedido ya se trabajó —se avisara o no—.
  const yaHay = await prisma.avisoSendura.findUnique({
    where: { pedidoId: pedido.id }, select: { id: true },
  });
  if (yaHay) { res.omitidos++; return; }

  const telefono = normalizePhone(pedido.cliente.telefono_local || pedido.cliente.telefono);
  if (!telefono || !sePuedeEscribirPorWhatsApp(telefono)) {
    await registrar(pedido, telefono ?? '', null, `Teléfono no utilizable: ${pedido.cliente.telefono}`);
    res.omitidos++;
    return;
  }

  /**
   * Revalidar en vivo, obligatorio y justo antes de escribir.
   *
   * Entre que se leyó la página y se llega aquí, otro proceso pudo avisar. Sin
   * esta llamada, un reintento de la tanda le escribe dos veces a la misma
   * clienta — que es exactamente lo que este aviso no se puede permitir.
   */
  const vivo = await obtenerPedido(pedido.id);
  if (!vivo.debe_avisar) {
    await registrar(pedido, telefono, null, 'El checkout dice que ya estaba avisado.');
    res.omitidos++;
    return;
  }

  const clienta = await clientaDe(vivo, telefono);
  const nombre = (vivo.cliente.nombre || '').trim().split(/\s+/)[0] || 'hermosa';

  const envio = await sendWhatsAppTemplate(
    telefono, PLANTILLA_AVISO, 'es', [nombre], {}, LINEA_POSTCOMPRA,
  );

  /**
   * La fila se escribe ANTES de reportar al checkout, y ese orden es el seguro
   * entero: si el reporte falla, el aviso ya consta como enviado aquí y la
   * clienta no lo recibe dos veces. El sello del checkout se reintenta después.
   */
  await registrar(pedido, telefono, clienta?.id ?? null, null, true);

  if (clienta) {
    await registrarPlantillaEnLinea(clienta.id, LINEA_POSTCOMPRA, PLANTILLA_AVISO, [nombre],
      envio?.messages?.[0]?.id)
      .catch(e => console.error('[Sendura] no se pudo registrar en la bandeja', e));
  }

  await prisma.avisoSendura.update({
    where: { pedidoId: pedido.id },
    data: { reportado: await sellar(pedido.id) },
  });

  res.avisados++;
}

/** Sella el aviso en el checkout. Devuelve si se consiguió. */
async function sellar(pedidoId: string): Promise<boolean> {
  try {
    await reportarAvisoPedido(pedidoId);
    return true;
  } catch (e) {
    console.error('[Sendura] no se pudo reportar el aviso', pedidoId, e);
    return false;
  }
}

/** Los enviados que quedaron sin sellar en el checkout. */
async function reintentarReportes(res: ResultadoAvisos) {
  const pendientes = await prisma.avisoSendura.findMany({
    where: { reportado: false, enviadoAt: { not: null } },
    select: { pedidoId: true },
    take: 20,
  });
  for (const p of pendientes) {
    if (await sellar(p.pedidoId)) {
      await prisma.avisoSendura.update({
        where: { pedidoId: p.pedidoId }, data: { reportado: true },
      }).catch(() => {});
    } else {
      res.errores++;
    }
  }
}

async function registrar(
  pedido: PedidoDespachado, telefono: string, customerId: string | null,
  motivo: string | null, enviado = false,
) {
  await prisma.avisoSendura.upsert({
    where: { pedidoId: pedido.id },
    create: {
      pedidoId: pedido.id,
      customerId,
      guia: pedido.guia ?? null,
      telefono,
      motivo,
      despachadoAt: pedido.despachado_at ? new Date(pedido.despachado_at) : null,
      ...(enviado ? { enviadoAt: new Date() } : {}),
    },
    update: {},
  });
}

/**
 * La ficha de la clienta, para que el aviso quede visible en la bandeja.
 *
 * Se busca por teléfono, que es la llave del CRM. Si no existe se crea: el
 * pedido es real y la agente tiene que poder ver a quién se le escribió cuando
 * la clienta conteste.
 */
async function clientaDe(pedido: PedidoDespachado, telefono: string) {
  const existente = await prisma.customer.findUnique({ where: { phone: telefono } });
  if (existente) return existente;

  return prisma.customer.create({
    data: {
      phone: telefono,
      name: pedido.cliente.nombre_completo?.trim() || pedido.cliente.nombre?.trim() || 'Sin nombre',
      email: pedido.cliente.email || null,
      city: pedido.cliente.ciudad || null,
      department: pedido.cliente.departamento || null,
      status: 'NEW',
    },
  }).catch(async () => prisma.customer.findUnique({ where: { phone: telefono } }));
}
