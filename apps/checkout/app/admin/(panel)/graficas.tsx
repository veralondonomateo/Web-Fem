"use client";

/**
 * Gráficas del dashboard de ventas, en SVG a mano.
 *
 * No se trajo una librería de charts a propósito: el proyecto tiene ocho
 * dependencias y las de gráficas pesan más que todo lo demás junto. Acá hacen
 * falta dos formas (barras apiladas y una línea), y ambas caben en unas
 * decenas de líneas de SVG que además se ven como el resto del admin y no como
 * una plantilla.
 *
 * El ancho se mide con ResizeObserver en vez de estirar el viewBox: escalar el
 * SVG deformaría el texto de los ejes.
 */

import { useEffect, useRef, useState } from "react";
import type { PuntoSerie } from "@/lib/metricas";

export const COLOR_SENDURA = "#fc5245";
export const COLOR_SHOPIFY = "#8a94a6";
const COLOR_LINEA = "#2f3a46";
const COLOR_EJE = "#e5e7eb";
const COLOR_TEXTO = "#9ca3af";

/** Ancho real del contenedor. Devuelve 0 hasta que hay medida. */
function useAncho<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [ancho, setAncho] = useState(0);

  useEffect(() => {
    const nodo = ref.current;
    if (!nodo) return;
    const observador = new ResizeObserver(([entrada]) => {
      setAncho(entrada.contentRect.width);
    });
    observador.observe(nodo);
    return () => observador.disconnect();
  }, []);

  return { ref, ancho };
}

/** Redondea el techo del eje a un número "bonito" para que las guías caigan en cifras legibles. */
function techo(max: number): number {
  if (max <= 0) return 1;
  const magnitud = 10 ** Math.floor(Math.log10(max));
  const escalado = max / magnitud;
  const paso = escalado <= 1 ? 1 : escalado <= 2 ? 2 : escalado <= 5 ? 5 : 10;
  return paso * magnitud;
}

function moneda(n: number): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Etiqueta corta para el eje: 1.200.000 → "1,2 M".
 *
 * Nunca redondea a entero un valor que no lo es: las guías caen en cuartos del
 * máximo, así que un techo de 50 M pone una línea en 37,5 M. Rotularla "38 M"
 * haría que la barra se leyera contra un número que no es el de la línea.
 */
function compacto(n: number, moneda: boolean): string {
  const signo = moneda ? "$" : "";
  const escribir = (v: number, sufijo: string) =>
    `${signo}${(Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)).replace(".", ",")} ${sufijo}`;

  if (n >= 1_000_000) return escribir(n / 1_000_000, "M");
  if (n >= 1_000) return escribir(n / 1_000, "k");
  return `${signo}${Math.round(n)}`;
}

/** Cuántas etiquetas caben en el eje X sin encimarse. */
function saltoEtiquetas(cantidad: number, ancho: number): number {
  const porEtiqueta = 52;
  return Math.max(1, Math.ceil(cantidad / Math.max(1, Math.floor(ancho / porEtiqueta))));
}

interface Tooltip {
  indice: number;
  x: number;
}

// ─────────────────────────────────────────────────────────────────────────────

