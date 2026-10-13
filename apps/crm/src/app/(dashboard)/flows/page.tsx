'use client';
import { useEffect, useState } from 'react';
import {
  Zap, MessageSquare, ShoppingCart, RotateCcw, Package, Truck,
  CheckCircle, Clock, Hash, PackageCheck, PackageX, Plus, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

// Etiqueta e icono por tipo de disparador (enum FlowTrigger)
const TRIGGERS: Record<string, { label: string; icon: typeof Zap; color: string }> = {
  ORDER_CREATED:       { label: 'Pedido creado',          icon: ShoppingCart, color: 'text-pepper-600' },
  ORDER_CONFIRMED:     { label: 'Pedido confirmado',      icon: CheckCircle,  color: 'text-blue-500' },
  ORDER_DISPATCHED:    { label: 'Pedido despachado',      icon: Truck,        color: 'text-violet-500' },
  ORDER_DELIVERED:     { label: 'Pedido entregado',       icon: PackageCheck, color: 'text-emerald-500' },
  ORDER_RETURNED:      { label: 'Pedido devuelto',        icon: PackageX,     color: 'text-red-500' },
  DAYS_AFTER_DELIVERY: { label: 'Días tras la entrega',   icon: Clock,        color: 'text-teal-500' },
  NO_REPURCHASE_DAYS:  { label: 'Días sin recompra',      icon: RotateCcw,    color: 'text-orange-500' },
  MESSAGE_RECEIVED:    { label: 'Mensaje recibido',       icon: MessageSquare,color: 'text-pepper-600' },
  KEYWORD_RECEIVED:    { label: 'Palabra clave recibida', icon: Hash,         color: 'text-pink-500' },
  ABANDONED_CART:      { label: 'Carrito abandonado',     icon: Package,      color: 'text-amber-500' },
  ORDER_IN_TRANSIT:       { label: 'Pedido en tránsito',    icon: Truck,        color: 'text-violet-500' },
  ORDER_OUT_FOR_DELIVERY: { label: 'Pedido en reparto',     icon: Truck,        color: 'text-indigo-500' },
  ORDER_AT_OFFICE:        { label: 'Pedido en oficina',     icon: Package,      color: 'text-amber-600' },
  ORDER_NOVELTY:          { label: 'Pedido con novedad',    icon: PackageX,     color: 'text-red-500' },
  CONFIRMATION_REMINDER:  { label: 'Sin confirmar (90 min)', icon: Clock,       color: 'text-orange-500' },
};

interface Flow {
  id: string;
  name: string;
  description?: string | null;
  trigger: string;
  isActive: boolean;
  steps: unknown;
  _count: { executions: number };
}

export default function FlowsPage() {
  const [flows, setFlows]     = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const load = () =>
    api.get<Flow[]>('/api/flows')
      .then(setFlows)
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  async function toggleFlow(id: string) {
    setToggling(id);
    // Optimista: refleja el cambio de inmediato y confirma contra el servidor
    setFlows(prev => prev.map(f => f.id === id ? { ...f, isActive: !f.isActive } : f));
    try {
      await api.patch(`/api/flows/${id}/toggle`, {});
    } catch {
      setFlows(prev => prev.map(f => f.id === id ? { ...f, isActive: !f.isActive } : f));
    } finally {
      setToggling(null);
    }
  }

  const activeCount = flows.filter(f => f.isActive).length;
  const stepCount = (steps: unknown) => Array.isArray(steps) ? steps.length : 0;

  return (
    <div className="flex-1 overflow-auto bg-[#FFF8F7]">

      {/* Header */}
      <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-[#F7E4E2] px-8 py-4 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[17px] font-bold text-[#2E1614]">Flujos automáticos</h1>
            <p className="text-xs text-[#8C6B66] mt-0.5">
              {loading ? 'Cargando…' : `${flows.length} flujo${flows.length === 1 ? '' : 's'} · ${activeCount} activo${activeCount === 1 ? '' : 's'}`}
            </p>
          </div>
          <button className="flex items-center gap-2 bg-pepper-600 hover:bg-pepper-700 text-white px-4 py-2 rounded-xl text-xs font-semibold transition-colors shadow-sm">
            <Plus className="w-3.5 h-3.5" /> Nuevo flujo
          </button>
        </div>
      </div>

      <div className="p-8 space-y-3 max-w-3xl">

        {loading && (
          <div className="flex items-center justify-center py-20 text-[#C6A5A2]">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {/* Estado vacío honesto: no hay motor de flujos configurado todavía */}
        {!loading && flows.length === 0 && (
          <div className="text-center py-16 bg-white rounded-2xl border border-[#F7E4E2]">
            <div className="w-12 h-12 rounded-2xl bg-brand-50 border border-brand-100 flex items-center justify-center mx-auto mb-4">
              <Zap className="w-6 h-6 text-pepper-600" />
            </div>
            <p className="font-bold text-[15px] text-[#2E1614]">Aún no hay flujos automáticos</p>
            <p className="text-xs text-[#8C6B66] mt-1.5 max-w-md mx-auto leading-relaxed">
              Los flujos permiten enviar mensajes automáticos según eventos: confirmar un pedido
              contra entrega, avisar el número de guía, o invitar a la recompra unos días después
              de entregado. Crea el primero para empezar a automatizar.
            </p>
            <button className="inline-flex items-center gap-2 mt-5 bg-pepper-600 hover:bg-pepper-700 text-white px-4 py-2 rounded-xl text-xs font-semibold transition-colors">
              <Plus className="w-3.5 h-3.5" /> Crear primer flujo
            </button>
          </div>
        )}

        {!loading && flows.map(flow => {
          const t = TRIGGERS[flow.trigger] ?? { label: flow.trigger, icon: Zap, color: 'text-[#8C6B66]' };
          return (
            <div
              key={flow.id}
              className={cn(
                'bg-white rounded-2xl border border-[#F7E4E2] p-5 flex items-center gap-4 transition-all',
                !flow.isActive && 'opacity-60'
              )}
            >
              <div className="w-11 h-11 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center shrink-0">
                <t.icon className={cn('w-5 h-5', t.color)} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[14px] text-[#2E1614]">{flow.name}</p>
                {flow.description && (
                  <p className="text-[11px] text-[#8C6B66] mt-1 leading-relaxed">{flow.description}</p>
                )}
                <p className="text-[11px] text-[#8C6B66] mt-1">
                  Disparador: {t.label}{stepCount(flow.steps) > 0 && ` · ${stepCount(flow.steps)} paso${stepCount(flow.steps) === 1 ? '' : 's'}`}
                </p>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="text-[10px] text-[#8C6B66]">Ejecuciones</p>
                  <p className="font-bold text-[#2E1614] text-[15px]">{flow._count.executions}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[10px] text-[#8C6B66]">{flow.isActive ? 'Activo' : 'Pausado'}</span>
                  <button
                    onClick={() => toggleFlow(flow.id)}
                    disabled={toggling === flow.id}
                    className={cn('w-10 h-6 rounded-full transition-colors relative disabled:opacity-50', flow.isActive ? 'bg-pepper-600' : 'bg-[#DBDBDB]')}
                  >
                    <span className={cn('absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform', flow.isActive ? 'translate-x-5' : 'translate-x-1')} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
