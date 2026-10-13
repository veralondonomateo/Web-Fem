/**
 * Arma la campaña de la encuesta de suscripción.
 *
 *   ./_run.sh npx tsx scripts/campana-encuesta-suscripcion.ts            # simula
 *   ./_run.sh npx tsx scripts/campana-encuesta-suscripcion.ts --crear    # la crea
 *   ./_run.sh npx tsx scripts/campana-encuesta-suscripcion.ts --arrancar # la pone a enviar
 *
 * A QUIÉN
 * A quien ya compró —al menos un pedido no cancelado—, con celular y sin baja
 * de marketing. No a toda la base: pedirle opinión sobre la suscripción a quien
 * nunca compró no da feedback útil y sí gasta la calificación del número.
 *
 * EN QUÉ ORDEN
 * Primero quien contesta. No es un capricho: una tanda que interactúa sube la
 * calificación y una que no la baja, así que abrir con las mejores protege al
 * resto de la campaña — y si algo va mal, lo que queda sin enviar es la parte
 * más fría, no la más valiosa.
 *
 * NO crea la plantilla ni arranca sola: eso se hace aparte y a propósito.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NOMBRE = 'Encuesta de suscripción · 10% por participar';
const PLANTILLA = 'encuesta_suscripcion';

/**
 * La línea general, nunca la de postcompra.
 *
 * Si Meta castiga el número de postcompra se cae la confirmación de pedidos y
 * el seguimiento de envíos de todo el negocio. Es el mismo número con el que
 * salió la campaña de Amor y Amistad (40.161 mensajes, 3 fallos, sigue GREEN).
 */
const LINEA = process.env.WHATSAPP_PHONE_NUMBER_ID;

/**
 * Ritmo: 1.800 por hora, de 8 a 20, hora de Colombia.
 *
 * Con ~26.700 destinatarias eso es unas 15 horas de envío: lo que quede de hoy
 * y la mañana de mañana. El tope diario se deja por encima del público porque
 * aquí el freno que manda es el de la hora, no el del día.
 *
 * Por qué a goteo y no de golpe: la campaña anterior mandó 40.000 en 2 h 40 y
 * el número aguantó, pero en una ráfaga el freno por rechazos de Meta no sirve
 * de nada —cuando avisa, ya salieron todos—. A 1.800/hora, si Meta empieza a
 * rechazar por saturación la campaña se pausa sola habiendo gastado una hora,
 * no la base entera.
 */
const POR_HORA = 1_800;
const TOPE_DIARIO = 30_000;
const HORA_INICIO = 8;
const HORA_FIN = 20;

/**
 * El público y su orden, en una sola consulta.
 *
 * Son ~26.700 filas: insertarlas una a una desde Node son 26.700 viajes a la
 * base. Va como INSERT ... SELECT para que el trabajo lo haga Postgres.
 *
 * La prioridad es por interacción real, en cuatro grupos:
 *   10 · escribió en los últimos 90 días
 *   20 · escribió alguna vez
 *   30 · compró en los últimos 90 días, pero nunca escribió
 *   40 · el resto
 * Y dentro de cada grupo, primero la compra más reciente.
 */
const SELECCION = /* sql */ `
  WITH publico AS (
    SELECT c.id,
           c.phone,
           c.name,
           MAX(o.created_at)                                     AS ultima_compra,
           MAX(m.created_at) FILTER (WHERE m.direction = 'INBOUND') AS ultimo_mensaje
      FROM customers c
      JOIN orders o        ON o.customer_id = c.id AND o.status <> 'CANCELLED'
 LEFT JOIN conversations cv ON cv.customer_id = c.id
 LEFT JOIN messages m       ON m.conversation_id = cv.id
     WHERE c.phone IS NOT NULL AND c.phone <> ''
       AND NOT EXISTS (SELECT 1 FROM bajas_marketing b WHERE b.customer_id = c.id)
     GROUP BY c.id, c.phone, c.name
  )
  SELECT gen_random_uuid()::text,
         $1::text,
         id,
         phone,
         name,
         'pendiente',
         CASE
           WHEN ultimo_mensaje >= now() - interval '90 days' THEN 10
           WHEN ultimo_mensaje IS NOT NULL                   THEN 20
           WHEN ultima_compra  >= now() - interval '90 days' THEN 30
           ELSE 40
         END
    FROM publico
`;

