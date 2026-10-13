/**
 * Campaña del aniversario de FEM (2 años): plantilla con imagen y envío a goteo.
 *
 *   ./_run.sh npx tsx scripts/campana-aniversario.ts               # simula
 *   ./_run.sh npx tsx scripts/campana-aniversario.ts --plantilla   # la crea en Meta
 *   ./_run.sh npx tsx scripts/campana-aniversario.ts --crear       # arma la campaña
 *   ./_run.sh npx tsx scripts/campana-aniversario.ts --arrancar    # la pone a enviar
 *
 * CUÁNDO
 * La promo va el miércoles 30 de septiembre y el jueves 1 de octubre de 2026.
 * Sale desde las 6:00 del miércoles y se corta el jueves a las 12:00 pase lo
 * que pase (`fin_at`): lo que no haya salido para entonces ya no sale.
 *
 * A QUIÉN
 * A toda la base con celular, no solo a quien compró: la idea es vender, y
 * quien nunca compró también puede comprar con descuento. Se excluye a quien
 * pidió la baja y a quien bloqueó el marketing de FEM desde WhatsApp (Meta ya
 * nos lo rechazó una vez: volver a intentarlo solo suma rechazos).
 *
 * EN QUÉ ORDEN
 *   10 · escribió en los últimos 90 días
 *   20 · escribió alguna vez
 *   30 · compró en los últimos 90 días, pero nunca escribió
 *   40 · compró alguna vez
 *   50 · el resto (nunca compró ni escribió)
 * Primero quien interactúa: sube la calificación del número y, si algo va mal,
 * lo que queda sin enviar es la parte más fría.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';
import { createMetaTemplate, subirEjemploPlantilla, CreateTemplateInput } from '../src/services/whatsapp';
import { sincronizarPlantillas } from '../src/services/plantillas-sync';

const prisma = new PrismaClient();

const NOMBRE = 'Aniversario FEM · 2 años';
const PLANTILLA = 'aniversario_fem_2026';
const IMAGEN = 'Lanzamiento-aniversario.jpg';
// Con parámetro: la CDN guardó un 404 de la URL sin él, de antes de desplegar la imagen.
const URL_IMAGEN = `https://fem-crm-gamma.vercel.app/${IMAGEN}?c=aniversario`;
const COLECCION = 'https://femprobiotics.co/collections/aniversario-fem';

/** La línea general, nunca la de postcompra: si Meta la castiga, se cae el seguimiento de pedidos. */
const LINEA = process.env.WHATSAPP_PHONE_NUMBER_ID;

/**
 * Ritmo: 2.600 por hora entre las 6 y las 21, hora de Colombia.
 *
 * Con ~48.800 destinatarias: 15 horas el miércoles (39.000) y el resto el
 * jueves desde las 6, terminando hacia las 10 — dos horas de margen antes del
 * corte. Es más lento que Amor y Amistad (40.000 en 2 h 40, el número siguió
 * GREEN) a propósito: a goteo, si Meta empieza a rechazar por saturación, la
 * campaña se pausa sola habiendo gastado una hora y no la base entera.
 */
const POR_HORA = 2_600;
const TOPE_DIARIO = 60_000;
const HORA_INICIO = 6;
const HORA_FIN = 21;
/** Jueves 1 de octubre de 2026, 12:00 en Colombia (UTC−5). */
const FIN = new Date('2026-10-01T17:00:00Z');

const TEXTO =
  'Amigaaa, FEM cumple 2 años y yo quería celebrarlo contigo con un descuento bien grandote 🥹🩷\n' +
  'Me metí a la página y dejé unos precios que… mejor entra y míralos tú misma 👀😂 ' +
  'Están perfectos para reponer tu FEM o probar ese producto que tienes pendiente.\n' +
  'Corre a aprovechar antes de que mi jefe me pregunte si se me fue la mano con los descuentos 🏃‍♀️🛍️\n' +
  'Y amiga… deséame que mañana todavía tenga trabajo :// 😂🩷';

