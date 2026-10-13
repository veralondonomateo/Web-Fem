"use client";

import { useEffect, useMemo, useState } from "react";
import { coberturaSendura, RESUMEN_COBERTURA } from "@/lib/cobertura-sendura";
import { DEPARTMENTS, DEPARTMENT_SLUGS } from "@/data/departments";

/**
 * Checkout del entorno de pruebas de Sendura, dentro del admin.
 *
 * Deliberadamente NO reutiliza los componentes del checkout real: así ningún
 * ajuste que se haga aquí para probar puede alterar la pantalla por la que
 * entran las ventas. La única pieza compartida es la lista de cobertura, que
 * es justamente lo que se está probando.
 */

interface Variante {
  id: number;
  title: string;
  price: string;
  sku?: string;
}

interface Producto {
  id: number;
  title: string;
  handle: string;
  variants: Variante[];
  images: { src: string }[];
}

interface LineaCarrito {
  shopifyVariantId: number;
  name: string;
  variant: string;
  price: number;
  quantity: number;
  sku?: string;
}

interface Resultado {
  carrier: "sendura" | "shopify";
  status: "ok" | "error" | "dry_run";
  motivo?: string;
  error?: string;
  municipio?: string;
  sendura_guia?: string;
  sendura_order_id?: string | number;
  shopify_order_id?: number;
  order_number?: string;
  request_payload?: unknown;
  response_payload?: unknown;
}

const formatCOP = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(n);

const cacheCiudades = new Map<string, string[]>();

async function traerCiudades(departamento: string): Promise<string[]> {
  const cache = cacheCiudades.get(departamento);
  if (cache) return cache;
  const slug = DEPARTMENT_SLUGS[departamento];
  if (!slug) return [];
  try {
    const res = await fetch(`/api/cities/${slug}`);
    if (!res.ok) return [];
    const { cities } = (await res.json()) as { cities: string[] };
    cacheCiudades.set(departamento, cities);
    return cities;
  } catch {
    return [];
  }
}

