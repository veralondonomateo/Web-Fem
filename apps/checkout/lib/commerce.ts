/** FEM-owned catalog and order registry. No remote storefront calls. */
import ownedCatalog from '../../../content/catalog.json';
import type {OrderItem} from '../types/checkout';
import {createServerClient} from './supabase';
import {resolveOwnedItems} from './owned-cart';

export interface CommerceVariant {
  id: number;
  title: string;
  price: string;
  sku: string;
  inventory_quantity: number;
  inventory_management?: string | null;
  inventory_policy?: string;
  available?: boolean;
}
export interface CommerceProduct {
  id: number;
  title: string;
  handle: string;
  status: string;
  variants: CommerceVariant[];
  images: {id: number; src: string}[];
}
export const PRODUCTS_REVALIDATE = 300;
export function varianteAgotada(variant: CommerceVariant) { return variant.available === false; }
export async function getProducts(): Promise<CommerceProduct[]> {
  return ownedCatalog.map(product => ({
    id: product.id, title: product.title, handle: product.handle, status: 'active',
    variants: product.variants.map(variant => ({
      id: variant.id, title: variant.title, price: (variant.price / 100).toFixed(2),
      sku: variant.sku ?? '', inventory_quantity: variant.available ? 1 : 0,
      available: variant.available, inventory_management: 'fem', inventory_policy: 'deny',
    })),
    images: product.images.map((src, id) => ({id, src})),
  }));
}
export async function getProductByHandle(handle: string) {
  const product = ownedCatalog.find(p => p.handle === handle || (p.aliases as string[]).includes(handle));
  return product ? (await getProducts()).find(p => p.id === product.id) ?? null : null;
}
export const getProductByHandleFresh = getProductByHandle;
export async function findProductByTitle(pattern: RegExp) {
  return (await getProducts()).find(product => pattern.test(product.title)) ?? null;
}
export async function findProductBySku(sku: string) {
  for (const product of await getProducts()) {
    const variant = product.variants.find(v => v.sku === sku);
    if (variant) return {product, variant};
  }
  return null;
}
export async function registerOwnedOrder(orderId: string): Promise<number> {
  const {data, error} = await createServerClient().rpc('fem_register_order', {p_order_id: orderId});
  if (error) throw Error('No pudimos registrar el pedido FEM: ' + error.message);
  const id = Number(data);
  if (!Number.isSafeInteger(id) || id <= 0) throw Error('Referencia de pedido inválida');
  return id;
}
export async function validateOwnedItems(items: OrderItem[]): Promise<OrderItem[]> {
  if (!Array.isArray(items) || !items.length || items.length > 15) throw Error('Carrito inválido');
  const ids = items.map(item => item.shopifyVariantId).filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id));
  const {data: stock, error} = await createServerClient().from('fem_catalog_variants')
    .select('variant_id,price_cents,available,stock').in('variant_id', ids);
  if (error || !stock) throw Error('La tienda necesita completar la configuración del catálogo. Inténtalo más tarde.');
  return resolveOwnedItems(items, await getProducts(), stock);
}