async function main() {
  const crear = process.argv.includes('--crear');
  const arrancar = process.argv.includes('--arrancar');

  if (!LINEA) {
    console.error('Falta WHATSAPP_PHONE_NUMBER_ID: sin línea no se sabe por dónde saldría.');
    process.exit(1);
  }

  const plantilla = await prisma.messageTemplate.findFirst({
    where: { name: PLANTILLA },
    select: { status: true },
  });
  if (!plantilla) {
    console.error(`La plantilla «${PLANTILLA}» no existe todavía. Créala primero:\n` +
      '  ./_run.sh npx tsx scripts/crear-plantilla-encuesta-suscripcion.ts');
    process.exit(1);
  }

  const existente = await prisma.campana.findFirst({ where: { plantilla: PLANTILLA } });

  if (arrancar) {
    if (!existente) { console.error('No hay campaña que arrancar.'); process.exit(1); }
    if (plantilla.status !== 'APPROVED') {
      console.error(`Meta todavía tiene la plantilla en ${plantilla.status}. Sin aprobar no sale nada.`);
      process.exit(1);
    }
    await prisma.campana.update({ where: { id: existente.id }, data: { estado: 'enviando' } });
    console.log(`«${existente.nombre}» pasa a enviando. El cron la empuja cada minuto.`);
    return;
  }

  if (existente) {
    const n = await prisma.campanaDestinatario.count({ where: { campanaId: existente.id } });
    console.log(`Ya existe «${existente.nombre}» (${existente.estado}) con ${n} destinatarias. No se toca.`);
    return;
  }

  // Cuántas serían, antes de escribir nada.
  const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM (${SELECCION.replace('$1::text', `'x'`)}) t`,
  );
  const total = Number(n);
  const horas = Math.ceil(total / POR_HORA);
  console.log(`Público: ${total.toLocaleString('es-CO')} clientas que ya compraron.`);
  console.log(`A ${POR_HORA}/hora en franja ${HORA_INICIO}–${HORA_FIN} son ~${horas} horas de envío.`);

  if (!crear) {
    console.log('\nSimulación. Para crearla de verdad: --crear');
    return;
  }

  const campana = await prisma.campana.create({
    data: {
      nombre: NOMBRE,
      plantilla: PLANTILLA,
      // Nace programada: no envía hasta que alguien la arranque a propósito.
      estado: 'programada',
      linea: LINEA,
      topeDiario: TOPE_DIARIO,
      topePorHora: POR_HORA,
      horaInicio: HORA_INICIO,
      horaFin: HORA_FIN,
      creadaPor: 'script campana-encuesta-suscripcion',
    },
  });

  const insertadas = await prisma.$executeRawUnsafe(
    `INSERT INTO campana_destinatarios
       (id, campana_id, customer_id, telefono, nombre, estado, prioridad)
     ${SELECCION}
     ON CONFLICT (campana_id, customer_id) DO NOTHING`,
    campana.id,
  );

  const porPrioridad = await prisma.campanaDestinatario.groupBy({
    by: ['prioridad'],
    where: { campanaId: campana.id },
    _count: { _all: true },
    orderBy: { prioridad: 'asc' },
  });

  console.log(`\nCampaña creada (${campana.id}) con ${insertadas} destinatarias:`);
  const ETIQUETA: Record<number, string> = {
    10: 'escribió en los últimos 90 días',
    20: 'escribió alguna vez',
    30: 'compró hace poco, nunca escribió',
    40: 'el resto',
  };
  for (const p of porPrioridad) {
    console.log(`  ${p.prioridad} · ${ETIQUETA[p.prioridad] ?? '—'}: ${p._count._all.toLocaleString('es-CO')}`);
  }
  console.log('\nQueda PROGRAMADA. Para que empiece a enviar: --arrancar');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
