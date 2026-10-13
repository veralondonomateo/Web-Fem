"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { useAdminPassword } from "../AdminShell";

interface ShopifyVariant {
  id: number;
  title: string;
  price: string;
  inventory_quantity?: number;
}

interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  variants: ShopifyVariant[];
  images: { src: string }[];
}

function formatCOP(n: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(n);
}

const APP_URL =
  typeof window !== "undefined" ? window.location.origin : "https://checkoutfem.com";

// Detect "1 unidad" and "2 unidades" variants (compra única)
function getQuantityLinks(product: ShopifyProduct) {
  const v1 = product.variants.find((v) => /\b1\s*unidad\b/i.test(v.title));
  const v2 = product.variants.find((v) => /\b2\s*unidades?\b/i.test(v.title));

  const basePrice = parseFloat(product.variants[0]?.price ?? "0");
  const base = product.variants[0];

  const link1 = v1
    ? {
        url: `${APP_URL}/checkout?product=${product.handle}&variant=${v1.id}`,
        price: parseFloat(v1.price),
        variantId: v1.id,
        label: "1 und",
      }
    : {
        url: `${APP_URL}/checkout?product=${product.handle}`,
        price: basePrice,
        variantId: base?.id,
        label: "1 und",
      };

  const link2 = v2
    ? {
        url: `${APP_URL}/checkout?product=${product.handle}&variant=${v2.id}`,
        price: parseFloat(v2.price),
        variantId: v2.id,
        label: "2 und",
      }
    : {
        url: `${APP_URL}/checkout?product=${product.handle}&qty=2`,
        price: basePrice * 2,
        variantId: null,
        label: "2 und",
      };

  return { link1, link2 };
}

export default function LinksClient() {
  const clave = useAdminPassword();

  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [descartados, setDescartados] = useState(0);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/products", {
        headers: { "x-admin-password": clave },
      });
      // El marco ya validó la contraseña, así que un 401 aquí significa que la
      // sesión caducó: conviene decirlo en vez de culpar a Shopify.
      if (res.status === 401) {
        setError("La sesión ya no es válida. Vuelve a entrar.");
        return;
      }
      if (!res.ok) {
        setError("Error al conectar con Shopify. Verifica las variables de entorno.");
        return;
      }
      const data = await res.json();
      // Un producto sin variantes no se puede comprar: su link generaría un
      // pedido imposible de despachar. Se excluye en vez de mostrarse roto.
      const todos: ShopifyProduct[] = data.products ?? [];
      const vendibles = todos.filter((p) => p.variants.length > 0);
      setDescartados(todos.length - vendibles.length);
      setProducts(vendibles);
    } catch {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  }, [clave]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const copyLink = (url: string, key: string) => {
    navigator.clipboard.writeText(url);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <main className="px-4 sm:px-6 py-6 max-w-6xl">
      <div className="flex items-center justify-between gap-4 mb-1">
        <h1 className="text-lg font-bold text-gray-900">Links de productos</h1>
        <span className="text-[11px] text-gray-400">
          {loading ? "cargando…" : `${products.length} productos`}
        </span>
      </div>
      <p className="text-xs text-gray-400 mb-2">
        Cada producto tiene link para 1 und y 2 und. Precios y stock desde Shopify.
      </p>
      <p className="text-xs text-gray-400 mb-6">
        Solo aparecen productos activos y comprables.
        {descartados > 0 && (
          <span className="text-amber-600">
            {" "}
            {descartados === 1
              ? "Se ocultó 1 producto sin variantes: no se puede vender."
              : `Se ocultaron ${descartados} productos sin variantes: no se pueden vender.`}
          </span>
        )}
      </p>

      {error && (
        <div className="bg-white rounded-lg border border-red-200 p-4 mb-4">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <div className="w-full aspect-square bg-gray-100 animate-pulse" />
              <div className="p-4 space-y-2">
                <div className="h-3 w-3/4 bg-gray-100 rounded animate-pulse" />
                <div className="h-9 bg-gray-50 rounded animate-pulse" />
                <div className="h-9 bg-gray-50 rounded animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? null /* con el error ya explicado arriba, "no hay productos"
                          solo confundiría: no es que no haya, es que no se pudo
                          preguntar. */ : products.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-sm">No hay productos activos en Shopify.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((product) => {
            const { link1, link2 } = getQuantityLinks(product);
            // `inventory_quantity` puede venir ausente si Shopify no rastrea
            // el inventario de esa variante: en ese caso no afirmamos que no
            // hay stock, porque se vende igual.
            const conDatosDeStock = product.variants.some(
              (v) => typeof v.inventory_quantity === "number"
            );
            const sinStock =
              conDatosDeStock &&
              product.variants.every((v) => (v.inventory_quantity ?? 0) <= 0);

            return (
              <div
                key={product.id}
                className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="relative w-full aspect-square bg-gray-50">
                  {product.images[0] ? (
                    <Image
                      src={product.images[0].src}
                      alt={product.title}
                      fill
                      className="object-cover"
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                      <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                </div>

                <div className="p-4">
                  <h3 className="font-semibold text-gray-900 text-sm leading-tight mb-2 line-clamp-2">
                    {product.title}
                  </h3>

                  {sinStock && (
                    <span className="inline-block mb-2 text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                      Sin stock en Shopify
                    </span>
                  )}

                  <LinkRow
                    label="1 und"
                    price={link1.price}
                    url={link1.url}
                    copiedKey={`${product.id}-1`}
                    activeCopied={copied}
                    onCopy={copyLink}
                  />

                  <LinkRow
                    label="2 und"
                    price={link2.price}
                    url={link2.url}
                    copiedKey={`${product.id}-2`}
                    activeCopied={copied}
                    onCopy={copyLink}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}

function LinkRow({
  label,
  price,
  url,
  copiedKey,
  activeCopied,
  onCopy,
}: {
  label: string;
  price: number;
  url: string;
  copiedKey: string;
  activeCopied: string | null;
  onCopy: (url: string, key: string) => void;
}) {
  const isCopied = activeCopied === copiedKey;
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="flex-1 min-w-0 bg-gray-50 rounded-md border border-gray-200 px-2.5 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide flex-shrink-0">
            {label}
          </span>
          <span className="text-xs font-bold text-[#fc5245] flex-shrink-0">
            {formatCOP(price)}
          </span>
        </div>
        <p className="text-[10px] text-gray-400 truncate font-mono mt-0.5">
          {url.replace(/^https?:\/\/[^/]+/, "")}
        </p>
      </div>
      <button
        onClick={() => onCopy(url, copiedKey)}
        title="Copiar link"
        className={`flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
          isCopied ? "bg-green-500 text-white" : "bg-[#fc5245] text-white hover:bg-[#e83d30]"
        }`}
      >
        {isCopied ? (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title="Ver checkout"
        className="flex-shrink-0 w-8 h-8 rounded-md border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>
    </div>
  );
}
