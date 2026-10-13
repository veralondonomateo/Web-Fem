import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * Pedidos de Ecuador para el panel.
 *
 * Lee solo de `pedidos_ecuador`. No toca `orders`: el dashboard de Colombia y
 * este módulo son dos cosas distintas mientras las operaciones lo sean.
 */
export async function GET(req: NextRequest) {
  const pw = req.headers.get("x-admin-password");
  if (!pw || pw !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("pedidos_ecuador")
    .select(
      "id, created_at, nombre, apellido, email, telefono, provincia, ciudad, direccion, presentacion, unidades, total, moneda, estado_pago, despachado_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[Admin EC] Error leyendo pedidos:", error);
    return NextResponse.json({ error: "No se pudo leer la base" }, { status: 500 });
  }

  const pedidos = data ?? [];
  const total = pedidos.reduce((s, p) => s + Number(p.total ?? 0), 0);

  return NextResponse.json({
    pedidos,
    resumen: {
      cantidad: pedidos.length,
      facturacion: total,
      // Se calcula aquí y no en el navegador para que el número del panel y el
      // de la lista no puedan discrepar por un redondeo distinto.
      ticket: pedidos.length ? total / pedidos.length : 0,
    },
  });
}
