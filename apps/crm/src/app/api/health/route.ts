import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Sonda pública sin secretos: sirve para monitoreo externo y para saber de un
 * vistazo si la app está viva y si la base responde.
 */
export async function GET() {
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }

  return NextResponse.json(
    { ok: db, db, at: new Date().toISOString() },
    { status: db ? 200 : 503 },
  );
}
