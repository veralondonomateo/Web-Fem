import { NextResponse } from "next/server";
import statesData from "@/data/states.json";
import { DEPARTMENTS } from "@/data/departments";

// Las ciudades (8.193 en total, ~195 KB) solían viajar en el bundle del checkout.
// Ahora se sirven por departamento: cada respuesta pesa unos pocos KB, se
// prerenderiza en build y se cachea en el CDN de forma inmutable.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return DEPARTMENTS.map((d) => ({ slug: d.slug }));
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
  const state = statesData.states.find((s) => slugify(s.name) === slug);

  if (!state) {
    return NextResponse.json({ cities: [] }, { status: 404 });
  }

  // Ordenadas en build para que el cliente no tenga que hacerlo en cada render.
  const cities = state.cities.slice().sort((a, b) => a.localeCompare(b, "es"));

  return NextResponse.json(
    { cities },
    {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    }
  );
}
