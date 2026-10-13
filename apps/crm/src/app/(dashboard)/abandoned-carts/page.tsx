'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ShoppingCart, Clock, TrendingUp, AlertCircle, CheckCircle, RefreshCw, X, Loader2, MessageCircle,
} from 'lucide-react';
import { cn, formatCOP, formatRelativeTime } from '@/lib/utils';
import { api } from '@/lib/api';

// Columnas alineadas al enum real CartStatus.
const COLUMNS = [
  { id: 'OPEN',      label: 'Abierto',    sublabel: 'Carrito sin finalizar',      icon: AlertCircle,
    headerBg: 'bg-amber-50',   headerText: 'text-amber-700',   headerBorder: 'border-amber-200',
    dot: 'bg-amber-400', cardBorder: 'border-amber-100', avatarBg: 'bg-amber-100 text-amber-700' },
  { id: 'RECOVERED', label: 'Recuperado', sublabel: 'Convertido en pedido',       icon: CheckCircle,
    headerBg: 'bg-emerald-50', headerText: 'text-emerald-700', headerBorder: 'border-emerald-200',
    dot: 'bg-emerald-400', cardBorder: 'border-emerald-100', avatarBg: 'bg-emerald-100 text-emerald-700' },
  // La clienta contestó al recordatorio y la secuencia se detuvo: la lleva una
  // persona. No es recuperado —todavía no ha comprado— ni perdido.
  { id: 'EN_CONVERSACION', label: 'En conversación', sublabel: 'Contestó · la atiende una asesora', icon: MessageCircle,
    headerBg: 'bg-sky-50',     headerText: 'text-sky-700',     headerBorder: 'border-sky-200',
    dot: 'bg-sky-400', cardBorder: 'border-sky-100', avatarBg: 'bg-sky-100 text-sky-700' },
  { id: 'LOST',      label: 'Perdido',    sublabel: 'Sin respuesta',              icon: X,
    headerBg: 'bg-red-50',     headerText: 'text-red-600',     headerBorder: 'border-red-200',
    dot: 'bg-red-400', cardBorder: 'border-red-100', avatarBg: 'bg-red-100 text-red-600' },
] as const;

interface Cart {
  id: string;
  status: 'OPEN' | 'RECOVERED' | 'LOST' | 'EN_CONVERSACION';
  totalAmount?: string | number | null;
  checkoutUrl?: string | null;
  reminderCount: number;
  createdAt: string;
  customer?: { id: string; name: string; phone: string; city?: string | null } | null;
  /** Conversación más reciente de la clienta, si tiene. */
  conversation?: { id: string; channel: string; status: string; messages: number } | null;
  email?: string | null;
  phone?: string | null;
}

const initials = (n: string) => n.split(' ').map(x => x[0]).join('').toUpperCase().slice(0, 2);

