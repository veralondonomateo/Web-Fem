/**
 * Reglas de las devoluciones de dinero, compartidas entre la API y la pantalla.
 *
 * Una devolución siempre cuelga de una PQRS: el radicado es el motivo. Por eso
 * aquí no hay nada que explique «por qué se devuelve» — eso se lee en la PQRS.
 */

export const ESTADOS_DEVOLUCION = {
  PENDIENTE:           'Pendiente',
  LISTA_PARA_DEVOLVER: 'Lista para devolver',
  HECHA:               'Hecha',
  RECHAZADA:           'Rechazada',
} as const;

export type EstadoDevolucion = keyof typeof ESTADOS_DEVOLUCION;

/** Una vez resuelta ya no se toca: es plata que salió (o que se decidió no sacar). */
export const ESTADOS_CERRADOS: EstadoDevolucion[] = ['HECHA', 'RECHAZADA'];

/**
 * Plata que la clienta todavía está esperando. Son los dos estados en los que
 * la devolución sigue viva: falta juntar los datos, o ya están y falta girar.
 */
export const ESTADOS_SIN_PAGAR: EstadoDevolucion[] = ['PENDIENTE', 'LISTA_PARA_DEVOLVER'];

/** El color de cada estado, en un solo sitio: se pinta en la lista de
 *  devoluciones y también en la PQRS que la originó. */
export const PILL_DEVOLUCION: Record<EstadoDevolucion, string> = {
  PENDIENTE:           'bg-amber-50 text-amber-700 border-amber-200',
  LISTA_PARA_DEVOLVER: 'bg-sky-50 text-sky-700 border-sky-200',
  HECHA:               'bg-emerald-50 text-emerald-700 border-emerald-200',
  RECHAZADA:           'bg-slate-100 text-slate-600 border-slate-200',
};

/**
 * Lo mínimo para poder girar: a qué entidad y a qué cuenta.
 *
 * Es lo que separa «pendiente» de «lista para devolver». El titular y la cédula
 * ayudan, pero sin entidad y número de cuenta no hay a dónde mandar la plata, y
 * marcarla como lista sería mentirle a quien paga.
 */
export function faltaParaGirar(dev: { entidad?: string | null; numeroCuenta?: string | null }): string | null {
  const falta: string[] = [];
  if (!dev.entidad?.trim()) falta.push('la entidad');
  if (!dev.numeroCuenta?.trim()) falta.push('el número de cuenta');
  return falta.length ? falta.join(' y ') : null;
}

export const METODOS_DEVOLUCION = {
  TRANSFERENCIA: 'Transferencia',
  NEQUI:         'Nequi',
  DAVIPLATA:     'Daviplata',
  BANCOLOMBIA:   'Bancolombia',
  EFECTIVO:      'Efectivo',
  PASARELA:      'Reverso por la pasarela',
  OTRO:          'Otro',
} as const;

export type MetodoDevolucion = keyof typeof METODOS_DEVOLUCION;

/**
 * Entidades que más se repiten en las devoluciones. Es una lista de ayuda para
 * escribir menos, no un catálogo cerrado: el campo es texto libre y admite
 * cualquier otra que la clienta indique.
 */
export const ENTIDADES_SUGERIDAS = [
  'Bancolombia', 'Nequi', 'Daviplata', 'Davivienda', 'Banco de Bogotá',
  'BBVA', 'Nu', 'Lulo Bank', 'Banco Falabella', 'Banco Caja Social',
  'Scotiabank Colpatria', 'Banco Agrario', 'Bancoomeva', 'Efectivo',
] as const;

export const TIPOS_CUENTA = ['Ahorros', 'Corriente'] as const;

/**
 * Traduce la entidad escrita a mano al método de pago, para no volver a
 * preguntar lo mismo cuando administración confirma que la plata salió.
 * Lo que no reconoce cae en TRANSFERENCIA, que es lo que suele ser.
 */
export function metodoDesdeEntidad(entidad?: string | null): MetodoDevolucion | '' {
  const e = (entidad ?? '').trim().toLowerCase();
  if (!e) return '';
  if (e.includes('nequi')) return 'NEQUI';
  if (e.includes('daviplata')) return 'DAVIPLATA';
  if (e.includes('bancolombia')) return 'BANCOLOMBIA';
  if (e.includes('efectivo')) return 'EFECTIVO';
  if (e.includes('pasarela') || e.includes('reverso')) return 'PASARELA';
  return 'TRANSFERENCIA';
}

/**
 * El plazo por defecto para pagar: un mes desde que se radica. No es un plazo
 * legal —ese es el de la PQRS— sino el compromiso interno con el que se venía
 * llevando el control, y sirve para que nada se quede sin fecha.
 *
 * Devuelve «YYYY-MM-DD» porque es lo que espera un <input type="date">.
 */
export function fechaLimitePorDefecto(desde: Date = new Date()): string {
  const d = new Date(desde.getFullYear(), desde.getMonth() + 1, desde.getDate());
  // Si el día no existe en el mes siguiente (31 de enero → 31 de febrero),
  // `Date` se pasa al mes de después; se retrocede al último día del que toca.
  if (d.getDate() !== desde.getDate()) d.setDate(0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function consecutivoBonito(consecutivo: number, creada: Date | string): string {
  return `DEV-${new Date(creada).getFullYear()}-${String(consecutivo).padStart(5, '0')}`;
}

/**
 * Cuánto lleva esperando una devolución pendiente, en días.
 *
 * No hay plazo legal propio —el que corre es el de la PQRS—, pero una
 * devolución aprobada y sin pagar es dinero que la clienta está esperando, así
 * que la antigüedad se muestra igual para que no se quede nadie olvidado.
 */
export function diasEsperando(creada: Date | string, ahora = new Date()): number {
  const ms = ahora.getTime() - new Date(creada).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export interface EntradaHistorialDevolucion {
  at: string;
  por: string;
  tipo: 'creacion' | 'monto' | 'estado' | 'nota';
  texto: string;
}

export function agregarHistorialDevolucion(
  historial: unknown,
  entrada: Omit<EntradaHistorialDevolucion, 'at'>,
): EntradaHistorialDevolucion[] {
  const lista = Array.isArray(historial) ? (historial as EntradaHistorialDevolucion[]) : [];
  return [...lista, { ...entrada, at: new Date().toISOString() }];
}

/**
 * El monto llega de un formulario, así que puede venir como «150.000», «150000»
 * o «$ 150.000,50». En Colombia el punto separa miles y la coma decimales, que
 * es justo al revés de lo que entiende `Number`, de ahí la normalización.
 *
 * Devuelve null si no es un importe positivo utilizable: quien llama decide qué
 * error mostrar.
 */
export function parsearMonto(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) && valor > 0 ? valor : null;
  if (typeof valor !== 'string') return null;

  const limpio = valor.replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(limpio);
  return Number.isFinite(n) && n > 0 ? n : null;
}
