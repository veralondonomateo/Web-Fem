import { NextRequest, NextResponse } from "next/server";
import { getProducts } from "@/lib/commerce";

export async function GET(req: NextRequest) {
  const pw = req.headers.get("x-admin-password");
  if (!pw || pw !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    const products = await getProducts();
    return NextResponse.json({ products });
  } catch (err) {
    console.error("[Admin] Error de catálogo FEM:", err);
    return NextResponse.json({ error: "No se pudo leer el catálogo FEM" }, { status: 500 });
  }
}
