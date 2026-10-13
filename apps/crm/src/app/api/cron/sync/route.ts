import { NextRequest, NextResponse } from 'next/server';
import { runMastershopSync } from '@/services/mastershop-sync';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// Ejecutado por el cron de Vercel (vercel.json). Los webhooks de Mastershop
// actualizan en tiempo real; este cron reconcilia cualquier evento perdido.
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  if (!process.env.MASTERSHOP_API_KEY) {
    return NextResponse.json({ error: 'MASTERSHOP_API_KEY no configurado' }, { status: 500 });
  }

  // 1 día, no 30. Con ~780 pedidos diarios, leer un mes de Mastershop son unas
  // 470 páginas a ~12 s cada una: ni de lejos cabe en los 300 s de la función.
  //
  // Y no hace falta. Los webhooks son el tiempo real; esto es solo la red de
  // seguridad, y corre cada hora. Por cómo se arma el rango (finalDate va un día
  // por delante), `days=1` ya cubre unas 48 h: veinticuatro pasadas de solape
  // sobre cualquier evento perdido.
  //
  // Medido en producción: days=2 son ~2.030 pedidos y 160 s de los 300
  // disponibles. Se deja en 1 (~120 s) para que el margen aguante si el volumen
  // de la cuenta crece. Para cargar el histórico está
  // `npm run backfill:mastershop`, que corre en la terminal sin límite de tiempo.
  const days = parseInt(new URL(req.url).searchParams.get('days') || '1');

  // El estado de las plantillas se refresca aquí porque el motor de flujos lo
  // consulta antes de enviar: si Meta aprueba una y el CRM no se entera, los
  // pedidos se quedarían esperando por algo que ya está listo. Va aislado — un
  // fallo de Meta no puede tumbar la reconciliación de pedidos.
  let plantillas: unknown = null;
  try {
    const { sincronizarPlantillas } = await import('@/services/plantillas-sync');
    plantillas = { sincronizadas: await sincronizarPlantillas() };
  } catch (e) {
    console.error('[cron/sync] plantillas', e);
    plantillas = { error: e instanceof Error ? e.message : String(e) };
  }

  try {
    const result = await runMastershopSync({ days });
    return NextResponse.json({ ...result, plantillas });
  } catch (err: any) {
    console.error('[cron/sync]', err);
    return NextResponse.json({ error: err.message, plantillas }, { status: 502 });
  }
}
