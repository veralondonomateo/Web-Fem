import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { createServerClient } from "@/lib/supabase";
import { hidratar, COLUMNAS_COLA } from "@/lib/crm";
import {
  FilaCarrito,
  MADURACION_MIN,
  VENTANA_MAX_HORAS,
  TipoCarrito,
} from "@/lib/carritos";

/**
 * Detector de carritos abandonados. Corre cada 5 minutos.
 *
 * Tres pasos, en este orden a propósito:
 *
 *   1. Reconciliar — quien ya compró sale de la cola antes que nada, para que
 *      el paso 3 no alcance a mandarle un mensaje.
 *   2. Detectar — encola los carritos maduros de los dos segmentos, con toda
 *      la supresión aplicada en Postgres (ver `carritos_candidatos`).
 *   3. Entregar — si hay CRM_WEBHOOK_URL configurada, empuja los pendientes.
 *      Si no la hay, quedan esperando a que el CRM los recoja por GET; no se
 *      pierde nada en ninguno de los dos casos.
 *
 * Protegido con CRON_SECRET, igual que /api/cron/sync-orders.
 */

/** Cuántos carritos se empujan por corrida. Con 5 min de cadencia sobra. */
const MAX_POR_CORRIDA = 50;
/** Después de esto el carrito ya está frío: no se insiste más con el webhook. */
const MAX_INTENTOS = 5;
const TIMEOUT_MS = 10_000;

interface Candidato {
  tipo: TipoCarrito;
  origen_id: string;
  telefono: string;
  nombre: string | null;
}

export async function GET(req: NextRequest) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();

  // ── 1. Reconciliar ────────────────────────────────────────────────────────
  let recuperados = 0;
  const { data: nRecuperados, error: errorReconciliar } = await supabase.rpc(
    "crm_reconciliar_recuperados"
  );
  if (errorReconciliar) {
    console.error("[Carritos] Error reconciliando:", errorReconciliar);
  } else {
    recuperados = nRecuperados ?? 0;
  }

  // ── 2. Detectar ───────────────────────────────────────────────────────────
  const { data: candidatos, error: errorCandidatos } = await supabase.rpc(
    "carritos_candidatos",
    { p_maduracion_min: MADURACION_MIN, p_ventana_horas: VENTANA_MAX_HORAS }
  );

  if (errorCandidatos) {
    console.error("[Carritos] Error detectando candidatos:", errorCandidatos);
    return NextResponse.json({ error: "Error detectando carritos" }, { status: 500 });
  }

  const nuevos = (candidatos ?? []) as Candidato[];
  let encolados = 0;

  if (nuevos.length > 0) {
    // `ignoreDuplicates`: si dos corridas se solapan, la segunda no revive un
    // carrito que la primera ya encoló (y que el CRM quizás ya trabajó).
    const { data: insertados, error: errorInsert } = await supabase
      .from("crm_carritos")
      .upsert(
        nuevos.map((c) => ({
          tipo: c.tipo,
          origen_id: c.origen_id,
          telefono: c.telefono,
          nombre: c.nombre,
          estado: "pendiente",
        })),
        { onConflict: "tipo,origen_id", ignoreDuplicates: true }
      )
      .select("id");

    if (errorInsert) {
      console.error("[Carritos] Error encolando:", errorInsert);
    } else {
      encolados = insertados?.length ?? 0;
    }
  }

  // ── 3. Entregar al CRM ────────────────────────────────────────────────────
  const url = process.env.CRM_WEBHOOK_URL;
  if (!url) {
    return NextResponse.json({
      ok: true,
      recuperados,
      encolados,
      entregados: 0,
      modo: "pull",
    });
  }

  const { data: pendientes, error: errorPendientes } = await supabase
    .from("crm_carritos")
    .select(`${COLUMNAS_COLA}, intentos_entrega`)
    .eq("estado", "pendiente")
    .lt("intentos_entrega", MAX_INTENTOS)
    .order("detectado_at", { ascending: true })
    .limit(MAX_POR_CORRIDA);

  if (errorPendientes) {
    console.error("[Carritos] Error leyendo pendientes:", errorPendientes);
    return NextResponse.json({ ok: true, recuperados, encolados, entregados: 0 });
  }

  const filas = (pendientes ?? []) as unknown as (FilaCarrito & { intentos_entrega: number })[];
  const intentosPrevios = new Map(filas.map((f) => [f.id, f.intentos_entrega ?? 0]));
  const carritos = await hidratar(supabase, filas);

  let entregados = 0;
  let fallidos = 0;

  for (const carrito of carritos) {
    const cuerpo = JSON.stringify({ evento: "carrito_abandonado", carrito });
    const marcaTiempo = Math.floor(Date.now() / 1000).toString();

    try {
      const cabeceras: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Fem-Timestamp": marcaTiempo,
        // Idempotencia del lado del CRM: si una entrega se repite por un
        // reintento, el CRM puede descartarla por este id.
        "X-Fem-Evento-Id": carrito.id,
      };

      const firmaSecreta = process.env.CRM_WEBHOOK_SECRET;
      if (firmaSecreta) {
        cabeceras["X-Fem-Firma"] = `sha256=${createHmac("sha256", firmaSecreta)
          .update(`${marcaTiempo}.${cuerpo}`)
          .digest("hex")}`;
      }

      const res = await fetch(url, {
        method: "POST",
        headers: cabeceras,
        body: cuerpo,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      await supabase
        .from("crm_carritos")
        .update({
          estado: "entregado",
          entregado_at: new Date().toISOString(),
          ultimo_error: null,
        })
        .eq("id", carrito.id)
        .eq("estado", "pendiente");

      entregados++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fallidos++;
      console.error(`[Carritos] Falló la entrega de ${carrito.id}:`, msg);

      await supabase
        .from("crm_carritos")
        .update({
          intentos_entrega: (intentosPrevios.get(carrito.id) ?? 0) + 1,
          ultimo_error: msg.slice(0, 300),
        })
        .eq("id", carrito.id);
    }
  }

  return NextResponse.json({
    ok: true,
    recuperados,
    encolados,
    entregados,
    fallidos,
    modo: "push",
  });
}

export const dynamic = "force-dynamic";
export const maxDuration = 60;
