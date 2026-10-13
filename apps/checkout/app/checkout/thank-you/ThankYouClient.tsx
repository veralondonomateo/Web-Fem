"use client";

import React, { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { OrderItem } from "@/types/checkout";
import { VARIANT_IDS } from "@/lib/catalog";

interface StoredOrder {
  firstName: string;
  lastName: string;
  email: string;
  items: OrderItem[];
  total: number;
  paymentMethod: "mercadopago" | "contraentrega";
  /** Por dónde va a salir el pedido. Solo llega en contraentrega. */
  destino?: "sendura" | "shopify" | null;
}

/**
 * Cuánto se espera antes de despachar solo, si la clienta no decide nada.
 *
 * Con Shopify da igual pasarse: si el jabón entra después, la Order Editing
 * API lo añade a la orden ya creada. Sendura no tiene forma de editar una guía
 * emitida, así que ahí el pedido no puede salir hasta que la decisión esté
 * tomada — de ahí la ventana más larga y el contador a la vista.
 *
 * Los dos plazos quedan holgadamente por debajo de los 10 minutos que espera
 * el cron de rescate, así que ningún pedido se queda sin despachar por esto.
 */
const VENTANA_SHOPIFY_MS = 45_000;
const VENTANA_SENDURA_MS = 240_000;

/**
 * Precio del jabón en el upsell post-compra.
 *
 * El precio tachado es el que el jabón cuesta de verdad en el checkout
 * (29.900). Antes decía 39.000, un precio al que no se vende en ningún lado:
 * una clienta que hubiera visto los dos precios el mismo día se daba cuenta, y
 * un descuento que no se sostiene hace dudar de todo lo demás.
 */
const UPSELL_PRECIO = 19900;
const UPSELL_PRECIO_LISTA = 29900;
const UPSELL_DESCUENTO = Math.round(
  (1 - UPSELL_PRECIO / UPSELL_PRECIO_LISTA) * 100
);

function formatCOP(n: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(n);
}

const STEPS_MP = [
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: "Pago confirmado",
    desc: "Mercado Pago procesó tu pago exitosamente.",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
      </svg>
    ),
    title: "Preparando tu pedido",
    desc: "Nuestro equipo alista tu pedido para enviarlo.",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
      </svg>
    ),
    title: "En camino",
    desc: "Recibirás un SMS con el número de seguimiento.",
  },
];

const STEPS_COD = [
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
    title: "Pedido recibido",
    desc: "Registramos tu pedido con pago contra entrega.",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10" />
      </svg>
    ),
    title: "Preparando tu pedido",
    desc: "Nuestro equipo alista tu pedido.",
  },
  {
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
    title: "Paga al recibir",
    desc: "Ten el efectivo listo cuando llegue tu pedido.",
  },
];

/**
 * Calls /finalize and only marks ref=true on a successful response.
 * If the request fails, ref stays false so the 45s timer can retry.
 * Server-side is idempotent (skips if shopify_order_id already set).
 */
function triggerFinalize(
  orderId: string | null,
  ref: React.MutableRefObject<boolean>
) {
  if (!orderId || ref.current) return;
  ref.current = true; // optimistic — prevents pile-up of concurrent calls
  fetch("/api/checkout/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order_id: orderId }),
  })
    .then((res) => {
      if (!res.ok) {
        // Allow the next caller (e.g. 45s timer) to retry
        ref.current = false;
        console.error("[Finalize] HTTP", res.status);
      }
    })
    .catch((err) => {
      ref.current = false;
      console.error("[Finalize]", err);
    });
}

/**
 * Cuenta atrás de la oferta.
 *
 * Barra de progreso en el rojo de la marca sobre gris claro, como el resto del
 * checkout. En el último medio minuto pasa a ámbar: el cambio de color avisa
 * sin necesidad de leer el número, que en móvil es lo que de verdad se mira.
 */
