/**
 * Crea en Meta la plantilla de la encuesta de suscripción y la sincroniza.
 *
 *   ./_run.sh npx tsx scripts/crear-plantilla-encuesta-suscripcion.ts
 *
 * Idempotente: si ya existe, no la vuelve a crear — solo sincroniza el estado.
 * La campaña no envía nada hasta que Meta la deje en APPROVED.
 */
import { PrismaClient } from '@prisma/client';
import { createMetaTemplate, CreateTemplateInput } from '../src/services/whatsapp';
import { sincronizarPlantillas } from '../src/services/plantillas-sync';

const prisma = new PrismaClient();

export const NOMBRE_PLANTILLA = 'encuesta_suscripcion';

/** La encuesta. Sin `usp=publish-editor`, que es un parámetro del editor. */
const ENCUESTA =
  'https://docs.google.com/forms/d/e/1FAIpQLScZe9x0Sj1d2fzKuZG-7ePg8nEM5HbJYJAn0rUDmg9iE2M-jw/viewform';

const plantilla: CreateTemplateInput = {
  name: NOMBRE_PLANTILLA,
  language: 'es',
  category: 'MARKETING',
  body:
    'Hola {{1}} 💗 Queremos seguir mejorando tu experiencia con FEM.\n\n' +
    'Completa esta encuesta corta sobre nuestra suscripción y cuéntanos qué te gustaría: ' +
    'al terminarla te damos un código con 10% de descuento ✨\n\n' +
    'Ese código lo escribes en el campo «Código de descuento» del checkout, ' +
    'al momento de pagar en nuestra página.\n\n' +
    'En FEM nos encanta conocerte, escuchar lo que prefieres y crear una experiencia cada vez mejor para ti 🌸',
  bodyExamples: ['María'],
  // Botón de URL fija: el enlace es el mismo para todas, así que no lleva
  // variable. El motor de campañas manda solo el nombre y ningún parámetro de
  // botón, que es justo lo que Meta espera de una URL estática.
  botones: [{ tipo: 'url', texto: 'Responder la encuesta', url: ENCUESTA }],
};

async function main() {
  const yaEsta = await prisma.messageTemplate.findFirst({
    where: { name: NOMBRE_PLANTILLA },
    select: { status: true },
  });

  if (yaEsta) {
    console.log(`La plantilla ya existe en el CRM (${yaEsta.status}). No se crea otra vez.`);
  } else {
    const r = await createMetaTemplate(plantilla);
    console.log(`Creada en Meta · id ${r.id} · estado ${r.status} · categoría ${r.category}`);
  }

  const n = await sincronizarPlantillas();
  const final = await prisma.messageTemplate.findFirst({
    where: { name: NOMBRE_PLANTILLA },
    select: { status: true, content: true, botones: true },
  });
  console.log(`Sincronizadas ${n} plantillas. «${NOMBRE_PLANTILLA}» está en ${final?.status}.`);
  if (final?.status !== 'APPROVED') {
    console.log('Cuando Meta la apruebe, la campaña arranca sola si ya está en «enviando».');
  }
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
