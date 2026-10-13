/**
 * IDs de variante de Shopify conocidos, usados como último recurso cuando la
 * consulta al catálogo falla o el link no trae `?product=`.
 *
 * Por qué existe este archivo: si un item llega a `createShopifyOrder` sin
 * `shopifyVariantId`, Shopify lo registra como línea suelta con el título
 * "Nombre – variante". Esa línea no descuenta inventario, no suma al reporte
 * del producto y no se puede devolver contra el SKU. Entre abril y julio de
 * 2026 eso pasó en 1.083 pedidos con el producto principal.
 *
 * Los IDs de variante son estables ante renombres del producto: la variante
 * 43659069325400 sobrevivió el cambio de "Probiótico vaginal x 60 UND" a
 * "Alimento con probióticos y prebióticos x 60 UND" sin cambiar de número.
 * Por eso resolvemos por ID de variante y no por handle ni por título.
 */
export const VARIANT_IDS = {
  /** Alimento con probióticos y prebióticos x 60 UND — Compra Única / 1 unidad */
  principal: 43659069325400,
  /** Jabón íntimo pH neutro — 200 ml */
  jabon: 43661845299288,
  /** Óvulos FEM x 6 unidades */
  ovulos: 43665049747544,
  /** Gomitas PMS FEM x 60 (Gomitas con fenogreco) */
  gomitas: 43665105748056,
} as const;

/** Precio de lista del producto principal, si Shopify no responde. */
export const PRINCIPAL_FALLBACK_PRICE = 110000;

/**
 * Productos que se ofrecen en el selector de campaña (`?elegir=1`).
 *
 * Es una lista cerrada y a mano, no todo el catálogo: en una campaña se
 * enseña lo que se quiere vender, no las 20 variantes que existen en Shopify.
 * Se resuelven por ID de variante y no por nombre ni precio, porque ambos
 * cambian —el jabón pasó de 29.900 a 46.900 y los óvulos de 45.000 a 84.900
 * sin cambiar de variante— y filtrar por ellos dejaría la campaña rota en
 * silencio el día que alguien ajuste un precio.
 *
 * El orden de esta lista es el orden en que aparecen las tarjetas.
 */
export const VARIANTES_CAMPANA: readonly number[] = [
  43659069325400, // Alimento con probióticos y prebióticos x 60 UND
  44041401598040, // Combo Probiótico + Six pack de Soda Prebiótica
  43661534298200, // Fem Mom x 60 tabletas
  43087005352024, // Soda Prebiótica x 6 UND
  43665049747544, // Óvulos Fem x 6 UND
  43661845299288, // Jabón íntimo pH neutro x 200 ml
  43665105748056, // Gomitas con fenogreco x 60 UND
  43429476008024, // Combo Completo
] as const;
