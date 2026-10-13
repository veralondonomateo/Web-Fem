/**
 * Reglas de la encuesta de satisfacción, compartidas entre el envío, el
 * webhook que recoge la respuesta y la pantalla de gerencia.
 */

/** Cuánto se espera desde que la conversación se cierra hasta preguntar. */
export const ESPERA_MINUTOS = 10;

/**
 * Ventana de WhatsApp: fuera de las 24 h desde el último mensaje de la clienta
 * solo se puede escribir con plantilla aprobada. La encuesta es texto libre, así
 * que si la ventana se cerró no se pregunta — se omite y queda dicho por qué.
 * Se deja un margen de una hora para no enviar justo en el filo.
 */
export const VENTANA_HORAS = 23;

/** No se le vuelve a preguntar a la misma clienta antes de este plazo. */
export const DIAS_ENTRE_ENCUESTAS = 30;

/**
 * Una calificación por debajo de esto es una conversación que gerencia debería
 * abrir y leer. No es un castigo para la agente: es dónde mirar primero.
 */
export const UMBRAL_REVISAR = 3;

export const ESTADOS_ENCUESTA = {
  PROGRAMADA: 'Programada',
  ENVIADA:    'Enviada',
  RESPONDIDA: 'Respondida',
  OMITIDA:    'Omitida',
} as const;

export type EstadoEncuesta = keyof typeof ESTADOS_ENCUESTA;

/**
 * Las cinco opciones, tal como las ve la clienta.
 *
 * Van con estrellas dibujadas y con palabra: la estrella sola se entiende de un
 * vistazo, la palabra evita que «3» signifique cosas distintas para cada una.
 */
export const OPCIONES_ESTRELLAS = [
  { estrellas: 5, titulo: '⭐⭐⭐⭐⭐', descripcion: 'Excelente' },
  { estrellas: 4, titulo: '⭐⭐⭐⭐',   descripcion: 'Buena' },
  { estrellas: 3, titulo: '⭐⭐⭐',     descripcion: 'Regular' },
  { estrellas: 2, titulo: '⭐⭐',       descripcion: 'Mala' },
  { estrellas: 1, titulo: '⭐',         descripcion: 'Muy mala' },
] as const;

/** Id que viaja en la lista de WhatsApp y vuelve en la respuesta. */
export const idOpcion = (estrellas: number) => `csat_${estrellas}`;

export const TEXTO_ENCUESTA = {
  cuerpo: '¿Cómo te pareció la atención que recibiste? 💛\n\nTu respuesta nos ayuda a mejorar y solo toma un segundo.',
  boton: 'Calificar',
  seccion: 'Del 1 al 5',
  gracias: '¡Gracias por calificarnos! 💛',
} as const;

/**
 * Saca la calificación de lo que contestó la clienta.
 *
 * Acepta las dos formas en que puede llegar, porque las dos ocurren:
 *
 *   · La opción de la lista (`interactive.list_reply.id` = «csat_4»), que es lo
 *     que pasa cuando toca el botón.
 *   · Un número suelto escrito a mano («5», «5 estrellas», «⭐⭐⭐⭐⭐»), que es
 *     lo que hace quien no ve la lista o prefiere escribir.
 *
 * Devuelve null si no se parece a una calificación. Es deliberadamente estricto:
 * quien llama usa ese null para tratar el mensaje como lo que es —un mensaje
 * normal de la clienta— y no tragárselo.
 */
export function calificacionDe(message: any): number | null {
  const deLista = calificacionDeLista(message);
  if (deLista !== null) return deLista;

  const texto: string | undefined =
    message?.interactive?.list_reply?.title
    ?? message?.interactive?.button_reply?.title
    ?? message?.button?.text
    ?? message?.text?.body;
  return calificacionDeTexto(texto);
}

/**
 * La calificación cuando llegó tocando la opción de la lista.
 *
 * Separada del texto porque las dos no valen lo mismo, y confundirlas costó
 * dieciséis calificaciones. Un `csat_4` solo puede haberlo generado nuestra
 * lista: no hay forma de que la clienta lo escriba por casualidad, así que se
 * acepta sin más comprobaciones. Un «4» tecleado, en cambio, puede ser
 * cualquier cosa y necesita las cautelas de `calificacionDeTexto`.
 */
export function calificacionDeLista(message: any): number | null {
  const id: string | undefined =
    message?.interactive?.list_reply?.id ?? message?.interactive?.button_reply?.id;
  if (typeof id !== 'string' || !id.startsWith('csat_')) return null;
  const n = Number(id.slice(5));
  return n >= 1 && n <= 5 ? n : null;
}

/** La misma lectura, pero solo del texto. Separada para poder probarla. */
export function calificacionDeTexto(texto?: string | null): number | null {
  if (!texto) return null;
  const limpio = texto.trim();
  if (!limpio || limpio.length > 20) return null;

  // «⭐⭐⭐⭐» — se cuentan las estrellas. La 🌟 va aparte porque no cabe en un
  // solo carácter de JavaScript y dentro de una clase de caracteres se leería
  // como dos mitades sueltas.
  const estrellas = (limpio.match(/[⭐★]/g) ?? []).length + (limpio.split('🌟').length - 1);
  if (estrellas >= 1 && estrellas <= 5 && !/\d/.test(limpio)) return estrellas;

  // «5», «5 estrellas», «calificación: 4». Un único dígito del 1 al 5 y nada
  // más que le cambie el sentido.
  const digitos = limpio.match(/\d+/g) ?? [];
  if (digitos.length !== 1) return null;
  const n = Number(digitos[0]);
  if (n < 1 || n > 5) return null;

  // Un «5» dentro de una frase larga casi nunca es una calificación.
  const soloPalabrasEsperadas = /^[^a-záéíóúñ]*\d[^a-záéíóúñ]*(estrella|estrellas|puntos?|de\s*5|⭐)?[^a-záéíóúñ]*$/i;
  return soloPalabrasEsperadas.test(limpio) ? n : null;
}

/** Promedio con un decimal, o null si todavía no hay ninguna respuesta. */
export function promedio(valores: number[]): number | null {
  if (!valores.length) return null;
  return Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 10) / 10;
}
