"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { OrderItem, CheckoutProduct } from "@/types/checkout";
import { UpsellProduct } from "./UpsellSection";
import CheckoutHeader from "./CheckoutHeader";
import CheckoutForm from "./CheckoutForm";
import OrderSummary from "./OrderSummary";
import MobileOrderToggle from "./MobileOrderToggle";
import { trackMeta, trackTikTok } from "@/lib/pixels";
import { asegurarIdsMeta } from "@/lib/meta-tracking";
import { COUPON_CODES } from "@/lib/coupons";
import SelectorProductos, { precioDe } from "./SelectorProductos";
import TemporizadorCupon from "./TemporizadorCupon";
import { VARIANT_IDS, PRINCIPAL_FALLBACK_PRICE } from "@/lib/catalog";

// Último recurso: solo se usa si Shopify no respondió y el servidor no pudo
// resolver el producto principal. Lleva shopifyVariantId para que, incluso en
// ese caso, el pedido quede enlazado al producto real y descuente inventario.
// El nombre y la variante replican los de Shopify a propósito.
const DEFAULT_ITEM: OrderItem = {
  id: "prod_001",
  name: "Alimento con probióticos y prebióticos x 60 UND",
  variant: "Compra Única 1 / 1 unidad",
  price: PRINCIPAL_FALLBACK_PRICE,
  quantity: 1,
  image: "https://images.unsplash.com/photo-1593095948071-474c5cc2989d?w=200&q=80",
  shopifyVariantId: VARIANT_IDS.principal,
};

function shopifyProductToItem(p: CheckoutProduct, variantId?: number): OrderItem {
  const variant = variantId
    ? (p.variants.find((v) => v.id === variantId) ?? p.variants[0])
    : p.variants[0];
  return {
    id: String(p.id),
    name: p.title,
    variant: variant?.title !== "Default Title" ? variant?.title : undefined,
    price: Math.round(parseFloat(variant?.price ?? "0")),
    quantity: 1,
    image: p.images[0]?.src ?? "",
    shopifyVariantId: variant?.id,
  };
}

// Catálogo base de upsells — Gomitas se completa desde Shopify.
// Cada uno trae su shopifyVariantId de respaldo: si la consulta a Shopify
// falla, el upsell sigue enlazado al producto real en vez de entrar como
// línea suelta sin inventario.
const BASE_UPSELLS: UpsellProduct[] = [
  {
    id: "jabon-intimo-fem",
    name: "Jabón íntimo pH neutro",
    variant: "200 ml",
    price: 29900,
    image: "/__theme/fem-owned-6eccb1aca36001af24dc.webp",
    benefit: "Higiene íntima con pH balanceado",
    stock: 7,
    soldToday: 14,
    shopifyHandle: "jabon-intimo-ph-neutro",
    shopifyVariantId: VARIANT_IDS.jabon,
  },
  {
    id: "ovulos-fem",
    name: "Óvulos FEM",
    variant: "6 unidades · Probióticos",
    price: 45000,
    image: "/__theme/fem-owned-c5c6b921f8387e194965.jpg",
    benefit: "Restaura la flora vaginal naturalmente",
    stock: 5,
    soldToday: 9,
    shopifyHandle: "ovulos-vaginales-fem",
    shopifyVariantId: VARIANT_IDS.ovulos,
  },
  {
    id: "gomitas-pms",
    name: "Gomitas PMS FEM",
    variant: "x60 gomitas · Síndrome premenstrual",
    price: 0, // filled from Shopify
    image: "",  // filled from Shopify
    benefit: "Elimina tus síntomas menstruales",
    stock: 8,
    soldToday: 11,
    shopifyHandle: "gomitas-sindrome-premestrual-x60",
    shopifyVariantId: VARIANT_IDS.gomitas,
  },
];

const SHIPPING = 15000;

// Los códigos vienen de lib/coupons, el mismo módulo que valida el servidor.

