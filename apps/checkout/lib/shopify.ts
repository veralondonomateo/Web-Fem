// ── Data sanitizers ────────────────────────────────────────────────────────────────────
function stripEmojis(str: string): string {
  // Extended_Pictographic covers all emoji-capable symbols (incl. geometric shapes like ▪ U+25AA)
  return str
    .replace(/\p{Extended_Pictographic}[\u{FE00}-\u{FE0F}]?/gu, "")
    .replace(/[\u{FE00}-\u{FE0F}\u{200D}]/gu, "")
    .trim();
}

function sanitizeEmail(email: string): string {
  // Trim whitespace and collapse internal spaces (common typo on mobile)
  return email.trim().toLowerCase().replace(/\s+/g, "");
}

// ── Auth: prefer static SHOPIFY_ACCESS_TOKEN, fall back to OAuth client_credentials ──
let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  // Static token (custom app) — simplest and most reliable
  if (process.env.SHOPIFY_ACCESS_TOKEN) {
    return process.env.SHOPIFY_ACCESS_TOKEN;
  }

  // OAuth client_credentials flow (fallback)
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }
  const oauthUrl = `https://${process.env.SHOPIFY_DOMAIN}/admin/oauth/access_token`;
  console.log(`[Shopify Auth] Requesting token from ${oauthUrl} with client_id=${process.env.SHOPIFY_CLIENT_ID?.slice(0, 8)}...`);
  const res = await fetch(oauthUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID!,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET!,
    }),
  });
  const responseText = await res.text();
  console.log(`[Shopify Auth] OAuth response ${res.status}: ${responseText.slice(0, 300)}`);
  if (!res.ok) throw new Error(`Shopify token error ${res.status}: ${responseText.slice(0, 200)}`);
  const data = JSON.parse(responseText);
  tokenCache = {
    token: data.access_token,
    expiresAt: now + ((data.expires_in ?? 3600) - 300) * 1000,
  };
  return tokenCache.token;
}

// ── REST client ────────────────────────────────────────────────────────────────
const API_VERSION = "2024-10";

/**
 * `revalidate` (segundos) activa el Data Cache de Next para lecturas que pueden
 * servirse tibias — el catálogo de productos. Sin él, cada visita al checkout
 * pagaba una ida y vuelta completa a la Admin API antes del primer byte.
 * Las escrituras (órdenes) siguen sin caché.
 */
async function shopifyFetchWithHeaders<T>(
  path: string,
  options?: RequestInit & { revalidate?: number }
): Promise<{ data: T; headers: Headers }> {
  const token = await getAccessToken();
  const url = `https://${process.env.SHOPIFY_DOMAIN}/admin/api/${API_VERSION}${path}`;
  const { revalidate, ...init } = options ?? {};
  const res = await fetch(url, {
    ...init,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...(revalidate !== undefined
      ? { next: { revalidate } }
      : { cache: "no-store" as const }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify API ${res.status}: ${text}`);
  }
  return { data: (await res.json()) as T, headers: res.headers };
}

async function shopifyFetch<T>(
  path: string,
  options?: RequestInit & { revalidate?: number }
): Promise<T> {
  const { data } = await shopifyFetchWithHeaders<T>(path, options);
  return data;
}

/**
 * Extrae el cursor `page_info` de la siguiente página del header `Link`.
 * Shopify pagina así en REST: `<...page_info=XYZ>; rel="next"`.
 */
function nextPageInfo(headers: Headers): string | null {
  const link = headers.get("link") ?? headers.get("Link");
  if (!link) return null;
  for (const part of link.split(",")) {
    if (!part.includes('rel="next"')) continue;
    const match = part.match(/[?&]page_info=([^&>]+)/);
    if (match) return match[1];
  }
  return null;
}

// ── GraphQL client ─────────────────────────────────────────────────────────────
async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  const token = await getAccessToken();
  const url = `https://${process.env.SHOPIFY_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Shopify GraphQL ${res.status}: ${text}`);
  }
  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(
      `Shopify GraphQL errors: ${json.errors.map((e) => e.message).join(", ")}`
    );
  }
  return json.data as T;
}

// ── Types ──────────────────────────────────────────────────────────────────────
export interface ShopifyVariant {
  id: number;
  title: string;
  price: string;
  sku: string;
  inventory_quantity: number;
  /** "shopify" cuando Shopify lleva el inventario; null si no se controla. */
  inventory_management?: string | null;
  /** "deny" no deja vender sin stock; "continue" sí. */
  inventory_policy?: string;
}

/**
 * Una variante está agotada solo si Shopify lleva su inventario, no permite
 * vender sin stock y no le queda nada. Si el inventario no se controla, o se
 * permite sobrevender, Shopify aceptaría el pedido igual y no la escondemos.
 */
export function varianteAgotada(v: ShopifyVariant): boolean {
  return (
    v.inventory_management === "shopify" &&
    v.inventory_policy === "deny" &&
    v.inventory_quantity <= 0
  );
}

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  status: string;
  variants: ShopifyVariant[];
  images: { id: number; src: string }[];
}

