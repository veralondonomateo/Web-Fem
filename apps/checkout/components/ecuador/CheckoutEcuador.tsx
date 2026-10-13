"use client";

/**
 * Checkout de Ecuador.
 *
 * Componente aparte del de Colombia a propósito. Comparte solo piezas de
 * presentación puras (Input, Select, el encabezado); nada de la lógica de
 * pedidos, cupones, upsells, Sendura ni Mercado Pago. Así la operación
 * colombiana, que ya funciona, no puede romperse por un cambio hecho aquí.
 *
 * Lo que todavía no tiene, porque aún no hay con qué conectarlo:
 *  - pasarela de pago (la cuenta de Mercado Pago es colombiana y cobra en COP)
 *  - operador logístico
 * Por eso el único método es contra entrega y el pedido queda guardado a la
 * espera del siguiente paso.
 */

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import CheckoutHeader from "@/components/checkout/CheckoutHeader";
import { PROVINCIAS_EC } from "@/data/provincias-ecuador";
import {
  ENVIO_EC,
  formatUSD,
  PRESENTACIONES_EC,
  PRODUCTO_EC,
  type PresentacionEC,
} from "@/lib/productos-ecuador";

const CLAVE_IDEMPOTENCIA = "fem-ec-idem";

interface Campos {
  email: string;
  nombre: string;
  apellido: string;
  cedula: string;
  telefono: string;
  direccion: string;
  complemento: string;
  provincia: string;
  ciudad: string;
}

