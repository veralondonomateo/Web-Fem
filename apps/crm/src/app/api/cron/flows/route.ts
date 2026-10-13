import { NextRequest, NextResponse } from 'next/server';
import { processScheduled, rescatarGuiasPendientes } from '@/services/order-flow';
import { conCandado } from '@/lib/cron-lock';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

/**
 * Ejecuta los pasos del flujo que ya vencieron: el recordatorio de confirmación
 * a los 90 minutos y la escalada a una persona 2 horas después, más el envío
 * de carritos abandonados. Corre cada minuto (vercel.json) — antes cada 10,
 * pero con el volumen real ese cupo se quedaba corto y la cola de mensajes
 * de seguimiento crecía en vez de bajar.
 *
 * Con esa frecuencia una pasada larga podría alcanzar a la siguiente, así
 * que todo el trabajo va bajo un candado (`conCandado`): si la pasada
 * anterior sigue corriendo, esta se retira sin hacer nada en vez de mandar
 * el mismo mensaje dos veces.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const resultado = await conCandado('cron-flows', 90_000, async () => {
      const result = await processScheduled();
      // Pedidos con guía a los que Mastershop nunca les avisó el «por alistar».
      const guias = await rescatarGuiasPendientes();

      // Carritos abandonados: se lee la cola del checkout y se manda lo vencido.
      // Va aquí y no en su propio cron porque comparten el mismo candado y la
      // misma cadencia; un fallo del checkout no puede tumbar el resto de los
      // flujos, así que va aislado en su propio try.
      let carritos: unknown = null;
      try {
        const { ingerirCarritos, procesarEnviosPendientes } = await import('@/services/cart-recovery');
        const ingesta = await ingerirCarritos();
        const envios = await procesarEnviosPendientes();
        carritos = { ingesta, envios };
      } catch (e) {
        console.error('[cron/flows] carritos', e);
        carritos = { error: e instanceof Error ? e.message : String(e) };
      }

      // Encuestas de satisfacción: programar lo que se cerró y mandar lo
      // vencido. Aislado igual que los carritos — que la encuesta falle no
      // puede costar el envío de un seguimiento de pedido.
      let encuestas: unknown = null;
      try {
        const { procesarEncuestas } = await import('@/services/encuestas');
        encuestas = await procesarEncuestas();
      } catch (e) {
        console.error('[cron/flows] encuestas', e);
        encuestas = { error: e instanceof Error ? e.message : String(e) };
      }

      // Aviso de Sendura: que la clienta sepa quién la va a llamar antes de
      // que suene el teléfono. Aislado como los demás.
      let sendura: unknown = null;
      try {
        const { procesarAvisosSendura } = await import('@/services/aviso-sendura');
        sendura = await procesarAvisosSendura();
      } catch (e) {
        console.error('[cron/flows] sendura', e);
        sendura = { error: e instanceof Error ? e.message : String(e) };
      }

      // Campañas de marketing. Va la ÚLTIMA y aislada: si algo tiene que
      // quedarse sin cupo en una pasada apretada, que sea la promo y nunca la
      // confirmación de un pedido.
      let campanas: unknown = null;
      try {
        const { procesarCampanas } = await import('@/services/campanas');
        campanas = await procesarCampanas();
      } catch (e) {
        console.error('[cron/flows] campanas', e);
        campanas = { error: e instanceof Error ? e.message : String(e) };
      }

      return { ok: true, ...result, guiasRescatadas: guias, carritos, encuestas, sendura, campanas };
    });

    if ('omitido' in resultado) {
      return NextResponse.json({ ok: true, omitido: 'pasada anterior aún en curso' });
    }
    return NextResponse.json(resultado);
  } catch (err: any) {
    console.error('[cron/flows]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
