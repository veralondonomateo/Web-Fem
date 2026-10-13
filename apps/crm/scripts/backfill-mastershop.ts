/**
 * Carga el histórico de pedidos de Mastershop.
 *
 *   npm run backfill:mastershop            # 30 días
 *   npm run backfill:mastershop 180        # 180 días
 *
 * El cron horario (`/api/cron/sync`) solo mira los últimos 2 días, porque más
 * no cabe en los 300 s de una función de Vercel: esta cuenta mueve ~780 pedidos
 * al día y leerlos de Mastershop va a ~12 s por página de 50. Este script hace
 * lo mismo desde la terminal, donde no hay límite de tiempo, y avanza tramo a
 * tramo para poder cortarlo con Ctrl-C y retomarlo sin perder lo ya cargado.
 *
 * Es idempotente: releer un tramo ya cargado no duplica nada.
 */
import { runMastershopSync } from '@/services/mastershop-sync';

const TRAMO_DIAS = 7;
const DIA_MS = 86_400_000;

const totalDias = Number(process.argv[2] || 30);
if (!Number.isFinite(totalDias) || totalDias < 1) {
  console.error('Uso: npm run backfill:mastershop [días]');
  process.exit(1);
}
if (!process.env.MASTERSHOP_API_KEY) {
  console.error('Falta MASTERSHOP_API_KEY en el entorno.');
  process.exit(1);
}

const dia = (diasAtras: number) => new Date(Date.now() - diasAtras * DIA_MS).toISOString().slice(0, 10);
const reloj = (ms: number) => new Date(ms).toISOString().slice(11, 19);

async function main() {
  console.log(`\nCargando ${totalDias} días en tramos de ${TRAMO_DIAS}, del más reciente al más antiguo.\n`);
  const t0 = Date.now();
  let creados = 0, actualizados = 0, iguales = 0, descartados = 0;
  const fallidos: string[] = [];

  for (let desde = 0; desde < totalDias; desde += TRAMO_DIAS) {
    const hasta = Math.min(desde + TRAMO_DIAS, totalDias);
    // finalDate un día por delante: la API excluye el extremo y si no se
    // perderían los pedidos del propio día del corte.
    const filter = { startDate: dia(hasta), finalDate: dia(desde - 1) };
    const t = Date.now();

    const r = await runMastershopSync({ filter }).catch((e: Error) => {
      console.error(`  ${filter.startDate} → ${filter.finalDate}  FALLÓ: ${e.message}`);
      fallidos.push(`${filter.startDate}→${filter.finalDate}`);
      return null;
    });
    if (!r) continue;

    creados += r.created; actualizados += r.updated; iguales += r.unchanged; descartados += r.errors;

    console.log(
      `  ${filter.startDate} → ${filter.finalDate}  ` +
      `${String(r.total).padStart(6)} pedidos  ` +
      `+${String(r.created).padStart(5)} nuevos  ` +
      `~${String(r.updated).padStart(5)} actualizados  ` +
      `${reloj(Date.now() - t)}`,
    );
  }

  console.log(
    `\nListo en ${reloj(Date.now() - t0)}\n` +
    `  ${creados} nuevos · ${actualizados} actualizados · ${iguales} sin cambios · ${descartados} descartados (sin teléfono)`,
  );
  if (fallidos.length) {
    console.log(`\nTramos que no entraron — vuelve a correrlo para recogerlos:`);
    for (const f of fallidos) console.log(`  ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
