import { prisma } from '@/lib/prisma';
import { sendWhatsAppTemplate } from '@/services/whatsapp';
import {
  listarCarritos, obtenerCarrito, reportarEvento, tokenDeLink,
  CarritoCheckout, ProductoCarrito, CheckoutNoConfigurado,
} from '@/services/checkout-fem';
import { LINEA_CARRITOS, registrarPlantillaEnLinea } from '@/services/linea-postcompra';

/**
 * Recuperación de carritos abandonados del checkout propio.
 *
 * Dos procesos, igual que con Mastershop: uno lee la cola y otro envía cuando
 * toca. El checkout ya filtra a quien compró, se dio de baja o no tiene celular;
 * aquí se cumplen las reglas que le tocan al CRM:
 *
 *   · Revalidar en vivo justo antes de CADA mensaje.
 *   · Tope de 3 mensajes por carrito.
 *   · Nada de noche: si el carrito madura a las 11 p. m., sale por la mañana.
 *   · Reportar cada envío, o no hay métricas de recuperación.
 */

// ── Los tres pasos del flujo ────────────────────────────────────────────────
// Las esperas son ACUMULADAS desde `contactar_desde` (detección + 45 min), no
// entre mensajes: así un retraso en un envío no corre todos los siguientes.
interface Paso {
  numero: 1 | 2 | 3;
  plantilla: string;
  /** Horas desde contactar_desde. El paso 1 sale en cuanto madura. */
  horas: number;
  /** El tercero es el único que ofrece descuento. */
  conDescuento: boolean;
  llevaImagen: boolean;
}

export const PASOS: Paso[] = [
  { numero: 1, plantilla: 'carrito_abandonado_1', horas: 0,  conDescuento: false, llevaImagen: false },
  { numero: 2, plantilla: 'carrito_abandonado_2', horas: 24, conDescuento: false, llevaImagen: true  },
  { numero: 3, plantilla: 'carrito_abandonado_3', horas: 79, conDescuento: true,  llevaImagen: true  },
];

/** Franja en la que se puede escribir, hora de Colombia (UTC-5). */
const HORA_INICIO = 8;
const HORA_FIN = 20;
const TZ_OFFSET_H = -5;

/**
 * A partir de aquí un carrito se considera "rezagado".
 *
 * Los frescos son la prioridad: a esos el mensaje les llega a tiempo y
 * convierten mejor. Los rezagados —la cola acumulada antes de encender el
 * flujo— también se trabajan, pero a cuentagotas y sin quitarle cupo a los
 * nuevos.
 */
const ANTIGUEDAD_REZAGADO_H = 12;

/**
 * A partir de aquí el carrito se cierra sin escribir.
 *
 * Nació pegado a un límite técnico —el link caducaba a los 30 días—, pero desde
 * el 25/09/2026 el checkout abre los productos hasta 90 días
 * (`CARRITO_VIGENCIA_DIAS` de su lado; solo los datos personales se siguen
 * rellenando 30). Así que estos 28 días ya no son una pared: son una decisión,
 * la de no perseguir un carrito de hace un mes. Si algún día se quiere estirar,
 * el techo real son los 90 del checkout.
 *
 * Quien decida moverlo: el link sigue comprobándose en vivo antes de cada
 * mensaje (`link_restaura.coincide`), así que alargar el plazo no arriesga
 * mandar a nadie a una página que no es la suya.
 */
const VIGENCIA_LINK_DIAS = 28;

/**
 * Topes por pasada del cron (cada minuto, ver vercel.json).
 *
 * El cupo original (10/pasada cada 10 min = 60/hora) se pensó para una
 * operación pequeña y se quedó corto: verificado en producción, entraban más
 * carritos nuevos por hora de los que el cupo alcanzaba a atender, así que la
 * cola de paso 2 crecía en vez de bajar (307 → 498 en un día).
 *
 * La causa real no era solo el tamaño del cupo sino cómo se repartía: turnarse
 * por posición en una lista entrelazada (uno de cada grupo, por turno) parece
 * justo, pero dejó de serlo en cuanto un grupo tuvo 503 carritos esperando y
 * otro solo 15 — el reparto real terminaba dominado por el grupo con más
 * volumen, no por el que más lo necesitaba. Por eso el reparto ahora es por
 * cupos explícitos, proporcionales al tamaño de cada cola y recalculados en
 * cada pasada (ver más abajo, `cupoRestante`), no por turnos.
 *
 * El total por pasada se dejó en 22, no más: a ~1.8 s por envío (medido en
 * producción), 22 caben en unos 40 s — con margen de sobra frente al límite
 * de 60 s de la función serverless. Con el cron cada minuto eso da hasta
 * 1.320 mensajes/hora de techo, muy por encima de cualquier cola real, así
 * que en la práctica el freno pasa a ser "cuántos hay vencidos", no el cupo.
 */
