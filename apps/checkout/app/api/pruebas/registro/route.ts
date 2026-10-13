import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * Registro de los pedidos del entorno de pruebas de Sendura.
 *
 * Va sin contraseña mientras duren las pruebas, igual que el módulo que lo
 * consume. Solo expone la tabla `pruebas_sendura` — nunca las ventas reales.
 * Para volver a cerrarlo: comprobar `x-admin-password` contra
 * `process.env.ADMIN_PASSWORD`, como hace `/api/admin/products`.
 */
export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("pruebas_sendura")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[Pruebas] Error leyendo el registro:", error);
    return NextResponse.json({ error: "Error de base de datos" }, { status: 500 });
  }

  return NextResponse.json({ pruebas: data ?? [] });
}
