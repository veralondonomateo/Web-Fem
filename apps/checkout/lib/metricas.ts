/**
 * Métricas de ventas del dashboard del admin.
 *
 * Todo lo de este archivo es cálculo puro: no toca la red ni la base. La
 * consulta vive en `app/api/admin/metricas/route.ts`. Separarlos es lo que
 * permite verificar los números sin levantar el servidor.
 *
 * Tres decisiones que conviene tener presentes al leer cualquier cifra:
 *
 * 1. **Una venta es un pedido `approved`**: contraentrega confirmada en el
 *    checkout, o Mercado Pago con el pago aprobado. Los `pending` y `failure`
 *    de MP no son ventas y no entran en ningún total.
 *
 * 2. **Contraentrega aprobada no es plata cobrada.** El pedido está hecho y
 *    sale a despacho, pero la clienta todavía puede rechazarlo en la puerta.
 *    Por eso el dashboard habla de "facturación" y no de "ingresos": es lo
 *    vendido, no lo recaudado.
 *
 * 3. **El canal es real desde que se desplegó el ruteo, y proyectado antes.**
 *    Los pedidos con `sendura_order_id` salieron por Sendura de verdad. Los
 *    anteriores al ruteo fueron todos a Shopify, así que para esos se usa la
 *    cobertura de `cobertura-sendura.ts` — si no, las gráficas de meses
 *    pasados dirían que Sendura no existió. Ver `canalDePedido`.
 */

import { tieneCoberturaSendura } from "./cobertura-sendura";

/**
 * Colombia es UTC-5 fijo: no tiene horario de verano desde 1993. Se usa el
 * offset literal en vez de un cálculo con `Intl` porque el día del dashboard
 * tiene que empezar a medianoche en Bogotá aunque el servidor esté en iad1 y
 * el navegador en cualquier lado.
 */
export const OFFSET_COT = "-05:00";
export const ZONA_COT = "America/Bogota";

export type Canal = "sendura" | "shopify";

/** Lo mínimo que necesita el cálculo. La consulta no trae más columnas. */
export interface PedidoMetrica {
  created_at: string;
  total: number | null;
  payment_method: string | null;
  state: string | null;
  city: string | null;
  sendura_order_id?: string | null;
  shopify_order_id?: number | string | null;
}

/**
 * ¿Por dónde salió este pedido?
 *
 * Manda lo que quedó registrado en la fila. La cobertura solo se usa como
 * respaldo para el histórico anterior al ruteo, donde todo fue a Shopify y
 * mirar `shopify_order_id` diría "Shopify" para pedidos que hoy sí irían por
 * Sendura — y las gráficas de meses pasados se leerían como si Sendura no
 * hubiera existido nunca.
 */
export function canalDePedido(pedido: PedidoMetrica): Canal {
  if (pedido.sendura_order_id) return "sendura";
  return tieneCoberturaSendura(pedido.state ?? "", pedido.city ?? "")
    ? "sendura"
    : "shopify";
}

// ─────────────────────────────────────────────────────────────────────────────
// Fechas
// ─────────────────────────────────────────────────────────────────────────────

export type Preset =
  | "hoy"
  | "ayer"
  | "7dias"
  | "30dias"
  | "mes"
  | "mes_pasado"
  | "todo";

export const ETIQUETAS_PRESET: Record<Preset, string> = {
  hoy: "Hoy",
  ayer: "Ayer",
  "7dias": "Últimos 7 días",
  "30dias": "Últimos 30 días",
  mes: "Mes hasta hoy",
  mes_pasado: "Mes pasado",
  todo: "Todo",
};

/**
 * Los formateadores se construyen una sola vez.
 *
 * Crear un `Intl.DateTimeFormat` por pedido costaba caro de verdad: con 9.200
 * pedidos de un mes, la agregación pasaba de 60 ms a 654 ms solo por esto.
 * Se construyen al cargar el módulo y se reutilizan.
 */
const FMT_DIA = new Intl.DateTimeFormat("en-CA", {
  // en-CA da exactamente YYYY-MM-DD, que es lo que se necesita para comparar
  // y para armar los límites del rango.
  timeZone: ZONA_COT,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const FMT_HORA = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_COT,
  hour: "2-digit",
  hour12: false,
});

/** Fecha `YYYY-MM-DD` de un instante, leída en hora de Colombia. */
export function diaCOT(instante: Date | string): string {
  return FMT_DIA.format(typeof instante === "string" ? new Date(instante) : instante);
}

/** Hora del día (0-23) de un instante, leída en hora de Colombia. */
export function horaCOT(instante: Date | string): number {
  return Number(
    FMT_HORA.format(typeof instante === "string" ? new Date(instante) : instante)
  );
}

/** Suma días a una fecha `YYYY-MM-DD` sin salirse del calendario. */
export function sumarDias(dia: string, dias: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  const base = new Date(Date.UTC(a, m - 1, d));
  base.setUTCDate(base.getUTCDate() + dias);
  return base.toISOString().slice(0, 10);
}

