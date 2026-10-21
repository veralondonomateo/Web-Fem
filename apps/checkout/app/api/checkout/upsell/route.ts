import {NextRequest, NextResponse} from 'next/server';
import {createServerClient} from '@/lib/supabase';
import {VARIANT_IDS} from '@/lib/catalog';
import {sendAlert} from '@/lib/alert';

export async function POST(req: NextRequest) {
  let orderId: unknown;
  try { orderId = (await req.json()).order_id; }
  catch { return NextResponse.json({error: 'Cuerpo inválido'}, {status: 400}); }
  if (typeof orderId !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(orderId)) {
    return NextResponse.json({error: 'Falta un order_id válido'}, {status: 400});
  }

  // The order lock, line, total and any stock adjustment share one transaction.
  // Concurrent clicks and finalize retries cannot add or reserve the soap twice.
  const {data, error} = await createServerClient().rpc('fem_add_cod_upsell', {
    p_order_id: orderId,
    p_variant_id: VARIANT_IDS.jabon,
    p_image: '/__theme/fem-owned-a7d6287f5bd4a2c3caa2.jpg',
  });
  if (error || !data) {
    console.error('[Upsell] No se pudo añadir el jabón:', error?.message);
    return NextResponse.json({error: 'No pudimos añadir el jabón. Tu pedido no ha cambiado.'}, {status: 409});
  }
  if (data.en_revision && !data.already) {
    sendAlert(`[Upsell] Orden ${orderId}: revisar el jabón añadido después de emitir la guía.`).catch(() => {});
  }
  return NextResponse.json(data);
}
