'use client';
/**
 * Abrir conversación con alguien a quien todavía no le hemos escrito.
 *
 * Busca entre TODAS las clientas del CRM —no solo las que ya tienen chat— y
 * acepta un celular que no exista aún, creando la ficha. Antes, para hablarle
 * a alguien nuevo había que esperar a que escribiera ella primero.
 */
import { useEffect, useState } from 'react';
import { Search, X, Loader2, MessageSquarePlus } from 'lucide-react';
import { cn, mostrarTelefono } from '@/lib/utils';
import { api } from '@/lib/api';

interface Clienta {
  id: string;
  name: string;
  phone: string;
  city?: string | null;
  _count?: { orders: number };
}

interface Linea { id: string; nombre: string }

export function NuevoChat({ lineas, lineaActual, onCerrar, onAbierta }: {
  lineas: Linea[];
  lineaActual: string;
  onCerrar: () => void;
  onAbierta: (conversationId: string) => void;
}) {
  const [q, setQ] = useState('');
  const [resultados, setResultados] = useState<Clienta[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [abriendo, setAbriendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linea, setLinea] = useState(lineaActual || lineas[0]?.id || '');

  // Solo dígitos y con largo de celular: se ofrece crear el contacto.
  const soloDigitos = q.replace(/\D/g, '');
  const pareceCelular = soloDigitos.length >= 10 && /^[\d\s+()-]+$/.test(q.trim());

  useEffect(() => {
    if (q.trim().length < 3) { setResultados([]); return; }
    const t = setTimeout(() => {
      setBuscando(true);
      api.get<{ data: Clienta[] }>(`/api/customers?search=${encodeURIComponent(q.trim())}&limit=8`)
        .then(r => setResultados(r.data ?? []))
        .catch(() => setResultados([]))
        .finally(() => setBuscando(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function abrir(datos: { customerId?: string; telefono?: string }) {
    setAbriendo(true);
    setError(null);
    try {
      const r = await api.post<{ id: string }>('/api/conversations/abrir', {
        ...datos, metaAccountId: linea || undefined,
      });
      onAbierta(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir la conversación.');
      setAbriendo(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/30 p-4 pt-24" onClick={onCerrar}>
      <div className="w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-brand-100 flex items-center justify-between">
          <h2 className="font-display font-bold text-ink flex items-center gap-2">
            <MessageSquarePlus className="w-4 h-4 text-pepper-600" /> Escribir a alguien
          </h2>
          <button onClick={onCerrar} className="p-1.5 rounded-lg hover:bg-brand-50"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-3">
          {lineas.length > 1 && (
            <div className="flex gap-1.5">
              {lineas.map(l => (
                <button key={l.id} onClick={() => setLinea(l.id)}
                  className={cn('flex-1 py-1.5 rounded-xl text-[11px] font-bold border transition-colors',
                    linea === l.id ? 'bg-violet-600 text-white border-violet-600'
                                   : 'bg-white border-brand-100 text-ink-soft hover:border-pepper-300')}>
                  {l.nombre}
                </button>
              ))}
            </div>
          )}

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-ink-muted" />
            <input
              value={q} onChange={e => setQ(e.target.value)} autoFocus
              placeholder="Nombre o celular…"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl text-[14px] bg-brand-50/60 border border-brand-100 outline-none focus:border-pepper-300"
            />
            {buscando && <Loader2 className="w-4 h-4 absolute right-3 top-3 animate-spin text-pepper-400" />}
          </div>

          {error && <p className="text-[12px] text-red-600 font-medium">{error}</p>}

          <div className="max-h-72 overflow-y-auto -mx-1">
            {resultados.map(c => (
              <button key={c.id} disabled={abriendo}
                onClick={() => abrir({ customerId: c.id })}
                className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-brand-50 disabled:opacity-50 flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-brand-100 text-pepper-700 flex items-center justify-center text-[11px] font-bold shrink-0">
                  {c.name.split(' ').map(x => x[0]).join('').toUpperCase().slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-ink truncate">{c.name}</p>
                  <p className="text-[11px] text-ink-muted">
                    {mostrarTelefono(c.phone)}{c.city ? ` · ${c.city}` : ''}
                    {c._count?.orders ? ` · ${c._count.orders} pedido(s)` : ''}
                  </p>
                </div>
              </button>
            ))}

            {/* Un celular que no está en el CRM: se crea el contacto al abrir. */}
            {pareceCelular && !resultados.some(c => c.phone.replace(/\D/g, '').endsWith(soloDigitos.slice(-10))) && (
              <button disabled={abriendo}
                onClick={() => abrir({ telefono: q.trim() })}
                className="w-full text-left px-3 py-2.5 rounded-xl border border-dashed border-pepper-300 hover:bg-brand-50 disabled:opacity-50 mt-1">
                <p className="text-[13px] font-semibold text-pepper-700">
                  Escribir a +57 {soloDigitos.slice(-10)}
                </p>
                <p className="text-[11px] text-ink-muted">No está en el CRM — se crea el contacto</p>
              </button>
            )}

            {q.trim().length >= 3 && !buscando && !resultados.length && !pareceCelular && (
              <p className="text-[12px] text-ink-muted text-center py-6">Sin resultados</p>
            )}
          </div>

          <p className="text-[11px] text-ink-muted leading-snug border-t border-brand-100 pt-3">
            Si la clienta no te ha escrito en las últimas 24 horas, WhatsApp solo
            permite enviarle una <strong>plantilla</strong>. El chat se abre igual
            y puedes elegirla desde el campo de mensaje.
          </p>
        </div>
      </div>
    </div>
  );
}