// ── Product cache (5 min TTL) ──────────────────────────────────────────────────
let productCache: { products: ShopifyProduct[]; fetchedAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

async function getCachedProducts(): Promise<ShopifyProduct[]> {
  const now = Date.now();
  if (productCache && now - productCache.fetchedAt < CACHE_TTL) {
    return productCache.products;
  }
  const products = await getProducts();
  productCache = { products, fetchedAt: now };
  return products;
}

/** Find the first active product whose title matches a pattern */
export async function findProductByTitle(
  pattern: RegExp
): Promise<ShopifyProduct | null> {
  const products = await getCachedProducts();
  return products.find((p) => pattern.test(p.title)) ?? null;
}

/** Find the product and exact variant that has the given SKU */
export async function findProductBySku(
  sku: string
): Promise<{ product: ShopifyProduct; variant: ShopifyVariant } | null> {
  const products = await getCachedProducts();
  for (const product of products) {
    const variant = product.variants.find((v) => v.sku === sku);
    if (variant) return { product, variant };
  }
  return null;
}

// ── Product queries ────────────────────────────────────────────────────────────
/** TTL del catálogo en el Data Cache de Next (precios/stock cambian poco). */
export const PRODUCTS_REVALIDATE = 300;

/** Tope de páginas: 250 productos cada una. Evita un bucle infinito si el
 *  header `Link` viniera mal formado. */
const MAX_PRODUCT_PAGES = 20;

export async function getProducts(): Promise<ShopifyProduct[]> {
  const FIELDS = "id,title,handle,status,variants,images";
  const all: ShopifyProduct[] = [];
  let path = `/products.json?limit=250&status=active&fields=${FIELDS}`;

  // Antes se pedía una sola página de 250: con el catálogo por encima de ese
  // número, los productos sobrantes simplemente no existían para el checkout
  // ni para el admin, y sus links caían a "no disponible" sin razón.
  for (let page = 0; page < MAX_PRODUCT_PAGES; page++) {
    const { data, headers } = await shopifyFetchWithHeaders<{ products: ShopifyProduct[] }>(
      path,
      { revalidate: PRODUCTS_REVALIDATE }
    );
    all.push(...data.products);

    const pageInfo = nextPageInfo(headers);
    if (!pageInfo) return all;
    // Con page_info, Shopify solo admite `limit` y `fields` como acompañantes.
    path = `/products.json?limit=250&fields=${FIELDS}&page_info=${pageInfo}`;
  }

  console.warn(`[Shopify] getProducts cortó en ${MAX_PRODUCT_PAGES} páginas (${all.length} productos)`);
  return all;
}

/**
 * Consulta un handle sin pasar por caché.
 *
 * El catálogo se sirve con 5 minutos de caché. Eso está bien para pintar el
 * checkout, pero no para declarar que un producto "no existe": un producto
 * recién creado, o recién republicado, no aparecería hasta que expire la
 * caché, y sus links mostrarían "no disponible" sin serlo. Esta consulta se
 * usa solo antes de dar ese veredicto, así que cuesta una llamada extra
 * únicamente en el camino de error.
 */
export async function getProductByHandleFresh(
  handle: string
): Promise<ShopifyProduct | null> {
  const data = await shopifyFetch<{ products: ShopifyProduct[] }>(
    `/products.json?handle=${encodeURIComponent(handle)}&limit=1&status=active&fields=id,title,handle,status,variants,images`
  );
  return data.products[0] ?? null;
}

export async function getProductByHandle(
  handle: string
): Promise<ShopifyProduct | null> {
  // Try exact handle first
  const data = await shopifyFetch<{ products: ShopifyProduct[] }>(
    `/products.json?handle=${encodeURIComponent(handle)}&limit=1&fields=id,title,handle,status,variants,images`,
    { revalidate: PRODUCTS_REVALIDATE }
  );
  if (data.products[0]) return data.products[0];

  // Fallback: search all cached products by handle similarity
  const products = await getCachedProducts();
  return (
    products.find(
      (p) => p.handle === handle || p.handle.includes(handle.replace(/-/g, ""))
    ) ?? null
  );
}

// ── Order creation ─────────────────────────────────────────────────────────────
export interface ShopifyOrderInput {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
  complement?: string | null;
  city: string;
  state: string;
  items: Array<{
    name: string;
    variant?: string | null;
    price: number;
    quantity: number;
    shopifyVariantId?: number | null;
  }>;
  shipping: number;
  total: number;
  paymentMethod: "mercadopago" | "contraentrega";
  mpPaymentId?: string | null;
  femOrderId: string;
  couponCode?: string | null;
  discount?: number | null;
  /**
   * Etiquetas adicionales, encima de las de siempre. Hoy solo la usa el
   * entorno de pruebas de Sendura, para poder filtrar y anular esos pedidos
   * en Shopify sin confundirlos con ventas reales.
   */
  extraTags?: string[];
}

export async function createShopifyOrder(
  input: ShopifyOrderInput
): Promise<number> {
  const isPaid = input.paymentMethod === "mercadopago";

  // Un item sin variant_id entra a Shopify como línea suelta: no descuenta
  // inventario, no suma al reporte del producto y no se puede devolver contra
  // el SKU. Antes pasaba en silencio; ahora queda registrado y avisa.
  const unlinked = input.items.filter((i) => !i.shopifyVariantId);
  if (unlinked.length > 0) {
    const detail = unlinked.map((i) => `${i.name}${i.variant ? ` – ${i.variant}` : ""}`).join(", ");
    console.error(`[ITEM-SUELTO] Pedido ${input.femOrderId}: ${detail}`);
  }

  // Sanitize all text fields — the new Shopify API rejects emojis and malformed emails
  const sanitized = sanitizeEmail(input.email);
  // Stricter than the naive /[^\s@]+/ pattern: TLD must be letters-only, no trailing/double
  // dots, and no dot immediately before the @ (e.g. "jeann.@hotmail.com") — Shopify rejects
  // all of these with "customer.email_address is invalid" even though a looser regex passes them.
  const isValidEmail =
    !sanitized.endsWith(".") &&
    !sanitized.includes("..") &&
    !sanitized.includes(".@") &&
    /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(sanitized);
  // Some old orders have phone numbers/malformed addresses stored as email — use synthetic fallback
  const cleanEmail = isValidEmail ? sanitized : `pedido-${input.femOrderId.slice(0, 8)}@checkoutfem.com`;
  const cleanFirst = stripEmojis(input.firstName);
  const cleanLast = stripEmojis(input.lastName);
  const cleanAddress = stripEmojis(input.address);
  const cleanComplement = input.complement ? stripEmojis(input.complement) : "";
  const cleanCity = stripEmojis(input.city);
  const cleanState = stripEmojis(input.state);

  const orderBody: Record<string, unknown> = {
    email: cleanEmail,
    financial_status: isPaid ? "paid" : "pending",
    currency: "COP",
    suppress_notifications: true,
    line_items: input.items.map((item) => {
      const base: Record<string, unknown> = {
        price: item.price.toFixed(2),
        quantity: item.quantity,
        requires_shipping: true,
      };
      if (item.shopifyVariantId) {
        base.variant_id = item.shopifyVariantId;
      } else {
        base.title = item.variant ? `${stripEmojis(item.name)} – ${stripEmojis(item.variant)}` : stripEmojis(item.name);
      }
      return base;
    }),
    shipping_address: {
      first_name: cleanFirst,
      last_name: cleanLast,
      address1: cleanAddress,
      address2: cleanComplement,
      city: cleanCity,
      province: cleanState,
      country_code: "CO",
      phone: `+57${input.phone.replace(/\D/g, "")}`,
    },
    note_attributes: [
      { name: "fem_order_id", value: input.femOrderId },
      { name: "payment_method", value: input.paymentMethod },
      ...(isPaid ? [{name:"regalo_pago_anticipado",value:"1 gorro de satín rosado · sin costo"}] : []),
      ...(input.mpPaymentId
        ? [{ name: "mp_payment_id", value: input.mpPaymentId }]
        : []),
      ...(input.couponCode
        ? [{ name: "coupon_code", value: input.couponCode }]
        : []),
    ],
    tags: [`fem-checkout`, input.paymentMethod, ...(isPaid ? ["regalo-gorro-satin-rosado"] : []), ...(input.extraTags ?? [])].join(","),
  };

  if (input.couponCode && input.discount && input.discount > 0) {
    orderBody.discount_codes = [
      {
        code: input.couponCode,
        amount: input.discount.toFixed(2),
        type: "fixed_amount",
      },
    ];
  }

  if (input.shipping > 0) {
    orderBody.shipping_lines = [
      {
        title: "Envío estándar",
        price: input.shipping.toFixed(2),
        code: "standard",
      },
    ];
  }

  // transactions[].gateway es lo que Shopify usa para llenar payment_gateway_names
  if (isPaid) {
    orderBody.transactions = [
      {
        kind: "sale",
        status: "success",
        amount: input.total.toFixed(2),
        gateway: "pago anticipado",
      },
    ];
  } else {
    // Contraentrega: transacción pendiente — Shopify llena payment_gateway_names
    // con el valor de gateway. El nombre debe coincidir exactamente con el
    // método de pago manual configurado en Shopify Settings > Payments.
    orderBody.transactions = [
      {
        kind: "sale",
        status: "pending",
        amount: input.total.toFixed(2),
        gateway: "contraentrega",
      },
    ];
  }

  const result = await shopifyFetch<{
    order: { id: number; order_number: number };
  }>("/orders.json", {
    method: "POST",
    body: JSON.stringify({ order: orderBody }),
  });

  console.log(
    `[Shopify] Orden #${result.order.order_number} creada (ID: ${result.order.id})`
  );
  return result.order.id;
}

// ── Add line item to existing order (Order Editing API — GraphQL) ──────────────
/**
 * Adds a product line item to an existing Shopify order via the Order Editing API.
 * When shopifyVariantId is provided, links to the real Shopify product/variant
 * (inventory tracked) and applies a price override if the variant's Shopify price
 * differs from the desired upsell price. Falls back to a custom item if no variant.
 */
export async function addLineItemToShopifyOrder(
  shopifyOrderId: number,
  item: {
    name: string;
    variant?: string | null;
    price: number; // desired final price (COP)
    quantity: number;
    shopifyVariantId?: number | null; // links to real Shopify product
    shopifyVariantPrice?: number | null; // current Shopify variant price (for discount calc)
  }
): Promise<void> {
  const orderId = `gid://shopify/Order/${shopifyOrderId}`;
  const title = item.variant ? `${item.name} – ${item.variant}` : item.name;

  // Step 1: Begin order edit
  const beginData = await shopifyGraphQL<{
    orderEditBegin: {
      calculatedOrder: { id: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(
    `mutation Begin($id: ID!) {
      orderEditBegin(id: $id) {
        calculatedOrder { id }
        userErrors { field message }
      }
    }`,
    { id: orderId }
  );

  const beginErrors = beginData.orderEditBegin.userErrors;
  if (beginErrors.length > 0) {
    throw new Error(`orderEditBegin: ${beginErrors.map((e) => e.message).join(", ")}`);
  }
  const calcId = beginData.orderEditBegin.calculatedOrder?.id;
  if (!calcId) throw new Error("orderEditBegin returned no calculatedOrder");

  let lineItemId: string | null = null;

  if (item.shopifyVariantId) {
    // Step 2a: Add by variant → properly linked to the Shopify product
    const addData = await shopifyGraphQL<{
      orderEditAddVariant: {
        calculatedLineItem: { id: string } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(
      `mutation AddVariant($id: ID!, $variantId: ID!, $qty: Int!) {
        orderEditAddVariant(id: $id, variantId: $variantId, quantity: $qty, allowDuplicates: true) {
          calculatedLineItem { id }
          userErrors { field message }
        }
      }`,
      {
        id: calcId,
        variantId: `gid://shopify/ProductVariant/${item.shopifyVariantId}`,
        qty: item.quantity,
      }
    );

    const addErrors = addData.orderEditAddVariant.userErrors;
    if (addErrors.length > 0) {
      throw new Error(`orderEditAddVariant: ${addErrors.map((e) => e.message).join(", ")}`);
    }
    lineItemId = addData.orderEditAddVariant.calculatedLineItem?.id ?? null;

    // Step 2b: Override price if the Shopify variant price differs from our upsell price
    const shopifyPrice = item.shopifyVariantPrice ?? null;
    const discountAmount = shopifyPrice !== null ? shopifyPrice - item.price : 0;
    if (lineItemId && discountAmount > 0) {
      const discountData = await shopifyGraphQL<{
        orderEditSetLineItemDiscount: {
          userErrors: Array<{ field: string[]; message: string }>;
        };
      }>(
        `mutation SetDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
          orderEditSetLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
            calculatedLineItem { id }
            userErrors { field message }
          }
        }`,
        {
          id: calcId,
          lineItemId,
          discount: {
            description: "Precio upsell post-compra",
            fixedValue: { amount: discountAmount.toFixed(2), currencyCode: "COP" },
          },
        }
      );
      const discountErrors = discountData.orderEditSetLineItemDiscount.userErrors;
      if (discountErrors.length > 0) {
        // Non-fatal: product is still added, just at Shopify price
        console.warn(`[Shopify] Discount warning: ${discountErrors.map((e) => e.message).join(", ")}`);
      }
    }
  } else {
    // Step 2 fallback: custom item (no inventory link) with exact price
    const addData = await shopifyGraphQL<{
      orderEditAddCustomItem: {
        calculatedLineItem: { id: string } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(
      `mutation AddCustom($id: ID!, $title: String!, $price: MoneyInput!, $qty: Int!) {
        orderEditAddCustomItem(id: $id, title: $title, price: $price, quantity: $qty, requiresShipping: true) {
          calculatedLineItem { id }
          userErrors { field message }
        }
      }`,
      {
        id: calcId,
        title,
        price: { amount: item.price.toFixed(2), currencyCode: "COP" },
        qty: item.quantity,
      }
    );

    const addErrors = addData.orderEditAddCustomItem.userErrors;
    if (addErrors.length > 0) {
      throw new Error(`orderEditAddCustomItem: ${addErrors.map((e) => e.message).join(", ")}`);
    }
  }

  // Step 3: Commit the edit
  const commitData = await shopifyGraphQL<{
    orderEditCommit: {
      order: { id: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(
    `mutation Commit($id: ID!, $staffNote: String!) {
      orderEditCommit(id: $id, notifyCustomer: false, staffNote: $staffNote) {
        order { id }
        userErrors { field message }
      }
    }`,
    { id: calcId, staffNote: "Upsell post-compra: jabón añadido desde thank-you page" }
  );

  const commitErrors = commitData.orderEditCommit.userErrors;
  if (commitErrors.length > 0) {
    throw new Error(`orderEditCommit: ${commitErrors.map((e) => e.message).join(", ")}`);
  }

  console.log(`[Shopify] Line item "${title}" añadido a orden ${shopifyOrderId}`);
}

// ── Order notes ────────────────────────────────────────────────────────────────
/** Append a plain text note to an existing Shopify order */
export async function addNoteToShopifyOrder(
  shopifyOrderId: number,
  note: string
): Promise<void> {
  const current = await shopifyFetch<{ order: { note: string | null } }>(
    `/orders/${shopifyOrderId}.json?fields=note`
  );
  const existing = current.order.note ?? "";
  const combined = existing ? `${existing}\n${note}` : note;

  await shopifyFetch(`/orders/${shopifyOrderId}.json`, {
    method: "PUT",
    body: JSON.stringify({ order: { note: combined } }),
  });
}
