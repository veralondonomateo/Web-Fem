import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { sincronizarPlantillas, MetaNoConfigurado } from '@/services/plantillas-sync';

export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  try {
    return NextResponse.json({ synced: await sincronizarPlantillas() });
  } catch (e) {
    if (e instanceof MetaNoConfigurado) {
      return NextResponse.json({ error: e.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error de la API de Meta' }, { status: 502 });
  }
}
