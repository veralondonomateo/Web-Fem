'use client';
/**
 * Modal para radicar una PQRS. Se usa en dos sitios: la página /pqrs (con
 * buscador de clienta) y la bandeja (con la clienta y la conversación ya
 * puestas, para radicar sin salir del chat).
 */
import { useEffect, useState } from 'react';
import { Loader2, Plus, Search, Wallet, X } from 'lucide-react';
import { cn, mostrarTelefono } from '@/lib/utils';
import { api } from '@/lib/api';
import { TIPOS_PQRS, TipoPqrs } from '@/lib/pqrs';
import { parsearMonto } from '@/lib/devoluciones';
import {
  CamposDevolucion, DatosDevolucion, cuerpoDevolucion, datosDevolucionVacios,
} from '@/components/devolucion-campos';

export function NuevaPqrs({ onCerrar, onCreada, clientaInicial, conversationId }: {
  onCerrar: () => void; onCreada: () => void;
  clientaInicial?: { id: string; name: string; phone?: string } | null;
  /** Si se radica desde el chat, la PQRS queda ligada a esa conversación. */
  conversationId?: string;
}) {
  const [tipo, setTipo] = useState<TipoPqrs>('RECLAMO');
  const [asunto, setAsunto] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [resultados, setResultados] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [clienta, setClienta] = useState<{ id: string; name: string; phone?: string } | null>(clientaInicial ?? null);
  const [ocupada, setOcupada] = useState(false);
  // La devolución se abre aquí mismo, al radicar. Antes solo se podía desde el
  // radicado ya abierto, y por eso la pestaña Devoluciones llevaba meses vacía:
  // cuando la clienta pide su plata lo dice en el mismo reclamo, no después.
  const [conDevolucion, setConDevolucion] = useState(false);
  const [dev, setDev] = useState<DatosDevolucion>(() => datosDevolucionVacios(clientaInicial));
  const ponerDev = (parche: Partial<DatosDevolucion>) => setDev(d => ({ ...d, ...parche }));

  const listo = !!clienta && !!asunto.trim() && !!descripcion.trim()
    && (!conDevolucion || parsearMonto(dev.monto) !== null);

  useEffect(() => {
    if (!busqueda.trim() || clienta) { setResultados([]); return; }
    const t = setTimeout(() => {
      api.get<{ data: { id: string; name: string; phone: string }[] }>(
        `/api/customers?search=${encodeURIComponent(busqueda)}&limit=6`,
      ).then(r => setResultados(r.data ?? [])).catch(() => setResultados([]));
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda, clienta]);

  /**
   * Al elegir la clienta se rellenan titular y contacto con lo suyo. Solo si
   * están vacíos: si la agente ya escribió que la cuenta es de otra persona,
   * eso manda sobre lo que diga la ficha.
   */
  useEffect(() => {
    if (!clienta) return;
    setDev(d => ({
      ...d,
      titular:  d.titular  || clienta.name,
      contacto: d.contacto || clienta.phone || '',
    }));
  }, [clienta]);

  const crear = async () => {
    if (!listo || !clienta) return;
    setOcupada(true);
    try {
      const pqrs = await api.post<{ id: string }>('/api/pqrs', {
        tipo, asunto: asunto.trim(), descripcion: descripcion.trim(),
        customerId: clienta.id, conversationId,
      });

      // La devolución va después y aparte: si falla, la PQRS ya está radicada y
      // no se pierde. Se avisa y se sigue, que la clienta quede registrada es lo
      // que no puede fallar; la plata se puede abrir luego desde el radicado.
      if (conDevolucion && parsearMonto(dev.monto) !== null) {
        try {
          await api.post('/api/devoluciones', {
            pqrsId: pqrs.id,
            ...cuerpoDevolucion(dev, asunto.trim()),
          });
        } catch (e) {
          alert(
            'La PQRS quedó radicada, pero la devolución no se pudo abrir: '
            + (e instanceof Error ? e.message : 'error desconocido')
            + '\nÁbrela desde el radicado, en la pestaña PQRS.',
          );
        }
      }

      onCreada();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo radicar.');
      setOcupada(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/30 p-4" onClick={onCerrar}>
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto bg-white rounded-3xl shadow-2xl p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-lg text-ink">Radicar PQRS</h2>
          <button onClick={onCerrar} className="p-1.5 rounded-lg hover:bg-brand-50"><X className="w-4 h-4" /></button>
        </div>

        {/* Tipo */}
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(TIPOS_PQRS).map(([k, v]) => (
            <button key={k}
              onClick={() => setTipo(k as TipoPqrs)}
              className={cn('py-2 rounded-xl text-[12px] font-bold border transition-colors',
                tipo === k ? 'bg-pepper-600 text-white border-pepper-600' : 'bg-white border-brand-100 text-ink-soft hover:bg-brand-50')}
            >{v.etiqueta}</button>
          ))}
        </div>

        {/* Clienta */}
        {clienta ? (
          <div className="flex items-center gap-2 bg-brand-50/60 rounded-xl px-3 py-2.5">
            <span className="text-[14px] font-semibold text-ink flex-1">{clienta.name}</span>
            {!clientaInicial && (
              <button onClick={() => { setClienta(null); setBusqueda(''); }}
                className="text-[12px] text-pepper-600 font-semibold">Cambiar</button>
            )}
          </div>
        ) : (
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-3 text-ink-muted" />
            <input
              value={busqueda} onChange={e => setBusqueda(e.target.value)} autoFocus
              placeholder="Buscar clienta por nombre o teléfono…"
              className="w-full pl-9 pr-3 py-2.5 rounded-xl text-[14px] bg-brand-50/60 border border-brand-100 outline-none focus:border-pepper-300"
            />
            {resultados.length > 0 && (
              <div className="absolute top-full mt-1 w-full bg-white border border-brand-100 rounded-xl shadow-lg z-10 overflow-hidden">
                {resultados.map(r => (
                  <button key={r.id}
                    onClick={() => setClienta(r)}
                    className="w-full text-left px-3 py-2 hover:bg-brand-50 text-[13px]"
                  >
                    <span className="font-semibold text-ink">{r.name}</span>
                    <span className="text-ink-muted ml-2">{mostrarTelefono(r.phone)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <input
          value={asunto} onChange={e => setAsunto(e.target.value)}
          placeholder="Asunto — ej.: Producto llegó averiado"
          className="w-full px-4 py-2.5 rounded-xl text-[14px] bg-brand-50/60 border border-brand-100 outline-none focus:border-pepper-300"
        />
        <textarea
          value={descripcion} onChange={e => setDescripcion(e.target.value)} rows={4}
          placeholder="Descripción completa de lo que reporta la clienta…"
          className="w-full px-4 py-2.5 rounded-xl text-[14px] bg-brand-50/60 border border-brand-100 outline-none focus:border-pepper-300 resize-none"
        />

        {/* Devolución de dinero */}
        <div className={cn('rounded-2xl border transition-colors',
          conDevolucion ? 'bg-amber-50 border-amber-200' : 'bg-white border-brand-100')}>
          <label className="flex items-center gap-2.5 px-4 py-3 cursor-pointer">
            <input
              type="checkbox" checked={conDevolucion}
              onChange={e => setConDevolucion(e.target.checked)}
              className="w-4 h-4 accent-amber-600"
            />
            <Wallet className={cn('w-4 h-4', conDevolucion ? 'text-amber-700' : 'text-pepper-600')} />
            <span className="text-[13px] font-semibold text-ink">Hay que devolverle dinero</span>
          </label>

          {conDevolucion && (
            <div className="px-4 pb-4">
              <CamposDevolucion datos={dev} set={ponerDev} />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-[12px] text-ink-muted">
            Plazo legal: <strong>{TIPOS_PQRS[tipo].diasHabiles} días hábiles</strong>
          </p>
          <button
            disabled={!listo || ocupada}
            onClick={crear}
            className="flex items-center gap-2 bg-pepper-600 hover:bg-pepper-700 disabled:opacity-50 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-colors"
          >
            {ocupada ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Radicar
          </button>
        </div>
      </div>
    </div>
  );
}