function ContadorOferta({ restanteMs }: { restanteMs: number }) {
  const totalSeg = Math.max(0, Math.ceil(restanteMs / 1000));
  const mm = Math.floor(totalSeg / 60);
  const ss = String(totalSeg % 60).padStart(2, "0");
  const pct = Math.max(0, Math.min(100, (restanteMs / 240_000) * 100));
  const apurando = totalSeg <= 30;
  const color = apurando ? "#d97706" : "#fc5245";

  return (
    <div className="px-3 pt-3">
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[11px] font-medium text-gray-500">
          {apurando ? "La oferta está por cerrarse" : "Guardamos el espacio en tu bolsita"}
        </span>
        <span
          className="text-sm font-bold tabular-nums transition-colors"
          style={{ color }}
        >
          {mm}:{ss}
        </span>
      </div>
      <div className="h-1 w-full rounded-full bg-gray-100 overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-1000 ease-linear"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}

export default function ThankYouClient() {
  const searchParams = useSearchParams();
  const status = searchParams.get("status");
  const paymentId = searchParams.get("payment_id");

  const [order, setOrder] = useState<StoredOrder | null>(null);
  const [upsellAdded, setUpsellAdded] = useState(false);
  const [upsellLoading, setUpsellLoading] = useState(false);
  const [upsellDismissed, setUpsellDismissed] = useState(false);
  const [restanteMs, setRestanteMs] = useState<number | null>(null);
  const finalizedRef = useRef(false);

  const orderId = searchParams.get("order_id");

  /**
   * ¿El pedido ya trae el jabón **suelto**?
   *
   * Ese es el caso que genera reclamos: lo acaba de pagar a 29.900 en el
   * checkout y en esta página se lo ofrecen a 19.900. Recibe dos y descubre
   * que el segundo valía diez mil menos (303 pedidos desde abril).
   *
   * Los combos que lo incluyen quedan fuera a propósito. Llevan "jabón" en el
   * nombre pero son 2 de cada 3 pedidos contraentrega: bloquearlos hundió los
   * upsells de 8 al día a 1. Ahí el jabón adicional es una segunda unidad a
   * mitad de precio, no el mismo producto cobrado dos veces.
   */
  const yaLlevaJabon = (order?.items ?? []).some(
    (i) =>
      i.shopifyVariantId === VARIANT_IDS.jabon ||
      (/jab[oó]n/i.test(i.name) && !/combo|\+/i.test(i.name))
  );
  const isFailure = status === "failure";
  const isPending = status === "pending";
  // Contraentrega: no payment_id in URL; MP: has payment_id
  const isContraentrega = !paymentId && !isFailure && !isPending;
  const esSendura = order?.destino === "sendura";
  const ventanaMs = esSendura ? VENTANA_SENDURA_MS : VENTANA_SHOPIFY_MS;
  // El contador solo se enseña cuando hay algo que decidir y vale la pena
  // enseñarlo: en 45 s un reloj en pantalla es presión, no ayuda.
  const mostrarContador =
    esSendura && !upsellAdded && !upsellDismissed && !yaLlevaJabon && restanteMs !== null;

  useEffect(() => {
    // Cargar datos de display desde sessionStorage
    const raw = sessionStorage.getItem("fem-order");
    if (raw) {
      try {
        const parsed: StoredOrder = JSON.parse(raw);
        setOrder(parsed);
        // Purchase pixel (navegador) — se deduplica con CAPI por event_id
        if (orderId && !isFailure && !isPending && typeof window !== "undefined") {
          if ((window as any).fbq) {
            // Coincidencias avanzadas manuales: sin esto el pixel solo manda lo
            // que logra deducir solo, y Meta reportaba datos completos en el
            // 44 % de las compras. El navegador hashea estos valores antes de
            // enviarlos; nunca viajan en claro.
            (window as any).fbq("init", "1382746760142604", {
              em: parsed.email?.trim().toLowerCase(),
              fn: parsed.firstName?.trim().toLowerCase(),
              ln: parsed.lastName?.trim().toLowerCase(),
              country: "co",
            });

            (window as any).fbq("track", "Purchase", {
              value: parsed.total,
              currency: "COP",
              content_type: "product",
              content_ids: parsed.items.map((i: OrderItem) =>
                String(i.shopifyVariantId ?? i.id)
              ),
              contents: parsed.items.map((i: OrderItem) => ({
                id: String(i.shopifyVariantId ?? i.id),
                quantity: i.quantity,
                item_price: i.price,
              })),
            }, { eventID: `purchase_${orderId}` });
          }
          if ((window as any).ttq) {
            (window as any).ttq.track("CompletePayment", {
              content_id: orderId,
              content_type: "product",
              currency: "COP",
              value: parsed.total,
              quantity: parsed.items.reduce((sum: number, i: OrderItem) => sum + i.quantity, 0),
            });
          }
        }
      } catch {}
    }

    // Confirmar pago de MP en la DB cuando el usuario llega desde el redirect
    if (orderId && paymentId && status) {
      fetch("/api/checkout/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: orderId,
          payment_id: paymentId,
          status,
        }),
      }).catch((err) => console.error("Confirm error:", err));
    }
  }, []);

  // ── Finalize: crear orden en Shopify con todos los items actuales ────────
  // Se llama cuando el usuario toma una decisión sobre el upsell (acepta o
  // descarta). Timer de 45s y sendBeacon son seguros de redes únicamente.
  useEffect(() => {
    if (!orderId || !isContraentrega) return;

    // Si no hay upsell que mostrar no hay decisión que esperar: la orden se va
    // a Shopify de una vez en lugar de quedarse 45 s esperando un clic que
    // nunca va a llegar. El timer y el beacon siguen montados como respaldo
    // por si esta llamada falla (todo el camino es idempotente).
    if (order && yaLlevaJabon) {
      triggerFinalize(orderId, finalizedRef);
    }

    // sendBeacon para cuando el usuario cierra la pestaña
    const beaconFinalize = () => {
      if (finalizedRef.current) return; // ya finalizó vía interacción del usuario
      const payload = JSON.stringify({ order_id: orderId });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/checkout/finalize",
          new Blob([payload], { type: "application/json" })
        );
      } else {
        fetch("/api/checkout/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
        }).catch(() => {});
      }
    };

    // Fallback: si la clienta no decide nada, el pedido se despacha igual al
    // cerrarse la ventana. Nunca se queda esperando indefinidamente.
    const timer = setTimeout(() => triggerFinalize(orderId, finalizedRef), ventanaMs);
    // `pagehide` y no `beforeunload`: en Safari de iPhone —de donde viene buena
    // parte del tráfico— `beforeunload` no dispara al cerrar la pestaña, y el
    // pedido se quedaba esperando al cron de rescate hasta 10 minutos.
    window.addEventListener("pagehide", beaconFinalize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("pagehide", beaconFinalize);
    };
  }, [orderId, isContraentrega, order, yaLlevaJabon, ventanaMs]);

  // Cuenta atrás visible de la oferta. Cuando llega a cero la oferta
  // desaparece de verdad: un contador que expira y deja el botón puesto es una
  // mentira, y esta página ya arrastra el problema de haber mostrado un precio
  // tachado que no existía.
  useEffect(() => {
    if (!esSendura || upsellAdded || upsellDismissed || yaLlevaJabon) return;
    const fin = Date.now() + VENTANA_SENDURA_MS;
    setRestanteMs(VENTANA_SENDURA_MS);
    const t = setInterval(() => {
      const queda = fin - Date.now();
      setRestanteMs(queda > 0 ? queda : 0);
      if (queda <= 0) {
        clearInterval(t);
        setUpsellDismissed(true);
      }
    }, 1000);
    return () => clearInterval(t);
  }, [esSendura, upsellAdded, upsellDismissed, yaLlevaJabon]);

  const handleUpsell = async () => {
    if (!orderId || upsellAdded || upsellLoading) return;
    setUpsellLoading(true);
    try {
      const res = await fetch("/api/checkout/upsell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });
      if (res.ok) {
        setUpsellAdded(true);
        // Crear la orden en Shopify ahora que el jabón ya está en Supabase
        triggerFinalize(orderId, finalizedRef);
      }
    } catch (err) {
      console.error("Upsell error:", err);
    } finally {
      setUpsellLoading(false);
    }
  };

  const handleDismissUpsell = () => {
    setUpsellDismissed(true);
    // Crear la orden en Shopify sin el jabón
    triggerFinalize(orderId, finalizedRef);
  };

  const isSuccess = !isFailure && !isPending;

  const steps = order?.paymentMethod === "contraentrega" ? STEPS_COD : STEPS_MP;

  return (
    <div className="min-h-screen bg-[#f5f5f5] flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between">
          <Link href="/">
            <Image src="/logo.svg" alt="FEM" width={100} height={32} priority className="h-8 w-auto" />
          </Link>
          {isSuccess && (
            <span className="flex items-center gap-1.5 text-xs text-green-600 font-medium">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
              </svg>
              Compra segura
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">

        {/* ── FAILURE ── */}
        {isFailure && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center space-y-4">
            <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-7 h-7 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900">Pago rechazado</h1>
            <p className="text-gray-500 text-sm max-w-xs mx-auto">
              No se pudo procesar tu pago. Puedes intentarlo de nuevo o elegir otro método.
            </p>
            <Link
              href="/checkout"
              className="inline-block mt-2 px-6 py-3 bg-[#fc5245] text-white text-sm font-semibold rounded-md hover:bg-[#e83d30] transition-colors"
            >
              Volver al checkout
            </Link>
          </div>
        )}

        {/* ── PENDING ── */}
        {isPending && (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center space-y-4">
            <div className="w-14 h-14 bg-yellow-50 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-7 h-7 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900">Pago en proceso</h1>
            <p className="text-gray-500 text-sm max-w-xs mx-auto">
              Tu pago está siendo verificado. Te notificaremos por SMS cuando se confirme.
            </p>
            {paymentId && (
              <p className="text-xs text-gray-400">Ref. #{paymentId}</p>
            )}
          </div>
        )}

        {/* ── SUCCESS ── */}
        {isSuccess && (
          <div className="space-y-4">

            {/* Hero card */}
            <div className="bg-white rounded-lg border border-gray-200 p-6 sm:p-8 text-center">
              {/* Animated checkmark */}
              <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>

              <h1 className="text-2xl font-bold text-gray-900 mb-1">
                ¡Gracias{order ? `, ${order.firstName}` : ""}!
              </h1>
              <p className="text-gray-500 text-sm mb-4">
                {order?.paymentMethod === "contraentrega"
                  ? "Tu pedido fue registrado. Prepara el pago en efectivo para cuando llegue."
                  : "Tu pedido fue confirmado y pronto estará en camino."}
              </p>

              {paymentId && (
                <div className="inline-flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-md px-4 py-2 mb-2">
                  <span className="text-xs text-gray-500">N.° de pago</span>
                  <span className="text-sm font-semibold text-gray-900 tabular-nums">#{paymentId}</span>
                </div>
              )}

              {order?.email && (
                <p className="text-xs text-gray-400 mt-2">
                  Confirmación enviada a <span className="font-medium text-gray-600">{order.email}</span>
                </p>
              )}
            </div>

            {/* ── POST-PURCHASE UPSELL (solo contraentrega) ── */}
            {order?.paymentMethod === "contraentrega" && !upsellDismissed && !yaLlevaJabon && (
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                {/* Foto del equipo */}
                <div className="relative w-full aspect-[3/2] sm:aspect-[16/7]">
                  <Image
                    src="/equipo.jpg"
                    alt="Equipo FEM empacando tu pedido"
                    fill
                    className="object-cover object-[center_30%]"
                    sizes="(max-width: 672px) 100vw, 672px"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/55 to-transparent" />
                  <p className="absolute bottom-3 left-4 text-white text-xs font-medium">
                    Tu pedido se está empacando ahora mismo
                  </p>
                </div>

                {/* Mensaje */}
                <div className="p-5 sm:p-6">
                  <p className="text-sm text-gray-700 leading-relaxed mb-4">
                    <span className="font-semibold text-gray-900">¡Ya vamos a empacar tu pedido!</span>{" "}
                    Justo vimos que en la bolsita hay un espacito para un jabón íntimo con prebióticos —
                    para que aceleres tus resultados y te cuides desde afuera también.
                  </p>

                  {/* Producto */}
                  {upsellAdded ? (
                    <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
                      <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-green-800">¡Listo! El jabón va en tu pedido.</p>
                        <p className="text-xs text-green-600 mt-0.5">Lo recibirás junto con tu compra.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-gray-200 overflow-hidden">
                      {mostrarContador && <ContadorOferta restanteMs={restanteMs!} />}
                      {/* Fila: imagen + info */}
                      <div className="flex items-center gap-3 p-3">
                        <div className="flex-shrink-0 w-16 h-16 rounded-md overflow-hidden bg-gray-100 border border-gray-200">
                          <Image
                            src="https://cdn.shopify.com/s/files/1/0611/6999/1768/files/Probiotico-jabon-5.jpg?v=1769877892"
                            alt="Jabón Íntimo con Prebióticos"
                            width={64}
                            height={64}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-gray-900 leading-tight">
                            Jabón Íntimo con Prebióticos
                          </p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-sm font-bold text-gray-900">{formatCOP(UPSELL_PRECIO)}</span>
                            <span className="text-xs text-gray-400 line-through">{formatCOP(UPSELL_PRECIO_LISTA)}</span>
                            <span className="text-[10px] font-semibold text-[#fc5245] bg-[#fc5245]/10 px-1.5 py-0.5 rounded">
                              -{UPSELL_DESCUENTO}%
                            </span>
                          </div>
                        </div>
                      </div>
                      {/* Botones */}
                      <div className="px-3 pb-3 space-y-2">
                        <button
                          type="button"
                          onClick={handleUpsell}
                          disabled={upsellLoading}
                          className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#fc5245] text-white text-sm font-semibold rounded-md hover:bg-[#e83d30] transition-colors disabled:opacity-60"
                        >
                          {upsellLoading ? (
                            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                          )}
                          Añadir a mi pedido
                        </button>
                        <button
                          type="button"
                          onClick={handleDismissUpsell}
                          className="w-full py-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          No gracias, continuar sin el jabón
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Order items */}
            {order && order.items.length > 0 && (
              <div className="bg-white rounded-lg border border-gray-200 p-5 sm:p-6">
                <h2 className="font-semibold text-gray-900 text-sm mb-4">Tu pedido</h2>
                <div className="space-y-3">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-3">
                      <div className="relative flex-shrink-0">
                        <div className="w-12 h-12 rounded-md overflow-hidden bg-gray-100 border border-gray-200">
                          <Image
                            src={item.image}
                            alt={item.name}
                            width={48}
                            height={48}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <span className="absolute -top-1.5 -right-1.5 bg-[#fc5245] text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                          {item.quantity}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 text-sm leading-tight truncate">{item.name}</p>
                        {item.variant && <p className="text-xs text-gray-500 mt-0.5">{item.variant}</p>}
                      </div>
                      <p className="font-semibold text-gray-900 text-sm flex-shrink-0">
                        {formatCOP(item.price * item.quantity)}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="border-t border-gray-100 mt-4 pt-4 flex justify-between items-center">
                  <span className="font-semibold text-gray-900 text-sm">Total</span>
                  <span className="font-bold text-gray-900 text-lg">{formatCOP(order.total)}</span>
                </div>
              </div>
            )}

            {/* Next steps */}
            <div className="bg-white rounded-lg border border-gray-200 p-5 sm:p-6">
              <h2 className="font-semibold text-gray-900 text-sm mb-4">¿Qué sigue?</h2>
              <div className="space-y-4">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      i === 0 ? "bg-green-100 text-green-600" : "bg-gray-100 text-gray-400"
                    }`}>
                      {step.icon}
                    </div>
                    <div>
                      <p className={`text-sm font-medium ${i === 0 ? "text-gray-900" : "text-gray-500"}`}>
                        {step.title}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{step.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Trust + CTA */}
            <div className="bg-white rounded-lg border border-gray-200 p-5 sm:p-6 text-center space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  { icon: "📦", text: "Envío rápido" },
                  { icon: "💬", text: "Soporte 24/7" },
                  { icon: "🇨🇴", text: "Hecho en Colombia" },
                ].map(({ icon, text }) => (
                  <div key={text} className="flex flex-col items-center gap-1">
                    <span className="text-xl">{icon}</span>
                    <span className="text-[11px] text-gray-500 font-medium leading-tight">{text}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs text-gray-400 mb-3">¿Tienes dudas sobre tu pedido?</p>
                <a
                  href="https://wa.me/573136272001"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#25D366] text-white text-sm font-semibold rounded-md hover:bg-[#1ebe5d] transition-colors"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  Escríbenos por WhatsApp
                </a>
              </div>
            </div>

          </div>
        )}
      </main>

      <footer className="py-6 text-center border-t border-gray-100 bg-white">
        <div className="flex items-center justify-center gap-4 text-xs text-gray-400 flex-wrap">
          <span>© 2025 FEM · Todos los derechos reservados</span>
          <span className="hidden sm:inline">·</span>
          <a href="#" className="hover:text-[#fc5245] transition-colors">Política de privacidad</a>
          <span className="hidden sm:inline">·</span>
          <a href="#" className="hover:text-[#fc5245] transition-colors">Términos y condiciones</a>
        </div>
      </footer>
    </div>
  );
}