const MAX_ENVIOS_POR_PASADA = 22;
const MAX_REZAGADOS_POR_PASADA = 18;

/**
 * Mínimo real entre un mensaje y el siguiente, sin importar qué diga la
 * fórmula de `contactar_desde + horas`. Solo importa para un backlog viejo
 * que se destraba de golpe: ahí el paso 2 y el paso 3 pueden vencer casi
 * juntos, y sin este seguro le llegarían a la clienta con minutos de
 * diferencia.
 */
const ESPACIADO_MINIMO_MS = 60 * 60_000;

export function dentroDeHorario(ahora = new Date()): boolean {
  const horaCol = new Date(ahora.getTime() + TZ_OFFSET_H * 3_600_000).getUTCHours();
  return horaCol >= HORA_INICIO && horaCol < HORA_FIN;
}

/**
 * Cuántos productos se nombran antes de resumir con «y N más».
 *
 * El carrito más grande visto tiene cuatro líneas, así que con cuatro se nombran
 * todos en la práctica. El resumen existe para que un carrito raro no le meta a
 * la clienta un párrafo de inventario en el primer renglón del mensaje.
 */
const MAX_PRODUCTOS_EN_MENSAJE = 4;

/**
 * Los productos del carrito, escritos para que quepan en «dejaste tu ___ en el
 * carrito».
 *
 * Se nombra TODO lo que hay, no el primero: durante meses el mensaje decía solo
 * `productos[0]` y en los carritos de dos a cuatro líneas la clienta leía un
 * producto y encontraba otros tres. La cantidad va delante cuando es más de una
 * por el mismo motivo —«2 × Jabón» y un solo jabón en la página es el mismo
 * problema en pequeño—.
 */
