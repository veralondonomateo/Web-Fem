import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import {
  calcularMetricas,
  limitesUTC,
  rangoAnterior,
  totalesDe,
  type PedidoMetrica,
  type Rango,
} from "@/lib/metricas";

/**
 * Métricas de ventas para el dashboard del admin.
 *
 * La agregación se hace acá y no en Postgres por una razón concreta: el canal
 * (Sendura o Shopify) sale de la lista de cobertura de `cobertura-sendura.ts`,
 * y duplicar esa lista en SQL sería tener dos fuentes de verdad que se van a
 * desincronizar el día que Sendura abra un municipio nuevo. PostgREST además
 * tiene los agregados deshabilitados en este proyecto, así que tampoco había
 * atajo por ese lado.
 *
 * Lo que sí se cuida es el costo de traer las filas: PostgREST corta en 1.000
 * por respuesta, así que las páginas se piden en paralelo. Medido contra la
 * base real, 30 días (≈9.400 pedidos) bajan de 4,1 s secuenciales a ~0,7 s.
 */

/** Margen sobre el tiempo por defecto: el preset "Todo" es el caso pesado. */
export const maxDuration = 30;

/** Solo lo que usa el cálculo. Traer `select(*)` multiplicaría el peso por 6. */
const COLUMNAS = "created_at,total,payment_method,state,city,sendura_order_id";

/** Tope de PostgREST por respuesta. No es configurable desde el cliente. */
const FILAS_POR_PAGINA = 1000;

/**
 * Páginas simultáneas. Con 20 el preset "Todo" (52.000 pedidos, 53 páginas)
 * baja de 3,4 s a algo más de 1,5 s de descarga.
 */
const PAGINAS_EN_PARALELO = 20;

/**
 * Techo de filas por consulta.
 *
 * El límite real no es la memoria —52.000 filas ocupan 37 MB— sino el tiempo
 * de la función. Medido contra la base: 52.000 filas tardan ~1,9 s en llegar y
 * 0,3 s en agregarse, así que 120.000 caben de sobra en los 30 s declarados
 * arriba.
 *
 * El número importa: "Todo" ya va por 52.000 pedidos y crece ~300 al día. Con
 * el tope anterior de 60.000 el botón habría empezado a fallar en menos de un
 * mes. Al pasarse se devuelve un aviso explícito en vez de recortar en
 * silencio, que mostraría menos ventas de las reales sin que nadie se entere.
 */
const MAX_FILAS = 120_000;

/**
 * Caché en memoria del proceso. El dashboard refresca cada 30 s y varias
 * pestañas pueden mirar el mismo rango; esto evita repetir la consulta. Es
 * best-effort: cada instancia serverless tiene la suya y se pierde al
 * reciclarse.
 *
 * Dura más cuanto más largo es el rango. En "Hoy" el panel tiene que verse
 * vivo; en "Todo", que el último minuto falte no cambia nada y sí evita
 * arrastrar 52.000 filas cada vez que alguien vuelve a la pestaña.
 */
const cache = new Map<string, { expira: number; filas: PedidoMetrica[] }>();

function ttlCache(filas: number): number {
  return filas > 20_000 ? 120_000 : 15_000;
}

