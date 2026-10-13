"use client";

/**
 * Módulo de descuentos: qué cupones están activos y cómo armar el link de
 * campaña que los deja aplicados.
 *
 * Los cupones viven en `lib/coupons.ts`, no en base de datos, así que esta
 * pantalla los lee de ahí: es la misma tabla que valida el servidor al crear
 * el pedido, y no puede desincronizarse. Para cambiar un porcentaje o añadir
 * un código hay que editar ese archivo y desplegar.
 */

import { useMemo, useState } from "react";
import { COUPON_CODES, COUPON_USAGE_LIMITS } from "@/lib/coupons";
import { MINUTOS_CUPON } from "@/components/checkout/TemporizadorCupon";

const BASE = "https://checkoutfem.com/checkout";

export default function DescuentosClient() {
  const codigos = useMemo(
    () => Object.entries(COUPON_CODES).sort((a, b) => b[1] - a[1]),
    []
  );

  const [codigo, setCodigo] = useState(codigos[0]?.[0] ?? "");
  const [elegir, setElegir] = useState(true);
  const [fuente, setFuente] = useState("instagram");
  const [medio, setMedio] = useState("bio");
  const [campana, setCampana] = useState("");
  const [copiado, setCopiado] = useState(false);

  const link = useMemo(() => {
    const p = new URLSearchParams();
    if (codigo) p.set("cupon", codigo);
    if (elegir) p.set("elegir", "1");
    if (fuente.trim()) p.set("utm_source", fuente.trim());
    if (medio.trim()) p.set("utm_medium", medio.trim());
    p.set("utm_campaign", (campana.trim() || codigo).toLowerCase());
    return `${BASE}?${p.toString()}`;
  }, [codigo, elegir, fuente, medio, campana]);

  const copiar = () => {
    navigator.clipboard.writeText(link);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  };

  return (
    <main className="px-4 sm:px-6 py-6 space-y-4 max-w-4xl">
      <h1 className="text-lg font-bold text-gray-900">Descuentos</h1>

      {/* ── Cupones activos ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="p-4 pb-3">
          <h2 className="text-sm font-semibold text-gray-900">Códigos activos</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">
            Viven en <code className="font-mono">lib/coupons.ts</code>. Para cambiarlos hay que
            editar el archivo y desplegar; no se administran desde aquí.
          </p>
        </div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-y border-gray-200 bg-gray-50 text-gray-500">
              <th className="text-left font-medium px-4 py-2">Código</th>
              <th className="text-right font-medium px-4 py-2">Descuento</th>
              <th className="text-right font-medium px-4 py-2">Usos por cliente</th>
            </tr>
          </thead>
          <tbody>
            {codigos.map(([c, tasa]) => {
              const limite = COUPON_USAGE_LIMITS[c];
              return (
                <tr key={c} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-2 font-mono font-semibold text-gray-900">{c}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-900">
                    {Math.round(tasa * 100)} %
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500">
                    {limite === undefined ? "sin límite" : limite}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Generador de link ───────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-900">Link de campaña</h2>
        <p className="text-[11px] text-gray-400 mt-0.5 mb-4">
          Deja el descuento aplicado al abrir el checkout. El servidor lo revalida igual, así que
          un código inventado en la URL no descuenta nada.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo etiqueta="Cupón">
            <select
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-1 focus:ring-[#fc5245] focus:border-[#fc5245]"
            >
              {codigos.map(([c, t]) => (
                <option key={c} value={c}>
                  {c} — {Math.round(t * 100)} %
                </option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="utm_campaign">
            <input
              value={campana}
              onChange={(e) => setCampana(e.target.value)}
              placeholder={codigo.toLowerCase()}
              className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-1 focus:ring-[#fc5245] focus:border-[#fc5245]"
            />
          </Campo>
          <Campo etiqueta="utm_source">
            <input
              value={fuente}
              onChange={(e) => setFuente(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-1 focus:ring-[#fc5245] focus:border-[#fc5245]"
            />
          </Campo>
          <Campo etiqueta="utm_medium">
            <input
              value={medio}
              onChange={(e) => setMedio(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-1 focus:ring-[#fc5245] focus:border-[#fc5245]"
            />
          </Campo>
        </div>

        <label className="flex items-start gap-2.5 mt-4 cursor-pointer">
          <input
            type="checkbox"
            checked={elegir}
            onChange={(e) => setElegir(e.target.checked)}
            className="mt-0.5 accent-[#fc5245]"
          />
          <span className="text-xs text-gray-700 leading-snug">
            <span className="font-medium">Dejar que elija el producto</span>
            <span className="block text-gray-400 mt-0.5">
              Muestra el catálogo arriba del checkout y un contador de {MINUTOS_CUPON} minutos.
              Sin esto, el link cae en el producto principal.
            </span>
          </span>
        </label>

        <div className="mt-4">
          <div className="bg-gray-50 border border-gray-200 rounded-md p-3">
            <p className="font-mono text-[11px] text-gray-700 break-all leading-relaxed">{link}</p>
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={copiar}
              className={`flex-1 py-2 text-sm font-semibold rounded-md transition-colors ${
                copiado ? "bg-green-500 text-white" : "bg-[#fc5245] text-white hover:bg-[#e83d30]"
              }`}
            >
              {copiado ? "Copiado" : "Copiar link"}
            </button>
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Probar
            </a>
          </div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed pb-6">
        El contador de {MINUTOS_CUPON} minutos quita el descuento al llegar a cero, pero no es un
        candado: el servidor no impone la caducidad, así que quien conozca el código puede volver
        a escribirlo y funcionará. Sirve para dar urgencia, no para cerrar la promoción.
      </p>
    </main>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">
        {etiqueta}
      </label>
      {children}
    </div>
  );
}
