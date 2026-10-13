import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCOP(amount: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0 }).format(amount);
}

export function formatDate(date: string | Date) {
  return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
}

export function formatRelativeTime(date: string | Date) {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins}m`;
  if (hours < 24) return `${hours}h`;
  if (days < 7) return `${days}d`;
  return formatDate(date);
}

export const CHANNEL_COLORS: Record<string, string> = {
  WHATSAPP: 'bg-green-500',
  INSTAGRAM: 'bg-pink-500',
  FACEBOOK: 'bg-blue-600',
};

export const CHANNEL_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  FACEBOOK: 'Facebook',
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING_CONFIRMATION: 'Pendiente confirmación',
  CONFIRMED: 'Confirmado',
  PREPARING: 'En preparación',
  DISPATCHED: 'Despachado',
  IN_TRANSIT: 'En camino',
  IN_DESTINATION: 'En ciudad destino',
  DELIVERED: 'Entregado',
  FAILED_DELIVERY: 'Novedad',
  RETURNED: 'Devuelto',
  CANCELLED: 'Cancelado',
};

export const ORDER_STATUS_COLORS: Record<string, string> = {
  PENDING_CONFIRMATION: 'bg-yellow-100 text-yellow-800',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  PREPARING: 'bg-indigo-100 text-indigo-800',
  DISPATCHED: 'bg-purple-100 text-purple-800',
  IN_TRANSIT: 'bg-cyan-100 text-cyan-800',
  IN_DESTINATION: 'bg-teal-100 text-teal-800',
  DELIVERED: 'bg-green-100 text-green-800',
  FAILED_DELIVERY: 'bg-red-100 text-red-800',
  RETURNED: 'bg-brand-50 text-ink',
  CANCELLED: 'bg-brand-50 text-ink-muted',
};

export const CUSTOMER_STATUS_LABELS: Record<string, string> = {
  NEW: 'Nueva',
  ACTIVE: 'Activa',
  AT_RISK: 'En riesgo',
  RECURRING: 'Recurrente',
  LOST: 'Perdida',
};

export const CUSTOMER_STATUS_COLORS: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-700',
  ACTIVE: 'bg-green-100 text-green-700',
  AT_RISK: 'bg-orange-100 text-orange-700',
  RECURRING: 'bg-brand-100 text-pepper-700',
  LOST: 'bg-brand-50 text-ink-muted',
};

/**
 * Cómo mostrar el «teléfono» de una clienta.
 *
 * Algunas tienen el número oculto en WhatsApp: Meta no lo manda y solo llega
 * una identidad opaca del tipo «CO.939818055836462», que es lo que se guarda
 * como llave. Enseñar ese código no le dice nada a la agente —y parece un
 * error del sistema—, así que se explica en palabras.
 */
export function mostrarTelefono(phone?: string | null): string {
  if (!phone) return 'Sin número';
  return phone.startsWith('CO.') ? 'Número oculto por la clienta' : phone;
}

/**
 * La hora tal cual se vive en Colombia.
 *
 * Se fija la zona a America/Bogota en vez de usar la del computador: si una
 * agente tiene mal el reloj o trabaja desde otro país, la hora que ve tiene que
 * seguir siendo la de Bogotá — es la que aparece en la guía de la
 * transportadora y la que la clienta menciona por teléfono.
 */
const ZONA = 'America/Bogota';

export function horaBogota(date: string | Date): string {
  return new Date(date).toLocaleTimeString('es-CO', {
    timeZone: ZONA, hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

/** Igual, con la fecha delante cuando el mensaje no es de hoy. */
export function fechaHoraBogota(date: string | Date): string {
  const d = new Date(date);
  const hoy = new Date().toLocaleDateString('es-CO', { timeZone: ZONA });
  const suyo = d.toLocaleDateString('es-CO', { timeZone: ZONA });
  const hora = horaBogota(d);
  if (hoy === suyo) return hora;
  const ayer = new Date(Date.now() - 86400_000).toLocaleDateString('es-CO', { timeZone: ZONA });
  if (ayer === suyo) return `ayer ${hora}`;
  const dia = d.toLocaleDateString('es-CO', { timeZone: ZONA, day: 'numeric', month: 'short' })
    .replace(' de ', ' ').replace('.', '');
  return `${dia}, ${hora}`;
}
