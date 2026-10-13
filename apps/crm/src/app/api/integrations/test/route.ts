import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import type { PlatformKey } from '@/lib/integrations';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface TestResult {
  ok: boolean;
  /** Frase corta y accionable: qué pasó y, si falló, qué revisar. */
  detail: string;
}

/**
 * Prueba de verdad contra cada proveedor. Tener la variable puesta no significa
 * que sirva: un token caducado o un dominio mal escrito solo se ven llamando.
 */
async function testDatabase(): Promise<TestResult> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const customers = await prisma.customer.count();
    return { ok: true, detail: `Conectada. ${customers} clienta${customers === 1 ? '' : 's'} en la base.` };
  } catch (e: any) {
    return { ok: false, detail: `No conecta: ${e.message ?? 'error desconocido'}. Revisa DATABASE_URL.` };
  }
}

/**
 * Aquí no hay a quién llamar: lo que puede fallar es que el secreto exista pero
 * sea corto o de ejemplo, y eso sí se puede comprobar.
 */
async function testApp(): Promise<TestResult> {
  const jwt  = process.env.JWT_SECRET ?? '';
  const cron = process.env.CRON_SECRET ?? '';
  const problemas: string[] = [];

  if (!jwt) problemas.push('falta JWT_SECRET');
  else if (jwt.length < 32) problemas.push('JWT_SECRET es demasiado corto (usa 48 bytes aleatorios)');
  else if (/^(secret|changeme|demo|test|preview)/i.test(jwt)) problemas.push('JWT_SECRET parece de ejemplo');

  if (!cron) problemas.push('falta CRON_SECRET: los crons quedan abiertos a cualquiera');

  if (process.env.ALLOW_DEV_LOGIN === 'true') {
    problemas.push('ALLOW_DEV_LOGIN está activo (inofensivo aquí porque la base no es local, pero sobra)');
  }

  return problemas.length
    ? { ok: false, detail: problemas.join(' · ') }
    : { ok: true, detail: 'Secretos presentes y con longitud suficiente.' };
}

async function testMastershop(): Promise<TestResult> {
  const key = process.env.MASTERSHOP_API_KEY;
  if (!key) return { ok: false, detail: 'Falta MASTERSHOP_API_KEY.' };

  const base = process.env.MASTERSHOP_API_URL || 'https://prod.api.mastershop.com/api';
  try {
    const res = await fetch(`${base}/orders/list?page=1&limit=1`, {
      method: 'POST',
      headers: { 'ms-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, detail: 'La API rechazó la llave (401/403). Genera una nueva en Mastershop.' };
    }
    if (!res.ok) return { ok: false, detail: `La API respondió ${res.status}.` };
    const data = await res.json();
    const n = Array.isArray(data) ? data.length : 0;
    return { ok: true, detail: n > 0 ? 'Responde y devuelve pedidos.' : 'Responde, pero sin pedidos en la ventana por defecto.' };
  } catch (e: any) {
    return { ok: false, detail: `No se pudo alcanzar la API: ${e.message ?? 'error de red'}.` };
  }
}

async function testMeta(): Promise<TestResult> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const waba  = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!token) return { ok: false, detail: 'Falta WHATSAPP_ACCESS_TOKEN.' };
  if (!waba)  return { ok: false, detail: 'Falta WHATSAPP_BUSINESS_ACCOUNT_ID.' };

  try {
    const res = await fetch(
      `https://graph.facebook.com/v23.0/${waba}/message_templates?fields=name,status&limit=50`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await res.json();
    if (!res.ok || data.error) {
      const msg = data.error?.message ?? `HTTP ${res.status}`;
      const caducado = /expired|session|OAuth/i.test(msg);
      return {
        ok: false,
        detail: caducado
          ? `Token inválido o caducado: ${msg}. Genera uno permanente con un usuario de sistema.`
          : `Meta respondió: ${msg}`,
      };
    }
    const total = data.data?.length ?? 0;
    const aprobadas = data.data?.filter((t: any) => t.status === 'APPROVED').length ?? 0;
    return { ok: true, detail: `Conectada. ${total} plantilla${total === 1 ? '' : 's'}, ${aprobadas} aprobada${aprobadas === 1 ? '' : 's'}.` };
  } catch (e: any) {
    return { ok: false, detail: `No se pudo alcanzar Graph API: ${e.message ?? 'error de red'}.` };
  }
}

async function testShopify(): Promise<TestResult> {
  const domain = process.env.SHOPIFY_SHOP_DOMAIN;
  const token  = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!domain) return { ok: false, detail: 'Falta SHOPIFY_SHOP_DOMAIN.' };
  if (!token)  return { ok: false, detail: 'Falta SHOPIFY_ACCESS_TOKEN.' };

  const host = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  try {
    const res = await fetch(`https://${host}/admin/api/2024-10/shop.json`, {
      headers: { 'X-Shopify-Access-Token': token },
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, detail: 'Shopify rechazó el token. Revisa los scopes de la app privada.' };
    }
    if (!res.ok) return { ok: false, detail: `Shopify respondió ${res.status}. Revisa el dominio.` };
    const data = await res.json();
    return { ok: true, detail: `Conectada a "${data.shop?.name ?? host}".` };
  } catch (e: any) {
    return { ok: false, detail: `No se pudo alcanzar la tienda: ${e.message ?? 'error de red'}.` };
  }
}

async function testCheckout(): Promise<TestResult> {
  if (!process.env.CHECKOUT_API_KEY) return { ok: false, detail: 'Falta CHECKOUT_API_KEY.' };

  try {
    const { listarCarritos } = await import('@/services/checkout-fem');
    const pagina = await listarCarritos({ limite: 1 });
    return {
      ok: true,
      detail: `Conectado. ${pagina.cantidad} carrito${pagina.cantidad === 1 ? '' : 's'} en esta página` +
              `${pagina.hay_mas ? ' y hay más en la cola' : ''}.`,
    };
  } catch (e: any) {
    const msg = String(e?.message ?? 'error de red');
    return {
      ok: false,
      detail: msg.includes('401')
        ? 'El checkout rechazó la llave. Revisa que CHECKOUT_API_KEY coincida con su CRM_API_KEY.'
        : `No se pudo alcanzar el checkout: ${msg}`,
    };
  }
}

const TESTS: Record<PlatformKey, () => Promise<TestResult>> = {
  DATABASE:   testDatabase,
  APP:        testApp,
  MASTERSHOP: testMastershop,
  META:       testMeta,
  CHECKOUT:   testCheckout,
  SHOPIFY:    testShopify,
};

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  if (user.role !== 'ADMIN') return forbidden();

  const { platform } = await req.json().catch(() => ({ platform: null }));
  const run = TESTS[platform as PlatformKey];
  if (!run) return NextResponse.json({ error: 'Plataforma desconocida' }, { status: 400 });

  const result = await run();
  return NextResponse.json({ platform, ...result });
}
