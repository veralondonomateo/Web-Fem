import { sessionSecret } from '@/lib/session-secret';
import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';
import { prisma } from '@/lib/prisma';
import { createServerSupabase } from '@/lib/supabase-server';

/**
 * Vista previa local sin Supabase.
 *
 * Existe solo para poder abrir el CRM con datos de demostración antes de tener
 * el proyecto de Supabase. Exige DOS condiciones a la vez, y la segunda es la
 * que lo vuelve inofensivo: la base de datos tiene que estar en la máquina.
 * En Vercel, con Supabase apuntando a un host remoto, esto nunca se activa
 * aunque alguien ponga la variable por error.
 */
function devLoginAllowed(): boolean {
  if (process.env.ALLOW_DEV_LOGIN !== 'true') return false;
  return /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? '');
}

function issue(user: { id: string; email: string; role: string; name: string; avatar: string | null }) {
  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    sessionSecret(),
    { expiresIn: '7d' },
  );
  return NextResponse.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar },
  });
}

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: 'Email y contraseña requeridos' }, { status: 400 });
    }

    if (devLoginAllowed()) {
      const user = await prisma.crmUser.findFirst({ where: { email } });
      if (!user || !user.isActive) {
        return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 });
      }
      console.warn('[auth] Sesión abierta por el acceso local de vista previa');
      return issue(user);
    }

    const supabase = createServerSupabase();
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError || !authData.user) {
      return NextResponse.json({ error: 'Credenciales inválidas' }, { status: 401 });
    }

    const user = await prisma.crmUser.findFirst({
      where: { OR: [{ authUserId: authData.user.id }, { email }] },
    });
    if (!user || !user.isActive) {
      return NextResponse.json({ error: 'Usuario no activo en el CRM' }, { status: 401 });
    }

    return issue(user);
  } catch (e) {
    return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  }
}
