'use client';
import { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { api } from '@/lib/api';
import { formatCOP } from '@/lib/utils';

// Un solo color de datos (familia cálida de la marca, validado para contraste);
// todo lo demás es tinta gris.
const ACCENT = '#D33A22';
const GRID   = '#F7E4E2';
const TICK   = { fill: '#8C6B66', fontSize: 11 };

const ORDER_STATUS_ES: Record<string, string> = {
  PENDING_CONFIRMATION: 'Por confirmar',
  PREPARING:            'Por alistar',
  IN_TRANSIT:           'En camino',
  IN_DESTINATION:       'En ciudad destino',
  DELIVERED:            'Entregados',
  RETURNED:             'Devueltos',
  CANCELLED:            'Cancelados',
  FAILED_DELIVERY:      'Con novedad',
};

const GRANULARITIES = [
  { label: 'Día',    value: 'day'   },
  { label: 'Semana', value: 'week'  },
  { label: 'Mes',    value: 'month' },
];

function colombiaToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
}

function daysAgo(n: number): string {
  const today = new Date(`${colombiaToday()}T12:00:00Z`);
  return new Date(today.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

const PRESETS = [
  { label: 'Hoy',     from: () => daysAgo(0),  },
  { label: '7 días',  from: () => daysAgo(6),  },
  { label: '30 días', from: () => daysAgo(29), },
  { label: '90 días', from: () => daysAgo(89), },
];

function compactCOP(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString('es-CO', { maximumFractionDigits: 1 })} M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)} mil`;
  return String(v);
}

function RevenueTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-brand-100 rounded-lg px-3 py-2 shadow-md text-sm">
      <p className="text-xs text-ink-muted mb-1">{label}</p>
      <p className="font-semibold text-ink">{formatCOP(payload[0].value)}</p>
    </div>
  );
}

function OrdersTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-brand-100 rounded-lg px-3 py-2 shadow-md text-sm">
      <p className="text-xs text-ink-muted mb-1">{label}</p>
      <p className="font-semibold text-ink">
        {payload[0].value}
        <span className="font-normal text-ink-muted ml-1">pedidos</span>
      </p>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-brand-100 px-5 py-4">
      <p className="text-[13px] text-ink-muted">{label}</p>
      <p className="text-[22px] font-semibold text-ink mt-1 tracking-tight">{value}</p>
      {sub && <p className="text-xs text-ink-muted mt-0.5">{sub}</p>}
    </div>
  );
}

function HBar({ label, value, max, suffix }: { label: string; value: number; max: number; suffix?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm mb-1">
        <span className="text-ink-soft truncate max-w-[65%]">{label}</span>
        <span className="font-medium text-ink tabular-nums">
          {value}{suffix && <span className="font-normal text-ink-muted ml-1 text-xs">{suffix}</span>}
        </span>
      </div>
      <div className="w-full bg-brand-100 rounded-sm h-1.5">
        <div className="h-1.5 rounded-sm" style={{ width: `${(value / max) * 100}%`, background: ACCENT }} />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [preset, setPreset] = useState<number | null>(2); // 30 días
  const [from, setFrom] = useState(() => daysAgo(29));
  const [to, setTo] = useState(() => colombiaToday());
  const [granularity, setGranularity] = useState('day');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get<any>(`/api/analytics/dashboard?from=${from}&to=${to}&granularity=${granularity}`)
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [from, to, granularity]);

  const applyPreset = (i: number) => {
    setPreset(i);
    setFrom(PRESETS[i].from());
    setTo(colombiaToday());
  };

  const sales = data?.sales;
  const customers = data?.customers;
  const series: { label: string; orders: number; revenue: number }[] = sales?.series ?? [];
  const ordersByCity: { city: string; orders: number }[] = sales?.ordersByCity ?? [];
  const ordersByStatus: { status: string; count: number }[] = sales?.ordersByStatus ?? [];

  const maxCity = Math.max(...ordersByCity.map(c => c.orders), 1);
  const totalOrders = sales?.totalOrders ?? 0;

  const funnel = useMemo(() => {
    const get = (s: string) => ordersByStatus.find(x => x.status === s)?.count ?? 0;
    return [
      { label: 'Creados',    value: totalOrders },
      { label: 'En camino',  value: get('IN_TRANSIT') + get('IN_DESTINATION') },
      { label: 'Entregados', value: sales?.deliveredOrders ?? 0 },
      { label: 'Devueltos',  value: sales?.returnedOrders ?? 0 },
    ];
  }, [ordersByStatus, sales, totalOrders]);

  const fewPoints = series.length <= 2;

  return (
    <div className="flex-1 overflow-auto bg-[#FFF8F7]">
      {/* Encabezado + fila única de filtros que aplica a todo lo de abajo */}
      <div className="sticky top-0 bg-white border-b border-brand-100 px-8 py-4 z-10">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="mr-auto">
            <h1 className="text-lg font-bold text-ink">Dashboard</h1>
            <p className="text-sm text-ink-muted mt-0.5">Fem · datos de Mastershop</p>
          </div>

          <div className="flex items-center gap-1 bg-brand-50 rounded-lg p-1">
            {PRESETS.map((p, i) => (
              <button
                key={p.label}
                onClick={() => applyPreset(i)}
                className={`px-3 py-1.5 rounded-md text-sm transition-all ${
                  preset === i ? 'bg-white text-ink shadow-sm font-medium' : 'text-ink-muted hover:text-ink-soft'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 text-sm">
            <input
              type="date"
              value={from}
              max={to}
              onChange={e => { if (e.target.value) { setFrom(e.target.value); setPreset(null); } }}
              className="border border-brand-100 rounded-lg px-2.5 py-1.5 text-ink-soft bg-white"
            />
            <span className="text-ink-muted">–</span>
            <input
              type="date"
              value={to}
              min={from}
              max={colombiaToday()}
              onChange={e => { if (e.target.value) { setTo(e.target.value); setPreset(null); } }}
              className="border border-brand-100 rounded-lg px-2.5 py-1.5 text-ink-soft bg-white"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-sm text-ink-muted">Agrupar por</span>
            <div className="flex items-center gap-1 bg-brand-50 rounded-lg p-1">
            {GRANULARITIES.map(g => (
              <button
                key={g.value}
                onClick={() => setGranularity(g.value)}
                className={`px-3 py-1.5 rounded-md text-sm transition-all ${
                  granularity === g.value ? 'bg-white text-ink shadow-sm font-medium' : 'text-ink-muted hover:text-ink-soft'
                }`}
              >
                {g.label}
              </button>
            ))}
            </div>
          </div>
        </div>
      </div>

      {/* Al refetch se conserva el render anterior atenuado; sin saltos de layout */}
      <div className={`p-8 space-y-5 transition-opacity ${loading && data ? 'opacity-50 pointer-events-none' : ''}`}>
        {!data ? (
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse bg-brand-100 rounded-xl h-24" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
              <StatTile label="Ingresos"           value={formatCOP(sales?.totalRevenue ?? 0)}       sub={`${totalOrders} pedidos en el período`} />
              <StatTile label="Ticket promedio"    value={formatCOP(sales?.avgOrderValue ?? 0)}      sub="por pedido" />
              <StatTile label="Tasa de entrega"    value={`${(sales?.deliveryRate ?? 0).toFixed(1)}%`} sub={`${sales?.deliveredOrders ?? 0} de ${totalOrders} entregados`} />
              <StatTile label="Devoluciones"       value={`${(sales?.returnRate ?? 0).toFixed(1)}%`} sub={`${sales?.returnedOrders ?? 0} pedidos devueltos`} />
              <StatTile label="Pedidos pendientes" value={String(sales?.pendingOrders ?? 0)}         sub="por confirmar o alistar" />
              <StatTile label="Clientas"           value={String(customers?.total ?? 0)}             sub={`${customers?.newCustomers ?? 0} nuevas en el período`} />
              <StatTile label="Tasa de recompra"   value={`${(customers?.repurchaseRate ?? 0).toFixed(1)}%`} sub={`${customers?.recurringCustomers ?? 0} clientas recurrentes`} />
              <StatTile label="Clientas en riesgo" value={String(customers?.atRiskCustomers ?? 0)}   sub="más de 45 días sin comprar" />
            </div>

            {/* Ingresos y pedidos: misma X, ejes separados (nunca doble eje) */}
            <div className="bg-white rounded-xl border border-brand-100 p-6">
              <div className="flex items-baseline justify-between mb-5">
                <p className="font-semibold text-ink">Ingresos</p>
                <p className="text-sm text-ink-muted">COP</p>
              </div>
              {series.length === 0 ? (
                <div className="h-[220px] flex items-center justify-center text-ink-muted text-sm">
                  Sin datos para este rango
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={series} syncId="dash" margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ACCENT} stopOpacity={0.12} />
                        <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis tick={TICK} axisLine={false} tickLine={false} tickFormatter={compactCOP} width={52} />
                    <Tooltip content={<RevenueTooltip />} cursor={{ stroke: '#F0C9C6', strokeWidth: 1 }} />
                    <Area
                      type="monotone"
                      dataKey="revenue"
                      stroke={ACCENT}
                      strokeWidth={2}
                      fill="url(#revGrad)"
                      dot={fewPoints ? { r: 4, fill: ACCENT, strokeWidth: 0 } : false}
                      activeDot={{ r: 4, fill: ACCENT, strokeWidth: 0 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}

              <div className="flex items-baseline justify-between mt-6 mb-4">
                <p className="font-semibold text-ink">Pedidos</p>
                <p className="text-sm text-ink-muted">unidades</p>
              </div>
              {series.length > 0 && (
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart data={series} syncId="dash" margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="label" tick={TICK} axisLine={false} tickLine={false} minTickGap={24} />
                    <YAxis tick={TICK} axisLine={false} tickLine={false} allowDecimals={false} width={52} />
                    <Tooltip content={<OrdersTooltip />} cursor={{ fill: '#FFF0EF' }} />
                    <Bar dataKey="orders" fill={ACCENT} radius={[3, 3, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
              <div className="bg-white rounded-xl border border-brand-100 p-6">
                <p className="font-semibold text-ink mb-5">Top ciudades</p>
                {ordersByCity.length === 0 ? (
                  <p className="text-sm text-ink-muted text-center py-4">Sin datos</p>
                ) : (
                  <div className="space-y-4">
                    {ordersByCity.slice(0, 6).map(c => (
                      <HBar key={c.city} label={c.city} value={c.orders} max={maxCity} />
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white rounded-xl border border-brand-100 p-6">
                <p className="font-semibold text-ink mb-5">Pedidos por estado</p>
                <div className="space-y-4">
                  {ordersByStatus
                    .filter(s => s.count > 0)
                    .sort((a, b) => b.count - a.count)
                    .map(s => (
                      <HBar
                        key={s.status}
                        label={ORDER_STATUS_ES[s.status] ?? s.status}
                        value={s.count}
                        max={Math.max(totalOrders, 1)}
                      />
                    ))}
                </div>
              </div>

              <div className="bg-white rounded-xl border border-brand-100 p-6">
                <p className="font-semibold text-ink mb-5">Embudo de entrega</p>
                <div className="space-y-4">
                  {funnel.map(f => (
                    <HBar
                      key={f.label}
                      label={f.label}
                      value={f.value}
                      max={Math.max(funnel[0].value, 1)}
                      suffix={`${funnel[0].value > 0 ? Math.round((f.value / funnel[0].value) * 100) : 0}%`}
                    />
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
