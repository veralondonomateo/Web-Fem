"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { coberturaSendura, RESUMEN_COBERTURA } from "@/lib/cobertura-sendura";
import CheckoutPrueba from "./CheckoutPrueba";

/**
 * Módulo de pruebas de Sendura, dentro del admin.
 *
 * Dos pestañas: el checkout de prueba y el registro de lo que ya se envió, con
 * el payload exacto y la respuesta de Sendura — que es lo que se revisa con
 * ellos para ajustar SKU y nombres de ciudad sin adivinar.
 *
 * Va sin contraseña a propósito, para poder compartirlo durante las pruebas.
 * Volver a cerrarlo es descomentar la comprobación de `ADMIN_PASSWORD` en
 * `app/api/pruebas/checkout/route.ts` y en `app/api/pruebas/registro/route.ts`.
 */

interface Producto {
  id: number;
  title: string;
  handle: string;
  variants: Array<{ id: number; title: string; price: string; sku?: string }>;
  images: { src: string }[];
}

interface Prueba {
  id: string;
  created_at: string;
  first_name: string;
  last_name: string;
  phone: string;
  address: string;
  state: string;
  city: string;
  payment_method: string;
  items: Array<{ name: string; variant?: string; quantity: number; price: number }>;
  total: number;
  carrier: "sendura" | "shopify";
  cobertura: boolean;
  motivo: string | null;
  status: "ok" | "error";
  sendura_order_id: string | null;
  sendura_guia: string | null;
  shopify_order_id: number | null;
  error: string | null;
  request_payload: unknown;
  response_payload: unknown;
}

const formatCOP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(n);

