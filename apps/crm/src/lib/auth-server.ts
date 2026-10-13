import { sessionSecret } from '@/lib/session-secret';
import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { prisma } from './prisma';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  name: string;
  /** Línea de WhatsApp a la que está restringida. null = ve todas (admin). */
  metaAccountId: string | null;
}

/**
 * Caché de usuarias por instancia.
 *
 * Cada petición hacía una consulta a Postgres solo para comprobar que la
 * usuaria sigue activa: ~100 ms de ida y vuelta en TODAS las rutas. La bandeja
 * se refresca cada 8 segundos, así que eso se paga constantemente mientras una
 * agente atiende.
 *
 * Con 60 segundos de caché la comprobación sigue siendo real —desactivar a
 * alguien surte efecto en menos de un minuto, no a los 7 días que dura el
 * token— y desaparece una consulta de cada petición.
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { user: AuthUser | null; hasta: number }>();

export async function getAuthUser(req: NextRequest): Promise<AuthUser | null> {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return null;

  let payload: { id?: string };
  try {
    payload = jwt.verify(token, sessionSecret()) as any;
  } catch {
    return null;
  }
  if (!payload?.id) return null;

  const ahora = Date.now();
  const enCache = cache.get(payload.id);
  if (enCache && enCache.hasta > ahora) return enCache.user;

  try {
    const user = await prisma.crmUser.findUnique({ where: { id: payload.id } });
    const resultado: AuthUser | null = user && user.isActive
      ? { id: user.id, email: user.email, role: user.role, name: user.name, metaAccountId: user.metaAccountId }
      : null;

    // La caché no crece sin control: la instancia atiende a un puñado de agentes.
    if (cache.size > 200) cache.clear();
    cache.set(payload.id, { user: resultado, hasta: ahora + CACHE_TTL_MS });
    return resultado;
  } catch {
    return null;
  }
}

export function unauthorized() {
  return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
}

export function forbidden() {
  return NextResponse.json({ error: 'Acceso denegado' }, { status: 403 });
}
