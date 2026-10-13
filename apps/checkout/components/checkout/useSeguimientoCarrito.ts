"use client";

import { useCallback, useEffect, useRef } from "react";
import type { UseFormWatch } from "react-hook-form";
import { OrderItem } from "@/types/checkout";

/**
 * Seguimiento del carrito para recuperación por WhatsApp.
 *
 * Manda a /api/checkout/track lo que la clienta ya escribió, para poder
 * escribirle si se va sin comprar. Todo aquí es lateral al checkout:
 *
 * - nunca lanza (cada envío va envuelto y silenciado),
 * - no re-renderiza el formulario (usa la suscripción de react-hook-form, no
 *   `watch()` a secas),
 * - no retrasa el submit — el envío final es fire-and-forget.
 *
 * Devuelve el `sessionId`, que el submit adjunta al pedido para que la sesión
 * quede marcada como convertida y nadie reciba un "no terminaste tu compra"
 * después de haber comprado.
 */

const CLAVE_SESION = "fem-cart-session";
const ESPERA_MS = 2500;

interface Campos {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  state?: string;
  city?: string;
  address?: string;
}

interface Opciones {
  watch: UseFormWatch<never>;
  items: OrderItem[];
  subtotal: number;
  total: number;
  coupon: string;
}

function obtenerSessionId(): string {
  try {
    const guardado = sessionStorage.getItem(CLAVE_SESION);
    if (guardado) return guardado;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(CLAVE_SESION, id);
    return id;
  } catch {
    return `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Nombre con dos letras y celular colombiano: sin eso no hay nada que mandar. */
function vale(c: Campos): boolean {
  const nombre = c.firstName?.trim() ?? "";
  const tel = (c.phone ?? "").replace(/\D/g, "");
  return nombre.length >= 2 && /^3\d{9}$/.test(tel.slice(-10));
}

export function useSeguimientoCarrito({ watch, items, subtotal, total, coupon }: Opciones) {
  const sessionIdRef = useRef<string>("");
  const datosRef = useRef<Record<string, unknown> | null>(null);
  const ultimoEnviadoRef = useRef<string | null>(null);
  const temporizadorRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lo que cambia fuera del formulario (carrito, cupón) se guarda en un ref
  // para que el callback de la suscripción siempre vea lo último sin tener
  // que resuscribirse en cada render.
  const contextoRef = useRef({ items, subtotal, total, coupon });
  useEffect(() => {
    contextoRef.current = { items, subtotal, total, coupon };
  }, [items, subtotal, total, coupon]);

  // El id de sesión se crea al montar, no durante el render: en el servidor no
  // existe `sessionStorage`. Está listo mucho antes del primer envío, que
  // espera el debounce.
  useEffect(() => {
    if (!sessionIdRef.current) sessionIdRef.current = obtenerSessionId();
  }, []);

  const enviar = useCallback((usarBeacon: boolean) => {
    const datos = datosRef.current;
    if (!datos || !sessionIdRef.current) return;

    const cuerpo = JSON.stringify({ sessionId: sessionIdRef.current, ...datos });
    if (cuerpo === ultimoEnviadoRef.current) return;
    ultimoEnviadoRef.current = cuerpo;

    try {
      if (usarBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        // Al cerrar la pestaña un fetch normal se cancela; el beacon lo entrega
        // el navegador aunque la página ya no exista.
        navigator.sendBeacon(
          "/api/checkout/track",
          new Blob([cuerpo], { type: "application/json" })
        );
        return;
      }
      fetch("/api/checkout/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: cuerpo,
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* el seguimiento nunca debe estorbar el checkout */
    }
  }, []);

  useEffect(() => {
    const suscripcion = watch((valores) => {
      const c = valores as Campos;
      if (!vale(c)) return;

      const { items, subtotal, total, coupon } = contextoRef.current;
      datosRef.current = {
        firstName: c.firstName?.trim(),
        lastName: c.lastName?.trim(),
        email: c.email?.trim(),
        phone: c.phone,
        state: c.state,
        city: c.city,
        address: c.address?.trim(),
        couponCode: coupon || undefined,
        variantId: items[0]?.shopifyVariantId,
        qty: items[0]?.quantity,
        subtotal,
        total,
        items: items.map((i) => ({
          id: i.id,
          name: i.name,
          variant: i.variant ?? null,
          price: i.price,
          quantity: i.quantity,
          shopifyVariantId: i.shopifyVariantId,
        })),
      };

      if (temporizadorRef.current) clearTimeout(temporizadorRef.current);
      temporizadorRef.current = setTimeout(() => enviar(false), ESPERA_MS);
    });

    return () => suscripcion.unsubscribe();
  }, [watch, enviar]);

  // Salida de la página: es justo el momento del abandono, así que se manda lo
  // último sin esperar el debounce. `pagehide` es el evento que sí dispara en
  // Safari iOS, donde `beforeunload` no es confiable.
  useEffect(() => {
    const alSalir = () => {
      if (temporizadorRef.current) clearTimeout(temporizadorRef.current);
      enviar(true);
    };
    const alOcultar = () => {
      if (document.visibilityState === "hidden") alSalir();
    };

    window.addEventListener("pagehide", alSalir);
    document.addEventListener("visibilitychange", alOcultar);
    return () => {
      window.removeEventListener("pagehide", alSalir);
      document.removeEventListener("visibilitychange", alOcultar);
      if (temporizadorRef.current) clearTimeout(temporizadorRef.current);
    };
  }, [enviar]);

  return sessionIdRef;
}