export default function CheckoutPrueba({
  productos,
  onEnviado,
}: {
  /** Catálogo resuelto en el servidor: así no queda un endpoint de productos abierto. */
  productos: Producto[];
  /** Avisa al módulo para que refresque el registro tras un envío real. */
  onEnviado?: () => void;
}) {
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
    complement: "",
    state: "",
    city: "",
    paymentMethod: "contraentrega" as "contraentrega" | "anticipado",
  });
  const [ciudades, setCiudades] = useState<string[]>([]);
  const [cargandoCiudades, setCargandoCiudades] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [verPayload, setVerPayload] = useState(false);

  useEffect(() => {
    if (!form.state) {
      setCiudades([]);
      return;
    }
    setCargandoCiudades(true);
    traerCiudades(form.state)
      .then(setCiudades)
      .finally(() => setCargandoCiudades(false));
  }, [form.state]);

  const cobertura = useMemo(
    () => (form.state && form.city ? coberturaSendura(form.state, form.city) : null),
    [form.state, form.city]
  );

  const subtotal = carrito.reduce((s, l) => s + l.price * l.quantity, 0);

  const agregar = (producto: Producto, variante: Variante) => {
    setResultado(null);
    setCarrito((actual) => {
      const existente = actual.find((l) => l.shopifyVariantId === variante.id);
      if (existente) {
        return actual.map((l) =>
          l.shopifyVariantId === variante.id ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [
        ...actual,
        {
          shopifyVariantId: variante.id,
          name: producto.title,
          variant: variante.title,
          price: parseFloat(variante.price) || 0,
          quantity: 1,
          sku: variante.sku,
        },
      ];
    });
  };

  const cambiarCantidad = (variantId: number, delta: number) => {
    setCarrito((actual) =>
      actual
        .map((l) =>
          l.shopifyVariantId === variantId ? { ...l, quantity: l.quantity + delta } : l
        )
        .filter((l) => l.quantity > 0)
    );
  };

  const enviar = async (dryRun: boolean) => {
    setEnviando(true);
    setResultado(null);
    setVerPayload(dryRun);
    try {
      const res = await fetch("/api/pruebas/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          items: carrito.map((l) => ({
            shopifyVariantId: l.shopifyVariantId,
            name: l.name,
            variant: l.variant,
            price: l.price,
            quantity: l.quantity,
          })),
          dryRun,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResultado({ carrier: "shopify", status: "error", error: data.error ?? "Error" });
        return;
      }
      setResultado(data);
      if (!dryRun) onEnviado?.();
    } catch (err) {
      setResultado({
        carrier: "shopify",
        status: "error",
        error: err instanceof Error ? err.message : "Error de conexión",
      });
    } finally {
      setEnviando(false);
    }
  };

  const listo =
    carrito.length > 0 &&
    form.firstName.trim() &&
    form.lastName.trim() &&
    form.phone.trim() &&
    form.address.trim() &&
    form.state &&
    form.city;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
      {/* Catálogo + formulario */}
      <div className="space-y-6">
        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-1">1. Productos</h2>
          <p className="text-xs text-gray-500 mb-4">
            Catálogo completo de Shopify
            {productos.length > 0 && ` (${productos.length} productos)`}. El SKU es el que se
            le manda a Sendura: si sale en rojo, ese producto no se puede enviar.
          </p>

          {productos.length === 0 ? (
            <p className="text-xs text-red-600">
              Shopify no devolvió productos. Sin catálogo no se pueden resolver los SKU.
            </p>
          ) : (
            <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
              {productos.map((producto) => (
                <div key={producto.id} className="border border-gray-200 rounded-md p-3">
                  <p className="text-sm font-medium text-gray-900 mb-2">{producto.title}</p>
                  <div className="space-y-1.5">
                    {producto.variants.map((v) => (
                      <div key={v.id} className="flex items-center gap-2 text-xs">
                        <span className="flex-1 text-gray-600 truncate">{v.title}</span>
                        <span
                          className={`font-mono text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${
                            v.sku
                              ? "bg-gray-100 text-gray-600"
                              : "bg-red-50 text-red-600 border border-red-200"
                          }`}
                        >
                          {v.sku || "sin SKU"}
                        </span>
                        <span className="font-semibold text-gray-900 flex-shrink-0 w-20 text-right">
                          {formatCOP(parseFloat(v.price) || 0)}
                        </span>
                        <button
                          onClick={() => agregar(producto, v)}
                          className="flex-shrink-0 px-2 py-1 bg-gray-900 text-white rounded text-[10px] font-semibold hover:bg-gray-700"
                        >
                          Añadir
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 mb-4">2. Datos de entrega</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Campo label="Nombre" value={form.firstName} onChange={(v) => setForm({ ...form, firstName: v })} />
            <Campo label="Apellido" value={form.lastName} onChange={(v) => setForm({ ...form, lastName: v })} />
            <Campo label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} placeholder="opcional" />
            <Campo label="Celular" value={form.phone} onChange={(v) => setForm({ ...form, phone: v.replace(/\D/g, "") })} />
            <div className="sm:col-span-2">
              <Campo label="Dirección" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
            </div>
            <div className="sm:col-span-2">
              <Campo label="Complemento" value={form.complement} onChange={(v) => setForm({ ...form, complement: v })} placeholder="Apto, torre, indicaciones" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Departamento</label>
              <select
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value, city: "" })}
                className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm bg-white focus:outline-none focus:ring-1 focus:ring-[#fc5245]"
              >
                <option value="">Selecciona…</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d.slug} value={d.name}>{d.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Ciudad {cargandoCiudades && <span className="text-gray-400">(cargando…)</span>}
              </label>
              <select
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                disabled={!form.state || cargandoCiudades}
                className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm bg-white disabled:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-[#fc5245]"
              >
                <option value="">Selecciona…</option>
                {ciudades.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-xs font-medium text-gray-700 mb-1.5">Método de pago</label>
            <div className="flex gap-2">
              {([
                ["contraentrega", "Contra entrega"],
                ["anticipado", "Pago anticipado (simulado)"],
              ] as const).map(([valor, etiqueta]) => (
                <button
                  key={valor}
                  onClick={() => setForm({ ...form, paymentMethod: valor })}
                  className={`flex-1 py-2 rounded-md text-xs font-semibold border transition-colors ${
                    form.paymentMethod === valor
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
                  }`}
                >
                  {etiqueta}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              El pago anticipado no cobra nada: entra como pagado sin pasar por Mercado Pago.
            </p>
          </div>
        </section>
      </div>

      {/* Destino + carrito + envío */}
      <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <DestinoBanner
          state={form.state}
          city={form.city}
          cubierta={cobertura?.cubierta ?? null}
          municipio={cobertura?.municipio?.city}
          corregimiento={cobertura?.corregimiento}
        />

        <section className="bg-white rounded-lg border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900 text-sm mb-3">Pedido</h2>
          {carrito.length === 0 ? (
            <p className="text-xs text-gray-400">Aún no has añadido productos.</p>
          ) : (
            <div className="space-y-2">
              {carrito.map((l) => (
                <div key={l.shopifyVariantId} className="flex items-center gap-2 text-xs">
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-900 font-medium truncate">{l.name}</p>
                    <p className="text-gray-400 truncate">
                      {l.variant} · <span className="font-mono">{l.sku || "sin SKU"}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => cambiarCantidad(l.shopifyVariantId, -1)} className="w-6 h-6 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">−</button>
                    <span className="w-6 text-center tabular-nums">{l.quantity}</span>
                    <button onClick={() => cambiarCantidad(l.shopifyVariantId, 1)} className="w-6 h-6 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">+</button>
                  </div>
                  <span className="w-20 text-right font-semibold text-gray-900 flex-shrink-0">
                    {formatCOP(l.price * l.quantity)}
                  </span>
                </div>
              ))}
              <div className="pt-2 mt-2 border-t border-gray-100 flex justify-between text-sm">
                <span className="font-semibold text-gray-700">Total</span>
                <span className="font-bold text-gray-900">{formatCOP(subtotal)}</span>
              </div>
              <p className="text-[11px] text-gray-400">Envío gratis, igual que en el checkout real.</p>
            </div>
          )}
        </section>

        <div className="space-y-2">
          <button
            onClick={() => enviar(true)}
            disabled={!listo || enviando}
            className="w-full py-2.5 bg-white border border-gray-300 text-gray-700 text-sm font-semibold rounded-md hover:bg-gray-50 disabled:opacity-40"
          >
            Simular — ver qué se enviaría
          </button>
          <button
            onClick={() => enviar(false)}
            disabled={!listo || enviando}
            className="w-full py-3 bg-[#fc5245] text-white text-sm font-semibold rounded-md hover:bg-[#e83d30] disabled:opacity-40"
          >
            {enviando ? "Enviando…" : "Enviar pedido de prueba"}
          </button>
        </div>

        {resultado && (
          <ResultadoPanel
            resultado={resultado}
            verPayload={verPayload}
            onTogglePayload={() => setVerPayload((v) => !v)}
          />
        )}

        <section className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-[11px] font-semibold text-gray-700 mb-2">Cobertura Sendura</p>
          <ul className="text-[11px] text-gray-500 space-y-0.5">
            {RESUMEN_COBERTURA.map((c) => (
              <li key={c}>· {c}</li>
            ))}
          </ul>
          <p className="text-[11px] text-gray-400 mt-2">
            Los corregimientos de estos municipios —los que aparecen como
            &ldquo;Vereda (Municipio)&rdquo;— también cuentan como cobertura.
          </p>
        </section>
      </div>
    </div>
  );
}

function Campo({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-1 focus:ring-[#fc5245] focus:border-[#fc5245]"
      />
    </div>
  );
}

/** El corazón de la prueba: dice a dónde va el pedido antes de enviarlo. */
function DestinoBanner({
  state,
  city,
  cubierta,
  municipio,
  corregimiento,
}: {
  state: string;
  city: string;
  cubierta: boolean | null;
  municipio?: string;
  corregimiento?: string;
}) {
  if (!state || !city) {
    return (
      <div className="bg-white rounded-lg border border-dashed border-gray-300 p-5 text-center">
        <p className="text-xs text-gray-400">
          Elige departamento y ciudad para ver a qué transportadora va el pedido.
        </p>
      </div>
    );
  }

  if (cubierta) {
    return (
      <div className="bg-emerald-50 rounded-lg border border-emerald-300 p-5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 mb-1">
          Este pedido va a
        </p>
        <p className="text-2xl font-bold text-emerald-900">SENDURA</p>
        <p className="text-xs text-emerald-800 mt-2">
          {city} tiene cobertura. Se envía a Sendura como <strong>{municipio}</strong>
          {corregimiento && <> (la vereda &ldquo;{corregimiento}&rdquo; va en la dirección 2)</>}.
        </p>
        <p className="text-xs text-emerald-700 mt-1.5 font-medium">No se crea nada en Shopify.</p>
      </div>
    );
  }

  return (
    <div className="bg-blue-50 rounded-lg border border-blue-300 p-5">
      <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700 mb-1">
        Este pedido va a
      </p>
      <p className="text-2xl font-bold text-blue-900">SHOPIFY</p>
      <p className="text-xs text-blue-800 mt-2">
        {city} ({state}) no está en la cobertura de Sendura, así que sigue el flujo de siempre.
      </p>
    </div>
  );
}

function ResultadoPanel({
  resultado,
  verPayload,
  onTogglePayload,
}: {
  resultado: Resultado;
  verPayload: boolean;
  onTogglePayload: () => void;
}) {
  const esError = resultado.status === "error";
  const esSimulacro = resultado.status === "dry_run";

  return (
    <section
      className={`rounded-lg border p-5 ${
        esError
          ? "bg-red-50 border-red-300"
          : esSimulacro
            ? "bg-gray-50 border-gray-300"
            : "bg-white border-gray-200"
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">
        {esSimulacro ? "Simulacro — no se envió nada" : esError ? "Falló" : "Enviado"}
      </p>

      {!esSimulacro && !esError && (
        <div className="space-y-1.5 text-xs">
          <Dato etiqueta="Transportadora" valor={resultado.carrier.toUpperCase()} />
          {resultado.order_number && <Dato etiqueta="Referencia" valor={resultado.order_number} />}
          {resultado.sendura_guia && <Dato etiqueta="Guía Sendura" valor={resultado.sendura_guia} destacado />}
          {resultado.sendura_order_id && <Dato etiqueta="ID Sendura" valor={String(resultado.sendura_order_id)} />}
          {resultado.shopify_order_id && (
            <Dato etiqueta="Orden Shopify" valor={String(resultado.shopify_order_id)} destacado />
          )}
        </div>
      )}

      {esError && (
        <>
          <p className="text-xs text-red-800 leading-relaxed">{resultado.error}</p>
          {resultado.motivo && (
            <p className="text-[11px] text-red-600 mt-2">
              Motivo clasificado: <span className="font-mono">{resultado.motivo}</span>
            </p>
          )}
        </>
      )}

      {resultado.request_payload != null && (
        <>
          <button
            onClick={onTogglePayload}
            className="mt-3 text-[11px] font-medium text-gray-500 hover:text-gray-800 underline"
          >
            {verPayload ? "Ocultar" : "Ver"} lo que se envía
          </button>
          {verPayload && (
            <pre className="mt-2 bg-gray-900 text-gray-100 text-[10px] p-3 rounded overflow-x-auto max-h-72">
              {JSON.stringify(resultado.request_payload, null, 2)}
            </pre>
          )}
        </>
      )}
    </section>
  );
}

function Dato({
  etiqueta,
  valor,
  destacado,
}: {
  etiqueta: string;
  valor: string;
  destacado?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-500">{etiqueta}</span>
      <span className={`font-mono ${destacado ? "font-bold text-gray-900" : "text-gray-700"}`}>
        {valor}
      </span>
    </div>
  );
}
