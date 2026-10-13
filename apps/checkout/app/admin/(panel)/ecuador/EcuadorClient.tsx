"use client";

/**
 * Módulo Ecuador del panel.
 *
 * Dos cosas: los links para pasar a pauta y los pedidos que van entrando.
 * Vive aparte del dashboard de Colombia porque son operaciones distintas —otra
 * moneda, otro catálogo, otra tabla— y mezclarlas haría que las cifras de una
 * contaminaran las de la otra.
 */

import { useCallback, useEffect, useState } from "react";
import { useAdminPassword } from "../AdminShell";
import { PRESENTACIONES_EC, PRODUCTO_EC, formatUSD } from "@/lib/productos-ecuador";

interface PedidoEC {
  id: string;
  created_at: string;
  nombre: string;
  apellido: string;
  email: string;
  telefono: string;
  provincia: string;
  ciudad: string;
  direccion: string;
  presentacion: string;
  unidades: number;
  total: number | string;
  estado_pago: string;
  despachado_at: string | null;
}

const APP_URL =
  typeof window !== "undefined" ? window.location.origin : "https://checkoutfem.com";

function fechaCorta(iso: string) {
  return new Intl.DateTimeFormat("es-EC", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    timeZone: "America/Guayaquil",
  }).format(new Date(iso));
}

export default function EcuadorClient() {
  const password = useAdminPassword();
  const [pedidos, setPedidos] = useState<PedidoEC[]>([]);
  const [resumen, setResumen] = useState({ cantidad: 0, facturacion: 0, ticket: 0 });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [copiado, setCopiado] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const res = await fetch("/api/admin/ecuador", {
        headers: { "x-admin-password": password },
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setPedidos(d.pedidos ?? []);
      setResumen(d.resumen ?? { cantidad: 0, facturacion: 0, ticket: 0 });
    } catch {
      setError("No se pudieron cargar los pedidos");
    } finally {
      setCargando(false);
    }
  }, [password]);

  useEffect(() => { cargar(); }, [cargar]);

  const copiar = async (texto: string, clave: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(clave);
      setTimeout(() => setCopiado(null), 1800);
    } catch { /* sin portapapeles: el link está a la vista para copiarlo a mano */ }
  };

  return (
    <div className="p-5 sm:p-8 max-w-5xl">
      <header className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Ecuador</h1>
        <p className="text-sm text-gray-500 mt-1">
          Operación independiente: precios en dólares y pedidos en su propia
          tabla. Todavía no está conectada a Shopify ni a ninguna transportadora.
        </p>
      </header>

      {/* ── Links ──────────────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-900 mb-1">Links de compra</h2>
        <p className="text-xs text-gray-500 mb-4">{PRODUCTO_EC.nombre}</p>

        <div className="space-y-3">
          {PRESENTACIONES_EC.map((p) => {
            const url = `${APP_URL}/ec/checkout?p=${p.slug}`;
            return (
              <div key={p.slug} className="border border-gray-200 rounded-lg p-3.5">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-gray-900">{p.titulo}</span>
                    {p.precioAntes && (
                      <span className="text-xs text-gray-400 line-through">
                        {formatUSD(p.precioAntes)}
                      </span>
                    )}
                    <span className="text-sm font-bold text-[#fc5245]">{formatUSD(p.precio)}</span>
                  </div>
                  <button
                    onClick={() => copiar(url, p.slug)}
                    className="text-xs font-medium px-3 py-1.5 rounded-md bg-gray-900 text-white hover:bg-gray-700 transition-colors flex-shrink-0"
                  >
                    {copiado === p.slug ? "¡Copiado!" : "Copiar"}
                  </button>
                </div>
                <code className="block text-[11px] text-gray-500 break-all bg-gray-50 rounded px-2.5 py-1.5">
                  {url}
                </code>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-4">
          Para cambiar precios o nombre del producto se edita
          <code className="mx-1 font-mono">lib/productos-ecuador.ts</code>
          y se despliega. No hay que tocar nada más.
        </p>
      </section>

      {/* ── Pedidos ────────────────────────────────────────────────────── */}
      <section className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">Pedidos</h2>
          <button
            onClick={cargar}
            className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
          >
            Actualizar
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-5">
          <Dato etiqueta="Pedidos" valor={String(resumen.cantidad)} />
          <Dato etiqueta="Facturación" valor={formatUSD(resumen.facturacion)} />
          <Dato etiqueta="Ticket promedio" valor={formatUSD(resumen.ticket)} />
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        {cargando ? (
          <p className="text-sm text-gray-400 py-8 text-center">Cargando…</p>
        ) : pedidos.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            Todavía no hay pedidos de Ecuador.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="pb-2 font-medium">Fecha</th>
                  <th className="pb-2 font-medium">Clienta</th>
                  <th className="pb-2 font-medium">Destino</th>
                  <th className="pb-2 font-medium">Presentación</th>
                  <th className="pb-2 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => (
                  <tr key={p.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 text-gray-500 whitespace-nowrap">{fechaCorta(p.created_at)}</td>
                    <td className="py-2.5">
                      <span className="block text-gray-900">{p.nombre} {p.apellido}</span>
                      <span className="block text-[11px] text-gray-400">{p.telefono}</span>
                    </td>
                    <td className="py-2.5 text-gray-600">
                      <span className="block">{p.ciudad}</span>
                      <span className="block text-[11px] text-gray-400">{p.provincia}</span>
                    </td>
                    <td className="py-2.5 text-gray-600">{p.unidades} und</td>
                    <td className="py-2.5 text-right font-medium text-gray-900">
                      {formatUSD(Number(p.total))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-lg border border-gray-200 px-3.5 py-3">
      <p className="text-[11px] text-gray-400">{etiqueta}</p>
      <p className="text-lg font-bold text-gray-900 mt-0.5">{valor}</p>
    </div>
  );
}
