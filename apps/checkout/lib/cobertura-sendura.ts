/**
 * Cobertura de última milla de Sendura.
 *
 * Sendura no expone un endpoint de cobertura, y su mensaje de error habla de
 * *provincia* ("Provincia 'Valle del Cauca' fuera de cobertura") mientras que
 * su operación real es por ciudad. Eso significa que no podemos delegarles la
 * decisión: un pedido a un municipio de Cundinamarca al que no llegan podría
 * devolver 201 y número de guía sin que nadie lo entregue. La lista manda
 * desde aquí.
 *
 * Se empareja por **departamento + ciudad**, nunca solo por nombre, por la
 * misma razón que en `zonas-pago-anticipado`: "Bello" el municipio de
 * Antioquia no es "Pueblo Bello (Turbo)", y hay decenas de casos así en el
 * selector de 8.193 ciudades.
 *
 * Los nombres están copiados literalmente de `data/states.json`, que es lo que
 * ve la compradora en el formulario. Ojo con "Itaguí": el municipio va sin
 * diéresis en el catálogo, pero sus corregimientos aparecen como "Itagüí". La
 * normalización quita ambas, así que las dos formas emparejan.
 */

export interface MunicipioSendura {
  /** Departamento tal como aparece en el selector. */
  state: string;
  /** Municipio tal como aparece en el selector. */
  city: string;
  /**
   * Provincia que espera Sendura, si difiere del departamento. Bogotá es
   * ciudad dentro de Cundinamarca en nuestro catálogo, pero en el ejemplo de
   * su documentación la provincia es "Bogotá, D.C.".
   */
  provinciaSendura?: string;
}

export const MUNICIPIOS_SENDURA: MunicipioSendura[] = [
  { state: "Cundinamarca", city: "Bogotá", provinciaSendura: "Bogotá, D.C." },
  { state: "Cundinamarca", city: "Soacha" },
  { state: "Antioquia", city: "Medellín" },
  { state: "Antioquia", city: "Bello" },
  { state: "Antioquia", city: "Envigado" },
  { state: "Antioquia", city: "Itaguí" },
  { state: "Antioquia", city: "La Estrella" },
  { state: "Antioquia", city: "Copacabana" },
  { state: "Antioquia", city: "Sabaneta" },
];

/** Quita tildes y diéresis y unifica mayúsculas/espacios para comparar sin sorpresas. */
function normalizar(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export interface Cobertura {
  cubierta: boolean;
  /** Municipio de Sendura al que pertenece la dirección, si hay cobertura. */
  municipio?: MunicipioSendura;
  /**
   * Corregimiento o vereda, cuando la ciudad seleccionada era del tipo
   * "Las Palmas (Envigado)". Se manda aparte: a Sendura le va el municipio en
   * `shipping_city` y esto en la segunda línea de dirección, porque su base
   * de ciudades no conoce los 8.193 nombres del catálogo colombiano.
   */
  corregimiento?: string;
}

/**
 * ¿Esta dirección la despacha Sendura?
 *
 * Cubre el municipio y sus corregimientos, que en el selector aparecen como
 * "Vereda (Municipio)". El paréntesis debe ir al final para no confundir un
 * municipio que empieza igual con un corregimiento de otro: "Pueblo Bello
 * (Turbo)" no es Bello.
 */
export function coberturaSendura(state: string, city: string): Cobertura {
  const s = normalizar(state);
  const c = normalizar(city);

  for (const municipio of MUNICIPIOS_SENDURA) {
    if (normalizar(municipio.state) !== s) continue;

    const nombre = normalizar(municipio.city);
    if (c === nombre) return { cubierta: true, municipio };

    if (c.endsWith(`(${nombre})`)) {
      // "Las Palmas (Envigado)" → corregimiento "Las Palmas"
      const corregimiento = city.slice(0, city.lastIndexOf("(")).trim();
      return { cubierta: true, municipio, corregimiento: corregimiento || undefined };
    }
  }

  return { cubierta: false };
}

/** Atajo booleano, para el checkout y para la vista del admin. */
export function tieneCoberturaSendura(state: string, city: string): boolean {
  return coberturaSendura(state, city).cubierta;
}

/** Provincia con la que hay que llamar a Sendura para este municipio. */
export function provinciaSendura(municipio: MunicipioSendura): string {
  return municipio.provinciaSendura ?? municipio.state;
}

/** Lista legible para la interfaz de pruebas. */
export const RESUMEN_COBERTURA = MUNICIPIOS_SENDURA.map(
  (m) => `${m.city} (${m.state})`
);
