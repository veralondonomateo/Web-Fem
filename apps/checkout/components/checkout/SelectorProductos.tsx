"use client";

/**
 * Selector de productos en la cabecera del checkout.
 *
 * Solo aparece con `?elegir=1`. Existe para las campañas con cupón: el link de
 * una promoción no debería obligar a comprar el probiótico porque sea el
 * producto por defecto del checkout. Quien llega con el descuento puesto arma
 * su pedido.
 *
 * No es "elegir uno" sino "agregar varios": cada tarjeta suma al carrito con
 * el **+** y se quita con el **−**. Es la misma mecánica que los upsells de
 * más abajo, para que la clienta no tenga que aprender dos formas distintas de
 * añadir algo en la misma página.
 *
 * Fuera de ese modo el checkout se comporta exactamente igual que antes: este
 * componente no se monta y el producto lo sigue fijando el `?product=` de la
 * URL o el principal.
 */

import Image from "next/image";
import { CheckoutProduct } from "@/types/checkout";

function formatCOP(n: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(n);
}

/** Precio de la primera variante: es la que se agrega al carrito. */
export function precioDe(p: CheckoutProduct): number {
  return Math.round(parseFloat(p.variants[0]?.price ?? "0"));
}

export default function SelectorProductos({
  catalogo,
  cantidades,
  onAgregar,
  onQuitar,
}: {
  catalogo: CheckoutProduct[];
  /** Cantidad en el carrito por id de producto. */
  cantidades: Record<string, number>;
  onAgregar: (p: CheckoutProduct) => void;
  onQuitar: (p: CheckoutProduct) => void;
}) {
  if (catalogo.length === 0) return null;

  const enCarrito = Object.values(cantidades).reduce((s, n) => s + n, 0);

  return (
    <section className="bg-white border-b border-gray-200">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-gray-900">Arma tu pedido</h2>
          <span className="text-[11px] text-gray-400">
            {enCarrito === 0
              ? "Agrega lo que quieras llevar"
              : "Tu descuento aplica a todo"}
          </span>
        </div>

        {/*
          Carrusel horizontal en móvil y rejilla en escritorio. En móvil una
          rejilla dejaría las tarjetas demasiado estrechas para leer el nombre,
          y de ahí vienen la mayoría de las compras.
        */}
        <div
          className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x
                     sm:mx-0 sm:px-0 sm:overflow-visible sm:grid sm:grid-cols-3 lg:grid-cols-4"
        >
          {catalogo.map((p) => {
            const cantidad = cantidades[String(p.id)] ?? 0;
            const dentro = cantidad > 0;
            return (
              <div
                key={p.id}
                className={`flex-shrink-0 w-[10.5rem] sm:w-auto snap-start rounded-lg border-2 overflow-hidden transition-colors flex flex-col ${
                  dentro ? "border-[#fc5245] bg-[#fc5245]/5" : "border-gray-200 bg-white"
                }`}
              >
                <div className="relative w-full aspect-square bg-gray-50">
                  {p.images[0]?.src ? (
                    <Image
                      src={p.images[0].src}
                      alt={p.title}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 45vw, 20vw"
                    />
                  ) : null}
                  {dentro && (
                    <span className="absolute top-1.5 right-1.5 min-w-[1.4rem] h-5 px-1.5 rounded-full bg-[#fc5245] text-white text-[11px] font-bold flex items-center justify-center">
                      {cantidad}
                    </span>
                  )}
                </div>

                <div className="p-2.5 flex flex-col flex-1">
                  <p className="text-[11px] leading-tight text-gray-900 line-clamp-2 min-h-[2.1em]">
                    {p.title}
                  </p>
                  <p className="text-xs font-bold text-gray-900 mt-1 mb-2">
                    {formatCOP(precioDe(p))}
                  </p>

                  {/* El botón queda abajo del todo para que todas las tarjetas
                      lo tengan a la misma altura aunque el nombre ocupe una
                      línea o dos. */}
                  <div className="mt-auto">
                    {dentro ? (
                      <div className="flex items-center justify-between gap-1 rounded-md border border-[#fc5245] bg-white p-0.5">
                        <button
                          type="button"
                          onClick={() => onQuitar(p)}
                          aria-label={`Quitar uno de ${p.title}`}
                          className="w-8 h-8 rounded flex items-center justify-center text-[#fc5245] hover:bg-[#fc5245]/10 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeWidth={2.5} d="M5 12h14" />
                          </svg>
                        </button>
                        <span className="text-sm font-bold text-gray-900 tabular-nums">
                          {cantidad}
                        </span>
                        <button
                          type="button"
                          onClick={() => onAgregar(p)}
                          aria-label={`Agregar otro ${p.title}`}
                          className="w-8 h-8 rounded flex items-center justify-center text-[#fc5245] hover:bg-[#fc5245]/10 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeWidth={2.5} d="M12 5v14M5 12h14" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onAgregar(p)}
                        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-md bg-[#fc5245] text-white text-xs font-semibold hover:bg-[#e83d30] transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeWidth={3} d="M12 5v14M5 12h14" />
                        </svg>
                        Agregar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {enCarrito === 0 && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-3">
            Agrega al menos un producto para continuar con tu pedido.
          </p>
        )}
      </div>
    </section>
  );
}