const SELECCION = /* sql */ `
  WITH bloqueo AS (
    SELECT DISTINCT cv.customer_id
      FROM messages m
      JOIN conversations cv ON cv.id = m.conversation_id
     WHERE m.status = 'FAILED'
       AND m.error_motivo ILIKE '%chosen to stop receiving marketing%'
  ),
  publico AS (
    SELECT c.id, c.phone, c.name,
           EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status <> 'CANCELLED') AS compro,
           EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status <> 'CANCELLED'
                     AND o.created_at >= now() - interval '90 days')                              AS compro_90,
           (SELECT max(m.created_at) FROM conversations cv JOIN messages m ON m.conversation_id = cv.id
             WHERE cv.customer_id = c.id AND m.direction = 'INBOUND')                               AS ultimo_mensaje
      FROM customers c
     WHERE c.phone IS NOT NULL AND c.phone <> ''
       AND NOT EXISTS (SELECT 1 FROM bajas_marketing b WHERE b.customer_id = c.id)
       AND c.id NOT IN (SELECT customer_id FROM bloqueo)
  )
  SELECT gen_random_uuid()::text, $1::text, id, phone, name, 'pendiente',
         CASE
           WHEN ultimo_mensaje >= now() - interval '90 days' THEN 10
           WHEN ultimo_mensaje IS NOT NULL                   THEN 20
           WHEN compro_90                                    THEN 30
           WHEN compro                                       THEN 40
           ELSE 50
         END
    FROM publico
`;

async function crearPlantilla() {
  const yaEsta = await prisma.messageTemplate.findFirst({ where: { name: PLANTILLA }, select: { status: true } });
  if (yaEsta) {
    console.log(`La plantilla ya existe en el CRM (${yaEsta.status}). No se crea otra vez.`);
  } else {
    const imagen = readFileSync(join(__dirname, '..', 'public', IMAGEN));
    const handle = await subirEjemploPlantilla(imagen, 'image/jpeg');
    const plantilla: CreateTemplateInput = {
      name: PLANTILLA,
      language: 'es',
      category: 'MARKETING',
      body: TEXTO,
      headerImageHandle: handle,
      footer: 'Responde STOP si no quieres recibir promociones.',
      botones: [{ tipo: 'url', texto: 'Ver los descuentos', url: COLECCION }],
    };
    const r = await createMetaTemplate(plantilla);
    console.log(`Creada en Meta · id ${r.id} · estado ${r.status} · categoría ${r.category}`);
  }
  await sincronizarPlantillas();
  const final = await prisma.messageTemplate.findFirst({ where: { name: PLANTILLA }, select: { status: true } });
  console.log(`«${PLANTILLA}» está en ${final?.status}.`);
}

async function main() {
  if (!LINEA) {
    console.error('Falta WHATSAPP_PHONE_NUMBER_ID: sin línea no se sabe por dónde saldría.');
    process.exit(1);
  }

  if (process.argv.includes('--plantilla')) return crearPlantilla();

  const existente = await prisma.campana.findFirst({ where: { plantilla: PLANTILLA } });

  if (process.argv.includes('--arrancar')) {
    if (!existente) { console.error('No hay campaña que arrancar.'); process.exit(1); }
    await prisma.campana.update({ where: { id: existente.id }, data: { estado: 'enviando' } });
    console.log(`«${existente.nombre}» pasa a enviando. Sale en la franja ${HORA_INICIO}–${HORA_FIN} ` +
      'en cuanto Meta apruebe la plantilla; el cron la empuja cada minuto.');
    return;
  }

  if (existente) {
    const n = await prisma.campanaDestinatario.count({ where: { campanaId: existente.id } });
    console.log(`Ya existe «${existente.nombre}» (${existente.estado}) con ${n} destinatarias. No se toca.`);
    return;
  }

  const [{ n }] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM (${SELECCION.replace('$1::text', `'x'`)}) t`,
  );
  console.log(`Público: ${Number(n).toLocaleString('es-CO')} contactos.`);
  console.log(`A ${POR_HORA}/hora en franja ${HORA_INICIO}–${HORA_FIN}, con corte el ${FIN.toISOString()}.`);

  if (!process.argv.includes('--crear')) {
    console.log('\nSimulación. Para crearla de verdad: --crear');
    return;
  }

  const campana = await prisma.campana.create({
    data: {
      nombre: NOMBRE,
      plantilla: PLANTILLA,
      estado: 'programada',
      linea: LINEA,
      topeDiario: TOPE_DIARIO,
      topePorHora: POR_HORA,
      horaInicio: HORA_INICIO,
      horaFin: HORA_FIN,
      imagenUrl: URL_IMAGEN,
      finAt: FIN,
      creadaPor: 'script campana-aniversario',
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
  for (const p of porPrioridad) console.log(`  ${p.prioridad}: ${p._count._all.toLocaleString('es-CO')}`);
  console.log('\nQueda PROGRAMADA. Para que empiece a enviar: --arrancar');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
