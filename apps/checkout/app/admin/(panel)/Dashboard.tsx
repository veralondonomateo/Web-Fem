"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ETIQUETAS_PRESET,
  diaCOT,
  diasEntre,
  rangoAnterior,
  rangoDePreset,
  variacion,
  type Metricas,
  type PedidoEnRevision,
  type Preset,
  type Rango,
  type Totales,
} from "@/lib/metricas";
import { BarrasApiladas, LineaTicket, COLOR_SENDURA, COLOR_SHOPIFY } from "./graficas";
import { useAdminPassword } from "./AdminShell";

const REFRESCO_MS = 30_000;

const PRESETS: Preset[] = ["hoy", "ayer", "7dias", "30dias", "mes", "mes_pasado", "todo"];

function moneda(n: number, compacta = false): string {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
    notation: compacta ? "compact" : "standard",
  }).format(n);
}

const numero = (n: number) => n.toLocaleString("es-CO");
const porcentaje = (n: number) => `${n.toFixed(n < 10 ? 1 : 0).replace(".", ",")} %`;

export default function Dashboard() {
  const clave = useAdminPassword();

  const [preset, setPreset] = useState<Preset | null>("7dias");
  const [rango, setRango] = useState<Rango>(() => rangoDePreset("7dias"));
  const [datos, setDatos] = useState<(Metricas & { enRevision?: PedidoEnRevision[] }) | null>(null);
  const [metrica, setMetrica] = useState<"facturacion" | "ventas">("facturacion");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [ultima, setUltima] = useState<number | null>(null);

  // Descarta respuestas que ya quedaron viejas: al cambiar de rango rápido, la
  // petición lenta podía llegar después y pintar datos de otro periodo.
  const peticion = useRef(0);

  const cargar = useCallback(
    async (silencioso = false) => {
      const id = ++peticion.current;
      if (!silencioso) setCargando(true);
      try {
        const res = await fetch(
          `/api/admin/metricas?desde=${rango.desde}&hasta=${rango.hasta}`,
          { headers: { "x-admin-password": clave } }
        );
        if (id !== peticion.current) return;
        if (!res.ok) {
          const cuerpo = await res.json().catch(() => ({}));
          setError(cuerpo.error ?? "No se pudieron cargar las métricas");
          return;
        }
        setDatos(await res.json());
        setError("");
        setUltima(Date.now());
      } catch {
        if (id === peticion.current) setError("Error de conexión");
      } finally {
        if (id === peticion.current) setCargando(false);
      }
    },
    [clave, rango]
  );

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Refresco automático. Se pausa con la pestaña oculta —no tiene sentido
  // consultar la base para nadie— y se dispara al volver a ella.
  useEffect(() => {
    const tick = () => {
      if (!document.hidden) cargar(true);
    };
    const intervalo = setInterval(tick, REFRESCO_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [cargar]);

  const aplicarPreset = (p: Preset) => {
    setPreset(p);
    setRango(rangoDePreset(p));
  };

  const cambiarFecha = (campo: "desde" | "hasta", valor: string) => {
    if (!valor) return;
    setPreset(null);
    setRango((r) => {
      const siguiente = { ...r, [campo]: valor };
      // Si se invierte el orden se colapsa al día elegido, que es lo que
      // espera quien está armando el rango de izquierda a derecha.
      if (siguiente.desde > siguiente.hasta) return { desde: valor, hasta: valor };
      return siguiente;
    });
  };

  const hoy = diaCOT(new Date());
  const dias = diasEntre(rango.desde, rango.hasta);
  const previo = rangoAnterior(rango);
  // El día de hoy va a medias: compararlo contra un periodo cerrado siempre
  // pinta una caída que no existe. Se avisa en vez de esconderlo.
  const incluyeHoy = rango.hasta === hoy;

  return (
    <main className="px-4 sm:px-6 py-6 space-y-4 max-w-6xl">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-bold text-gray-900">Dashboard</h1>
        <Reloj ultima={ultima} cargando={cargando} onRefrescar={() => cargar()} />
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-lg border border-gray-200 p-3 flex flex-wrap items-center gap-x-2 gap-y-2">
        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => aplicarPreset(p)}
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                preset === p ? "bg-[#fc5245] text-white" : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {ETIQUETAS_PRESET[p]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <input
            type="date"
            value={rango.desde}
            max={hoy}
            onChange={(e) => cambiarFecha("desde", e.target.value)}
            className="px-2 py-1.5 rounded-md border border-gray-300 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#fc5245] focus:border-[#fc5245]"
          />
          <span className="text-xs text-gray-400">a</span>
          <input
            type="date"
            value={rango.hasta}
            max={hoy}
            onChange={(e) => cambiarFecha("hasta", e.target.value)}
            className="px-2 py-1.5 rounded-md border border-gray-300 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#fc5245] focus:border-[#fc5245]"
          />
        </div>
      </div>

      {error && (
        <div className="bg-white rounded-lg border border-red-200 p-4">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {!datos && cargando && <Esqueleto />}

      {datos && (
        <>
          <p className="text-xs text-gray-400">
            {dias === 1
              ? `${rango.desde} · hora de Colombia`
              : `${rango.desde} a ${rango.hasta} · ${dias} días · hora de Colombia`}
            {datos.anterior && (
              <span className="text-gray-300">
                {" "}
                — comparado con {previo.desde} a {previo.hasta}
              </span>
            )}
          </p>

          {incluyeHoy && datos.anterior && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
              El rango llega hasta hoy, que todavía va en curso. La comparación es
              contra un periodo ya cerrado, así que las variaciones se ven más bajas
              de lo que van a terminar siendo.
            </p>
          )}

          {datos.enRevision && datos.enRevision.length > 0 && (
            <AvisoRevision pedidos={datos.enRevision} />
          )}

          {/* KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi
              titulo="Pedidos"
              valor={numero(datos.total.ventas)}
              delta={datos.anterior ? variacion(datos.total.ventas, datos.anterior.total.ventas) : null}
            />
            <Kpi
              titulo="Facturación"
              valor={moneda(datos.total.facturacion)}
              delta={datos.anterior ? variacion(datos.total.facturacion, datos.anterior.total.facturacion) : null}
            />
            <Kpi
              titulo="Ticket promedio"
              valor={moneda(datos.total.aov)}
              delta={datos.anterior ? variacion(datos.total.aov, datos.anterior.total.aov) : null}
            />
            <Kpi
              titulo="Promedio diario"
              valor={moneda(datos.total.facturacion / dias)}
              nota={`${(datos.total.ventas / dias).toFixed(1).replace(".", ",")} pedidos/día`}
            />
          </div>

          {/* Canales */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <h2 className="text-sm font-semibold text-gray-900">Reparto por operador</h2>
              <span className="text-[11px] text-gray-400 text-right">
                Real donde quedó registrado; antes del ruteo, según cobertura
              </span>
            </div>

            <BarraReparto sendura={datos.sendura} shopify={datos.shopify} />

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
              <TarjetaCanal nombre="Sendura" color={COLOR_SENDURA} totales={datos.sendura} totalGeneral={datos.total} anterior={datos.anterior?.sendura} />
              <TarjetaCanal nombre="Shopify" color={COLOR_SHOPIFY} totales={datos.shopify} totalGeneral={datos.total} anterior={datos.anterior?.shopify} />
              <TarjetaCanal nombre="Total" color="#2f3a46" totales={datos.total} totalGeneral={datos.total} anterior={datos.anterior?.total} esTotal />
            </div>
          </div>

          {/* Gráfica principal */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  {metrica === "facturacion" ? "Facturación" : "Pedidos"} por{" "}
                  {datos.granularidad === "hora" ? "hora" : datos.granularidad === "semana" ? "semana" : "día"}
                </h2>
                <div className="flex items-center gap-3 mt-1">
                  <Leyenda color={COLOR_SENDURA} texto="Sendura" />
                  <Leyenda color={COLOR_SHOPIFY} texto="Shopify" />
                </div>
              </div>
              <div className="flex rounded-md border border-gray-200 overflow-hidden">
                {(["facturacion", "ventas"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMetrica(m)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      metrica === m ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {m === "facturacion" ? "Facturación" : "Pedidos"}
                  </button>
                ))}
              </div>
            </div>
            <BarrasApiladas serie={datos.serie} metrica={metrica} />
          </div>

          {/* Ticket promedio */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">Ticket promedio</h2>
            <p className="text-[11px] text-gray-400 mb-3">
              Los periodos sin ventas quedan como corte en la línea, no como cero.
            </p>
            <LineaTicket serie={datos.serie} />
          </div>

          <TablaZonas zonas={datos.zonas} totalFacturacion={datos.total.facturacion} />

          <p className="text-[11px] text-gray-400 leading-relaxed pb-6">
            Una venta es un pedido aprobado: contraentrega confirmada en el checkout o
            Mercado Pago con el pago acreditado. Los pagos pendientes o fallidos de
            Mercado Pago no entran en ninguna cifra. La contraentrega aprobada todavía
            puede rechazarse en la puerta, así que esto es lo vendido, no lo recaudado.
          </p>
        </>
      )}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Reloj({
  ultima,
  cargando,
  onRefrescar,
}: {
  ultima: number | null;
  cargando: boolean;
  onRefrescar: () => void;
}) {
  const [, forzar] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forzar((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const segundos = ultima ? Math.floor((Date.now() - ultima) / 1000) : null;
  const texto = cargando
    ? "actualizando…"
    : segundos === null
      ? ""
      : segundos < 5
        ? "al día"
        : segundos < 60
          ? `hace ${segundos} s`
          : `hace ${Math.floor(segundos / 60)} min`;

  return (
    <button
      onClick={onRefrescar}
      title="Actualizar ahora"
      className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cargando ? "bg-amber-400" : "bg-green-500"}`} />
      {texto}
    </button>
  );
}

/**
 * Pedidos detenidos porque Sendura no respondió y su guía puede existir. No
 * se despacharon por ningún lado a propósito: hay que mirar el panel de
 * Sendura antes de decidir. Va arriba del todo y en rojo porque no hay
 * alertas configuradas y este es el único sitio donde aparecen.
 */
function AvisoRevision({ pedidos }: { pedidos: PedidoEnRevision[] }) {
  return (
    <div className="bg-white rounded-lg border-2 border-red-300 overflow-hidden">
      <div className="bg-red-50 px-4 py-2.5 border-b border-red-200">
        <p className="text-sm font-semibold text-red-800">
          {pedidos.length} pedido{pedidos.length === 1 ? "" : "s"} sin despachar, esperando revisión
        </p>
        <p className="text-[11px] text-red-700 mt-0.5">
          Algo quedó a medias con Sendura y hay que mirarlo a mano. El motivo va en
          cada fila: puede ser que no respondieran a tiempo y la guía exista o no —ahí
          no se mandó a Shopify para no arriesgar una doble entrega—, o que la clienta
          añadiera el jabón después de que el pedido ya hubiera salido.
        </p>
      </div>
      <ul className="divide-y divide-gray-100">
        {pedidos.map((p) => (
          <li key={p.id} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="text-xs text-gray-900">
                {p.city} <span className="text-gray-400">· {p.state}</span>
              </span>
              <span className="text-xs tabular-nums font-semibold text-gray-900">
                {moneda(p.total ?? 0)}
              </span>
            </div>
            <p className="text-[11px] text-gray-600 leading-snug mt-1">
              {(p.sendura_error ?? "").replace(/^REVISAR:\s*/, "")}
            </p>
            <p className="text-[10px] text-gray-400 mt-1 font-mono">
              {p.created_at.slice(0, 16).replace("T", " ")} · {p.id.slice(0, 8)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Kpi({
  titulo,
  valor,
  delta,
  nota,
}: {
  titulo: string;
  valor: string;
  delta?: number | null;
  nota?: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">{titulo}</p>
      <p className="text-xl font-bold text-gray-900 mt-1.5 tabular-nums">{valor}</p>
      {delta !== undefined && <Delta valor={delta} />}
      {nota && <p className="text-[11px] text-gray-400 mt-1">{nota}</p>}
    </div>
  );
}

function Delta({ valor }: { valor: number | null }) {
  if (valor === null) {
    return <p className="text-[11px] text-gray-300 mt-1">sin periodo anterior</p>;
  }
  const sube = valor >= 0;
  return (
    <p className={`text-[11px] mt-1 font-medium ${sube ? "text-green-600" : "text-red-500"}`}>
      {sube ? "▲" : "▼"} {porcentaje(Math.abs(valor))}
      <span className="text-gray-400 font-normal"> vs. periodo anterior</span>
    </p>
  );
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
      <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
      {texto}
    </span>
  );
}

function BarraReparto({ sendura, shopify }: { sendura: Totales; shopify: Totales }) {
  const total = sendura.facturacion + shopify.facturacion;
  const pctSendura = total > 0 ? (sendura.facturacion / total) * 100 : 0;

  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div style={{ width: `${pctSendura}%`, background: COLOR_SENDURA }} />
        <div style={{ width: `${100 - pctSendura}%`, background: COLOR_SHOPIFY }} />
      </div>
      <div className="flex justify-between mt-1.5 text-[11px] text-gray-500">
        <span>Sendura {total > 0 ? porcentaje(pctSendura) : "—"}</span>
        <span>Shopify {total > 0 ? porcentaje(100 - pctSendura) : "—"}</span>
      </div>
    </div>
  );
}

function TarjetaCanal({
  nombre,
  color,
  totales,
  totalGeneral,
  anterior,
  esTotal,
}: {
  nombre: string;
  color: string;
  totales: Totales;
  totalGeneral: Totales;
  anterior?: Totales;
  esTotal?: boolean;
}) {
  const cuota = totalGeneral.facturacion > 0 ? (totales.facturacion / totalGeneral.facturacion) * 100 : 0;

  return (
    <div className={`rounded-md border p-3 ${esTotal ? "border-gray-300 bg-gray-50" : "border-gray-200"}`}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-900">
          <span className="h-2 w-2 rounded-sm" style={{ background: color }} />
          {nombre}
        </span>
        {!esTotal && <span className="text-[11px] text-gray-400">{porcentaje(cuota)}</span>}
      </div>
      <p className="text-lg font-bold text-gray-900 mt-1.5 tabular-nums">{moneda(totales.facturacion)}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">
        {numero(totales.ventas)} pedidos · ticket {moneda(totales.aov)}
      </p>
      {anterior && (
        <div className="mt-1">
          <Delta valor={variacion(totales.facturacion, anterior.facturacion)} />
        </div>
      )}
    </div>
  );
}

function TablaZonas({
  zonas,
  totalFacturacion,
}: {
  zonas: Metricas["zonas"];
  totalFacturacion: number;
}) {
  const [todas, setTodas] = useState(false);
  const visibles = useMemo(() => (todas ? zonas : zonas.slice(0, 12)), [zonas, todas]);

  if (zonas.length === 0) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="p-4 pb-3">
        <h2 className="text-sm font-semibold text-gray-900">Dónde se vende</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">
          {zonas.length} ciudades con ventas en el periodo, ordenadas por facturación.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-y border-gray-200 bg-gray-50 text-gray-500">
              <th className="text-left font-medium px-4 py-2">Ciudad</th>
              <th className="text-left font-medium px-4 py-2">Operador</th>
              <th className="text-right font-medium px-4 py-2">Pedidos</th>
              <th className="text-right font-medium px-4 py-2">Facturación</th>
              <th className="text-right font-medium px-4 py-2 w-28">Cuota</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((z) => {
              const cuota = totalFacturacion > 0 ? (z.facturacion / totalFacturacion) * 100 : 0;
              return (
                <tr key={`${z.state}|${z.city}`} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-2">
                    <span className="text-gray-900">{z.city}</span>
                    <span className="text-gray-400"> · {z.state}</span>
                  </td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
                      <span
                        className="h-1.5 w-1.5 rounded-sm"
                        style={{ background: z.canal === "sendura" ? COLOR_SENDURA : COLOR_SHOPIFY }}
                      />
                      {z.canal === "sendura" ? "Sendura" : "Shopify"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-700">{numero(z.ventas)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-900 font-medium">
                    {moneda(z.facturacion, true)}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1 w-12 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            // Mínimo visible: con cuotas de 1 % la barra medía
                            // una décima de píxel y se veía como una mancha.
                            width: `${Math.max(cuota > 0 ? 4 : 0, Math.min(100, cuota))}%`,
                            background: z.canal === "sendura" ? COLOR_SENDURA : COLOR_SHOPIFY,
                          }}
                        />
                      </div>
                      <span className="tabular-nums text-gray-500 w-10 text-right">{porcentaje(cuota)}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {zonas.length > 12 && (
        <button
          onClick={() => setTodas((v) => !v)}
          className="w-full py-2.5 text-xs font-medium text-gray-500 hover:bg-gray-50 border-t border-gray-200 transition-colors"
        >
          {todas ? "Ver solo las 12 primeras" : `Ver las ${zonas.length} ciudades`}
        </button>
      )}
    </div>
  );
}

function Esqueleto() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="h-2.5 w-16 bg-gray-100 rounded animate-pulse" />
            <div className="h-6 w-24 bg-gray-100 rounded mt-2.5 animate-pulse" />
          </div>
        ))}
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="h-[260px] bg-gray-50 rounded animate-pulse" />
      </div>
    </div>
  );
}
