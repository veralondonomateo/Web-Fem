import { Suspense } from "react";
import CheckoutEcuador from "@/components/ecuador/CheckoutEcuador";
import { presentacionPorSlug } from "@/lib/productos-ecuador";

export const metadata = {
  title: "FEM Ecuador | Finalizar compra",
  description: "Checkout seguro - FEM Ecuador",
};

/**
 * /ec/checkout?p=1-unidad | 2-unidades
 *
 * Ruta propia, separada del checkout de Colombia. No comparte datos, ni
 * catálogo, ni tabla, ni lógica de despacho: lo único en común son los
 * componentes visuales, que no tienen estado.
 *
 * Si `?p=` viene vacío o con algo que no existe, cae a la presentación de 1
 * unidad en vez de mostrar un error: quien abre el link viene a comprar.
 */
export default async function CheckoutEcuadorPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;

  return (
    <Suspense>
      <CheckoutEcuador presentacionInicial={presentacionPorSlug(p)} />
    </Suspense>
  );
}
