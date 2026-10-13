/**
 * Siembra los flujos del recorrido del pedido (paso 1 al 8) + el recordatorio
 * de confirmación. Idempotente: se puede correr las veces que haga falta.
 *
 *   ./_run.sh npx tsx scripts/seed-flows.ts
 *
 * Nacen APAGADOS a propósito: encenderlos manda WhatsApps reales a clientas
 * reales. Se activan desde /flows cuando el negocio lo decida.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FLOWS = [
  {
    trigger: 'ORDER_CREATED',
    name: 'Paso 1 · Por confirmar',
    description:
      'Al crearse el pedido envía pedido_por_confirmar con los botones Confirmar y Tengo dudas. ' +
      'Si no responde, a los 90 minutos entra el recordatorio.',
    steps: [{ type: 'template', template: 'pedido_por_confirmar', params: ['nombre', 'producto', 'direccion', 'ciudad'] }],
  },
  {
    trigger: 'ORDER_DISPATCHED',
    name: 'Paso 2 · Por alistar',
    description: 'Cuando Mastershop genera la guía envía pedido_despachado con el número y la transportadora.',
    steps: [{ type: 'template', template: 'pedido_despachado', params: ['guia', 'transportadora'] }],
  },
  {
    trigger: 'ORDER_IN_TRANSIT',
    name: 'Paso 3 · En tránsito',
    description: 'El pedido va rumbo a la ciudad de la clienta.',
    steps: [{ type: 'template', template: 'pedido_en_transito', params: ['nombre', 'guia', 'transportadora'] }],
  },
  {
    trigger: 'ORDER_OUT_FOR_DELIVERY',
    name: 'Paso 4 · En reparto',
    description: 'El transportador va camino a la dirección: le pedimos estar pendiente del teléfono.',
    steps: [{ type: 'template', template: 'pedido_en_reparto', params: ['nombre'] }],
  },
  {
    trigger: 'ORDER_AT_OFFICE',
    name: 'Paso 5 · Entrega en oficina',
    description: 'El pedido quedó en oficina de la transportadora para que lo reclamen con documento.',
    steps: [{ type: 'template', template: 'pedido_entrega_oficina', params: ['nombre', 'transportadora', 'guia'] }],
  },
  {
    trigger: 'ORDER_DELIVERED',
    name: 'Paso 6 · Entregado',
    description: 'Envía dos mensajes: la confirmación de entrega y, seguido, la guía de uso.',
    steps: [
      { type: 'template', template: 'pedido_entregado', params: ['nombre', 'producto'] },
      { type: 'template', template: 'guia_de_uso', params: [] },
    ],
  },
  {
    trigger: 'ORDER_NOVELTY',
    name: 'Paso 7 · Novedad',
    description: 'La entrega falló por una novedad: pedimos confirmar dirección o datos de contacto.',
    steps: [{ type: 'template', template: 'pedido_novedad', params: ['nombre'] }],
  },
  {
    trigger: 'ORDER_RETURNED',
    name: 'Paso 8 · Devolución',
    description: 'El pedido vuelve a bodega: preguntamos qué pasó para poder mejorar.',
    steps: [{ type: 'template', template: 'pedido_devolucion', params: ['nombre'] }],
  },
  {
    trigger: 'CONFIRMATION_REMINDER',
    name: 'Recordatorio de confirmación (90 min)',
    description:
      'Si no responde el paso 1, a los 90 minutos manda pedido_recordatorio_confirmacion. ' +
      'Si tampoco responde, 2 horas después etiqueta a la clienta como prioridad para atención humana.',
    steps: [
      { type: 'wait', minutes: 90 },
      { type: 'template', template: 'pedido_recordatorio_confirmacion', params: ['producto', 'direccion', 'ciudad'] },
      { type: 'wait', minutes: 120 },
      { type: 'tag', tag: 'prioridad' },
    ],
  },
] as const;

async function main() {
  for (const f of FLOWS) {
    const existing = await prisma.flowTemplate.findFirst({ where: { trigger: f.trigger as any } });

    if (existing) {
      await prisma.flowTemplate.update({
        where: { id: existing.id },
        // isActive no se toca: si el negocio ya lo encendió, se respeta.
        data: { name: f.name, description: f.description, steps: f.steps as any },
      });
      console.log(`actualizado  ${f.name}  (activo: ${existing.isActive})`);
    } else {
      await prisma.flowTemplate.create({
        data: {
          name: f.name,
          description: f.description,
          trigger: f.trigger as any,
          steps: f.steps as any,
          isActive: false,
        },
      });
      console.log(`creado       ${f.name}  (apagado)`);
    }
  }
  await prisma.$disconnect();
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