export function BarrasApiladas({
  serie,
  metrica,
}: {
  serie: PuntoSerie[];
  metrica: "facturacion" | "ventas";
}) {
  const { ref, ancho } = useAncho<HTMLDivElement>();
  const [tip, setTip] = useState<Tooltip | null>(null);

  const alto = 260;
  const margen = { top: 12, derecha: 8, abajo: 26, izquierda: 56 };
  const anchoTrazo = Math.max(0, ancho - margen.izquierda - margen.derecha);
  const altoTrazo = alto - margen.top - margen.abajo;

  const valor = (p: PuntoSerie, canal: "sendura" | "shopify" | "total") =>
    p[canal][metrica];

  const maximo = techo(Math.max(...serie.map((p) => valor(p, "total")), 0));
  const y = (v: number) => margen.top + altoTrazo - (v / maximo) * altoTrazo;

  const paso = anchoTrazo / Math.max(1, serie.length);
  const anchoBarra = Math.max(1, Math.min(28, paso * 0.66));
  const salto = saltoEtiquetas(serie.length, anchoTrazo);
  const esMoneda = metrica === "facturacion";

  const activo = tip ? serie[tip.indice] : null;

  return (
    <div ref={ref} className="relative w-full">
      {ancho > 0 && (
        <svg width={ancho} height={alto} role="img" aria-label="Ventas por periodo">
          {/* Guías horizontales y eje Y */}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const v = maximo * f;
            return (
              <g key={f}>
                <line
                  x1={margen.izquierda}
                  x2={ancho - margen.derecha}
                  y1={y(v)}
                  y2={y(v)}
                  stroke={COLOR_EJE}
                  strokeWidth={1}
                />
                <text
                  x={margen.izquierda - 8}
                  y={y(v) + 3.5}
                  textAnchor="end"
                  fontSize={10}
                  fill={COLOR_TEXTO}
                >
                  {f === 0 ? (esMoneda ? "$0" : "0") : compacto(v, esMoneda)}
                </text>
              </g>
            );
          })}

          {serie.map((punto, i) => {
            const centro = margen.izquierda + paso * i + paso / 2;
            const x = centro - anchoBarra / 2;
            const vShopify = valor(punto, "shopify");
            const vSendura = valor(punto, "sendura");
            const altoShopify = (vShopify / maximo) * altoTrazo;
            const altoSendura = (vSendura / maximo) * altoTrazo;
            const baseSendura = margen.top + altoTrazo - altoSendura;

            return (
              <g key={punto.clave}>
                {/* Sendura abajo, Shopify encima: el canal nuevo queda apoyado
                    en el eje, que es donde el ojo compara con más precisión. */}
                <rect
                  x={x}
                  y={baseSendura}
                  width={anchoBarra}
                  height={Math.max(0, altoSendura)}
                  fill={COLOR_SENDURA}
                />
                <rect
                  x={x}
                  y={baseSendura - altoShopify}
                  width={anchoBarra}
                  height={Math.max(0, altoShopify)}
                  fill={COLOR_SHOPIFY}
                />
                {/* Zona de hover del ancho completo de la columna: acertarle a
                    una barra de 6 px con el mouse es imposible. */}
                <rect
                  x={margen.izquierda + paso * i}
                  y={margen.top}
                  width={paso}
                  height={altoTrazo}
                  fill="transparent"
                  onMouseEnter={() => setTip({ indice: i, x: centro })}
                  onMouseLeave={() => setTip(null)}
                />
                {i % salto === 0 && (
                  <text
                    x={centro}
                    y={alto - 8}
                    textAnchor="middle"
                    fontSize={10}
                    fill={COLOR_TEXTO}
                  >
                    {punto.etiqueta}
                  </text>
                )}
              </g>
            );
          })}

          {tip && (
            <line
              x1={tip.x}
              x2={tip.x}
              y1={margen.top}
              y2={margen.top + altoTrazo}
              stroke={COLOR_LINEA}
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.4}
            />
          )}
        </svg>
      )}

      {activo && tip && (
        <CajaTooltip x={tip.x} ancho={ancho}>
          <p className="font-semibold text-gray-900 mb-1.5">{activo.etiqueta}</p>
          <FilaTooltip color={COLOR_SENDURA} nombre="Sendura" valor={valor(activo, "sendura")} esMoneda={esMoneda} />
          <FilaTooltip color={COLOR_SHOPIFY} nombre="Shopify" valor={valor(activo, "shopify")} esMoneda={esMoneda} />
          <div className="mt-1.5 pt-1.5 border-t border-gray-100 flex justify-between gap-6">
            <span className="text-gray-500">Total</span>
            <span className="font-semibold text-gray-900">
              {esMoneda ? moneda(valor(activo, "total")) : valor(activo, "total").toLocaleString("es-CO")}
            </span>
          </div>
        </CajaTooltip>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function LineaTicket({ serie }: { serie: PuntoSerie[] }) {
  const { ref, ancho } = useAncho<HTMLDivElement>();
  const [tip, setTip] = useState<Tooltip | null>(null);

  const alto = 170;
  const margen = { top: 12, derecha: 8, abajo: 26, izquierda: 56 };
  const anchoTrazo = Math.max(0, ancho - margen.izquierda - margen.derecha);
  const altoTrazo = alto - margen.top - margen.abajo;

  const maximo = techo(Math.max(...serie.map((p) => p.total.aov), 0));
  const y = (v: number) => margen.top + altoTrazo - (v / maximo) * altoTrazo;
  const paso = anchoTrazo / Math.max(1, serie.length);
  const x = (i: number) => margen.izquierda + paso * i + paso / 2;
  const salto = saltoEtiquetas(serie.length, anchoTrazo);

  // Los periodos sin ventas tienen ticket 0, que no es "un ticket de $0" sino
  // ausencia de dato. Se corta la línea ahí en vez de hundirla hasta el eje.
  const tramos: PuntoSerie[][] = [];
  let actual: PuntoSerie[] = [];
  serie.forEach((punto) => {
    if (punto.total.ventas > 0) actual.push(punto);
    else if (actual.length) { tramos.push(actual); actual = []; }
  });
  if (actual.length) tramos.push(actual);

  const indiceDe = new Map(serie.map((p, i) => [p.clave, i]));
  const activo = tip ? serie[tip.indice] : null;

  return (
    <div ref={ref} className="relative w-full">
      {ancho > 0 && (
        <svg width={ancho} height={alto} role="img" aria-label="Ticket promedio por periodo">
          {[0, 0.5, 1].map((f) => {
            const v = maximo * f;
            return (
              <g key={f}>
                <line
                  x1={margen.izquierda}
                  x2={ancho - margen.derecha}
                  y1={y(v)}
                  y2={y(v)}
                  stroke={COLOR_EJE}
                  strokeWidth={1}
                />
                <text x={margen.izquierda - 8} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill={COLOR_TEXTO}>
                  {compacto(v, true)}
                </text>
              </g>
            );
          })}

          {tramos.map((tramo, t) => (
            <polyline
              key={t}
              fill="none"
              stroke={COLOR_LINEA}
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={tramo
                .map((p) => `${x(indiceDe.get(p.clave)!)},${y(p.total.aov)}`)
                .join(" ")}
            />
          ))}

          {serie.map((punto, i) => (
            <g key={punto.clave}>
              <rect
                x={margen.izquierda + paso * i}
                y={margen.top}
                width={paso}
                height={altoTrazo}
                fill="transparent"
                onMouseEnter={() => setTip({ indice: i, x: x(i) })}
                onMouseLeave={() => setTip(null)}
              />
              {i % salto === 0 && (
                <text x={x(i)} y={alto - 8} textAnchor="middle" fontSize={10} fill={COLOR_TEXTO}>
                  {punto.etiqueta}
                </text>
              )}
            </g>
          ))}

          {activo && activo.total.ventas > 0 && tip && (
            <circle cx={tip.x} cy={y(activo.total.aov)} r={3.5} fill={COLOR_LINEA} />
          )}
        </svg>
      )}

      {activo && tip && (
        <CajaTooltip x={tip.x} ancho={ancho}>
          <p className="font-semibold text-gray-900 mb-1">{activo.etiqueta}</p>
          <div className="flex justify-between gap-6">
            <span className="text-gray-500">Ticket promedio</span>
            <span className="font-semibold text-gray-900">
              {activo.total.ventas > 0 ? moneda(activo.total.aov) : "sin ventas"}
            </span>
          </div>
        </CajaTooltip>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function CajaTooltip({
  x,
  ancho,
  children,
}: {
  x: number;
  ancho: number;
  children: React.ReactNode;
}) {
  // Se ancla por el lado que no se sale del contenedor.
  const aLaDerecha = x < ancho / 2;
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg"
      style={aLaDerecha ? { left: x + 14 } : { right: ancho - x + 14 }}
    >
      {children}
    </div>
  );
}

function FilaTooltip({
  color,
  nombre,
  valor,
  esMoneda,
}: {
  color: string;
  nombre: string;
  valor: number;
  esMoneda: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-6">
      <span className="flex items-center gap-1.5 text-gray-500">
        <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
        {nombre}
      </span>
      <span className="tabular-nums text-gray-900">
        {esMoneda ? moneda(valor) : valor.toLocaleString("es-CO")}
      </span>
    </div>
  );
}
