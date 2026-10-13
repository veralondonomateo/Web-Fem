/**
 * Catálogo único de las credenciales que necesita el CRM.
 *
 * Este archivo es la fuente de verdad para tres cosas a la vez: la página de
 * Ajustes, el endpoint de estado y el `.env.example`. Si mañana aparece otra
 * integración, se añade aquí y las tres se enteran solas.
 *
 * Regla dura: aquí NUNCA se exporta el valor de una variable, solo si existe.
 * Los secretos no salen del servidor.
 */

export type PlatformKey = 'DATABASE' | 'APP' | 'MASTERSHOP' | 'META' | 'SHOPIFY' | 'CHECKOUT';

export interface EnvVarSpec {
  name: string;
  /** Sin esta variable la integración no funciona en absoluto. */
  required: boolean;
  /** Para qué sirve, en una línea, en la página de Ajustes. */
  help: string;
}

export interface PlatformSpec {
  key: PlatformKey;
  label: string;
  /** Qué deja de funcionar si esta integración está caída. */
  purpose: string;
  /** Dónde se sacan las credenciales. */
  where: string;
  vars: EnvVarSpec[];
  /** Rutas que hay que registrar en el panel del proveedor. */
  webhooks: { path: string; note: string }[];
}

export const PLATFORMS: PlatformSpec[] = [
  {
    key: 'DATABASE',
    label: 'Base de datos (Supabase)',
    purpose: 'Guarda clientas, pedidos, conversaciones y flujos. Sin ella no arranca nada.',
    where: 'Supabase → Project Settings → Database / API',
    vars: [
      { name: 'DATABASE_URL',              required: true,  help: 'Transaction pooler (puerto 6543). Es la que usa la app en Vercel.' },
      { name: 'DIRECT_URL',                required: true,  help: 'Conexión directa (puerto 5432). Solo para migraciones de Prisma.' },
      { name: 'SUPABASE_URL',              required: true,  help: 'URL del proyecto Supabase.' },
      { name: 'SUPABASE_SERVICE_ROLE_KEY', required: true,  help: 'Clave de servicio. Autentica el login. Solo servidor, nunca en el navegador.' },
    ],
    webhooks: [],
  },
  {
    key: 'APP',
    label: 'La propia app',
    purpose: 'Firma la sesión, protege los crons y arma las URLs de webhook.',
    where: 'Las generas tú: openssl rand -base64 48',
    vars: [
      { name: 'JWT_SECRET',          required: true,  help: 'Cadena aleatoria larga: firma la sesión y los enlaces temporales de adjuntos.' },
      { name: 'CRON_SECRET',         required: true,  help: 'Sin ella, cualquiera puede disparar /api/cron/* desde fuera.' },
      { name: 'NEXT_PUBLIC_APP_URL', required: false, help: 'Dominio público del CRM. Si falta, se deduce del de Vercel.' },
    ],
    webhooks: [],
  },
  {
    key: 'MASTERSHOP',
    label: 'Mastershop',
    purpose: 'Origen de los pedidos, las guías y los estados de envío.',
    where: 'Mastershop → Configuración → Integraciones / API',
    vars: [
      { name: 'MASTERSHOP_API_KEY',        required: true,  help: 'Se envía como cabecera ms-api-key en cada llamada.' },
      { name: 'MASTERSHOP_WEBHOOK_SECRET', required: false, help: 'Valida que el webhook viene de Mastershop.' },
      { name: 'MASTERSHOP_API_URL',        required: false, help: 'Solo si usan un host distinto al de producción.' },
    ],
    webhooks: [
      { path: '/api/webhooks/mastershop', note: 'Eventos de pedido: creado, por alistar, en tránsito, entregado, novedad, devuelto.' },
    ],
  },
  {
    key: 'META',
    label: 'Meta · WhatsApp, Instagram y Facebook',
    purpose: 'Manda y recibe los mensajes de la bandeja y las plantillas de los flujos.',
    where: 'developers.facebook.com → tu app → WhatsApp / Messenger',
    vars: [
      { name: 'WHATSAPP_ACCESS_TOKEN',        required: true,  help: 'Token permanente de un usuario de sistema. Los de 24 h no sirven.' },
      { name: 'WHATSAPP_PHONE_NUMBER_ID',     required: true,  help: 'ID del número desde el que se escribe.' },
      { name: 'WHATSAPP_BUSINESS_ACCOUNT_ID', required: true,  help: 'WABA ID: hace falta para listar y crear plantillas.' },
      { name: 'META_APP_SECRET',              required: true,  help: 'Verifica la firma de cada webhook entrante.' },
      { name: 'META_WEBHOOK_VERIFY_TOKEN',    required: true,  help: 'Cadena que tú inventas y repites en el panel de Meta.' },
      { name: 'META_INSTAGRAM_ACCOUNT_ID',    required: false, help: 'Solo si se atiende Instagram Direct: separa lo de IG de lo de Messenger.' },
    ],
    webhooks: [
      { path: '/api/webhooks/meta', note: 'Suscribir a messages y message_status. Usa el mismo verify token.' },
    ],
  },
  {
    key: 'SHOPIFY',
    label: 'Shopify (opcional)',
    purpose: 'No hace falta: la venta entra por el checkout propio y los pedidos llegan por Mastershop. Solo sirve si algún día se quiere leer la tienda directamente.',
    where: 'Shopify admin → Settings → Apps and sales channels → Develop apps',
    vars: [
      { name: 'SHOPIFY_SHOP_DOMAIN',   required: false, help: 'Por ejemplo fem-co.myshopify.com' },
      { name: 'SHOPIFY_ACCESS_TOKEN',  required: false, help: 'Admin API access token (empieza por shpat_).' },
      { name: 'SHOPIFY_WEBHOOK_SECRET', required: false, help: 'Clave de firma de los webhooks. Sin ella no se puede validar el origen.' },
    ],
    webhooks: [
      { path: '/api/webhooks/shopify/orders/create',    note: 'Evento orders/create.' },
      { path: '/api/webhooks/shopify/orders/fulfilled', note: 'Evento orders/fulfilled.' },
    ],
  },
  {
    key: 'CHECKOUT',
    label: 'Checkout propio (carritos abandonados)',
    purpose: 'De aquí salen los carritos abandonados y sus links de recuperación. Shopify solo recibe los pedidos ya cerrados.',
    where: 'checkoutfem.com → variables de entorno en Vercel',
    vars: [
      { name: 'CHECKOUT_API_KEY',       required: true,  help: 'La misma CRM_API_KEY que tiene configurada el checkout. Da acceso a nombres, celulares y direcciones.' },
      { name: 'CHECKOUT_WEBHOOK_SECRET', required: false, help: 'Firma HMAC de los carritos que empuja el checkout. Sin ella, el webhook acepta cualquier POST.' },
      { name: 'CHECKOUT_API_URL',       required: false, help: 'Solo para apuntar a otro entorno. Por defecto https://checkoutfem.com/api/crm' },
    ],
    webhooks: [
      { path: '/api/webhooks/carritos', note: 'Va en CRM_WEBHOOK_URL del checkout. Opcional: la cola se lee igual por cursor cada 10 min.' },
    ],
  },
];

/** Solo booleanos: qué variables están puestas y cuáles faltan. */
export function inspectPlatform(spec: PlatformSpec) {
  const vars = spec.vars.map(v => ({
    ...v,
    present: Boolean(process.env[v.name]?.trim()),
  }));
  const missingRequired = vars.filter(v => v.required && !v.present).map(v => v.name);

  return {
    key: spec.key,
    label: spec.label,
    purpose: spec.purpose,
    where: spec.where,
    webhooks: spec.webhooks,
    vars,
    ready: missingRequired.length === 0,
    missingRequired,
  };
}
