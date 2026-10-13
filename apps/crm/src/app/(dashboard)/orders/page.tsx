'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquare, Package, Clock, MapPin } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { api } from '@/lib/api';
import { formatCOP, formatRelativeTime, ORDER_STATUS_LABELS, ORDER_STATUS_COLORS } from '@/lib/utils';
import { cn } from '@/lib/utils';

/** Tarjetas que se traen por columna. El total real va aparte. */
const POR_COLUMNA = 60;

const KANBAN_COLUMNS = [
  { key: 'PENDING_CONFIRMATION', label: 'Por confirmar',     color: 'border-yellow-300 bg-yellow-50' },
  { key: 'PREPARING',            label: 'Por alistar',       color: 'border-indigo-300 bg-indigo-50' },
  { key: 'IN_TRANSIT',           label: 'En camino',         color: 'border-cyan-300 bg-cyan-50'     },
  { key: 'IN_DESTINATION',       label: 'En ciudad destino', color: 'border-teal-300 bg-teal-50'     },
  { key: 'DELIVERED',            label: 'Entregado',         color: 'border-green-300 bg-green-50'   },
  { key: 'FAILED_DELIVERY',      label: 'Con novedad',       color: 'border-red-300 bg-red-50'       },
  { key: 'RETURNED',             label: 'Devuelto',          color: 'border-brand-200 bg-brand-50'     },
  { key: 'CANCELLED',            label: 'Cancelado',         color: 'border-brand-100 bg-brand-50'     },
];

interface Order {
  id: string;
  shopifyOrderNumber?: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  trackingNumber?: string;
  customer: { id: string; name: string; phone: string; city?: string };
}


