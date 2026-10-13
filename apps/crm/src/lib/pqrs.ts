/**
 * Reglas de negocio de las PQRS, compartidas entre la API y la interfaz.
 */
import { diasHabilesRestantes } from './dias-habiles';

export const TIPOS_PQRS = {
  PETICION:   { etiqueta: 'Petición',   diasHabiles: 15, prioridad: 'MEDIA' },
  QUEJA:      { etiqueta: 'Queja',      diasHabiles: 15, prioridad: 'ALTA' },
  RECLAMO:    { etiqueta: 'Reclamo',    diasHabiles: 15, prioridad: 'ALTA' },
  SUGERENCIA: { etiqueta: 'Sugerencia', diasHabiles: 15, prioridad: 'BAJA' },
} as const;

export type TipoPqrs = keyof typeof TIPOS_PQRS;

export const ESTADOS_PQRS = {
  ABIERTA:           'Abierta',
  EN_PROCESO:        'En proceso',
  ESPERANDO_CLIENTA: 'Esperando clienta',
  RESUELTA:          'Resuelta',
  CERRADA:           'Cerrada',
} as const;

export type EstadoPqrs = keyof typeof ESTADOS_PQRS;

export const PRIORIDADES_PQRS = ['BAJA', 'MEDIA', 'ALTA', 'CRITICA'] as const;
export type PrioridadPqrs = (typeof PRIORIDADES_PQRS)[number];

/** Con una PQRS resuelta o cerrada el plazo deja de correr. */
export const ESTADOS_VIVOS: EstadoPqrs[] = ['ABIERTA', 'EN_PROCESO', 'ESPERANDO_CLIENTA'];

export function radicadoBonito(radicado: number, creada: Date | string): string {
  const anio = new Date(creada).getFullYear();
  return `PQR-${anio}-${String(radicado).padStart(5, '0')}`;
}

export type Semaforo = 'verde' | 'amarillo' | 'rojo' | 'vencida' | 'resuelta';

/**
 * El semáforo del plazo legal. Rojo desde 3 días hábiles antes: quien mira la
 * lista tiene que poder salvar el plazo, no enterarse de que ya se perdió.
 */
export function semaforoDe(estado: EstadoPqrs, venceAt: Date | string, ahora = new Date()): {
  semaforo: Semaforo; diasRestantes: number;
} {
  const dias = diasHabilesRestantes(new Date(venceAt), ahora);
  if (estado === 'RESUELTA' || estado === 'CERRADA') return { semaforo: 'resuelta', diasRestantes: dias };
  if (new Date(venceAt).getTime() < ahora.getTime()) return { semaforo: 'vencida', diasRestantes: dias };
  if (dias <= 3) return { semaforo: 'rojo', diasRestantes: dias };
  if (dias <= 7) return { semaforo: 'amarillo', diasRestantes: dias };
  return { semaforo: 'verde', diasRestantes: dias };
}

export interface EntradaHistorial {
  at: string;
  por: string;
  tipo: 'creacion' | 'comentario' | 'estado' | 'prioridad' | 'asignacion' | 'resolucion';
  texto: string;
}

export function agregarHistorial(
  historial: unknown, entrada: Omit<EntradaHistorial, 'at'>,
): EntradaHistorial[] {
  const lista = Array.isArray(historial) ? (historial as EntradaHistorial[]) : [];
  return [...lista, { ...entrada, at: new Date().toISOString() }];
}