function rangoValido(valor: string | null): valor is string {
  return !!valor && /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

/** Cuenta los pedidos aprobados del rango sin traerlos. */
async function contar(
  supabase: ReturnType<typeof createServerClient>,
  desdeUTC: string,
  hastaUTC: string
): Promise<number> {
  const { count, error } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("payment_status", "approved")
    .gte("created_at", desdeUTC)
    .lt("created_at", hastaUTC);

  if (error) throw new Error(`conteo: ${error.message}`);
  return count ?? 0;
}

/** Trae los pedidos aprobados del rango, paginando en paralelo. */
async function traerPedidos(
  supabase: ReturnType<typeof createServerClient>,
  desdeUTC: string,
  hastaUTC: string,
  filasEsperadas: number
): Promise<PedidoMetrica[]> {
  const clave = `${desdeUTC}|${hastaUTC}`;
  const guardado = cache.get(clave);
  if (guardado && guardado.expira > Date.now()) return guardado.filas;

  const filas: PedidoMetrica[] = [];
  let inicio = 0;
  let seguir = true;

  // El conteo es una pista, no un contrato: entre contar y traer pueden entrar
  // pedidos nuevos, que se añaden al final por ir ordenados por fecha. Se sigue
  // pidiendo mientras el último lote venga lleno, en vez de cortar en el número
  // de páginas calculado y dejar fuera las ventas de los últimos segundos.
  while (seguir) {
    const restantes = Math.ceil(filasEsperadas / FILAS_POR_PAGINA) - inicio;
    const cuantas = Math.max(1, Math.min(PAGINAS_EN_PARALELO, restantes || 1));

    const lote = Array.from({ length: cuantas }, (_, i) => {
      const pagina = inicio + i;
      return supabase
        .from("orders")
        .select(COLUMNAS)
        .eq("payment_status", "approved")
        .gte("created_at", desdeUTC)
        .lt("created_at", hastaUTC)
        // El desempate por `id` es lo que hace estable la paginación por
        // desplazamiento: si dos pedidos comparten `created_at`, Postgres puede
        // ordenarlos distinto en cada página y una fila se colaría dos veces
        // mientras otra se pierde.
        .order("created_at")
        .order("id")
        .range(pagina * FILAS_POR_PAGINA, pagina * FILAS_POR_PAGINA + FILAS_POR_PAGINA - 1);
    });

    const respuestas = await Promise.all(lote);
    let ultimaLlena = false;
    for (const { data, error } of respuestas) {
      // Si una página falla, los totales quedarían por debajo de la realidad.
      // Es preferible fallar la petición entera que pintar cifras incompletas.
      if (error) throw new Error(`página: ${error.message}`);
      const pagina = (data ?? []) as PedidoMetrica[];
      filas.push(...pagina);
      ultimaLlena = pagina.length === FILAS_POR_PAGINA;
    }

    inicio += cuantas;
    seguir = ultimaLlena && filas.length < MAX_FILAS;
  }

  cache.set(clave, { expira: Date.now() + ttlCache(filas.length), filas });
  // La caché es de un solo rango por clave; sin esto crecería sin límite en
  // instancias de larga vida a medida que se prueban rangos manuales.
  if (cache.size > 40) {
    for (const [k, v] of cache) if (v.expira <= Date.now()) cache.delete(k);
  }
  return filas;
}

export async function GET(req: NextRequest) {
  const pw = req.headers.get("x-admin-password");
  if (!pw || pw !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const desde = params.get("desde");
  const hasta = params.get("hasta");

  if (!rangoValido(desde) || !rangoValido(hasta)) {
    return NextResponse.json(
      { error: "Faltan `desde` y `hasta` en formato YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (desde > hasta) {
    return NextResponse.json(
      { error: "La fecha inicial es posterior a la final" },
      { status: 400 }
    );
  }

  const rango: Rango = { desde, hasta };
  const comparar = params.get("comparar") !== "0";

  try {
    const supabase = createServerClient();
    const { desdeUTC, hastaUTC } = limitesUTC(rango);

    const filas = await contar(supabase, desdeUTC, hastaUTC);
    if (filas > MAX_FILAS) {
      return NextResponse.json(
        {
          error: `El rango tiene ${filas.toLocaleString("es-CO")} pedidos, más de los ${MAX_FILAS.toLocaleString("es-CO")} que se pueden procesar de una. Elige un rango más corto.`,
        },
        { status: 413 }
      );
    }

    const pedidos = await traerPedidos(supabase, desdeUTC, hastaUTC, filas);

    let anteriores: PedidoMetrica[] | null = null;
    if (comparar) {
      const previo = rangoAnterior(rango);
      const limitesPrevio = limitesUTC(previo);
      const filasPrevio = await contar(
        supabase,
        limitesPrevio.desdeUTC,
        limitesPrevio.hastaUTC
      );
      // La comparación es un extra: si el periodo anterior es enorme se omite
      // en vez de castigar el tiempo de respuesta del dato principal.
      if (filasPrevio <= MAX_FILAS) {
        anteriores = await traerPedidos(
          supabase,
          limitesPrevio.desdeUTC,
          limitesPrevio.hastaUTC,
          filasPrevio
        );
      }
    }

    const metricas = calcularMetricas(pedidos, rango, anteriores);

    // Pedidos detenidos porque Sendura no respondió y la guía puede existir.
    // No dependen del rango: si hay uno, hay que verlo siempre — este proyecto
    // no tiene alertas, así que el dashboard es el único sitio donde aparecen.
    // Sin filtrar por "no despachado": hay un caso marcado REVISAR que sí tiene
    // guía —el jabón del upsell añadido después de que el pedido saliera por
    // Sendura—. Ese también hay que verlo, así que manda la marca, no el estado.
    const { data: revision } = await supabase
      .from("orders")
      .select("id,created_at,city,state,total,sendura_error")
      .ilike("sendura_error", "REVISAR:%")
      .order("created_at", { ascending: false })
      .limit(50);

    return NextResponse.json(
      { ...metricas, enRevision: revision ?? [], generado: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Admin/Métricas] Error:", msg);
    return NextResponse.json(
      { error: "No se pudieron cargar las métricas" },
      { status: 500 }
    );
  }
}

// Sanity check en desarrollo: `totalesDe` y `calcularMetricas` tienen que dar
// lo mismo para el gran total. Si divergen, uno de los dos tiene un bug.
if (process.env.NODE_ENV === "development") {
  const muestra: PedidoMetrica[] = [
    { created_at: "2026-08-20T15:00:00Z", total: 100, payment_method: "contraentrega", state: "Antioquia", city: "Medellín" },
    { created_at: "2026-08-20T16:00:00Z", total: 200, payment_method: "contraentrega", state: "Huila", city: "Neiva" },
  ];
  const a = totalesDe(muestra).total;
  const b = calcularMetricas(muestra, { desde: "2026-08-20", hasta: "2026-08-20" }).total;
  if (a.facturacion !== b.facturacion || a.ventas !== b.ventas) {
    console.error("[Admin/Métricas] Los dos caminos de agregación no coinciden");
  }
}
