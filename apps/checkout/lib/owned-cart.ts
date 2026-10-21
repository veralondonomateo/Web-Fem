/** Pure validation shared by the checkout and its offline contract tests. */
export interface OwnedStock {
  variant_id: number | string;
  price_cents: number | string;
  available: boolean;
  stock: number | null;
}
interface Product {
  id: number;
  title: string;
  images: {src: string}[];
  variants: {id: number; title: string; price: string; available?: boolean}[];
}
interface Item {
  id: string;
  name: string;
  variant?: string;
  image: string;
  shopifyVariantId?: number;
  quantity: number;
  price: number;
}

export function resolveOwnedItems(items: Item[], products: Product[], stock: OwnedStock[]): Item[] {
  if (!Array.isArray(items) || !items.length || items.length > 15) {
    throw Error('Revisa los productos de tu carrito.');
  }
  const quantities = new Map<number, number>();
  return items.map(item => {
    const product = products.find(p => p.variants.some(v => v.id === item.shopifyVariantId));
    const variant = product?.variants.find(v => v.id === item.shopifyVariantId);
    const owned = stock.find(v => Number(v.variant_id) === item.shopifyVariantId);
    if (!variant || !product || !owned || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99 || !Number.isFinite(item.price)) {
      throw Error('Tu carrito cambió. Revisa los productos y sus precios antes de continuar.');
    }
    if (/suscripci[oó]n/i.test(variant.title)) {
      throw Error('Elige tu suscripción en Planes FEM para autorizar los cobros automáticos.');
    }
    const quantity = (quantities.get(variant.id) ?? 0) + item.quantity;
    quantities.set(variant.id, quantity);
    if (variant.available === false || !owned.available || Number(owned.price_cents) !== Math.round(item.price * 100) || Number(variant.price) !== item.price || (owned.stock !== null && owned.stock < quantity)) {
      throw Error('El producto o la cantidad seleccionada ya no están disponibles. Revisa tu carrito.');
    }
    // Names, images and prices always come from the server's catalog.
    return {...item, id: String(product.id), name: product.title, variant: variant.title, image: product.images[0]?.src ?? '', price: Number(owned.price_cents) / 100};
  });
}
