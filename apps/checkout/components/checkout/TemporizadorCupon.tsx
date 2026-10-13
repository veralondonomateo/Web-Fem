"use client";

/**
 * Cuenta atrás del cupón de campaña.
 *
 * Solo se monta con `?elegir=1` y un cupón válido en la URL. Al llegar a cero
 * el descuento **se quita de verdad**: un reloj que expira y deja el precio
 * rebajado es mentira, y esta tienda ya arrastra el antecedente del precio
 * tachado que no existía en ningún lado.
 *
 * Lo que no hace: el servidor no impone el límite de tiempo. Quien conozca el
 * código puede volver a escribirlo y funcionará. Es una llamada a la urgencia,
 * no un candado — para que lo fuera habría que firmar el cupón con caducidad.
 */

import { useEffect, useRef, useState } from "react";

export const MINUTOS_CUPON = 10;

export default function TemporizadorCupon({
  codigo,
  onExpirar,
}: {
  codigo: string;
  onExpirar: () => void;
}) {
  const [restante, setRestante] = useState(MINUTOS_CUPON * 60_000);
  // El fin se fija una sola vez: si dependiera del render, cada cambio de
  // estado del checkout reiniciaría la cuenta y nunca llegaría a cero.
  const fin = useRef<number>(Date.now() + MINUTOS_CUPON * 60_000);
  const yaExpiro = useRef(false);

  useEffect(() => {
    const t = setInterval(() => {
      const queda = fin.current - Date.now();
      setRestante(queda > 0 ? queda : 0);
      if (queda <= 0 && !yaExpiro.current) {
        yaExpiro.current = true;
        clearInterval(t);
        onExpirar();
      }
    }, 1000);
    return () => clearInterval(t);
  }, [onExpirar]);

  const seg = Math.max(0, Math.ceil(restante / 1000));
  const mm = Math.floor(seg / 60);
  const ss = String(seg % 60).padStart(2, "0");
  const pct = Math.max(0, Math.min(100, (restante / (MINUTOS_CUPON * 60_000)) * 100));
  // Último minuto en ámbar: el cambio de color avisa sin tener que leer el
  // número, que en móvil es lo que de verdad se mira.
  const apurando = seg <= 60;
  const color = apurando ? "#d97706" : "#fc5245";

  if (seg <= 0) return null;

  return (
    <div className="bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5">
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <p className="text-[11px] sm:text-xs text-gray-600 leading-snug">
            <span className="font-semibold text-gray-900">{codigo}</span> aplicado ·{" "}
            {apurando ? "tu descuento está por vencer" : "tu descuento está reservado"}
          </p>
          <span
            className="text-sm font-bold tabular-nums flex-shrink-0 transition-colors"
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
    </div>
  );
}
