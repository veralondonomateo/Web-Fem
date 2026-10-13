/**
 * Catálogo de Ecuador — vive solo aquí.
 *
 * No hay nada de esto en Shopify ni en Sendura, y es deliberado: la operación
 * de Ecuador todavía no está conectada a ningún operador. El precio, el nombre
 * y las presentaciones se editan en este archivo y se despliegan; no hay que
 * tocar ninguna otra cosa.
 *
 * La moneda es **dólar estadounidense**, que es la moneda de Ecuador. Los
 * precios van en dólares con decimales (34.99), no en centavos: es
 * como se escriben en el resto del proyecto y evita confundir 34.99 con 0,3499.
 *
 * Cuando toque conectar con un operador, lo que hay que añadir es el
 * `shopifyVariantId` (o el SKU del operador que se elija) a cada presentación.
 * Hasta entonces el pedido se guarda y no se despacha por ningún lado.
 */

export const MONEDA_EC = "USD";
export const PAIS_EC = "EC";

export interface PresentacionEC {
  /** Va en la URL: /ec/checkout?p=<slug> */
  slug: string;
  /** Lo que ve la clienta en el resumen. */
  titulo: string;
  unidades: number;
  precio: number;
  /** Precio tachado, solo si es un precio real al que se vende. Ver nota abajo. */
  precioAntes?: number;
}

/**
 * Nombre del producto. Está aparte de las presentaciones porque las dos
 * comparten el mismo producto: cambia una vez y cambia en los dos links.
 */
export const PRODUCTO_EC = {
  nombre: "Alimento con probióticos y prebióticos x 60 UND",
  imagen:
    "https://cdn.shopify.com/s/files/1/0611/6999/1768/files/probiotico-uno.webp",
};

/**
 * Las dos presentaciones que pidió la operación.
 *
 * `precioAntes` va vacío a propósito en la de 1 unidad: un precio tachado que
 * no existe en ningún lado es publicidad engañosa, y esta tienda ya arrastra
 * ese antecedente. En la de 2 unidades sí es real —$69.98 es lo que costarían
 * comprando dos veces la de una— así que ahí el tachado dice la verdad.
 */
export const PRESENTACIONES_EC: readonly PresentacionEC[] = [
  { slug: "1-unidad",  titulo: "1 unidad",   unidades: 1, precio: 34.99 },
  { slug: "2-unidades", titulo: "2 unidades", unidades: 2, precio: 49.99, precioAntes: 69.98 },
] as const;

/** Envío. Gratis mientras la operación no tenga tarifa cerrada. */
export const ENVIO_EC = 0;

export function presentacionPorSlug(slug: string | undefined | null): PresentacionEC {
  return (
    PRESENTACIONES_EC.find((p) => p.slug === slug) ?? PRESENTACIONES_EC[0]
  );
}

/** $34.99 — sin decimales solo cuando el precio es redondo. */
export function formatUSD(n: number): string {
  return new Intl.NumberFormat("es-EC", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
  }).format(n);
}
