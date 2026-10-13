import { NextRequest, NextResponse } from "next/server";
import { getProducts } from "@/lib/shopify";

export async function GET(req: NextRequest) {
  const pw = req.headers.get("x-admin-password");
  if (!pw || pw !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  try {
    const products = await getProducts();
    return NextResponse.json({ products });
  } catch (err) {
    console.error("[Admin] Error Shopify:", err);
    return NextResponse.json({ error: "Error al conectar con Shopify" }, { status: 500 });
  }
}