interface CheckoutPageClientProps {
  unified?: boolean;
  initialPayment?: "mercadopago" | "contraentrega";
  shopifyProduct?: CheckoutProduct | null;
  gomitasProduct?: CheckoutProduct | null;
  jabonProduct?: CheckoutProduct | null;
  ovulosProduct?: CheckoutProduct | null;
  /** IDs de variante de upsells sin stock en Shopify; no se ofrecen. */
  upsellsAgotados?: number[];
  initialVariantId?: number;
  initialQty?: number;
  /** Catálogo para el selector de campaña. Solo llega con `?elegir=1`. */
  catalogo?: CheckoutProduct[];
  /**
   * Carrito reconstruido desde un link de recuperación (`?r=`), con todas sus
   * líneas, cantidades, precios y el cupón que el link deja aplicado. Cuando
   * llega, manda sobre el producto del link y sobre el modo campaña.
   */
  carritoRestaurado?: { items: OrderItem[]; cupon: string | null };
}

export default function CheckoutPageClient({ shopifyProduct, gomitasProduct, jabonProduct, ovulosProduct, upsellsAgotados, initialVariantId, initialQty, catalogo, carritoRestaurado, unified=false, initialPayment }: CheckoutPageClientProps) {
  const searchParams = useSearchParams();

  // Modo campaña: el producto deja de venir fijo de la URL y lo elige la
  // clienta. Sin `?elegir=1` este estado nunca cambia, así que el checkout de
  // siempre se comporta exactamente igual que antes.
  const modoEleccion =
    !carritoRestaurado && searchParams.get("elegir") === "1" && (catalogo?.length ?? 0) > 0;

  // Cantidad por producto del selector. Arranca con el producto del link ya
  // dentro, para que quien llega no vea un carrito vacío.
  const [cantidades, setCantidades] = useState<Record<string, number>>(() =>
    shopifyProduct ? { [String(shopifyProduct.id)]: 1 } : {}
  );

  const agregarProducto = (p: CheckoutProduct) =>
    setCantidades((c) => ({ ...c, [String(p.id)]: (c[String(p.id)] ?? 0) + 1 }));

  const quitarProducto = (p: CheckoutProduct) =>
    setCantidades((c) => {
      const n = (c[String(p.id)] ?? 0) - 1;
      const copia = { ...c };
      // Se borra la clave en vez de dejarla en 0: así `cantidades` refleja
      // exactamente lo que hay en el carrito y no hay que filtrar ceros.
      if (n <= 0) delete copia[String(p.id)];
      else copia[String(p.id)] = n;
      return copia;
    });

  // Fuera del modo campaña manda el carrito restaurado o, si no hay, el
  // producto del link, como siempre.
  const MAIN_ITEMS: OrderItem[] = carritoRestaurado
    ? carritoRestaurado.items
    : shopifyProduct
      ? [shopifyProductToItem(shopifyProduct, initialVariantId)]
      : [DEFAULT_ITEM];
  const mainVariantId = MAIN_ITEMS[0]?.shopifyVariantId;

  /** Lo que el selector aporta al carrito, en el orden del catálogo. */
  const itemsSeleccion = useMemo<OrderItem[]>(() => {
    if (!modoEleccion) return [];
    return (catalogo ?? [])
      .filter((p) => (cantidades[String(p.id)] ?? 0) > 0)
      .map((p) => ({
        ...shopifyProductToItem(p),
        price: precioDe(p),
        quantity: cantidades[String(p.id)],
      }));
  }, [modoEleccion, catalogo, cantidades]);

  /**
   * Variantes que la clienta ya lleva en el carrito.
   *
   * Fuera del modo campaña es una sola: la del link. En modo campaña son las
   * que eligió arriba, y ahí está el motivo de que esto exista. El jabón, los
   * óvulos y las gomitas se ofrecen **en los dos sitios**: en el selector de
   * campaña y en el upsell de abajo. El filtro del upsell solo miraba el
   * producto principal, así que quien agregaba el jabón arriba seguía viendo
   * la oferta del jabón abajo y podía terminar con el mismo producto dos
   * veces en el mismo pedido, a dos precios distintos.
   */
  const variantesEnCarrito = useMemo(() => {
    const ids = new Set<number>();
    if (modoEleccion) {
      itemsSeleccion.forEach((i) => {
        if (i.shopifyVariantId) ids.add(i.shopifyVariantId);
      });
    } else if (carritoRestaurado) {
      carritoRestaurado.items.forEach((i) => {
        if (i.shopifyVariantId) ids.add(i.shopifyVariantId);
      });
    } else if (mainVariantId) {
      ids.add(mainVariantId);
    }
    return ids;
  }, [modoEleccion, itemsSeleccion, mainVariantId, carritoRestaurado]);

  const carritoVacio = modoEleccion && itemsSeleccion.length === 0;
  const mpStatus = searchParams.get("status"); // "success" | "failure" | "pending" | null

  const [mainQty, setMainQty] = useState(
    carritoRestaurado?.items[0]?.quantity ?? initialQty ?? 1
  );
  const [upsellQty, setUpsellQty] = useState<Record<string, number>>({});

  // Disparar InitiateCheckout al cargar la página. Los pixeles ahora cargan
  // diferidos, así que esperamos a que existan en vez de descartar el evento.
  useEffect(() => {
    // Antes que nada: fijar los identificadores de Meta. El `fbclid` solo está
    // en la URL de la primera visita, y si la clienta navega antes de comprar
    // se pierde para siempre.
    asegurarIdsMeta();

    const cancelMeta = trackMeta("InitiateCheckout");
    const cancelTikTok = trackTikTok("InitiateCheckout");
    return () => {
      cancelMeta();
      cancelTikTok();
    };
  }, []);

  // ── Coupon state (shared between form and order summary) ──────────────────
  //
  // `?cupon=` viene de los links de recuperación (/r/<token>): el descuento
  // llega ya aplicado para que la clienta no tenga que escribir el código.
  // Solo se acepta si existe en la tabla; el servidor lo revalida igual, así
  // que un código inventado en la URL no descuenta nada.
  const cuponUrl = searchParams.get("cupon")?.trim().toUpperCase() ?? "";
  const cuponUrlValido = COUPON_CODES[cuponUrl] !== undefined ? cuponUrl : "";

  // El carrito restaurado trae su propio cupón (el que la clienta tenía, o el
  // de recuperación si el link es con descuento) y manda sobre la URL.
  const cuponInicial =
    carritoRestaurado?.cupon && COUPON_CODES[carritoRestaurado.cupon] !== undefined
      ? carritoRestaurado.cupon
      : cuponUrlValido;
  const [coupon, setCoupon] = useState(cuponInicial);
  const [couponApplied, setCouponApplied] = useState(Boolean(cuponInicial));
  const [couponError, setCouponError] = useState("");

  const handleApplyCoupon = () => {
    const code = coupon.trim().toUpperCase();
    if (!code) return;
    if (COUPON_CODES[code] !== undefined) {
      setCouponApplied(true);
      setCouponError("");
    } else {
      setCouponError("Código no válido");
    }
  };

  // El navegador solo sabe si el código existe; quién ya lo gastó lo sabe el
  // servidor. Cuando lo rechaza se quita el descuento y se dice por qué, para
  // que la clienta pueda terminar la compra en vez de quedarse reintentando.
  const handleCouponRejected = (mensaje: string) => {
    setCouponApplied(false);
    setCoupon("");
    setCouponError(mensaje);
  };

  const handleCouponChange = (value: string) => {
    setCoupon(value);
    setCouponError("");
  };

  // ── Upsell catalog: fill data from Shopify + filter main product ─────────
  const UPSELL_PRODUCTS = useMemo<UpsellProduct[]>(() => {
    if (unified) return [];
    const filled = BASE_UPSELLS.map((p) => {
      // `?? p.shopifyVariantId` conserva el respaldo: un producto de Shopify
      // sin variantes no debe borrar el enlace que ya traíamos.
      if (p.id === "gomitas-pms" && gomitasProduct) {
        const v = gomitasProduct.variants[0];
        return {
          ...p,
          price: Math.round(parseFloat(v?.price ?? "0")),
          image: gomitasProduct.images[0]?.src ?? p.image,
          shopifyVariantId: v?.id ?? p.shopifyVariantId,
        };
      }
      if (p.id === "jabon-intimo-fem" && jabonProduct) {
        return { ...p, shopifyVariantId: jabonProduct.variants[0]?.id ?? p.shopifyVariantId };
      }
      if (p.id === "ovulos-fem" && ovulosProduct) {
        return { ...p, shopifyVariantId: ovulosProduct.variants[0]?.id ?? p.shopifyVariantId };
      }
      return p;
    });
    // No ofrecer como upsell lo que la clienta ya está comprando.
    //
    // Antes esto se comparaba solo por handle, y los handles escritos a mano
    // aquí no coincidían con los reales de Shopify ("jabon-intimo-fem" vs
    // "jabon-intimo-ph-neutro"): el filtro nunca se activaba y el mismo
    // producto se podía comprar dos veces en un mismo pedido, a dos precios
    // distintos. Ahora manda el ID de variante, que es el dato que Shopify
    // realmente usa; el handle queda como respaldo.
    return filled.filter((p) => {
      if (p.shopifyVariantId && variantesEnCarrito.has(p.shopifyVariantId)) return false;
      if (p.shopifyHandle === shopifyProduct?.handle) return false;
      if (p.id === "gomitas-pms" && (!p.price || !p.image)) return false;
      // Ofrecer algo agotado acaba en un pedido que no se puede despachar.
      if (p.shopifyVariantId && upsellsAgotados?.includes(p.shopifyVariantId)) return false;
      return true;
    });
  }, [gomitasProduct, jabonProduct, ovulosProduct, upsellsAgotados, shopifyProduct, variantesEnCarrito]);

  // ── Items & totals ────────────────────────────────────────────────────────
  const handleToggle = (id: string) =>
    setUpsellQty((prev) => ({ ...prev, [id]: prev[id] ? 0 : 1 }));

  const allItems = useMemo<OrderItem[]>(() => {
    const mainWithQty = modoEleccion
      ? itemsSeleccion
      : MAIN_ITEMS.map((item, i) => (i === 0 ? { ...item, quantity: mainQty } : item));
    const added = UPSELL_PRODUCTS.filter((p) => (upsellQty[p.id] ?? 0) > 0).map((p) => ({
      id: p.id,
      name: p.name,
      variant: p.variant,
      price: p.price,
      quantity: upsellQty[p.id],
      image: p.image,
      shopifyVariantId: p.shopifyVariantId,
    }));
    return [...mainWithQty, ...added];
  }, [upsellQty, mainQty, UPSELL_PRODUCTS, modoEleccion, itemsSeleccion]);

  const subtotal = useMemo(
    () => allItems.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [allItems]
  );

  const discountRate = couponApplied
    ? (COUPON_CODES[coupon.trim().toUpperCase()] ?? 0)
    : 0;
  const discount = Math.round(subtotal * discountRate);
  const total = subtotal - discount;

  return (
    <div className="min-h-screen bg-[#f5f5f5] flex flex-col">
      <CheckoutHeader />
      {unified && <div className="max-w-6xl mx-auto px-4 pt-5 w-full"><a href="/cart" className="text-sm underline">← Revisar productos en el carrito</a>{process.env.NEXT_PUBLIC_FEM_PREVIEW === 'true' && <p className="p-3 mt-3 bg-amber-50 text-amber-900 text-sm rounded-lg">Vista previa de prueba: no se generan cobros ni pedidos reales.</p>}</div>}

      {modoEleccion && (
        <>
          {couponApplied && cuponUrlValido && (
            <TemporizadorCupon
              codigo={cuponUrlValido}
              onExpirar={() => {
                // Se quita el descuento de verdad. Ver la nota del componente:
                // el servidor no impone la caducidad, así que quien reescriba
                // el código lo vuelve a aplicar. Es urgencia, no candado.
                setCouponApplied(false);
                setCoupon("");
              }}
            />
          )}
          <SelectorProductos
            catalogo={catalogo ?? []}
            cantidades={cantidades}
            onAgregar={agregarProducto}
            onQuitar={quitarProducto}
          />
        </>
      )}

      {mpStatus === "success" && (
        <div className="max-w-6xl mx-auto px-4 mt-6">
          <div className="bg-green-50 border border-green-200 rounded-lg p-5 flex items-center gap-3">
            <svg className="w-6 h-6 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <div>
              <p className="font-semibold text-green-800 text-sm">¡Pago aprobado!</p>
              <p className="text-green-700 text-xs mt-0.5">Tu pedido fue confirmado. Recibirás un mensaje con el seguimiento.</p>
            </div>
          </div>
        </div>
      )}

      {mpStatus === "pending" && (
        <div className="max-w-6xl mx-auto px-4 mt-6">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-5 flex items-center gap-3">
            <svg className="w-6 h-6 text-yellow-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="font-semibold text-yellow-800 text-sm">Pago pendiente</p>
              <p className="text-yellow-700 text-xs mt-0.5">Tu pago está siendo procesado. Te notificaremos cuando se confirme.</p>
            </div>
          </div>
        </div>
      )}

      {mpStatus === "failure" && (
        <div className="max-w-6xl mx-auto px-4 mt-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-5 flex items-center gap-3">
            <svg className="w-6 h-6 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            <div>
              <p className="font-semibold text-red-800 text-sm">Pago rechazado</p>
              <p className="text-red-700 text-xs mt-0.5">No se pudo procesar tu pago. Intenta de nuevo o elige otro método.</p>
            </div>
          </div>
        </div>
      )}

      <MobileOrderToggle
        items={allItems}
        subtotal={subtotal}
        shipping={unified ? 0 : SHIPPING}
        total={total}
        mainQty={mainQty}
        onMainQtyChange={unified ? undefined : setMainQty}
      />

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-6 lg:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-8 items-start">
          <CheckoutForm
            initialPayment={initialPayment}
            unified={unified}
            allItems={allItems}
            carritoVacio={carritoVacio}
            subtotal={subtotal}
            shipping={0}
            total={total}
            upsellProducts={UPSELL_PRODUCTS}
            upsellQty={upsellQty}
            onUpsellToggle={handleToggle}
            coupon={coupon}
            couponApplied={couponApplied}
            couponError={couponError}
            onCouponChange={handleCouponChange}
            onCouponApply={handleApplyCoupon}
            onCouponRejected={handleCouponRejected}
            discount={discount}
          />

          <aside className="hidden lg:block sticky top-24">
            <OrderSummary
              items={allItems}
              subtotal={subtotal}
              shipping={unified ? 0 : SHIPPING}
              total={total}
              coupon={coupon}
              couponApplied={couponApplied}
              couponError={couponError}
              discount={discount}
              onCouponChange={handleCouponChange}
              onCouponApply={unified ? undefined : handleApplyCoupon}
              mainQty={mainQty}
              onMainQtyChange={unified ? undefined : setMainQty}
            />
          </aside>
        </div>
      </main>

      <footer className="py-6 text-center border-t border-gray-100 bg-white">
        <div className="flex items-center justify-center gap-4 text-xs text-gray-400 flex-wrap">
          <span>© {new Date().getFullYear()} FEM · Todos los derechos reservados</span>
          <span className="hidden sm:inline">·</span>
          <a href="/pages/policy-privac" className="hover:text-[#fc5245] transition-colors">Política de privacidad</a>
          <span className="hidden sm:inline">·</span>
          <a href="/pages/terminos-y-condiciones-de-suscripcion" className="hover:text-[#fc5245] transition-colors">Términos y condiciones</a>
        </div>
      </footer>
    </div>
  );
}
