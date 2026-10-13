'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Search, MessageSquare, TrendingUp, AlertTriangle } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { formatCOP, formatDate, CHANNEL_COLORS, CUSTOMER_STATUS_LABELS, CUSTOMER_STATUS_COLORS, mostrarTelefono } from '@/lib/utils';
import { cn } from '@/lib/utils';

/** Clientas por tanda al bajar en la lista. */
const POR_PAGINA = 100;

interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  city?: string;
  department?: string;
  originChannel?: string;
  status: string;
  ltv: number;
  totalOrders: number;
  lastPurchaseAt?: string;
  firstPurchaseAt?: string;
  tags: string[];
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [pagina, setPagina] = useState(1);

  /**
   * Se traen por tandas. Antes se pedían 1.000 de golpe y ahí acababa la
   * lista: con 22.441 clientas, las demás no había manera de verlas. El total
   * viene del servidor para que el encabezado diga cuántas hay de verdad y no
   * cuántas se alcanzaron a cargar.
   */
  const loadCustomers = useCallback((pagina = 1) => {
    if (pagina === 1) setLoading(true); else setCargandoMas(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (filterStatus) params.set('status', filterStatus);
    params.set('limit', String(POR_PAGINA));
    params.set('page', String(pagina));
    api.get<{ data: Customer[]; total: number }>(`/api/customers?${params}`)
      .then(r => {
        setCustomers(prev => pagina === 1 ? (r.data ?? []) : [...prev, ...(r.data ?? [])]);
        setTotal(r.total ?? null);
        setPagina(pagina);
      })
      .catch(() => { if (pagina === 1) setCustomers([]); })
      .finally(() => { setLoading(false); setCargandoMas(false); });
  }, [search, filterStatus]);

  useEffect(() => { loadCustomers(1); }, [loadCustomers]);

  const initials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  const daysSince = (date?: string) => date ? Math.floor((Date.now() - new Date(date).getTime()) / 86400000) : null;

  return (
    <div className="flex-1 overflow-auto">
      <div className="sticky top-0 bg-white border-b border-brand-100 px-8 py-4 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-ink">Clientas</h1>
            <p className="text-sm text-muted-foreground">
              {loading ? 'Cargando…' : `${(total ?? customers.length).toLocaleString('es-CO')} clientas registradas · sincronización automática con Mastershop`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
            <Input
              placeholder="Buscar por nombre, teléfono o email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-1.5">
            {[{ key: '', label: 'Todos' }, ...Object.entries(CUSTOMER_STATUS_LABELS).map(([k, v]) => ({ key: k, label: v }))].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilterStatus(key)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                  filterStatus === key ? 'bg-pepper-600 text-white border-pepper-600' : 'bg-white text-ink-soft border-brand-100 hover:border-brand-200'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-8">
        <div className="bg-white rounded-xl border border-brand-100 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-brand-100">
                {['Clienta', 'Canal', 'Estado', 'Pedidos', 'LTV', 'Última compra', 'Días sin compra', 'Etiquetas', ''].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-ink-muted uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-brand-50 rounded animate-pulse" style={{ width: j === 0 ? 140 : j === 4 ? 80 : 60 }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-sm text-ink-muted">
                    No hay clientas todavía. Se importan automáticamente desde Mastershop.
                  </td>
                </tr>
              ) : (
                customers.map(c => {
                  const dias = daysSince(c.lastPurchaseAt);
                  return (
                    <tr key={c.id} className="hover:bg-brand-50 transition-colors group">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar className="w-8 h-8">
                            <AvatarFallback className="text-xs">{initials(c.name)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <Link href={`/customers/${c.id}`} className="font-medium text-ink text-sm hover:text-pepper-600">
                              {c.name}
                            </Link>
                            <p className="text-xs text-muted-foreground">{mostrarTelefono(c.phone)}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {c.originChannel && (
                          <span className={`w-2 h-2 rounded-full inline-block mr-1.5 ${CHANNEL_COLORS[c.originChannel]}`} />
                        )}
                        <span className="text-xs text-ink-soft">
                          {c.originChannel ? c.originChannel.charAt(0) + c.originChannel.slice(1).toLowerCase() : '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('px-2 py-0.5 rounded-full text-xs font-medium', CUSTOMER_STATUS_COLORS[c.status])}>
                          {CUSTOMER_STATUS_LABELS[c.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-ink">{c.totalOrders}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-pepper-600">{formatCOP(c.ltv)}</td>
                      <td className="px-4 py-3 text-xs text-ink-soft">{c.lastPurchaseAt ? formatDate(c.lastPurchaseAt) : '—'}</td>
                      <td className="px-4 py-3">
                        {dias !== null && (
                          <span className={cn(
                            'text-xs font-medium',
                            dias > 45 ? 'text-red-600' : dias > 30 ? 'text-orange-500' : 'text-ink-soft'
                          )}>
                            {dias > 45 && <AlertTriangle className="w-3 h-3 inline mr-0.5" />}
                            {dias}d
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {c.tags.map(tag => (
                            <span key={tag} className="text-[10px] bg-brand-50 text-ink-soft px-1.5 py-0.5 rounded-full">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="opacity-0 group-hover:opacity-100 flex gap-1 transition-opacity">
                          <Link href={`/customers/${c.id}`}>
                            <button className="p-1.5 hover:bg-brand-50 rounded-lg" title="Ver perfil">
                              <TrendingUp className="w-3.5 h-3.5 text-ink-muted" />
                            </button>
                          </Link>
                          <button className="p-1.5 hover:bg-brand-50 rounded-lg" title="Enviar mensaje">
                            <MessageSquare className="w-3.5 h-3.5 text-ink-muted" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
              </tbody>
            </table>
            {total !== null && customers.length < total && (
              <button
                onClick={() => loadCustomers(pagina + 1)}
                disabled={cargandoMas}
                className="w-full py-3 text-[12px] font-bold text-pepper-600 hover:bg-brand-50 disabled:opacity-50 transition-colors border-t border-brand-100"
              >
                {cargandoMas
                  ? 'Cargando…'
                  : `Ver más · ${customers.length.toLocaleString('es-CO')} de ${total.toLocaleString('es-CO')}`}
              </button>
            )}
        </div>
      </div>
    </div>
  );
}
