"use client";

import Image from "next/image";

export interface UpsellProduct {
  id: string;
  name: string;
  variant: string;
  price: number;
  image: string;
  benefit: string;
  stock: number;
  soldToday: number;
  /** Shopify handle — used to exclude this upsell when the main product is the same */
  shopifyHandle?: string;
  /** Shopify variant ID — for proper inventory/product linking in orders */
  shopifyVariantId?: number;
}

interface UpsellSectionProps {
  products: UpsellProduct[];
  qty: Record<string, number>;
  onToggle: (id: string) => void;
}

function formatCOP(n: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(n);
}

export default function UpsellSection({ products, qty, onToggle }: UpsellSectionProps) {
  return (
    <section className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="font-semibold text-gray-900 text-sm">Añade productos extra a tu pedido</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Estos productos tienen un costo adicional y se sumará al valor total de tu compra
          </p>
        </div>
        <span className="flex items-center gap-1 text-[10px] font-semibold text-[#fc5245] bg-[#fc5245]/10 px-2 py-1 rounded">
          <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clipRule="evenodd" />
          </svg>
          <span className="hidden xs:inline">Tiempo limitado</span>
          <span className="xs:hidden">Oferta</span>
        </span>
      </div>

      {/* Cards */}
      <div className="space-y-2.5">
        {products.map((product) => {
          const added = (qty[product.id] ?? 0) > 0;
          return (
            <div
              key={product.id}
              className={`flex items-center gap-3 p-3 rounded-md border transition-colors duration-150 ${
                added ? "border-[#fc5245]" : "border-gray-200"
              }`}
            >
              {/* Image */}
              <div className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-md overflow-hidden bg-gray-100 border border-gray-200">
                <Image
                  src={product.image}
                  alt={product.name}
                  width={56}
                  height={56}
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-gray-900 leading-tight truncate">
                  {product.name}
                </p>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{product.variant}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm font-semibold text-gray-900">
                    {formatCOP(product.price)}
                  </span>
                  <span className="text-[10px] text-orange-600 font-medium hidden sm:inline">
                    Solo {product.stock} disponibles
                  </span>
                </div>
              </div>

              {/* Toggle button */}
              <button
                type="button"
                onClick={() => onToggle(product.id)}
                className={`flex-shrink-0 flex items-center justify-center gap-1 px-2.5 py-2 sm:px-3 rounded-md text-xs font-semibold transition-colors duration-150 min-w-[60px] sm:min-w-[72px] ${
                  added
                    ? "bg-[#fc5245] text-white hover:bg-[#e83d30]"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {added ? (
                  <>
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Listo</span>
                  </>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    <span>Añadir</span>
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {/* Social proof */}
      <p className="mt-3 text-[11px] text-gray-400 flex items-center gap-1.5">
        <svg className="w-3.5 h-3.5 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
        </svg>
        28 personas los añadieron hoy
      </p>
    </section>
  );
}
