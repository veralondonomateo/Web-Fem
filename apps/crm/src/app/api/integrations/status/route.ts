import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { PLATFORMS, inspectPlatform } from '@/lib/integrations';

export const dynamic = 'force-dynamic';

/**
 * Qué credenciales están puestas y cuáles faltan. Devuelve booleanos, nunca
 * valores: quien tenga sesión de agente no debería poder leer los secretos, y
 * de todos modos no hay razón para que salgan del servidor.
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  if (user.role !== 'ADMIN') return forbidden();

  const platforms = PLATFORMS.map(inspectPlatform);

  // Última sincronización registrada por integración, para saber si el cron vive.
  let lastSync: Record<string, string | null> = {};
  try {
    const configs = await prisma.integrationConfig.findMany({
      select: { platform: true, lastSyncAt: true },
    });
    lastSync = Object.fromEntries(
      configs.map(c => [c.platform, c.lastSyncAt?.toISOString() ?? null]),
    );
  } catch (e) {
    console.error('[integrations/status] lastSync', e);
  }

  // La URL pública real, para poder copiar los webhooks sin escribirlos a mano.
  const origin =
    process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
    ?? new URL(req.url).origin;

  return NextResponse.json({ origin, platforms, lastSync });
}