const formatFecha = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function PruebasAdminClient({ productos }: { productos: Producto[] }) {
  const [pestana, setPestana] = useState<"checkout" | "registro">("checkout");
  const [pruebas, setPruebas] = useState<Prueba[]>([]);
  const [cargando, setCargando] = useState(true);
  const [expandida, setExpandida] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch("/api/pruebas/registro");
      if (!res.ok) return;
      const data = await res.json();
      setPruebas(data.pruebas ?? []);
    } catch {
      /* se conserva lo que ya está en pantalla */
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const aSendura = pruebas.filter((p) => p.carrier === "sendura");
  const aShopify = pruebas.filter((p) => p.carrier === "shopify");
  const fallidas = pruebas.filter((p) => p.status === "error");

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/admin" className="text-xs text-gray-500 hover:text-gray-900 flex-shrink-0">
              ← Admin
            </Link>
            <span className="text-sm font-semibold text-gray-900 truncate">Pruebas Sendura</span>
          </div>
          <div className="flex items-center gap-1 bg-gray-100 rounded-md p-0.5 flex-shrink-0">
            {([
              ["checkout", "Nuevo pedido"],
              ["registro", `Registro${pruebas.length ? ` (${pruebas.length})` : ""}`],
            ] as const).map(([valor, etiqueta]) => (
              <button
                key={valor}
                onClick={() => {
                  setPestana(valor);
                  if (valor === "registro") cargar();
                }}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors ${
                  pestana === valor
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-800"
                }`}
              >
                {etiqueta}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="bg-amber-50 border-b border-amber-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 text-xs text-amber-900">
          Los pedidos que envíes aquí son <strong>reales</strong> en Sendura y en Shopify — hay
          que anularlos a mano. No tocan la tabla de ventas, ni Mercado Pago, ni Meta, ni el CRM.
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {pestana === "checkout" ? (
          <CheckoutPrueba productos={productos} onEnviado={cargar} />
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Tarjeta etiqueta="Pruebas" valor={pruebas.length} />
              <Tarjeta etiqueta="A Sendura" valor={aSendura.length} color="text-emerald-700" />
              <Tarjeta etiqueta="A Shopify" valor={aShopify.length} color="text-blue-700" />
              <Tarjeta
                etiqueta="Fallidas"
                valor={fallidas.length}
                color={fallidas.length ? "text-red-600" : undefined}
              />
            </div>

            <ProbadorCobertura />

            <section className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-gray-900 text-sm">Pedidos de prueba</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Toca una fila para ver el payload enviado y la respuesta.
                  </p>
                </div>
                <button
                  onClick={cargar}
                  disabled={cargando}
                  className="text-xs px-3 py-1.5 border border-gray-300 rounded-md text-gray-600 hover:bg-gray-50 disabled:opacity-50 flex-shrink-0"
                >
                  {cargando ? "…" : "Refrescar"}
                </button>
              </div>

              {pruebas.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-sm text-gray-500">
                    {cargando ? "Cargando…" : "Todavía no hay pedidos de prueba."}
                  </p>
                  {!cargando && (
                    <button
                      onClick={() => setPestana("checkout")}
                      className="text-xs text-[#fc5245] font-medium mt-2"
                    >
                      Crear el primero →
                    </button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {pruebas.map((p) => (
                    <div key={p.id}>
                      <button
                        onClick={() => setExpandida(expandida === p.id ? null : p.id)}
                        className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
                      >
                        <span
                          className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded flex-shrink-0 w-20 text-center ${
                            p.carrier === "sendura"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {p.carrier}
                        </span>

                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-900 truncate">
                            {p.city} <span className="text-gray-400">· {p.state}</span>
                          </p>
                          <p className="text-xs text-gray-400 truncate">
                            {p.first_name} {p.last_name} · {formatFecha(p.created_at)} ·{" "}
                            {p.payment_method}
                          </p>
                        </div>

                        <div className="text-right flex-shrink-0">
                          {p.status === "error" ? (
                            <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
                              error
                            </span>
                          ) : (
                            <p className="text-xs font-mono text-gray-700">
                              {p.sendura_guia
                                ? `guía ${p.sendura_guia}`
                                : p.shopify_order_id
                                  ? `Shopify ${p.shopify_order_id}`
                                  : "—"}
                            </p>
                          )}
                          <p className="text-xs text-gray-400 tabular-nums">{formatCOP(p.total)}</p>
                        </div>
                      </button>

                      {expandida === p.id && (
                        <div className="px-5 pb-5 bg-gray-50 border-t border-gray-100 space-y-3">
                          <div className="pt-3 text-xs text-gray-600 space-y-1">
                            <p><span className="text-gray-400">Motivo:</span> {p.motivo ?? "—"}</p>
                            <p><span className="text-gray-400">Dirección:</span> {p.address}</p>
                            <p><span className="text-gray-400">Celular:</span> {p.phone}</p>
                            <p>
                              <span className="text-gray-400">Productos:</span>{" "}
                              {p.items?.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
                            </p>
                          </div>

                          {p.error && (
                            <div className="bg-red-50 border border-red-200 rounded p-3">
                              <p className="text-xs text-red-800 leading-relaxed">{p.error}</p>
                            </div>
                          )}

                          <Bloque titulo="Enviado" contenido={p.request_payload} />
                          {p.response_payload != null && (
                            <Bloque titulo="Respuesta" contenido={p.response_payload} />
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function Tarjeta({
  etiqueta,
  valor,
  color = "text-gray-900",
}: {
  etiqueta: string;
  valor: number;
  color?: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{etiqueta}</p>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{valor}</p>
    </div>
  );
}

function Bloque({ titulo, contenido }: { titulo: string; contenido: unknown }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">{titulo}</p>
      <pre className="bg-gray-900 text-gray-100 text-[10px] p-3 rounded overflow-x-auto max-h-64">
        {JSON.stringify(contenido, null, 2)}
      </pre>
    </div>
  );
}

/**
 * Probador de cobertura contra el catálogo real de ciudades.
 *
 * Busca sobre las 8.193 ciudades del selector, no sobre una lista aparte: si
 * aquí dice "Sendura", el checkout dirá exactamente lo mismo.
 */
function ProbadorCobertura() {
  const [consulta, setConsulta] = useState("");
  const [todas, setTodas] = useState<Array<{ state: string; city: string }>>([]);

  // El catálogo completo pesa ~195 KB: se descarga solo al abrir este módulo,
  // no en el bundle del admin. Mismo criterio que el checkout.
  useEffect(() => {
    let vigente = true;
    import("@/data/states.json").then(({ default: data }) => {
      if (!vigente) return;
      setTodas(data.states.flatMap((s) => s.cities.map((c) => ({ state: s.name, city: c }))));
    });
    return () => {
      vigente = false;
    };
  }, []);

  const resultados = useMemo(() => {
    const q = consulta
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .toLowerCase();
    if (q.length < 3) return [];
    return todas
      .filter((x) =>
        x.city
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .toLowerCase()
          .includes(q)
      )
      .slice(0, 12)
      .map((x) => ({ ...x, cobertura: coberturaSendura(x.state, x.city) }));
  }, [consulta, todas]);

  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5">
      <h2 className="font-semibold text-gray-900 text-sm mb-1">Probador de cobertura</h2>
      <p className="text-xs text-gray-400 mb-3">
        Escribe una ciudad como aparece en el formulario y mira a qué transportadora iría.
      </p>

      <input
        value={consulta}
        onChange={(e) => setConsulta(e.target.value)}
        placeholder="Ej. Envigado, Soacha, Cali…"
        className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-1 focus:ring-[#fc5245] focus:border-[#fc5245]"
      />

      {resultados.length > 0 && (
        <div className="mt-3 space-y-1">
          {resultados.map((r) => (
            <div
              key={`${r.state}-${r.city}`}
              className="flex items-center gap-3 text-xs py-1.5 px-2 rounded hover:bg-gray-50"
            >
              <span
                className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded w-20 text-center flex-shrink-0 ${
                  r.cobertura.cubierta
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-gray-100 text-gray-500"
                }`}
              >
                {r.cobertura.cubierta ? "Sendura" : "Shopify"}
              </span>
              <span className="text-gray-900 flex-1 truncate">{r.city}</span>
              <span className="text-gray-400 flex-shrink-0">{r.state}</span>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-3">
        Cobertura configurada: {RESUMEN_COBERTURA.join(" · ")}
      </p>
    </section>
  );
}