export function fraseDeProductos(productos: ProductoCarrito[] | undefined): string {
  const nombres = (productos ?? [])
    .map(p => {
      const nombre = (p.nombre ?? '').replace(/\s+/g, ' ').trim();
      if (!nombre) return '';
      const cantidad = p.cantidad ?? 1;
      return cantidad > 1 ? `${cantidad} × ${nombre}` : nombre;
    })
    .filter(Boolean);

  if (!nombres.length) return 'pedido Fem';

  const sobran = nombres.length - MAX_PRODUCTOS_EN_MENSAJE;
  const partes = sobran > 0 ? nombres.slice(0, MAX_PRODUCTOS_EN_MENSAJE) : nombres;
  if (sobran > 0) partes.push(`${sobran} producto${sobran === 1 ? '' : 's'} más`);

  // «A», «A y B», «A, B y C»: la coma de Oxford no existe en español.
  return partes.length === 1
    ? partes[0]
    : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`;
}

function urlImagenTestimonio(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || '';
  return `${base}/testimonio-carrito.jpg`;
}

// ── Ingesta ─────────────────────────────────────────────────────────────────

async function integracion() {
  let cfg = await prisma.integrationConfig.findFirst({ where: { platform: 'CHECKOUT', isActive: true } });
  if (!cfg) {
    cfg = await prisma.integrationConfig.create({
      data: { platform: 'CHECKOUT', name: 'Checkout Fem', credentials: {}, settings: {}, isActive: true },
    });
  }
  return cfg;
}

/** Guarda o actualiza un carrito. Idempotente por el id del checkout. */
export async function guardarCarrito(c: CarritoCheckout, integrationId: string) {
  const telefono = c.telefono?.trim();
  if (!telefono) return null;

  // La clienta puede no existir aún en el CRM: se crea con lo que trae el
  // carrito. Si ya existe (compró antes), se respeta lo que ya sabemos.
  const clienta = await prisma.customer.upsert({
    where: { phone: telefono },
    create: {
      phone: telefono,
      name: c.nombre_completo?.trim() || c.nombre?.trim() || 'Sin nombre',
      email: c.email || null,
      city: c.ciudad || null,
      department: c.departamento || null,
      status: 'NEW',
    },
    update: {
      email: c.email || undefined,
      city: c.ciudad || undefined,
      department: c.departamento || undefined,
    },
  });

  const datos = {
    cartType: c.tipo,
    customerId: clienta.id,
    integrationId,
    email: c.email || null,
    phone: telefono,
    checkoutUrl: c.link_recuperacion,
    discountUrl: c.link_recuperacion_descuento || null,
    couponCode: c.cupon_descuento || null,
    totalAmount: c.total ?? null,
    lineItems: (c.productos ?? []) as any,
    contactableFrom: new Date(c.contactar_desde),
    abandonedAt: new Date(c.detectado_at),
    reminderCount: c.mensajes_enviados ?? 0,
  };

  return prisma.abandonedCart.upsert({
    where: { externalId: c.id },
    create: { externalId: c.id, ...datos },
    // `status` y `reminderSentAt` los lleva el CRM: no se pisan desde la cola.
    update: {
      checkoutUrl: datos.checkoutUrl,
      discountUrl: datos.discountUrl,
      couponCode: datos.couponCode,
      contactableFrom: datos.contactableFrom,
      customerId: datos.customerId,
      cartType: datos.cartType,
      // El contenido sí se refresca en cada lectura de la cola. Antes se
      // guardaba solo al crear la fila, así que si la clienta volvía y cambiaba
      // su carrito, el CRM seguía mostrando el de la primera detección: la
      // ficha decía una cosa, el link abría otra y no había manera de saber
      // cuál de las dos era la de verdad. El dinero también: `totalAmount` es
      // el que suma la pantalla de carritos («cuánto hay sin recuperar»).
      lineItems: datos.lineItems,
      totalAmount: datos.totalAmount,
    },
  });
}

export interface ResultadoIngesta {
  leidos: number;
  guardados: number;
  cursor: number | null;
  paginas: number;
}

/**
 * Lee la cola desde el último cursor. El cursor vive en los ajustes de la
 * integración, así que si el CRM se cae y vuelve horas después, retoma justo
 * donde iba sin releer ni perderse nada.
 */
export async function ingerirCarritos(maxPaginas = 20): Promise<ResultadoIngesta> {
  const cfg = await integracion();
  const ajustes = (cfg.settings ?? {}) as Record<string, unknown>;
  let cursor: number | null = typeof ajustes.cursor === 'number' ? ajustes.cursor : null;

  let leidos = 0, guardados = 0, paginas = 0;

  for (; paginas < maxPaginas; paginas++) {
    const pagina = await listarCarritos({ cursor, limite: 100 });
    leidos += pagina.carritos.length;

    for (const c of pagina.carritos) {
      if (await guardarCarrito(c, cfg.id)) guardados++;
    }

    cursor = pagina.cursor ?? cursor;
    await prisma.integrationConfig.update({
      where: { id: cfg.id },
      data: { settings: { ...ajustes, cursor }, lastSyncAt: new Date() },
    });

    if (!pagina.hay_mas) { paginas++; break; }
  }

  return { leidos, guardados, cursor, paginas };
}

// ── Envío ───────────────────────────────────────────────────────────────────

export interface ResultadoEnvio {
  candidatos: number;
  enviados: number;
  bloqueados: number;
  /** Demasiado viejos para un primer mensaje: se cerraron sin escribir. */
  caducados: number;
  errores: number;
  fueraDeHorario: boolean;
  topeAlcanzado: boolean;
  detalle: string[];
}

/** Qué paso toca según cuántos mensajes lleva ya el carrito. */
function pasoPendiente(enviados: number): Paso | undefined {
  return PASOS[enviados];
}

/**
 * Envía lo que esté vencido. Pensado para correr cada 10 minutos desde el cron
 * de flujos: esa precisión sobra para esperas de 24 y 79 horas.
 */
export interface OpcionesEnvio {
  limite?: number;
  /**
   * Recorre todo el camino real —selección, revalidación en vivo, armado de
   * los parámetros— pero no manda el WhatsApp, no reporta al checkout y no
   * toca la base. Sirve para comprobar qué haría antes de encender el flujo.
   * Ignora la franja horaria y el estado del flujo: no envía nada igualmente.
   */
  dryRun?: boolean;
}

export async function procesarEnviosPendientes(opts: OpcionesEnvio | number = {}): Promise<ResultadoEnvio> {
  const { limite = 60, dryRun = false } = typeof opts === 'number' ? { limite: opts, dryRun: false } : opts;

  const res: ResultadoEnvio = {
    candidatos: 0, enviados: 0, bloqueados: 0, caducados: 0, errores: 0,
    fueraDeHorario: !dentroDeHorario(), topeAlcanzado: false, detalle: [],
  };

  // El carrito no se vence: fuera de la franja simplemente no se escribe y se
  // reintenta en la siguiente pasada.
  if (res.fueraDeHorario && !dryRun) return res;

  const flujo = await prisma.flowTemplate.findFirst({ where: { trigger: 'ABANDONED_CART' } });
  if (!flujo?.isActive && !dryRun) return res;

  const ahora = new Date();
  const corteRezagado = new Date(ahora.getTime() - ANTIGUEDAD_REZAGADO_H * 3_600_000);
  const corteLinkMuerto = new Date(ahora.getTime() - VIGENCIA_LINK_DIAS * 86_400_000);

  /**
   * «Ya le toca su siguiente mensaje», expresado para la base de datos.
   *
   * La espera depende de cuántos mensajes lleva el carrito (0 h, 24 h, 79 h),
   * así que no basta con `contactableFrom <= ahora`: hay que comparar contra
   * el plazo DE SU PASO. Sin esto la consulta devolvía carritos que aún no
   * vencían y, como se ordenaba por `contactableFrom` y se cortaba en 60,
   * esos no-vencidos —los que esperan el paso 2, con fecha más antigua— se
   * llevaban todos los cupos y tapaban a los que sí debían salir ya.
   * Verificado en producción: 69 carritos vencidos y cero envíos por pasada.
   */
  const yaLeToca = {
    OR: PASOS.map((paso, i) => ({
      reminderCount: i,
      contactableFrom: { lte: new Date(ahora.getTime() - paso.horas * 3_600_000) },
    })),
  };

  const base = {
    status: 'OPEN' as const,
    reminderCount: { lt: PASOS.length },
    contactableFrom: { lte: ahora },
    phone: { not: null },
    // Dentro de AND y no como `OR` suelto: la consulta de rezagados añade su
    // propio OR para el espaciado, y dos claves `OR` en el mismo objeto se
    // pisan —quedaría solo la última y este filtro desaparecería sin avisar—.
    AND: [yaLeToca],
  };

  // Tres grupos en tres consultas, y no una sola ordenada por fecha: con cientos
  // de carritos rezagados en cola, un único lote se llenaba de viejos y los
  // frescos —los que mejor convierten— nunca llegaban a evaluarse.
  const frescos = await prisma.abandonedCart.findMany({
    where: { ...base, abandonedAt: { gt: corteRezagado } },
    orderBy: { contactableFrom: 'asc' },
    take: limite,
    include: { customer: true },
  });

  // Rezagados: se trabajan igual, con su propio cupo pequeño.
  //
  // Van TRES bugs reales encontrados aquí, uno encima del otro:
  //
  // 1) No se puede pedir solo "los N más recientes por abandonedAt" como con
  //    los frescos. Con el backlog en cientos, siempre hay carritos recién
  //    cumplidos sus 12 h esperando el paso 1 — y esos, por ser los más
  //    recientes, le ganaban SIEMPRE el puesto a uno que ya recibió el paso 1
  //    hace más de un día y espera el paso 2.
  //
  // 2) Ordenar por "cuántos mensajes lleva ya" (para que completar un flujo
  //    empezado ganara sobre arrancar uno nuevo) resolvía lo anterior pero
  //    abría un bug nuevo: el grupo que espera el paso 3 —chico— se llevaba
  //    TODO el cupo así ninguno estuviera vencido todavía.
  //
  // 3) Turnarse por posición en una lista entrelazada (uno de cada grupo, por
  //    turno) parecía la solución, pero deja de ser justo en cuanto un grupo
  //    tiene muchísimos más carritos que otro: verificado en producción con
  //    503 esperando el paso 2 contra 15 esperando el paso 3, el reparto real
  //    terminaba dominado por el grupo con más volumen (paso 1, siempre
  //    "vencido" por definición), no por el que más presión tenía.
  //
  // La solución real es un cupo FIJO por paso, proporcional al tamaño de su
  // cola y recalculado en cada pasada — no una posición en una lista.
  // El seguro de una hora (ESPACIADO_MINIMO_MS) se aplica AQUÍ, en la consulta,
  // no solo más abajo en el bucle. Un backlog viejo que se destraba de golpe
  // puede tener cientos de carritos con la MISMA fecha de detección —se
  // importaron juntos—; si a un lote grande de esos ya se le mandó algo hace
  // minutos, ese lote entero domina el tope de "los más vencidos" y no deja
  // margen —ni ×15— para llegar a los que sí están libres para enviar ya.
  // Filtrando el espaciado en la consulta, la lista ordenada por vencimiento
  // solo contiene carritos que de verdad se pueden mandar en este momento.
  const elegiblesRezagados = await prisma.abandonedCart.findMany({
    where: {
      ...base,
      abandonedAt: { lte: corteRezagado, gt: corteLinkMuerto },
      OR: [{ reminderSentAt: null }, { reminderSentAt: { lt: new Date(ahora.getTime() - ESPACIADO_MINIMO_MS) } }],
    },
    select: { id: true, abandonedAt: true, contactableFrom: true, reminderCount: true },
  });
  const venceDe = (c: (typeof elegiblesRezagados)[number]) =>
    (c.contactableFrom ?? c.abandonedAt).getTime() + (PASOS[c.reminderCount]?.horas ?? 0) * 3_600_000;

  const porPasoPendiente = new Map<number, typeof elegiblesRezagados>();
  for (const c of elegiblesRezagados) {
    const lista = porPasoPendiente.get(c.reminderCount);
    if (lista) lista.push(c); else porPasoPendiente.set(c.reminderCount, [c]);
  }
  for (const lista of Array.from(porPasoPendiente.values())) lista.sort((a, b) => venceDe(a) - venceDe(b));

  // Cupo proporcional: quien tiene más gente esperando se lleva más cupo, con
  // un mínimo de 1 para que un paso chico (como el 3, casi siempre con pocos
  // carritos) nunca se quede en cero.
  const totalElegibles = elegiblesRezagados.length || 1;
  const cupoPorPaso = new Map<number, number>();
  for (const [paso, lista] of Array.from(porPasoPendiente.entries())) {
    cupoPorPaso.set(paso, Math.max(1, Math.round(MAX_REZAGADOS_POR_PASADA * lista.length / totalElegibles)));
  }

  // De cada grupo se toman muchos más candidatos que su cupo, no el triple:
  // los más vencidos por fórmula (contactar_desde + horas) pueden ser
  // exactamente los que recibieron su mensaje anterior hace poco —un backlog
  // viejo que se destraba de golpe manda varios pasos casi juntos— y esos los
  // frena el seguro de una hora (`ESPACIADO_MINIMO_MS`). Verificado en
  // producción: con el triple como margen, esos bloqueados se comían todo el
  // cupo evaluado y ninguno de los que sí estaban libres para enviar llegaba
  // a probarse. Con ×15 hay margen real para saltarlos y seguir bajando la
  // lista hasta encontrar candidatos que sí se puedan mandar ya.
  const idsRezagados = Array.from(porPasoPendiente.entries())
    .flatMap(([paso, lista]) => lista.slice(0, (cupoPorPaso.get(paso) ?? 1) * 15).map(c => c.id));

  const rezagados = idsRezagados.length
    ? await prisma.abandonedCart.findMany({
        where: { id: { in: idsRezagados } },
        include: { customer: true },
      })
    : [];

  // Con el link ya caducado no hay nada que hacer: se cierran.
  const muertos = await prisma.abandonedCart.findMany({
    where: { ...base, abandonedAt: { lte: corteLinkMuerto } },
    orderBy: { abandonedAt: 'asc' },
    take: 40,
    include: { customer: true },
  });

  const esRezagado = new Set(rezagados.map(c => c.id));
  const esMuerto = new Set(muertos.map(c => c.id));
  const candidatos = [...frescos, ...rezagados, ...muertos];

  // Cupo fijo por grupo, no uno solo compartido en orden de lista ni por turnos
  // (ver el porqué en el comentario de `cupoPorPaso`, más arriba). Cada paso
  // tiene su propio contador, así que a ninguno lo puede dejar en cero un
  // grupo vecino más grande ni una racha de suerte en el orden de llegada.
  const CUPO_FRESCOS = Math.max(MAX_ENVIOS_POR_PASADA - MAX_REZAGADOS_POR_PASADA, 0);
  let frescosEnviados = 0;
  const cupoRestantePorPaso = new Map(cupoPorPaso);
  let cupoAgotado = false;

  for (const carrito of candidatos) {
    const rezagadoActual = esRezagado.has(carrito.id);
    const muertoActual = esMuerto.has(carrito.id);

    if (!muertoActual) {
      const sinCupo = rezagadoActual
        ? (cupoRestantePorPaso.get(carrito.reminderCount) ?? 0) <= 0
        : frescosEnviados >= CUPO_FRESCOS;
      if (sinCupo) {
        cupoAgotado = true;
        continue;
      }
    }

    const paso = pasoPendiente(carrito.reminderCount);
    if (!paso) continue;

    // ¿Ya venció la espera de ESTE paso? Se cuenta desde contactar_desde, no
    // desde el mensaje anterior, para que un retraso no arrastre a los demás.
    const vence = new Date((carrito.contactableFrom ?? carrito.abandonedAt).getTime() + paso.horas * 3_600_000);
    if (vence > ahora) continue;

    // Seguro contra el arrastre de un backlog muy viejo: si un carrito llevaba
    // días detenido, al destrabarse puede que el paso 2 Y el paso 3 estén
    // vencidos a la vez (24h y 79h ya pasaron ambos desde `contactar_desde`).
    // Sin esto, un mismo mensaje seguiría al anterior en la siguiente pasada
    // del cron —minutos después—, y a la clienta le llegarían dos WhatsApp
    // casi juntos. Se exige una hora real desde el ÚLTIMO mensaje, sin
    // importar qué diga la fórmula.
    if (carrito.reminderSentAt && ahora.getTime() - carrito.reminderSentAt.getTime() < ESPACIADO_MINIMO_MS) {
      continue;
    }

    // Link caducado: el mensaje llevaría a una página muerta.
    if (muertoActual) {
      res.caducados++;
      if (!dryRun) {
        await prisma.abandonedCart.update({ where: { id: carrito.id }, data: { status: 'LOST' } });
        await reportarEvento(carrito.externalId, 'descartado',
          `Link de recuperación caducado (más de ${VIGENCIA_LINK_DIAS} días desde la detección).`)
          .catch(e => console.error('[Carritos] no se pudo reportar descartado', carrito.externalId, e));
      }
      continue;
    }

    res.candidatos++;

    /**
     * ¿Ya compró? Se pregunta en NUESTROS pedidos antes de nada.
     *
     * El checkout ya filtra a quien compró por su propia vía, y para eso está
     * la revalidación de abajo. Pero la clienta también compra por caminos que
     * el checkout no ve —le escribe a una asesora y el pedido entra por
     * Shopify o por Mastershop—, y entonces `debe_contactar` sigue diciendo que
     * sí. Resultado: 58 carritos en 14 días recibieron el segundo o el tercer
     * recordatorio de un carrito que la clienta ya había convertido en pedido.
     * «Ya te compré y me siguen escribiendo» es de las peores cosas que puede
     * hacer un CRM.
     *
     * Se mira por ficha, que es la misma llave con la que se guardó el carrito
     * (`upsert` por teléfono), así que el pedido hecho con ese número aparece
     * aquí aunque lo trajera otro sistema. Y solo cuentan los pedidos
     * POSTERIORES al abandono: uno de hace un mes no dice nada de este carrito.
     */
    if (carrito.customerId) {
      /**
       * Ya contestó: para la secuencia y que siga una persona.
       *
       * Este era el agujero grande, y no lo tapaba mirar los pedidos. La
       * clienta responde al primer recordatorio —«sí, quiero», «cómo hago el
       * pedido»— y se pone a hablar con una asesora; el pedido todavía no
       * existe, así que la secuencia seguía mandándole el segundo y el tercero
       * por encima de esa conversación. Medido sobre 7 días: 403 carritos, y en
       * 372 de ellos una asesora ya le estaba escribiendo.
       *
       * Cualquier respuesta suya cuenta, incluso «no me interesa»: en los dos
       * casos lo que toca es callarse y dejar que la lleve una persona.
       */
      const respondio = await prisma.message.findFirst({
        where: {
          direction: 'INBOUND',
          createdAt: { gte: carrito.contactableFrom ?? carrito.abandonedAt },
          conversation: { customerId: carrito.customerId },
        },
        select: { id: true },
      });
      if (respondio) {
        res.bloqueados++;
        res.detalle.push(`${carrito.externalId.slice(0, 8)}: la clienta ya contestó, la lleva una persona`);
        if (!dryRun) {
          await prisma.abandonedCart.update({
            where: { id: carrito.id }, data: { status: 'EN_CONVERSACION' },
          });
          await reportarEvento(carrito.externalId, 'respondio')
            .catch(e => console.error('[Carritos] no se pudo reportar respondio', carrito.externalId, e));
        }
        continue;
      }

      const pedido = await prisma.order.findFirst({
        where: {
          customerId: carrito.customerId,
          /**
           * Se mira desde ANTES del abandono, no desde el abandono.
           *
           * El checkout detecta el carrito 45 minutos después de la actividad,
           * así que el pedido que la clienta acababa de completar tiene fecha
           * ANTERIOR al «abandono» de su propio carrito: era la misma compra.
           * Con el corte en `abandonedAt` se le escribía igual. Tres horas
           * cubren ese desfase sin tragarse los carritos legítimos de una
           * clienta que ya había comprado otra vez hace días.
           */
          createdAt: { gte: new Date(carrito.abandonedAt.getTime() - 3 * 3_600_000) },
          status: { notIn: ['CANCELLED'] },
        },
        select: { id: true },
      });
      if (pedido) {
        res.bloqueados++;
        res.detalle.push(`${carrito.externalId.slice(0, 8)}: ya tiene pedido, no se le escribe`);
        if (!dryRun) {
          // Y de paso se le dice al checkout, que es lo que cierra el carrito
          // de su lado y suma a sus métricas de recuperación.
          await marcarRecuperado(carrito.externalId, pedido.id)
            .catch(e => console.error('[Carritos] no se pudo marcar recuperado', carrito.externalId, e));
        }
        continue;
      }
    }

    try {
      // Regla dura: revalidar en vivo. Pudo comprar durante la espera.
      const vivo = await obtenerCarrito(carrito.externalId);

      if (!vivo.debe_contactar) {
        res.bloqueados++;
        res.detalle.push(`${carrito.externalId.slice(0, 8)}: ${vivo.motivo_no_contactar ?? 'bloqueado'}`);
        if (!dryRun) {
          await prisma.abandonedCart.update({
            where: { id: carrito.id },
            data: { status: vivo.motivo_no_contactar === 'ya_compro' ? 'RECOVERED' : 'LOST' },
          });
        }
        continue;
      }
      if (vivo.mensajes_enviados >= PASOS.length) {
        res.bloqueados++;
        if (!dryRun) {
          await prisma.abandonedCart.update({
            where: { id: carrito.id }, data: { reminderCount: vivo.mensajes_enviados },
          });
        }
        continue;
      }

      const conDescuento = paso.conDescuento && Boolean(vivo.link_recuperacion_descuento);
      const link = conDescuento ? vivo.link_recuperacion_descuento! : vivo.link_recuperacion;
      const token = tokenDeLink(link);
      if (!token) throw new Error(`link de recuperación con formato inesperado: ${link}`);

      /**
       * Lo que ese link va a abrir, según el checkout. Es la pieza que faltaba.
       *
       * Se pide el bloque del link que se va a mandar —el de descuento en el
       * paso 3, el normal en los demás—, no «el del carrito»: son dos tokens
       * distintos y podrían no abrir lo mismo.
       */
      const restaura = conDescuento ? vivo.link_descuento_restaura : vivo.link_restaura;

      /**
       * Si el link no abre su carrito, no se manda nada.
       *
       * Es la regla que pidió el checkout al exponer `coincide`, y es la que
       * cierra el fallo que estuvo meses en producción: el mensaje nombraba un
       * combo y la clienta aterrizaba en un probiótico suelto de $110.000.
       * Vale para los tres pasos, no solo para el primero: el que nombra los
       * productos es el paso 1, pero el botón lo llevan todos.
       *
       * `restaura` puede no venir —un checkout más viejo, o la cola en vez del
       * detalle—: en ese caso no se bloquea, porque quedarse sin mandar por un
       * campo que no existe sería peor que el problema que evita.
       */
      if (restaura && (!restaura.disponible || !restaura.coincide)) {
        res.bloqueados++;
        const porQue = restaura.motivo ?? (restaura.disponible ? 'abre un carrito distinto' : 'no se puede abrir');
        res.detalle.push(`${carrito.externalId.slice(0, 8)}: el link no abre su carrito (${porQue})`);
        if (!dryRun && !restaura.disponible) {
          // No hay carrito que abrir: escribirle es mandarla a una página que no
          // es la suya. Se cierra en vez de reintentarlo cada pasada.
          await prisma.abandonedCart.update({ where: { id: carrito.id }, data: { status: 'LOST' } });
          await reportarEvento(carrito.externalId, 'descartado', `El link ya no abre el carrito (${porQue}).`)
            .catch(e => console.error('[Carritos] no se pudo reportar descartado', carrito.externalId, e));
        }
        if (restaura.disponible) {
          // Sí se puede abrir pero no es lo mismo que dice la API: es una
          // inconsistencia del checkout, no algo que el CRM pueda arreglar. Se
          // deja abierto y se avisa, que es lo que permite que alguien lo mire.
          console.error('[Carritos] el link no coincide con el carrito', carrito.externalId, porQue);
        }
        continue;
      }

      const nombre = vivo.nombre?.trim() || carrito.customer?.name?.split(/\s+/)[0] || 'Hola';

      /**
       * Los productos que la clienta va a ver al tocar el botón.
       *
       * Se nombran los de `restaura` y no los del carrito: son lo que el link
       * abre de verdad. Con `coincide` en true ya son los mismos —es justo lo
       * que ese campo garantiza—, pero leerlos de ahí deja el mensaje atado a la
       * página y no a una lista paralela.
       *
       * Este renglón estuvo meses diciendo «pedido Fem» a secas porque el link
       * no reconstruía el carrito y cualquier nombre era una promesa que la
       * página desmentía. El checkout lo arregló el 25/09/2026 (ver
       * `docs/checkout-link-recuperacion.md`) y con eso volvió a tener sentido
       * nombrarlos — todos, con su cantidad, no solo el primero.
       */
      const producto = fraseDeProductos(restaura?.productos ?? vivo.productos);

      if (dryRun) {
        res.enviados++;
        if (rezagadoActual) cupoRestantePorPaso.set(carrito.reminderCount, (cupoRestantePorPaso.get(carrito.reminderCount) ?? 1) - 1); else frescosEnviados++;
        // Se imprime también lo que dice la API del carrito, para poder verlo al
        // lado de lo que abrirá el link: es la comparación que importa.
        const enElCarrito = fraseDeProductos(vivo.productos);
        res.detalle.push(
          `SIMULADO paso ${paso.numero} · ${paso.plantilla} · ${vivo.telefono} · ` +
          `"${nombre}"${paso.numero === 1 ? ` / "${producto}"` : ''} · ` +
          `link abre: ${(restaura ? fraseDeProductos(restaura.productos) : 'sin dato').slice(0, 90)}` +
          `${restaura?.coincide === false ? ' · ¡NO COINCIDE!' : ''} · ` +
          `carrito: ${enElCarrito.slice(0, 90)} · ` +
          `token ${token.slice(0, 12)}…${paso.llevaImagen ? ' · con imagen' : ''}`,
        );
        continue;
      }

      const params = paso.numero === 1 ? [nombre, producto] : [nombre];

      /**
       * Por qué línea sale este mensaje.
       *
       * Los carritos pasan a la línea de recuperación (la general, la que
       * atiende Lina): quien abandona un carrito todavía no ha comprado, así
       * que su conversación es de venta y no de postcompra, y quien la contesta
       * tiene que ser quien lleva la venta.
       *
       * Pero solo las secuencias NUEVAS. Una secuencia ya empezada termina por
       * donde empezó: en el teléfono de la clienta los tres recordatorios son
       * un solo hilo, y cambiarle el número a mitad de camino le parte la
       * conversación en dos chats sin relación aparente. `phoneNumberId` guarda
       * la línea con la que arrancó y por eso existe.
       */
      const lineaDelCarrito = carrito.phoneNumberId || LINEA_CARRITOS;

      const envio = await sendWhatsAppTemplate(
        vivo.telefono,
        paso.plantilla,
        'es',
        params,
        {
          urlButtonParam: token,
          ...(paso.llevaImagen && { headerImageUrl: urlImagenTestimonio() }),
        },
        lineaDelCarrito,
      );

      // El mensaje queda en la conversación para que se vea en la bandeja.
      // Antes se mandaba «a ciegas»: la clienta recibía el WhatsApp pero en el
      // CRM no había ni rastro, así que cuando respondía, la agente veía una
      // contestación sin saber a qué.
      if (carrito.customerId) {
        await registrarPlantillaEnLinea(
          carrito.customerId, lineaDelCarrito, paso.plantilla, params, envio?.messages?.[0]?.id,
          // Con el token, para que en la bandeja quede el enlace de ESTE
          // carrito y no el molde con `{{1}}`: es lo que permite comprobar a
          // dónde llevó el mensaje cuando la clienta dice que no era su pedido.
          token,
        ).catch(e => console.error('[Carritos] no se pudo registrar en la bandeja', e));
      }

      // Reportar SIEMPRE, y antes de tocar nuestro contador: si esto falla,
      // el carrito no avanza y se reintenta, que es preferible a perder la
      // cuenta y escribirle de más a la clienta.
      await reportarEvento(carrito.externalId, 'mensaje_enviado');

      await prisma.abandonedCart.update({
        where: { id: carrito.id },
        data: {
          reminderCount: { increment: 1 },
          reminderSentAt: new Date(),
          // Se deja anotada la línea por la que salió, que fija la de los
          // recordatorios siguientes de ESTE carrito.
          phoneNumberId: lineaDelCarrito,
        },
      });

      await prisma.flowExecution.create({
        data: {
          flowTemplateId: flujo!.id,
          customerId: carrito.customerId!,
          cartId: carrito.id,
          currentStep: paso.numero,
          status: 'sent',
          completedAt: new Date(),
          metadata: { plantilla: paso.plantilla, paso: paso.numero } as any,
        },
      });

      if (rezagadoActual) cupoRestantePorPaso.set(carrito.reminderCount, (cupoRestantePorPaso.get(carrito.reminderCount) ?? 1) - 1); else frescosEnviados++;
      res.enviados++;
    } catch (e) {
      res.errores++;
      const msg = e instanceof Error ? e.message : String(e);
      res.detalle.push(`${carrito.externalId}: ${msg.slice(0, 140)}`);
      console.error('[Carritos] fallo enviando', carrito.externalId, e);
      if (e instanceof CheckoutNoConfigurado) break;
    }
  }

  res.topeAlcanzado = cupoAgotado;
  return res;
}

/** Marca un carrito como recuperado y se lo dice al checkout. */
export async function marcarRecuperado(externalId: string, orderId?: string) {
  await prisma.abandonedCart.updateMany({
    where: { externalId },
    data: { status: 'RECOVERED', ...(orderId && { recoveredOrderId: orderId }) },
  });
  await reportarEvento(externalId, 'recuperado').catch(e =>
    console.error('[Carritos] no se pudo reportar recuperado', externalId, e));
}