export default function AbandonedCartsPage() {
  const [carts, setCarts]     = useState<Cart[]>([]);
  const [loading, setLoading] = useState(true);
  const [conteos, setConteos] = useState<Record<string, number>>({});
  const [montos, setMontos]   = useState<Record<string, number>>({});
  const [totalGeneral, setTotalGeneral] = useState(0);

  useEffect(() => {
    api.get<{
      data: Cart[]; totalGeneral?: number;
      porEstado?: Record<string, number>; montoPorEstado?: Record<string, number>;
    }>('/api/abandoned-carts?limit=150')
      .then(res => {
        setCarts(res.data);
        if (res.porEstado) setConteos(res.porEstado);
        if (res.montoPorEstado) setMontos(res.montoPorEstado);
        if (res.totalGeneral) setTotalGeneral(res.totalGeneral);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const byStatus = (s: string) => carts.filter(c => c.status === s);
  const num = (v: unknown) => Number(v || 0);

  /**
   * Las tarjetas cuentan TODOS los carritos, no los 150 que se traen para
   * pintar las tarjetas del kanban. Antes se calculaban sobre lo cargado, y
   * como la pantalla pide los 150 más recientes mezclando estados, decía «144
   * abiertos» habiendo 2.286 y una tasa de recuperación del 4 % cuando la real
   * es del 18 %. Se leía como que casi no entran carritos.
   */
  const abiertos    = conteos.OPEN      ?? byStatus('OPEN').length;
  const convertidos = conteos.RECOVERED ?? byStatus('RECOVERED').length;
  const totales     = totalGeneral || carts.length;
  const recoverable = montos.OPEN      ?? 0;
  const recovered   = montos.RECOVERED ?? 0;
  const rate = totales ? Math.round((convertidos / totales) * 100) : 0;

  return (
    <div className="flex-1 overflow-auto bg-[#FFF8F7]">

      {/* Header */}
      <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-[#F7E4E2] px-8 py-4 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[17px] font-bold text-[#2E1614]">Carritos abandonados</h1>
            <p className="text-xs text-[#8C6B66] mt-0.5">
              {loading
                ? 'Cargando…'
                : `${totales.toLocaleString('es-CO')} carrito${totales === 1 ? '' : 's'}` +
                  (carts.length < totales ? ` · se muestran los ${carts.length} más recientes` : '')}
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-5">

        {/* KPIs (reales) */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label:'Recuperable',       value:formatCOP(recoverable),       sub:`${abiertos.toLocaleString('es-CO')} abiertos`,        icon:ShoppingCart, color:'text-amber-600',   bg:'bg-amber-50 border-amber-100' },
            { label:'Recuperado',        value:formatCOP(recovered),         sub:`${convertidos.toLocaleString('es-CO')} convertidos`,  icon:TrendingUp,   color:'text-emerald-600', bg:'bg-emerald-50 border-emerald-100' },
            { label:'Abiertos',          value:abiertos.toLocaleString('es-CO'), sub:'Requieren atención',                   icon:AlertCircle,  color:'text-red-500',     bg:'bg-red-50 border-red-100' },
            { label:'Tasa recuperación', value:`${rate}%`,                    sub:'del total de carritos',                   icon:RefreshCw,    color:'text-pepper-600',  bg:'bg-brand-50 border-brand-200' },
          ].map(s => (
            <div key={s.label} className={cn('rounded-2xl border p-4', s.bg)}>
              <s.icon className={cn('w-4 h-4 mb-2', s.color)} />
              <p className={cn('text-2xl font-bold', s.color)}>{s.value}</p>
              <p className="text-[10px] font-black text-[#8C6B66] uppercase tracking-wide mt-0.5">{s.label}</p>
              <p className="text-[10px] text-[#8C6B66] mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16 text-[#C6A5A2]">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {/* Estado vacío honesto: el rastreo de carritos aún no está conectado */}
        {!loading && carts.length === 0 && (
          <div className="text-center py-16 bg-white rounded-2xl border border-[#F7E4E2]">
            <div className="w-12 h-12 rounded-2xl bg-brand-50 border border-brand-100 flex items-center justify-center mx-auto mb-4">
              <ShoppingCart className="w-6 h-6 text-pepper-600" />
            </div>
            <p className="font-bold text-[15px] text-[#2E1614]">No hay carritos abandonados registrados</p>
            <p className="text-xs text-[#8C6B66] mt-1.5 max-w-md mx-auto leading-relaxed">
              Los carritos aparecerán aquí automáticamente cuando se active el rastreo de checkouts
              de Shopify. Cada vez que alguien inicie una compra y no la termine, quedará registrado
              para poder recuperarlo por WhatsApp.
            </p>
          </div>
        )}

        {/* Kanban con datos reales */}
        {!loading && carts.length > 0 && (
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-4" style={{ minWidth: `${COLUMNS.length * 300}px` }}>
              {COLUMNS.map(col => {
                const items = byStatus(col.id);
                return (
                  <div key={col.id} className="w-[290px] shrink-0">
                    <div className={cn('rounded-xl px-4 py-3 mb-3 border', col.headerBg, col.headerBorder)}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={cn('w-2 h-2 rounded-full', col.dot)} />
                          <col.icon className={cn('w-3.5 h-3.5', col.headerText)} />
                          <span className={cn('font-bold text-[13px]', col.headerText)}>{col.label}</span>
                        </div>
                        <span className={cn('text-[11px] font-black px-2 py-0.5 rounded-full border', col.headerBg, col.headerBorder, col.headerText)}>
                          {(conteos[col.id] ?? items.length).toLocaleString('es-CO')}
                        </span>
                      </div>
                      <p className="text-[10px] text-[#8C6B66] mt-1 ml-4">{col.sublabel}</p>
                    </div>

                    <div className="space-y-2">
                      {(conteos[col.id] ?? 0) > items.length && (
                        <p className="text-center text-[10px] text-[#8C6B66] pb-1">
                          mostrando {items.length} de {(conteos[col.id] ?? 0).toLocaleString('es-CO')}
                        </p>
                      )}
                      {items.map(cart => {
                        const name = cart.customer?.name || cart.email || cart.phone || 'Anónimo';
                        return (
                          <div key={cart.id} className={cn('bg-white rounded-xl border p-3', col.cardBorder)}>
                            <div className="flex items-start gap-2.5">
                              <div className={cn('w-8 h-8 rounded-xl flex items-center justify-center text-[11px] font-bold shrink-0', col.avatarBg)}>
                                {initials(name)}
                              </div>
                              <div className="flex-1 min-w-0">
                                {cart.customer ? (
                                  <Link href={`/customers/${cart.customer.id}`} className="font-semibold text-[12px] text-[#2E1614] hover:text-pepper-600 truncate block">
                                    {name}
                                  </Link>
                                ) : (
                                  <p className="font-semibold text-[12px] text-[#2E1614] truncate">{name}</p>
                                )}
                                {cart.customer?.city && <p className="text-[10px] text-[#8C6B66]">{cart.customer.city}</p>}
                                {/* Salto a la bandeja para ver qué se le ha escrito. */}
                                {cart.conversation ? (
                                  <Link
                                    href={`/inbox?c=${cart.conversation.id}`}
                                    className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-pepper-600 hover:text-pepper-700 hover:underline"
                                  >
                                    <MessageCircle className="w-2.5 h-2.5" />
                                    Ver conversación ({cart.conversation.messages})
                                  </Link>
                                ) : (
                                  <span className="mt-0.5 inline-block text-[10px] text-[#B9A3A0]">Sin conversación</span>
                                )}
                              </div>
                            </div>
                            <div className="mt-2 pt-2 border-t border-[#FFF8F7] flex items-center justify-between">
                              <span className="font-bold text-[12px] text-[#2E1614]">{formatCOP(num(cart.totalAmount))}</span>
                              <div className="flex items-center gap-1.5">
                                <Clock className="w-2.5 h-2.5 text-[#8C6B66]" />
                                <span className="text-[10px] text-[#8C6B66]">{formatRelativeTime(cart.createdAt)}</span>
                              </div>
                            </div>
                            {cart.reminderCount > 0 && (
                              <p className="text-[10px] text-pepper-600 font-semibold mt-1.5">
                                {cart.reminderCount} recordatorio{cart.reminderCount > 1 ? 's' : ''} enviado{cart.reminderCount > 1 ? 's' : ''}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
