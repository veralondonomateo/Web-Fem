export interface CheckoutFormData {
  email: string;
  firstName: string;
  lastName: string;
  cedula?: string;
  address: string;
  complement?: string;
  state: string;
  city: string;
  phone: string;
  paymentMethod: "mercadopago" | "contraentrega";
  privacyAccepted: boolean;
  saveInfo?: boolean;
}

export interface StateData {
  id: number;
  id_country: number;
  name: string;
  cities: string[];
}

export interface StatesJson {
  states: StateData[];
}

/**
 * Versión mínima de un producto de Shopify: solo lo que el checkout usa.
 * El objeto completo (todas las imágenes, inventario, metadatos) viajaba
 * serializado en el HTML del RSC payload sin que el cliente lo necesitara.
 */
export interface CheckoutProduct {
  id: number;
  title: string;
  handle: string;
  variants: Array<{ id: number; title: string; price: string }>;
  images: Array<{ src: string }>;
}

export interface OrderItem {
  id: string;
  name: string;
  variant?: string;
  price: number;
  quantity: number;
  image: string;
  /** Shopify variant ID — used for proper inventory/product linking in orders */
  shopifyVariantId?: number;
}

export interface OrderSummaryProps {
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  total: number;
  discountCode?: string;
}

export type CheckoutStep = "contact" | "delivery" | "payment" | "confirmation";