function OrderCard({ order, onStatusChange }: { order: Order; onStatusChange: (id: string, status: string) => void }) {
  const initials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="bg-white rounded-xl border border-brand-100 p-4 hover:shadow-md transition-shadow space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Avatar className="w-7 h-7">
            <AvatarFallback className="text-xs">{initials(order.customer.name)}</AvatarFallback>
          </Avatar>
          <div>
            <Link href={`/customers/${order.customer.id}`} className="text-sm font-semibold text-ink hover:text-pepper-600 leading-tight">
              {order.customer.name}
            </Link>
            {order.shopifyOrderNumber && (
              <p className="text-xs text-muted-foreground">{order.shopifyOrderNumber}</p>
            )}
          </div>
        </div>
        <p className="font-bold text-pepper-600 text-sm">{formatCOP(order.totalAmount)}</p>
      </div>

      <div className="space-y-1">
        {order.customer.city && (
          <div className="flex items-center gap-1.5 text-xs text-ink-muted">
            <MapPin className="w-3 h-3" />
            {order.customer.city}
          </div>
        )}
        {order.trackingNumber && (
          <div className="flex items-center gap-1.5 text-xs text-ink-muted">
            <Package className="w-3 h-3" />
            {order.trackingNumber}
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs text-ink-muted">
          <Clock className="w-3 h-3" />
          {formatRelativeTime(order.createdAt)}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs border border-brand-100 rounded-lg hover:bg-brand-50 transition-colors text-ink-soft">
          <MessageSquare className="w-3 h-3" /> Mensaje
        </button>
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [loading, setLoading] = useState(true);
  const [conteos, setConteos] = useState<Record<string, number>>({});
  const [total, setTotal] = useState<number | null>(null);

  /**
   * Cada columna pide SUS pedidos.
   *
   * Antes se traían los 1.000 más recientes y se repartían en el navegador.
   * Como los entregados y devueltos son de días atrás, no entraban en esos
   * 1.000 y sus columnas decían «Sin pedidos» habiendo 11.054 y 1.094. Con
   * una consulta por estado, cada columna trae los suyos, y los totales
   * vienen aparte para que el número del encabezado sea el real y no el de
   * las tarjetas cargadas.
   */
  function loadOrders() {
    setLoading(true);
    Promise.all(
      KANBAN_COLUMNS.map(col =>
        api.get<{ data: Order[]; total: number; porEstado?: Record<string, number> }>(
          `/api/orders?status=${col.key}&limit=${POR_COLUMNA}` +
          (col.key === KANBAN_COLUMNS[0].key ? '&conteos=1' : ''),
        ).catch(() => ({ data: [], total: 0 } as any)),
      ),
    ).then(res => {
      setOrders(res.flatMap(r => r.data ?? []));
      const c = res.find(r => r.porEstado)?.porEstado;
      if (c) {
        setConteos(c);
        setTotal(Object.values(c).reduce<number>((a, b) => a + Number(b), 0));
      }
    }).finally(() => setLoading(false));
  }

  useEffect(() => { loadOrders(); }, []);

  const grouped = KANBAN_COLUMNS.reduce((acc, col) => {
    acc[col.key] = orders.filter(o => o.status === col.key);
    return acc;
  }, {} as Record<string, Order[]>);

  function handleStatusChange(id: string, status: string) {
    setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o));
    api.patch(`/api/orders/${id}/status`, { status }).catch(() => {});
  }

  const initials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="sticky top-0 bg-white border-b border-brand-100 px-8 py-4 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-ink">Pedidos</h1>
            <p className="text-sm text-muted-foreground">
              {loading ? 'Cargando…' : `${(total ?? orders.length).toLocaleString('es-CO')} pedidos totales · sincronización automática con Mastershop`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex gap-1 bg-brand-50 rounded-lg p-1">
              {(['kanban', 'list'] as const).map(v => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-medium transition-all capitalize',
                    view === v ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink-soft'
                  )}
                >
                  {v === 'kanban' ? 'Kanban' : 'Lista'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {view === 'kanban' ? (
        <div className="flex-1 overflow-x-auto p-6">
          <div className="flex gap-4 min-w-max h-full">
            {KANBAN_COLUMNS.map(col => (
              <div key={col.key} className="w-64 flex flex-col">
                <div className={cn('rounded-xl border-2 px-3 py-2 mb-3', col.color)}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-ink-soft">{col.label}</p>
                    <span className="bg-white text-ink-soft text-xs font-bold px-2 h-5 rounded-full flex items-center justify-center shadow-sm tabular-nums">
                      {(conteos[col.key] ?? grouped[col.key]?.length ?? 0).toLocaleString('es-CO')}
                    </span>
                  </div>
                </div>
                <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                  {grouped[col.key]?.map(order => (
                    <OrderCard key={order.id} order={order} onStatusChange={handleStatusChange} />
                  ))}
                  {grouped[col.key]?.length === 0 && (
                    <div className="text-center py-8 text-ink-muted text-xs">
                      {loading ? 'Cargando…' : 'Sin pedidos'}
                    </div>
                  )}
                  {/* Decir cuántos quedan sin mostrar evita que el tablero
                      parezca una lista completa cuando son solo las primeras. */}
                  {(conteos[col.key] ?? 0) > (grouped[col.key]?.length ?? 0) && (
                    <p className="text-center py-3 text-[11px] text-ink-muted">
                      y {((conteos[col.key] ?? 0) - (grouped[col.key]?.length ?? 0)).toLocaleString('es-CO')} más
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-8">
          <div className="bg-white rounded-xl border border-brand-100 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-brand-100">
                  {['Pedido', 'Cliente', 'Ciudad', 'Estado', 'Guía', 'Monto', 'Fecha', ''].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-100">
                {orders.map(order => (
                  <tr key={order.id} className="hover:bg-brand-50 transition-colors group">
                    <td className="px-4 py-3 font-mono text-sm text-ink-soft">{order.shopifyOrderNumber || order.id.slice(0, 8)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Avatar className="w-7 h-7"><AvatarFallback className="text-xs">{initials(order.customer.name)}</AvatarFallback></Avatar>
                        <Link href={`/customers/${order.customer.id}`} className="text-sm font-medium text-ink hover:text-pepper-600">{order.customer.name}</Link>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-ink-soft">{order.customer.city || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', ORDER_STATUS_COLORS[order.status])}>
                        {ORDER_STATUS_LABELS[order.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-ink-muted">{order.trackingNumber || '—'}</td>
                    <td className="px-4 py-3 font-semibold text-pepper-600">{formatCOP(order.totalAmount)}</td>
                    <td className="px-4 py-3 text-xs text-ink-muted">{formatRelativeTime(order.createdAt)}</td>
                    <td className="px-4 py-3">
                      <button className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-brand-50 rounded-lg transition-all">
                        <MessageSquare className="w-3.5 h-3.5 text-ink-muted" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
