/**
 * Zonas donde el costo de envío hace inviable el pago contra entrega.
 *
 * La lista la comparten el navegador y el servidor, igual que los cupones: el
 * checkout esconde la opción y el servidor la vuelve a rechazar. El servidor
 * es la autoridad — nunca se confía en que el cliente respetó la restricción.
 *
 * Se empareja por **departamento + ciudad**, nunca solo por nombre: "Andes"
 * existe en Antioquia, Caquetá, Córdoba, Cundinamarca, Magdalena y Nariño, y
 * solo el de Antioquia está restringido. Lo mismo con "Florida" (Valle del
 * Cauca vs Cauca) y "Puerto Carreño" (Vichada vs una vereda en Cesar).
 */

export interface ZonaRestringida {
  /** Departamento tal como aparece en el selector. */
  state: string;
  /** Municipio tal como aparece en el selector. */
  city: string;
  /**
   * Nombre con el que los corregimientos referencian a este municipio, cuando
   * difiere del anterior. En el catálogo los corregimientos aparecen como
   * "Llorente (San Andrés de Tumaco)", usando el nombre oficial largo.
   */
  nombreOficial?: string;
}

export const ZONAS_SOLO_PAGO_ANTICIPADO: ZonaRestringida[] = [
  { state: "Nariño", city: "Tumaco", nombreOficial: "San Andrés de Tumaco" },
  { state: "Antioquia", city: "Andes" },
  { state: "Valle del Cauca", city: "Florida" },
  { state: "Chocó", city: "Quibdó" },
  { state: "Antioquia", city: "Arboletes" },
  { state: "Sucre", city: "Santiago de Tolú" },
  // Ya estaba restringida antes, en duro dentro de la ruta de checkout.
  { state: "Vichada", city: "Puerto Carreño" },
];

/** Quita tildes y unifica mayúsculas/espacios para comparar sin sorpresas. */
function normalizar(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * ¿Esta ciudad solo admite pago anticipado?
 *
 * Cubre el municipio y sus corregimientos. Los corregimientos aparecen en el
 * selector como "Vereda (Municipio)" y son zonas rurales del mismo municipio,
 * donde el envío cuesta igual o más — restringirlos es el mismo criterio.
 *
 * El paréntesis debe ir al final para no confundir "Tolú Viejo" (municipio
 * aparte, no restringido) con "Pita Abajo (Santiago de Tolú)".
 */
export function soloPagoAnticipado(state: string, city: string): boolean {
  const s = normalizar(state);
  const c = normalizar(city);

  return ZONAS_SOLO_PAGO_ANTICIPADO.some((zona) => {
    if (normalizar(zona.state) !== s) return false;

    const municipio = normalizar(zona.city);
    if (c === municipio) return true;

    const oficial = normalizar(zona.nombreOficial ?? zona.city);
    return c.endsWith(`(${municipio})`) || c.endsWith(`(${oficial})`);
  });
}

/** Mensaje único, para que el checkout y el servidor digan lo mismo. */
export const MENSAJE_SOLO_PAGO_ANTICIPADO =
  "En esta ciudad solo tenemos pago anticipado disponible. El pago contra entrega no está habilitado por los costos de envío de la zona.";
