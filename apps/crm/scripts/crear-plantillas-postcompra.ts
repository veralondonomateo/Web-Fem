/**
 * Crea en Meta las 22 plantillas del flujo de postcompra: 11 pasos ×
 * (probióticos y demás productos / FEM MOM). Idempotente — si una plantilla
 * con ese nombre ya existe, se salta.
 *
 *   ./_run.sh npx tsx scripts/crear-plantillas-postcompra.ts
 */
import { PrismaClient } from '@prisma/client';
import { createMetaTemplate, fetchMetaTemplates, CreateTemplateInput } from '../src/services/whatsapp';

const prisma = new PrismaClient();
const BASE = (process.env.NEXT_PUBLIC_APP_URL || 'https://fem-crm-gamma.vercel.app').replace(/\/$/, '');

// Los botones de las plantillas llevan la URL grabada dentro, y Meta la guarda
// tal cual: si se crean desde una máquina con NEXT_PUBLIC_APP_URL apuntando a
// localhost, la clienta recibe un botón que no lleva a ninguna parte. Pasó de
// verdad — cuatro plantillas salieron con http://localhost:3000 y hubo que
// editarlas una por una. Mejor no dejar que el script arranque siquiera.
if (/localhost|127\.0\.0\.1/.test(BASE)) {
  console.error(
    `NEXT_PUBLIC_APP_URL apunta a «${BASE}».\n` +
    'Los botones de las plantillas quedarían rotos para las clientas.\n' +
    'Corre el script con la URL pública, por ejemplo:\n' +
    '  NEXT_PUBLIC_APP_URL=https://fem-crm-gamma.vercel.app ./_run.sh npx tsx scripts/crear-plantillas-postcompra.ts',
  );
  process.exit(1);
}

const BOTONES_CONFIRMACION = [
  { tipo: 'respuesta_rapida' as const, texto: 'Sí, confirmo' },
  { tipo: 'respuesta_rapida' as const, texto: 'Tengo dudas' },
];

