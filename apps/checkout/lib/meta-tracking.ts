"use client";

/**
 * Identificadores de navegador para Meta, creados por nosotros.
 *
 * El pixel de FEM no está escribiendo `_fbp` ni `_fbc` (verificado en
 * producción: TikTok y Klaviyo sí crean las suyas, Meta no). Eso pasa cuando
 * las "cookies propias" están desactivadas en el Events Manager, y deja al
 * evento Purchase sin ningún identificador de navegador — que es justo lo que
 * más pesa en la calidad de coincidencia.
 *
 * Aquí las creamos con el formato oficial de Meta. Si algún día se activan las
 * cookies propias del pixel, este módulo no estorba: solo escribe cuando la
 * cookie no existe, así que la del pixel siempre gana.
 */

const NOVENTA_DIAS = 60 * 60 * 24 * 90;

function leerCookie(nombre: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(`(^|;)\\s*${nombre}\\s*=\\s*([^;]+)`);
  return m ? m.pop() ?? null : null;
}

function escribirCookie(nombre: string, valor: string): void {
  try {
    document.cookie = [
      `${nombre}=${valor}`,
      `max-age=${NOVENTA_DIAS}`,
      "path=/",
      "SameSite=Lax",
      location.protocol === "https:" ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; ");
  } catch {
    /* el tracking nunca debe romper el checkout */
  }
}

/**
 * Devuelve `_fbp` y `_fbc`, creándolas si hacen falta.
 *
 * - `_fbc` solo existe si la visita viene de un anuncio (`?fbclid=`). Sin
 *   fbclid se queda ausente, que es lo correcto: inventarlo sería mentirle a
 *   Meta sobre el origen de la visita.
 * - `_fbp` identifica al navegador y se puede generar siempre. El formato es
 *   `fb.<subdominio>.<creación en ms>.<aleatorio>`.
 */
export function asegurarIdsMeta(): { fbp?: string; fbc?: string } {
  if (typeof window === "undefined" || !/(?:^|;\s*)fem_consent=all(?:;|$)/.test(document.cookie)) return {};

  try {
    const params = new URLSearchParams(window.location.search);

    let fbc = leerCookie("_fbc");
    if (!fbc) {
      // `?fbc=` es el identificador ya armado que puede pasarnos la landing.
      // Hace falta porque vive en otro dominio: su cookie `_fbc` no llega
      // hasta aquí, y sin esto la visita pierde el rastro del anuncio.
      const heredado = params.get("fbc");
      const fbclid = params.get("fbclid");
      if (heredado?.startsWith("fb.")) {
        fbc = heredado;
        escribirCookie("_fbc", fbc);
      } else if (fbclid) {
        fbc = `fb.1.${Date.now()}.${fbclid}`;
        escribirCookie("_fbc", fbc);
      }
    }

    let fbp = leerCookie("_fbp") ?? params.get("fbp") ?? null;
    if (fbp && !leerCookie("_fbp")) escribirCookie("_fbp", fbp);
    if (!fbp) {
      const aleatorio = Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000;
      fbp = `fb.1.${Date.now()}.${aleatorio}`;
      escribirCookie("_fbp", fbp);
    }

    return { fbp: fbp ?? undefined, fbc: fbc ?? undefined };
  } catch {
    return {};
  }
}
