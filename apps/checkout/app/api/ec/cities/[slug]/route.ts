import { NextResponse } from "next/server";
import ciudades from "@/data/ecuador-ciudades.json";
import { PROVINCIAS_EC } from "@/data/provincias-ecuador";

// Gemelo de /api/cities para Ecuador. Vive aparte a propósito: las 1.056
// ciudades ecuatorianas no tienen por qué entrar en el bundle del checkout
// colombiano, ni al revés. Cada respuesta pesa unos pocos KB, se prerenderiza
// en build y se sirve desde el CDN.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return PROVINCIAS_EC.map((p) => ({ slug: p.slug }));
}

const slugify = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const provincia = ciudades.states.find((s) => slugify(s.name) === slug);

  if (!provincia) {
    return NextResponse.json({ cities: [] }, { status: 404 });
  }

  return NextResponse.json(
    { cities: provincia.cities },
    { headers: { "Cache-Control": "public, max-age=31536000, immutable" } }
  );
}
