import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { verificarToken } from "@/lib/carritos";
import { VIGENCIA_DIAS } from "@/lib/restaurar-carrito";

/**
 * Devuelve los datos que la clienta ya había escrito, para que el link de
 * recuperación (`/checkout?r=<token>`) reabra el checkout lleno.
 *
 * El token va firmado con HMAC: sin el secreto no se puede fabricar uno
 * válido ni enumerar UUIDs para pescar datos de otras clientas. Además caduca,
 * porque un link de WhatsApp vive para siempre en el chat y no queremos que
 * dentro de seis meses siga sirviendo para leer una dirección.
 */

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("t");
  if (!token) {
    return NextResponse.json({ ok: false, error: "Falta el token" }, { status: 400 });
  }

  const verificado = verificarToken(token);
  if (!verificado) {
    return NextResponse.json({ ok: false, error: "Token inválido" }, { status: 403 });
  }

  const supabase = createServerClient();
  const { tipo, id } = verificado;

  // `checkout_sessions` no guarda cédula ni complemento: quien abandona a
  // medio formulario rara vez llegó tan lejos, y no vale la pena guardar más
  // datos personales de los necesarios.
  const esOrden = tipo === "pago_no_completado";
  const columnas = esOrden
    ? "first_name, last_name, email, phone, cedula, address, complement, state, city, created_at"
    : "first_name, last_name, email, phone, address, state, city, created_at";

  const { data, error } = await supabase
    .from(esOrden ? "orders" : "checkout_sessions")
    .select(columnas)
    .eq("id", id)
    .maybeSingle<{
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
      cedula?: string | null;
      address: string | null;
      complement?: string | null;
      state: string | null;
      city: string | null;
      created_at: string;
    }>();

  if (error || !data) {
    return NextResponse.json({ ok: false, error: "No encontrado" }, { status: 404 });
  }

  const edadDias = (Date.now() - new Date(data.created_at).getTime()) / 86_400_000;
  if (edadDias > VIGENCIA_DIAS) {
    return NextResponse.json({ ok: false, error: "El enlace expiró" }, { status: 410 });
  }

  // Solo los campos del formulario, con los nombres que usa react-hook-form.
  // El teléfono vuelve a 10 dígitos porque así lo espera el validador.
  return NextResponse.json(
    {
      ok: true,
      cliente: {
        firstName: data.first_name ?? "",
        lastName: data.last_name ?? "",
        email: data.email ?? "",
        cedula: data.cedula ?? "",
        phone: (data.phone ?? "").replace(/\D/g, "").slice(-10),
        address: data.address ?? "",
        complement: data.complement ?? "",
        state: data.state ?? "",
        city: data.city ?? "",
      },
    },
    {
      // Datos personales: que no queden en ninguna caché intermedia.
      headers: { "Cache-Control": "private, no-store" },
    }
  );
}

export const dynamic = "force-dynamic";