/** Diferencia en días entre dos fechas `YYYY-MM-DD` (inclusive el primero). */
export function diasEntre(desde: string, hasta: string): number {
  const ms =
    Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

export interface Rango {
  /** Primer día incluido, `YYYY-MM-DD` en hora de Colombia. */
  desde: string;
  /** Último día incluido, `YYYY-MM-DD` en hora de Colombia. */
  hasta: string;
}

/**
 * Límites del rango como instantes UTC, listos para la consulta.
 *
 * `hasta` es el día final **incluido**, así que el corte superior es la
 * medianoche del día siguiente. Con `<` en vez de `<=` no se pierde ni se
 * duplica ningún pedido de las 23:59.
 */
export function limitesUTC(rango: Rango): { desdeUTC: string; hastaUTC: string } {
  return {
    desdeUTC: new Date(`${rango.desde}T00:00:00.000${OFFSET_COT}`).toISOString(),
    hastaUTC: new Date(
      `${sumarDias(rango.hasta, 1)}T00:00:00.000${OFFSET_COT}`
    ).toISOString(),
  };
}

/** Traduce un preset a fechas concretas, siempre en el calendario colombiano. */
export function rangoDePreset(preset: Preset, ahora: Date = new Date()): Rango {
  const hoy = diaCOT(ahora);
  const [a, m] = hoy.split("-").map(Number);
  const primeroDelMes = `${hoy.slice(0, 7)}-01`;

  switch (preset) {
    case "hoy":
      return { desde: hoy, hasta: hoy };
    case "ayer": {
      const ayer = sumarDias(hoy, -1);
      return { desde: ayer, hasta: ayer };
    }
    case "7dias":
      return { desde: sumarDias(hoy, -6), hasta: hoy };
    case "30dias":
      return { desde: sumarDias(hoy, -29), hasta: hoy };
    case "mes":
      return { desde: primeroDelMes, hasta: hoy };
    case "mes_pasado": {
      const finMesPasado = sumarDias(primeroDelMes, -1);
      const mesAnterior = m === 1 ? 12 : m - 1;
      const anioAnterior = m === 1 ? a - 1 : a;
      const inicio = `${anioAnterior}-${String(mesAnterior).padStart(2, "0")}-01`;
      return { desde: inicio, hasta: finMesPasado };
    }
    case "todo":
      // El checkout no tiene pedidos anteriores a 2026. Se ancla en una fecha
      // fija y no en "hace N días" para que "Todo" signifique lo mismo siempre.
      return { desde: "2026-01-01", hasta: hoy };
  }
}

/**
 * Rango inmediatamente anterior, del mismo largo. Es contra esto que se
 * comparan los KPI: 7 días contra los 7 anteriores, no contra la semana
 * calendario, para que la comparación no cambie de significado según el día.
 */
export function rangoAnterior(rango: Rango): Rango {
  const largo = diasEntre(rango.desde, rango.hasta);
  return {
    desde: sumarDias(rango.desde, -largo),
    hasta: sumarDias(rango.desde, -1),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agregación
// ─────────────────────────────────────────────────────────────────────────────

export type Granularidad = "hora" | "dia" | "semana";

/** Un rango de 1-2 días se lee mejor por hora; uno largo, por semana. */
export function granularidadPara(rango: Rango): Granularidad {
  const dias = diasEntre(rango.desde, rango.hasta);
  if (dias <= 2) return "hora";
  if (dias <= 92) return "dia";
  return "semana";
}

export interface Totales {
  ventas: number;
  facturacion: number;
  aov: number;
}

export interface PuntoSerie {
  /** Clave ordenable: `YYYY-MM-DD`, o `YYYY-MM-DDTHH` cuando es por hora. */
  clave: string;
  /** Texto corto para el eje. */
  etiqueta: string;
  sendura: Totales;
  shopify: Totales;
  total: Totales;
}

export interface FilaZona {
  state: string;
  city: string;
  canal: Canal;
  ventas: number;
  facturacion: number;
}

export interface Metricas {
  rango: Rango;
  granularidad: Granularidad;
  total: Totales;
  sendura: Totales;
  shopify: Totales;
  serie: PuntoSerie[];
  zonas: FilaZona[];
  /** Totales del rango anterior del mismo largo, para las variaciones. */
  anterior: { total: Totales; sendura: Totales; shopify: Totales } | null;
}

/** Pedido detenido a la espera de comprobar si Sendura creó la guía. */
export interface PedidoEnRevision {
  id: string;
  created_at: string;
  city: string | null;
  state: string | null;
  total: number | null;
  sendura_error: string | null;
}

function totalesVacios(): Totales {
  return { ventas: 0, facturacion: 0, aov: 0 };
}

function acumular(t: Totales, monto: number): void {
  t.ventas += 1;
  t.facturacion += monto;
}

function cerrar(t: Totales): Totales {
  t.aov = t.ventas > 0 ? t.facturacion / t.ventas : 0;
  return t;
}

/** Lunes de la semana a la que pertenece el día, en calendario colombiano. */
function lunesDe(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d));
  // getUTCDay: 0 domingo … 6 sábado. Se corre al lunes anterior.
  const desplazamiento = (fecha.getUTCDay() + 6) % 7;
  return sumarDias(dia, -desplazamiento);
}

const MESES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

function etiquetaDia(dia: string): string {
  const [, m, d] = dia.split("-").map(Number);
  return `${d} ${MESES[m - 1]}`;
}

/**
 * Arma el esqueleto de la serie con **todos** los periodos del rango, incluso
 * los que no tuvieron ventas. Sin esto un día en cero desaparecería del gráfico
 * y la caída se leería como si no hubiera pasado nada.
 */
function esqueleto(rango: Rango, granularidad: Granularidad): Map<string, PuntoSerie> {
  const puntos = new Map<string, PuntoSerie>();
  const nuevo = (clave: string, etiqueta: string) =>
    puntos.set(clave, {
      clave,
      etiqueta,
      sendura: totalesVacios(),
      shopify: totalesVacios(),
      total: totalesVacios(),
    });

  if (granularidad === "hora") {
    for (let dia = rango.desde; dia <= rango.hasta; dia = sumarDias(dia, 1)) {
      const variosDias = rango.desde !== rango.hasta;
      for (let h = 0; h < 24; h++) {
        const hh = String(h).padStart(2, "0");
        nuevo(`${dia}T${hh}`, variosDias ? `${etiquetaDia(dia)} ${hh}h` : `${hh}h`);
      }
    }
    return puntos;
  }

  if (granularidad === "semana") {
    let semana = lunesDe(rango.desde);
    const ultima = lunesDe(rango.hasta);
    while (semana <= ultima) {
      nuevo(semana, etiquetaDia(semana));
      semana = sumarDias(semana, 7);
    }
    return puntos;
  }

  for (let dia = rango.desde; dia <= rango.hasta; dia = sumarDias(dia, 1)) {
    nuevo(dia, etiquetaDia(dia));
  }
  return puntos;
}

function claveDe(pedido: PedidoMetrica, granularidad: Granularidad): string {
  const dia = diaCOT(pedido.created_at);
  if (granularidad === "hora") {
    return `${dia}T${String(horaCOT(pedido.created_at)).padStart(2, "0")}`;
  }
  if (granularidad === "semana") return lunesDe(dia);
  return dia;
}

/** Solo los totales, para el rango de comparación (no necesita serie ni zonas). */
export function totalesDe(pedidos: PedidoMetrica[]): {
  total: Totales;
  sendura: Totales;
  shopify: Totales;
} {
  const total = totalesVacios();
  const sendura = totalesVacios();
  const shopify = totalesVacios();

  for (const pedido of pedidos) {
    const monto = pedido.total ?? 0;
    acumular(total, monto);
    acumular(canalDePedido(pedido) === "sendura" ? sendura : shopify, monto);
  }

  return { total: cerrar(total), sendura: cerrar(sendura), shopify: cerrar(shopify) };
}

export function calcularMetricas(
  pedidos: PedidoMetrica[],
  rango: Rango,
  anteriores: PedidoMetrica[] | null = null
): Metricas {
  const granularidad = granularidadPara(rango);
  const puntos = esqueleto(rango, granularidad);
  const zonas = new Map<string, FilaZona>();

  const total = totalesVacios();
  const sendura = totalesVacios();
  const shopify = totalesVacios();

  for (const pedido of pedidos) {
    const monto = pedido.total ?? 0;
    const canal = canalDePedido(pedido);

    acumular(total, monto);
    acumular(canal === "sendura" ? sendura : shopify, monto);

    const punto = puntos.get(claveDe(pedido, granularidad));
    // Un pedido fuera del esqueleto solo puede venir de un desfase de rango.
    // Se ignora en la serie en vez de inventarle una barra al gráfico.
    if (punto) {
      acumular(punto.total, monto);
      acumular(canal === "sendura" ? punto.sendura : punto.shopify, monto);
    }

    const state = pedido.state?.trim() || "Sin departamento";
    const city = pedido.city?.trim() || "Sin ciudad";
    const llave = `${state}|${city}`;
    const fila =
      zonas.get(llave) ?? { state, city, canal, ventas: 0, facturacion: 0 };
    fila.ventas += 1;
    fila.facturacion += monto;
    zonas.set(llave, fila);
  }

  const serie = [...puntos.values()].sort((a, b) => a.clave.localeCompare(b.clave));
  for (const punto of serie) {
    cerrar(punto.total);
    cerrar(punto.sendura);
    cerrar(punto.shopify);
  }

  return {
    rango,
    granularidad,
    total: cerrar(total),
    sendura: cerrar(sendura),
    shopify: cerrar(shopify),
    serie,
    zonas: [...zonas.values()].sort((a, b) => b.facturacion - a.facturacion),
    anterior: anteriores ? totalesDe(anteriores) : null,
  };
}

/**
 * Variación porcentual contra el periodo anterior.
 *
 * Devuelve `null` cuando el periodo anterior fue cero: de 0 a 40 ventas no es
 * "+∞ %" ni "+100 %", es un dato sin base de comparación, y la interfaz lo
 * muestra como "—" en vez de un número que engaña.
 */
export function variacion(actual: number, previo: number): number | null {
  if (previo === 0) return null;
  return ((actual - previo) / previo) * 100;
}
