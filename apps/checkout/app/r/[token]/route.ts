import { NextRequest, NextResponse } from "next/server";
import { verificarToken, CUPON_RECUPERACION } from "@/lib/carritos";

/**
 * `/r/<token>` — el link corto que va en el mensaje de WhatsApp.
 *
 * Existe para que el mensaje lleve **una sola cadena**: el botón de URL
 * dinámica de Meta está aprobado como `checkoutfem.com/r/{{1}}`, así que la
 * forma de esta URL no se puede cambiar sin volver a pasar por aprobación.
 *
 * Solo reenvía el token a `/checkout?r=<token>`. Quien reconstruye el carrito
 * es el checkout, en el servidor y con `lib/restaurar-carrito` (la misma
 * función que usa la API del CRM para decir qué abre el link). Antes esta
 * ruta calculaba UNA variante y el checkout ni siquiera la respetaba: todos
 * los carritos abrían el probiótico de $110.000.
 *
 * El token se reenvía aunque sea inválido: así el checkout le dice a la
 * clienta que ese carrito no está disponible, en vez de abrir un checkout
 * normal que parece el suyo y no lo es.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const destino = new URL("/checkout", req.nextUrl.origin);
  destino.searchParams.set("r", token);

  // El checkout aplica el cupón por su cuenta; este parámetro queda para que
  // la URL siga diciendo lo mismo que antes a quien la mire o la mida.
  if (verificarToken(token)?.conDescuento) {
    destino.searchParams.set("cupon", CUPON_RECUPERACION);
  }

  return NextResponse.redirect(destino, 302);
}

export const dynamic = "force-dynamic";