const plantillas: CreateTemplateInput[] = [
  // ── PROBIÓTICOS ────────────────────────────────────────────────────────
  {
    name: 'fem_confirmacion', language: 'es', category: 'UTILITY',
    body: '¡Hola, hermosa! 💕 Gracias por elegir FEM Probiotics.\n\n' +
      'Antes de preparar el envío de tus probióticos, queremos confirmar que tus datos estén correctos para evitar cualquier novedad con la entrega 📦✨\n\n' +
      'Nombre: {{1}}\nTeléfono: {{2}}\nDirección: {{3}}\n\n' +
      '¿Está todo correcto? Puedes responder o tocar un botón. 💗',
    bodyExamples: ['María Pérez', '3001234567', 'Calle 10 # 5-20, Bogotá'],
    botones: BOTONES_CONFIRMACION,
  },
  {
    name: 'fem_preparacion_envio', language: 'es', category: 'UTILITY',
    body: 'Hermosa, tu guía de transporte ya fue generada y el pedido se encuentra en proceso de envío 🚚📦\n\n' +
      'Transportadora: {{1}}\nNúmero de guía: {{2}}\n\n' +
      'La entrega está estimada entre 3 y 6 días hábiles. Ten presente que la guía puede tardar algunas horas en reflejar los primeros movimientos.\n\n' +
      'Estaremos muy atentas al proceso para que recibas tus probióticos sin inconvenientes 🌸\nCualquier duda, estamos aquí para ayudarte 💗',
    bodyExamples: ['Interrapidísimo', '123456789'],
  },
  {
    name: 'fem_en_transito', language: 'es', category: 'UTILITY',
    body: '¡Hermosa, tu pedido acaba de salir de nuestra bodega! 💕📦\n\n' +
      'Ya inició su recorrido hacia ti y muy pronto podrás comenzar tu proceso de bienestar íntimo ✨\n\n' +
      'Recuerda que estamos muy atentas para acompañarte y ayudarte con cualquier duda durante la entrega o cuando recibas tus productos. 🌸',
  },
  {
    name: 'fem_en_reparto', language: 'es', category: 'UTILITY',
    body: '¡Hermosaaa! 🌸 Tu pedido está por llegar y queremos que lo recibas con toda la magia FEM ✨📦\n\n' +
      'Recuerda que, si tienes cualquier duda sobre el producto o su consumo, estamos aquí para acompañarte y ayudarte en todo lo que necesites. 💗',
  },
  {
    name: 'fem_en_oficina', language: 'es', category: 'UTILITY',
    body: '¡Hermosaaa! 🌺 Tu pedido ya llegó a la oficina o punto de atención de la transportadora más cercano 📦✨\n\n' +
      'Recuerda acercarte a reclamarlo llevando tu documento de identidad y, si es posible, el número de guía. Así podrás recibirlo y comenzar a cuidar de ti con FEM 💕\n\n' +
      'En FEM trabajamos para acompañarte y hacer que tu pedido llegue de forma segura. Si tienes alguna duda, estamos aquí para ayudarte. 🌸\n\n' +
      'Transportadora: {{1}}\nNúmero de guía: {{2}} 💗',
    bodyExamples: ['Coordinadora', '123456789'],
  },
  {
    name: 'fem_entregado', language: 'es', category: 'UTILITY',
    body: '¡Hermosa, tu pedido ya está contigo! ✨\n\n' +
      'Esperamos que disfrutes muchísimo tus productos y que este sea el comienzo de una linda experiencia de cuidado y bienestar íntimo 💖\n\n' +
      'Cuando revises tu pedido, cuéntanos si todo llegó completo y en perfectas condiciones. Recuerda que estamos aquí para acompañarte y resolver cualquier duda que tengas 💌\n\n' +
      'Con amor, FEM 💕',
    botones: [{ tipo: 'url', texto: 'Ver guía de uso', url: `${BASE}/guia-cuidado-intimo.pdf` }],
  },
  {
    name: 'fem_acompanamiento_8d', language: 'es', category: 'MARKETING',
    body: 'Hermosa, ¿cómo vas con tus probióticos? 💕 Cuéntame si has notado algún cambio desde que comenzaste a tomarlos.\n\n' +
      'Algunas de nuestras clientas nos cuentan que empiezan a sentirse más frescas y cómodas durante su proceso ✨ Queremos saber cómo te has sentido tú y si tienes alguna duda en la que podamos acompañarte.',
  },
  {
    name: 'fem_valor_15d', language: 'es', category: 'MARKETING',
    body: '💖 ¡Hola, hermosaaa! ✨🍫\n\n' +
      '¿Sabías que consumir demasiados dulces puede influir en el equilibrio de tu flora íntima? 😱 Aunque amamos consentirnos con algo rico de vez en cuando, también es importante cuidar lo que comemos 💕\n\n' +
      'Por eso queremos regalarte un recetario súper girly, lleno de opciones deliciosas pensadas para chicas lindas y poderosas como tú 🌸👑\n\n' +
      'Así podrás disfrutar, cuidar tu bienestar íntimo y seguir brillando con todo tu glow ✨',
    botones: [{ tipo: 'url', texto: 'Ver recetario', url: `${BASE}/recetario-wellness.pdf` }],
  },
  {
    name: 'fem_feedback_25d', language: 'es', category: 'MARKETING',
    body: 'Hermosa, hagamos un pequeño check de tu proceso 💕\n\n' +
      'Durante estos días, ¿has logrado tomar tus dos probióticos diariamente? ✨\n\n' +
      '✅ Sí, todos los días\n🌸 La mayoría de los días\n🙈 Algunas veces se me olvida\n💬 No sé si los estoy tomando correctamente\n\n' +
      'Cuéntanos cuál opción eres y te compartimos una recomendación para ayudarte a continuar.',
  },
  {
    name: 'fem_postcompra_30d', language: 'es', category: 'MARKETING',
    body: 'Hermosaaaa 💕 Ya completaste tu primer mes con FEM y queremos acompañarte para que continúes con tu proceso sin interrupciones 🌸\n\n' +
      'La constancia es muy importante, ya que cada cuerpo avanza a su propio ritmo y el bienestar íntimo se construye poco a poco ✨\n\n' +
      'Por eso, tenemos para ti un bono de $25.000 de descuento para renovar tus probióticos 😱💗\n\n' +
      '⏰ Este beneficio estará disponible únicamente durante las próximas 24 horas.\n\n' +
      'Responde "QUIERO MI BONO" y te ayudamos a realizar tu nuevo pedido. 💕',
  },
  {
    name: 'fem_postcompra_32d', language: 'es', category: 'MARKETING',
    body: 'Hermosaaa 💕 Pasamos por aquí para recordarte que tu bono de $25.000 está a punto de finalizar ⏰\n\n' +
      'Queremos acompañarte para que no interrumpas tu proceso y puedas seguir construyendo tu rutina de bienestar íntimo con constancia 🌸\n\n' +
      'Todavía estás a tiempo de aprovecharlo. Responde "QUIERO RENOVAR" y te ayudamos a realizar tu pedido antes de que termine el beneficio ✨',
  },

  // ── FEM MOM ──────────────────────────────────────────────────────────────
  {
    name: 'fmom_confirmacion', language: 'es', category: 'UTILITY',
    body: '¡Hola, hermosa! 💕 Gracias por elegir FEM MOM.\n\n' +
      'Antes de preparar tu pedido, queremos confirmar que tus datos estén correctos para evitar cualquier novedad con la entrega 📦✨\n\n' +
      'Nombre: {{1}}\nDirección: {{2}}\nCiudad: {{3}}\nDepartamento: {{4}}\n\n' +
      '¿Está todo correcto? Puedes responder o tocar un botón. 💗',
    bodyExamples: ['María Pérez', 'Calle 10 # 5-20', 'Bogotá', 'Cundinamarca'],
    botones: BOTONES_CONFIRMACION,
  },
  {
    name: 'fmom_preparacion_envio', language: 'es', category: 'UTILITY',
    body: 'Hermosa, la guía de transporte de tu FEM MOM ya fue generada y tu pedido se encuentra en proceso de envío 🚚📦\n\n' +
      'Transportadora: {{1}}\nNúmero de guía: {{2}}\n\n' +
      'La entrega está estimada entre 3 y 6 días hábiles. Ten presente que la guía puede tardar algunas horas en reflejar sus primeros movimientos.\n\n' +
      'Estaremos muy atentas al proceso para que recibas tu pedido sin inconvenientes 🌸\nCualquier duda, estamos aquí para acompañarte 💗',
    bodyExamples: ['Interrapidísimo', '123456789'],
  },
  {
    name: 'fmom_en_transito', language: 'es', category: 'UTILITY',
    body: '¡Mamá, tu pedido acaba de salir de nuestra bodega! 💕📦\n\n' +
      'Tu FEM MOM ya inició su recorrido hacia ti y muy pronto podrá comenzar a acompañarte durante esta etapa tan especial ✨\n\n' +
      'Mientras tú cuidas y alimentas a tu bebé, queremos recordarte que tú también mereces sentirte cuidada y acompañada 🌸\n\n' +
      'Estamos muy atentas para ayudarte con cualquier duda durante la entrega o cuando recibas tu producto.',
  },
  {
    name: 'fmom_en_reparto', language: 'es', category: 'UTILITY',
    body: '¡Hermosaaa! 🌸 Tu FEM MOM está por llegar y queremos que lo recibas con toda la magia FEM ✨📦\n\n' +
      'Recuerda que puedes masticarlo o tomarlo con agua, siguiendo siempre la cantidad diaria recomendada.\n\n' +
      'Si tienes cualquier duda sobre el producto o su consumo, estamos aquí para acompañarte en todo lo que necesites 💗',
  },
  {
    name: 'fmom_en_oficina', language: 'es', category: 'UTILITY',
    body: '¡Hermosaaa! 🌺 Tu pedido ya llegó a la oficina o punto de atención de la transportadora más cercano 📦✨\n\n' +
      'Recuerda acercarte a reclamarlo llevando tu documento de identidad y, si es posible, el número de guía. Así podrás recibir tu FEM MOM y comenzar este proceso de acompañamiento durante la lactancia 💕\n\n' +
      'En FEM trabajamos para que tu pedido llegue de forma segura. Si tienes alguna duda, estamos aquí para ayudarte 🌸\n\n' +
      'Transportadora: {{1}}\nNúmero de guía: {{2}} 💗',
    bodyExamples: ['Coordinadora', '123456789'],
  },
  {
    name: 'fmom_entregado', language: 'es', category: 'UTILITY',
    body: '¡Mamá, tu pedido ya está contigo! ✨💕\n\n' +
      'Esperamos que disfrutes muchísimo tu FEM MOM y que este sea el comienzo de una linda experiencia de acompañamiento durante la lactancia 🌸👶🏼\n\n' +
      'Recuerda que FEM MOM contiene derivados de la leche. Si tú o tu bebé presentan alergia a la proteína de la leche de vaca o alguna intolerancia, te recomendamos consultar con tu médico antes de consumirlo.\n\n' +
      'Cuando revises tu pedido, cuéntanos si todo llegó completo y en perfectas condiciones. Estamos aquí para acompañarte y resolver cualquier duda que tengas 💌\n\n' +
      'Con amor, FEM 💕',
    botones: [{ tipo: 'url', texto: 'Ver guía de lactancia', url: `${BASE}/guia-lactancia-7-dias.pdf` }],
  },
  {
    name: 'fmom_acompanamiento_8d', language: 'es', category: 'MARKETING',
    body: 'Hermosa, ¿cómo vas con tu FEM MOM? 💕\n\n' +
      'Cuéntanos si has logrado consumirlo todos los días y cómo te has sentido desde que comenzaste a incluirlo en tu rutina.\n\n' +
      'Algunas mamás nos cuentan que poco a poco empiezan a sentirse más acompañadas durante su proceso, con mayor energía y bienestar ✨ Sin embargo, cada cuerpo y cada experiencia de lactancia son diferentes.\n\n' +
      'Queremos saber cómo vas tú y si tienes alguna duda en la que podamos ayudarte 🌸',
  },
  {
    name: 'fmom_valor_15d', language: 'es', category: 'MARKETING',
    body: '¡Hola, mamá hermosa! 🌸\n\n' +
      'Sabemos que la lactancia es una etapa llena de aprendizajes, emociones y muchos cambios. Por eso, queremos seguir acompañándote también en este proceso ✨\n\n' +
      'Preparamos para ti una guía especial de 7 días de lactancia, en la que encontrarás diferentes tips y recomendaciones para ayudarte a vivir esta etapa con más tranquilidad, confianza y amor 💕\n\n' +
      'Esperamos que la disfrutes muchísimo y recuerdes que no tienes que hacerlo todo sola. Estamos aquí para acompañarte y resolver cualquier duda que tengas 🌸👶🏼',
    botones: [{ tipo: 'url', texto: 'Ver guía de lactancia', url: `${BASE}/guia-lactancia-7-dias.pdf` }],
  },
  {
    name: 'fmom_feedback_25d', language: 'es', category: 'MARKETING',
    body: 'Hermosa, hagamos un pequeño check de tu proceso con FEM MOM 💕\n\n' +
      'Durante estos días, ¿has logrado consumir tus dos unidades diariamente? ✨\n\n' +
      '✅ Sí, todos los días\n🌸 La mayoría de los días\n🙈 Algunas veces se me olvida\n💬 No sé si lo estoy consumiendo correctamente\n\n' +
      'Cuéntanos cuál opción se parece más a ti y te compartiremos una recomendación para ayudarte a continuar.',
  },
  {
    name: 'fmom_postcompra_30d', language: 'es', category: 'MARKETING',
    body: '¡Mamá hermosaaaa! 💕 Ya completaste tu primer mes con FEM MOM y queremos acompañarte para que continúes tu proceso sin interrupciones 🌸\n\n' +
      'La constancia es muy importante, ya que cada cuerpo y cada proceso de lactancia avanzan a su propio ritmo ✨\n\n' +
      'Por eso, tenemos para ti un bono de $25.000 de descuento para renovar tu FEM MOM 😱💗\n\n' +
      '⏰ Este beneficio estará disponible únicamente durante las próximas 24 horas.\n\n' +
      'Responde "QUIERO MI BONO" y te ayudamos a realizar tu nuevo pedido 💕',
  },
  {
    name: 'fmom_postcompra_32d', language: 'es', category: 'MARKETING',
    body: 'Mamá hermosa 💕 Mientras tú cuidas y alimentas a tu bebé, recuerda que tú también mereces sentirte acompañada 🌸\n\n' +
      'Pasamos por aquí para contarte que tu bono de $25.000 de descuento está a punto de finalizar ⏰\n\n' +
      'Todavía estás a tiempo de aprovecharlo y continuar tu proceso con FEM MOM sin interrupciones.\n\n' +
      'Responde "QUIERO RENOVAR" y te ayudamos a realizar tu pedido antes de que termine el beneficio ✨',
  },
];

async function main() {
  const existentes = new Set((await fetchMetaTemplates())?.map(t => t.name) ?? []);
  console.log(`Plantillas ya existentes en Meta: ${existentes.size}\n`);

  for (const p of plantillas) {
    if (existentes.has(p.name)) {
      console.log(`○ ${p.name} — ya existe, se salta`);
      continue;
    }
    try {
      const r = await createMetaTemplate(p);
      console.log(`✔ ${p.name} — creada, id=${r.id}, estado=${r.status}, categoría=${r.category}`);
    } catch (e) {
      console.error(`✘ ${p.name} — FALLÓ: ${e instanceof Error ? e.message : e}`);
    }
    await new Promise(r => setTimeout(r, 600)); // no saturar el rate limit de creación
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
