import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase';
import { getProducts } from '@/lib/shopify';
import { restaurarCarrito } from '@/lib/restaurar-carrito';
export async function GET(req: NextRequest) {
  if (!process.env.FEM_INTERNAL_SECRET || req.headers.get('x-fem-internal') !== process.env.FEM_INTERNAL_SECRET)
    return NextResponse.json({error:'No autorizado'}, {status:401});
  const token=req.nextUrl.searchParams.get('token') || '';
  const result=await restaurarCarrito(createServerClient(),token,await getProducts());
  return NextResponse.json(result,{headers:{'Cache-Control':'no-store'}});
}
