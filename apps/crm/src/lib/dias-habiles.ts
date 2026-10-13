/**
 * Días hábiles en Colombia, para el vencimiento legal de las PQRS.
 *
 * La SIC da 15 días hábiles contados desde el día siguiente a la radicación.
 * «Hábil» descuenta sábados, domingos y festivos. Los festivos no van en una
 * lista pegada que caduque: se calculan con la Ley Emiliani —seis fechas
 * fijas, siete que se corren al lunes siguiente y tres que dependen de la
 * Pascua— así que sirve para cualquier año.
 *
 * Todo se calcula en calendario de Bogotá (UTC-5, sin horario de verano).
 */

const MS_DIA = 86_400_000;
const OFFSET_BOGOTA = 5 * 3_600_000;

/** El día calendario de Bogotá en que cae un instante, como fecha UTC a medianoche. */
function diaBogota(fecha: Date): Date {
  const local = fecha.getTime() - OFFSET_BOGOTA;
  return new Date(Math.floor(local / MS_DIA) * MS_DIA);
}

/** Domingo de Pascua (algoritmo de computus para el calendario gregoriano). */
function pascua(anio: number): Date {
  const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(anio, mes - 1, dia));
}

/** Corre una fecha al lunes siguiente, salvo que ya sea lunes (Ley Emiliani). */
function alLunes(f: Date): Date {
  const dia = f.getUTCDay();
  return dia === 1 ? f : new Date(f.getTime() + ((8 - dia) % 7) * MS_DIA);
}

const sumaDias = (f: Date, n: number) => new Date(f.getTime() + n * MS_DIA);

const cacheFestivos = new Map<number, Set<number>>();

function festivosDelAnio(anio: number): Set<number> {
  const memo = cacheFestivos.get(anio);
  if (memo) return memo;

  const fijas = [
    [0, 1],   // Año Nuevo
    [4, 1],   // Día del Trabajo
    [6, 20],  // Independencia
    [7, 7],   // Batalla de Boyacá
    [11, 8],  // Inmaculada Concepción
    [11, 25], // Navidad
  ].map(([m, d]) => new Date(Date.UTC(anio, m, d)));

  const corridas = [
    [0, 6],   // Reyes Magos
    [2, 19],  // San José
    [5, 29],  // San Pedro y San Pablo
    [7, 15],  // Asunción de la Virgen
    [9, 12],  // Día de la Raza
    [10, 1],  // Todos los Santos
    [10, 11], // Independencia de Cartagena
  ].map(([m, d]) => alLunes(new Date(Date.UTC(anio, m, d))));

  const p = pascua(anio);
  const deLaPascua = [
    sumaDias(p, -3),          // Jueves Santo
    sumaDias(p, -2),          // Viernes Santo
    alLunes(sumaDias(p, 39)), // Ascensión
    alLunes(sumaDias(p, 60)), // Corpus Christi
    alLunes(sumaDias(p, 68)), // Sagrado Corazón
  ];

  const set = new Set([...fijas, ...corridas, ...deLaPascua].map(f => f.getTime()));
  cacheFestivos.set(anio, set);
  return set;
}

export function esDiaHabil(dia: Date): boolean {
  const d = dia.getUTCDay();
  if (d === 0 || d === 6) return false;
  return !festivosDelAnio(dia.getUTCFullYear()).has(dia.getTime());
}

/**
 * El vencimiento de una PQRS radicada en `radicada`: `n` días hábiles contados
 * desde el día siguiente, como manda la norma. Devuelve el fin del día límite
 * (23:59:59 de Bogotá).
 */
export function vencimientoHabil(radicada: Date, n: number): Date {
  let dia = diaBogota(radicada);
  let restantes = n;
  while (restantes > 0) {
    dia = sumaDias(dia, 1);
    if (esDiaHabil(dia)) restantes--;
  }
  // 23:59:59 en Bogotá = 04:59:59 UTC del día siguiente.
  return new Date(dia.getTime() + MS_DIA + OFFSET_BOGOTA - 1000);
}

/** Días hábiles que quedan hasta `limite` (negativo si ya se venció). */
export function diasHabilesRestantes(limite: Date, ahora = new Date()): number {
  const desde = diaBogota(ahora);
  const hasta = diaBogota(limite);
  return hasta.getTime() >= desde.getTime() ? contar(desde, hasta) : -contar(hasta, desde);
}

/** Días hábiles en (a, b], contando el final si es hábil. */
function contar(a: Date, b: Date): number {
  let n = 0;
  for (let d = sumaDias(a, 1); d.getTime() <= b.getTime(); d = sumaDias(d, 1)) {
    if (esDiaHabil(d)) n++;
  }
  return n;
}