const VACIO: Campos = {
  email: "", nombre: "", apellido: "", cedula: "", telefono: "",
  direccion: "", complemento: "", provincia: "", ciudad: "",
};

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
   .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export default function CheckoutEcuador({
  presentacionInicial,
}: {
  presentacionInicial: PresentacionEC;
}) {
  const [presentacion, setPresentacion] = useState(presentacionInicial);
  const [campos, setCampos] = useState<Campos>(VACIO);
  const [errores, setErrores] = useState<Partial<Record<keyof Campos, string>>>({});
  const [ciudades, setCiudades] = useState<string[]>([]);
  const [cargandoCiudades, setCargandoCiudades] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errorEnvio, setErrorEnvio] = useState("");
  const [listo, setListo] = useState<{ id: string; total: number } | null>(null);

  // Hasta que React hidrata, el submit no está enganchado: un toque enviaría
  // el formulario de forma nativa y recargaría con los datos en la URL.
  const [hidratado, setHidratado] = useState(false);
  useEffect(() => setHidratado(true), []);

  // Bloqueo síncrono contra el doble toque. `enviando` es estado y React lo
  // aplica en el siguiente render, que llega tarde para dos toques seguidos.
  const enVuelo = useRef(false);

  // Las ciudades se piden por provincia; son 1.056 y no tienen por qué viajar
  // todas al navegador.
  useEffect(() => {
    if (!campos.provincia) {
      setCiudades([]);
      return;
    }
    let cancelado = false;
    setCargandoCiudades(true);
    fetch(`/api/ec/cities/${slugify(campos.provincia)}`)
      .then((r) => (r.ok ? r.json() : { cities: [] }))
      .then((d) => { if (!cancelado) setCiudades(d.cities ?? []); })
      .catch(() => { if (!cancelado) setCiudades([]); })
      .finally(() => { if (!cancelado) setCargandoCiudades(false); });
    return () => { cancelado = true; };
  }, [campos.provincia]);

  const set = (k: keyof Campos) => (v: string) => {
    setCampos((p) => ({ ...p, [k]: v }));
    setErrores((p) => (p[k] ? { ...p, [k]: undefined } : p));
  };

  const subtotal = presentacion.precio;
  const total = subtotal + ENVIO_EC;

  function validar(): boolean {
    const e: Partial<Record<keyof Campos, string>> = {};
    if (!campos.email.trim()) e.email = "Escribe tu correo";
    else if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(campos.email.trim()))
      e.email = "Ese correo no parece válido";
    if (!campos.nombre.trim()) e.nombre = "Escribe tu nombre";
    if (!campos.apellido.trim()) e.apellido = "Escribe tu apellido";
    const d = campos.telefono.replace(/\D/g, "");
    if (!d) e.telefono = "Escribe tu número";
    else if (d.length < 9 || d.length > 13) e.telefono = "Revisa el número";
    if (!campos.direccion.trim()) e.direccion = "Escribe tu dirección";
    if (!campos.provincia) e.provincia = "Elige tu provincia";
    if (!campos.ciudad) e.ciudad = "Elige tu ciudad";
    setErrores(e);
    return Object.keys(e).length === 0;
  }

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    if (enVuelo.current) return;
    if (!validar()) {
      // Llevar la vista al primer campo con problema, que en móvil puede estar
      // fuera de pantalla y si no parece que el botón no hiciera nada.
      document.querySelector('[data-error="1"]')?.scrollIntoView({
        behavior: "smooth", block: "center",
      });
      return;
    }
    enVuelo.current = true;
    setEnviando(true);
    setErrorEnvio("");

    // La clave sobrevive a un reintento dentro de la misma pestaña, que es
    // justo cuando el doble pedido aparece.
    let idem = "";
    try {
      idem = sessionStorage.getItem(CLAVE_IDEMPOTENCIA) ?? "";
      if (!idem) {
        idem = crypto.randomUUID();
        sessionStorage.setItem(CLAVE_IDEMPOTENCIA, idem);
      }
    } catch { /* modo privado: se sigue sin clave, queda la huella del servidor */ }

    try {
      const res = await fetch("/api/ec/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...campos,
          presentacion: presentacion.slug,
          idempotencyKey: idem || undefined,
          eventSourceUrl: window.location.href,
        }),
      });
      const datos = await res.json().catch(() => null);

      if (!res.ok) {
        setErrorEnvio(
          typeof datos?.error === "string" && datos.error
            ? datos.error
            : "No pudimos registrar tu pedido. Intenta de nuevo."
        );
        return;
      }

      try { sessionStorage.removeItem(CLAVE_IDEMPOTENCIA); } catch {}
      setListo({ id: datos.pedido_id, total: datos.total });
    } catch {
      setErrorEnvio("No pudimos conectarnos. Revisa tu internet e intenta de nuevo.");
    } finally {
      enVuelo.current = false;
      setEnviando(false);
    }
  }

  if (listo) {
    return (
      <div className="min-h-screen bg-[#f5f5f5] flex flex-col">
        <CheckoutHeader />
        <main className="flex-1 flex items-center justify-center px-4 py-16">
          <div className="bg-white rounded-lg border border-gray-200 p-8 max-w-md w-full text-center">
            <div className="w-12 h-12 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-5">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-lg font-bold text-gray-900 mb-2">¡Pedido recibido!</h1>
            <p className="text-sm text-gray-500 mb-5">
              Te vamos a contactar por WhatsApp al{" "}
              <span className="font-medium text-gray-700">{campos.telefono}</span>{" "}
              para confirmar la entrega. Pagas {formatUSD(listo.total)} cuando
              recibas tu pedido.
            </p>
            <p className="text-[11px] text-gray-400">
              Número de pedido: {listo.id.slice(0, 8).toUpperCase()}
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5] flex flex-col">
      <CheckoutHeader />

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6">
        <form onSubmit={enviar} noValidate className="grid lg:grid-cols-[1fr_380px] gap-6 items-start">
          {/* ── Columna del formulario ─────────────────────────────────── */}
          <div className="space-y-4 min-w-0">
            <Seccion n={1} titulo="Contacto">
              <Input
                label="Correo electrónico" type="email" inputMode="email"
                placeholder="tu@email.com" value={campos.email}
                onChange={(e) => set("email")(e.target.value)}
                error={errores.email} data-error={errores.email ? "1" : undefined}
              />
            </Seccion>

            <Seccion n={2} titulo="Dirección de entrega">
              <div className="grid sm:grid-cols-2 gap-4">
                <Input label="Nombre" placeholder="Ana" value={campos.nombre}
                  onChange={(e) => set("nombre")(e.target.value)}
                  error={errores.nombre} data-error={errores.nombre ? "1" : undefined} />
                <Input label="Apellido" placeholder="García" value={campos.apellido}
                  onChange={(e) => set("apellido")(e.target.value)}
                  error={errores.apellido} data-error={errores.apellido ? "1" : undefined} />
                <Input label="Cédula" optional placeholder="Para la factura"
                  inputMode="numeric" value={campos.cedula}
                  onChange={(e) => set("cedula")(e.target.value)} />
                <Input label="Número de WhatsApp" type="tel" inputMode="tel"
                  placeholder="0991234567" value={campos.telefono}
                  onChange={(e) => set("telefono")(e.target.value)}
                  error={errores.telefono} data-error={errores.telefono ? "1" : undefined} />
              </div>

              <Input label="Dirección" placeholder="Av. Amazonas N34-56 y Av. Naciones Unidas"
                value={campos.direccion}
                onChange={(e) => set("direccion")(e.target.value)}
                error={errores.direccion} data-error={errores.direccion ? "1" : undefined} />

              <Input label="Complemento" optional placeholder="Depto., piso, oficina..."
                value={campos.complemento}
                onChange={(e) => set("complemento")(e.target.value)} />

              <div className="grid sm:grid-cols-2 gap-4">
                <Select
                  label="Provincia" placeholder="Selecciona una provincia"
                  options={PROVINCIAS_EC.map((p) => ({ value: p.name, label: p.name }))}
                  value={campos.provincia}
                  onChange={(e) => {
                    set("provincia")(e.target.value);
                    // La ciudad anterior pertenece a otra provincia.
                    setCampos((p) => ({ ...p, ciudad: "" }));
                  }}
                  error={errores.provincia}
                />
                <Select
                  label="Ciudad"
                  placeholder={
                    !campos.provincia ? "Primero elige la provincia"
                    : cargandoCiudades ? "Cargando..." : "Selecciona una ciudad"
                  }
                  options={ciudades.map((c) => ({ value: c, label: c }))}
                  value={campos.ciudad}
                  onChange={(e) => set("ciudad")(e.target.value)}
                  disabled={!campos.provincia || cargandoCiudades}
                  loading={cargandoCiudades}
                  error={errores.ciudad}
                />
              </div>
            </Seccion>

            <Seccion n={3} titulo="Método de pago">
              <div className="rounded-lg border-2 border-[#fc5245] bg-[#fc5245]/5 p-4 flex items-start gap-3">
                <div className="w-5 h-5 rounded-full border-[6px] border-[#fc5245] flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-gray-900">Pago contra entrega</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Pagas en efectivo cuando recibas tu pedido. Te llamamos antes
                    para confirmar la dirección.
                  </p>
                </div>
              </div>
            </Seccion>
          </div>

          {/* ── Resumen ─────────────────────────────────────────────────── */}
          <aside className="bg-white rounded-lg border border-gray-200 p-5 lg:sticky lg:top-24">
            <div className="flex gap-3 pb-4 border-b border-gray-100">
              <div className="relative w-16 h-16 rounded-md overflow-hidden bg-gray-50 flex-shrink-0">
                <Image src={PRODUCTO_EC.imagen} alt={PRODUCTO_EC.nombre} fill
                  className="object-cover" sizes="64px" />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-gray-900 leading-tight">{PRODUCTO_EC.nombre}</p>
                <p className="text-xs text-gray-500 mt-0.5">{presentacion.titulo}</p>
              </div>
            </div>

            {/* Cambiar de presentación sin volver al link anterior. */}
            <div className="py-4 border-b border-gray-100 space-y-2">
              {PRESENTACIONES_EC.map((p) => {
                const activa = p.slug === presentacion.slug;
                return (
                  <button
                    key={p.slug} type="button" onClick={() => setPresentacion(p)}
                    className={`w-full flex items-center justify-between gap-2 rounded-md border-2 px-3 py-2.5 text-left transition-colors ${
                      activa ? "border-[#fc5245] bg-[#fc5245]/5" : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <span className="text-sm font-medium text-gray-900">{p.titulo}</span>
                    <span className="flex items-baseline gap-1.5">
                      {p.precioAntes && (
                        <span className="text-xs text-gray-400 line-through">
                          {formatUSD(p.precioAntes)}
                        </span>
                      )}
                      <span className="text-sm font-bold text-gray-900">{formatUSD(p.precio)}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <dl className="py-4 space-y-2 text-sm border-b border-gray-100">
              <div className="flex justify-between">
                <dt className="text-gray-500">Subtotal</dt>
                <dd className="text-gray-900">{formatUSD(subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Envío</dt>
                <dd>
                  {ENVIO_EC === 0
                    ? <span className="text-green-600 font-medium">GRATIS</span>
                    : formatUSD(ENVIO_EC)}
                </dd>
              </div>
            </dl>

            <div className="flex items-end justify-between pt-4">
              <span className="font-bold text-gray-900">Total</span>
              <div className="text-right">
                <span className="block text-[10px] text-gray-400 leading-none">USD</span>
                <span className="text-2xl font-bold text-gray-900">{formatUSD(total)}</span>
              </div>
            </div>

            {errorEnvio && (
              <div className="mt-4 rounded-md bg-red-50 border border-red-200 px-3 py-2.5 flex gap-2">
                <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-px" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <p className="text-xs text-red-700">{errorEnvio}</p>
              </div>
            )}

            <button
              type="submit" disabled={!hidratado || enviando}
              className="mt-4 w-full flex items-center justify-center gap-2 py-3.5 rounded-md bg-[#fc5245] text-white font-semibold hover:bg-[#e83d30] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              {enviando ? "Enviando..." : `Completar pedido · ${formatUSD(total)}`}
            </button>
            <p className="mt-2 text-center text-[11px] text-gray-400">
              Pagas al recibir · Envío a todo Ecuador
            </p>
          </aside>
        </form>
      </main>
    </div>
  );
}

function Seccion({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-5 sm:p-6">
      <div className="flex items-center gap-2.5 mb-5">
        <div className="w-6 h-6 rounded-full bg-[#fc5245] flex items-center justify-center flex-shrink-0">
          <span className="text-white text-xs font-bold">{n}</span>
        </div>
        <h2 className="font-semibold text-gray-900">{titulo}</h2>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
