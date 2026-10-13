import { getProducts, type ShopifyProduct } from "@/lib/shopify";
import PruebasAdminClient from "./PruebasAdminClient";

export const metadata = {
  title: "Pruebas Sendura | FEM Admin",
  robots: { index: false, follow: false },
};

/** El catálogo cambia mientras se prueba: no queremos servir uno congelado. */
export const dynamic = "force-dynamic";

export default async function AdminPruebasPage() {
  // El catálogo se resuelve aquí, en el servidor, en vez de pedirlo desde el
  // navegador: el módulo va sin contraseña, y así no queda expuesto un
  // endpoint que devuelva inventario y precios de costo a quien lo llame.
  const productos = await getProducts().catch((err) => {
    console.error("[Pruebas] No se pudo leer el catálogo de Shopify:", err);
    return [] as ShopifyProduct[];
  });

  return (
    <PruebasAdminClient
      productos={productos
        .filter((p) => p.variants.length > 0)
        .map((p) => ({
          id: p.id,
          title: p.title,
          handle: p.handle,
          variants: p.variants.map((v) => ({
            id: v.id,
            title: v.title,
            price: v.price,
            sku: v.sku,
          })),
          images: p.images.slice(0, 1).map((i) => ({ src: i.src })),
        }))}
    />
  );
}
