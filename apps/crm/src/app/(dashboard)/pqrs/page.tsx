'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ShieldAlert, Clock, CheckCircle2, Loader2, Plus, Search, X,
  MessageCircle, User, Send, AlertTriangle, Timer, Wallet,
} from 'lucide-react';
import { cn, formatCOP, formatRelativeTime, mostrarTelefono } from '@/lib/utils';
import { api } from '@/lib/api';
import {
  TIPOS_PQRS, TipoPqrs, ESTADOS_PQRS, EstadoPqrs, PRIORIDADES_PQRS,
  radicadoBonito, Semaforo, EntradaHistorial,
} from '@/lib/pqrs';
import { NuevaPqrs } from '@/components/pqrs-nueva';
import { Devoluciones } from '@/components/devoluciones';
import {
  ESTADOS_DEVOLUCION, EstadoDevolucion, PILL_DEVOLUCION, consecutivoBonito, parsearMonto,
} from '@/lib/devoluciones';
import {
  CamposDevolucion, DatosDevolucion, cuerpoDevolucion, datosDevolucionVacios,
} from '@/components/devolucion-campos';

/* ── Presentación ── */

const SEMAFORO: Record<Semaforo, { punto: string; texto: string; etiqueta: (d: number) => string }> = {
  verde:    { punto: 'bg-emerald-400', texto: 'text-emerald-700', etiqueta: d => `${d} días hábiles` },
  amarillo: { punto: 'bg-amber-400',   texto: 'text-amber-700',   etiqueta: d => `${d} días hábiles` },
  rojo:     { punto: 'bg-red-500',     texto: 'text-red-600',     etiqueta: d => d === 0 ? 'Vence HOY' : `¡${d} días hábiles!` },
  vencida:  { punto: 'bg-red-600 animate-pulse', texto: 'text-red-700', etiqueta: d => `VENCIDA hace ${Math.abs(d)} días hábiles` },
  resuelta: { punto: 'bg-ink-muted/40', texto: 'text-ink-muted',  etiqueta: () => '' },
};

const TIPO_PILL: Record<TipoPqrs, string> = {
  PETICION:   'bg-sky-50 text-sky-700 border-sky-200',
  QUEJA:      'bg-amber-50 text-amber-700 border-amber-200',
  RECLAMO:    'bg-red-50 text-red-600 border-red-200',
  SUGERENCIA: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const PRIORIDAD_PILL: Record<string, string> = {
  BAJA:    'bg-slate-50 text-slate-600 border-slate-200',
  MEDIA:   'bg-sky-50 text-sky-700 border-sky-200',
  ALTA:    'bg-amber-50 text-amber-700 border-amber-200',
  CRITICA: 'bg-red-50 text-red-600 border-red-200',
};

interface PqrsRow {
  id: string;
  radicado: number;
  type: TipoPqrs;
  priority: string;
  status: EstadoPqrs;
  subject: string;
  description: string;
  resolution?: string | null;
  customer: { id: string; name: string; phone: string };
  agent?: { id: string; name: string } | null;
  conversationId?: string | null;
  orderId?: string | null;
  createdByName?: string | null;
  dueAt: string;
  createdAt: string;
  updatedAt: string;
  history: EntradaHistorial[];
  semaforo: Semaforo;
  diasRestantes: number;
  devolucion?: DevolucionResumen | null;
}

interface DevolucionResumen {
  id: string;
  consecutivo: number;
  monto: number;
  estado: EstadoDevolucion;
  createdAt: string;
}

interface Metricas {
  vivas: number; vencidas: number; porVencer: number; resueltasMes: number; pctATiempo: number | null;
}

interface Usuaria { id: string; name: string }

const initials = (n: string) => n.split(' ').map(x => x[0]).join('').toUpperCase().slice(0, 2);

/**
 * `useSearchParams` deja el árbol que lo usa fuera del prerenderizado, así que
 * Next exige una frontera de Suspense explícita. Sin ella el build no compila.
 */
export default function PqrsPage() {
  return (
    <Suspense fallback={
      <div className="flex-1 flex items-center justify-center bg-[#FFF8F7]">
        <Loader2 className="w-6 h-6 animate-spin text-pepper-400" />
      </div>
    }>
      <PqrsContenido />
    </Suspense>
  );
}

function PqrsContenido() {
  const [lista, setLista] = useState<PqrsRow[]>([]);
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [usuarias, setUsuarias] = useState<Usuaria[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState('vivas');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<PqrsRow | null>(null);
  const [creando, setCreando] = useState(false);
  const [pestana, setPestana] = useState<'pqrs' | 'devoluciones'>('pqrs');

  // Desde una devolución se vuelve a su radicado con /pqrs?radicado=42. Se
  // resuelve una sola vez: si no, cada recarga de la lista reabriría el panel
  // y la agente no podría cerrarlo.
  const params = useSearchParams();
  const radicadoBuscado = params.get('radicado');
  const [enlaceResuelto, setEnlaceResuelto] = useState(false);

  const cargar = useCallback(() => {
    const p = new URLSearchParams();
    if (filtroEstado) p.set('estado', filtroEstado);
    if (filtroTipo) p.set('tipo', filtroTipo);
    if (q.trim()) p.set('q', q.trim());
    api.get<{ lista: PqrsRow[]; metricas: Metricas }>(`/api/pqrs?${p}`)
      .then(r => { setLista(r.lista); setMetricas(r.metricas); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filtroEstado, filtroTipo, q]);

  useEffect(() => { const t = setTimeout(cargar, q ? 300 : 0); return () => clearTimeout(t); }, [cargar, q]);
  useEffect(() => { api.get<Usuaria[]>('/api/users').then(setUsuarias).catch(() => {}); }, []);

  useEffect(() => {
    if (!radicadoBuscado || enlaceResuelto) return;
    // «Todas», porque el radicado que se busca puede estar ya resuelto y el
    // filtro por defecto solo muestra las vivas.
    setPestana('pqrs');
    setFiltroEstado('');
    const encontrada = lista.find(x => String(x.radicado) === radicadoBuscado);
    if (encontrada) { setSel(encontrada); setEnlaceResuelto(true); }
  }, [radicadoBuscado, enlaceResuelto, lista]);

  const alActualizar = (p: PqrsRow) => {
    setSel(p);
    setLista(xs => xs.map(x => (x.id === p.id ? p : x)));
    cargar();
  };

  return (
    <div className="flex-1 overflow-auto bg-[#FFF8F7]">

      {/* Encabezado */}
      <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-[#F7E4E2] px-8 py-4 z-10">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-xl font-bold text-ink flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-pepper-600" /> PQRS
            </h1>
            <p className="text-[13px] text-ink-muted mt-0.5">
              Peticiones, quejas, reclamos y sugerencias — plazo legal de 15 días hábiles
            </p>
          </div>
          <button
            onClick={() => setCreando(true)}
            className="flex items-center gap-2 bg-pepper-600 hover:bg-pepper-700 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
          >
            <Plus className="w-4 h-4" /> Radicar PQRS
          </button>
        </div>

        {/* Pestañas: el mismo módulo, dos caras. El reclamo y la plata que
            salió por ese reclamo. */}
        <div className="flex items-center gap-1 mt-4 border-b border-[#F7E4E2] -mb-px">
          {([['pqrs', 'Radicados', ShieldAlert], ['devoluciones', 'Devoluciones', Wallet]] as const).map(([v, l, Icono]) => (
            <button key={v}
              onClick={() => setPestana(v)}
              className={cn('flex items-center gap-1.5 px-4 py-2 text-[13px] font-semibold border-b-2 -mb-px transition-colors',
                pestana === v
                  ? 'border-pepper-600 text-pepper-700'
                  : 'border-transparent text-ink-muted hover:text-ink-soft')}
            ><Icono className="w-4 h-4" /> {l}</button>
          ))}
        </div>

        {/* Métricas */}
        {pestana === 'pqrs' && metricas && (
          <div className="flex gap-3 mt-4 flex-wrap">
            <Chip icon={Clock} color="text-sky-600" valor={metricas.vivas} etiqueta="abiertas" />
            <Chip icon={AlertTriangle} color={metricas.vencidas ? 'text-red-600' : 'text-emerald-600'}
              valor={metricas.vencidas} etiqueta="vencidas" alerta={metricas.vencidas > 0} />
            <Chip icon={Timer} color={metricas.porVencer ? 'text-amber-600' : 'text-emerald-600'}
              valor={metricas.porVencer} etiqueta="por vencer (5 días)" />
            <Chip icon={CheckCircle2} color="text-emerald-600" valor={metricas.resueltasMes} etiqueta="resueltas este mes" />
            {metricas.pctATiempo !== null && (
              <Chip icon={CheckCircle2} color={metricas.pctATiempo >= 90 ? 'text-emerald-600' : 'text-amber-600'}
                valor={`${metricas.pctATiempo}%`} etiqueta="a tiempo" />
            )}
          </div>
        )}

        {/* Filtros */}
        {pestana === 'pqrs' && (
        <div className="flex items-center gap-2 mt-4 flex-wrap">
          {[['vivas', 'Pendientes'], ['', 'Todas'], ['RESUELTA', 'Resueltas'], ['CERRADA', 'Cerradas']].map(([v, l]) => (
            <button key={v}
              onClick={() => setFiltroEstado(v)}
              className={cn('px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors',
                filtroEstado === v ? 'bg-pepper-600 text-white' : 'bg-white border border-brand-100 text-ink-soft hover:bg-brand-50')}
            >{l}</button>
          ))}
          <select
            value={filtroTipo}
            onChange={e => setFiltroTipo(e.target.value)}
            className="px-3 py-1.5 rounded-lg text-[13px] font-semibold bg-white border border-brand-100 text-ink-soft"
          >
            <option value="">Todos los tipos</option>
            {Object.entries(TIPOS_PQRS).map(([k, v]) => <option key={k} value={k}>{v.etiqueta}</option>)}
          </select>
          <div className="relative flex-1 min-w-[180px] max-w-xs ml-auto">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
            <input
              value={q} onChange={e => setQ(e.target.value)}
              placeholder="Radicado, clienta o asunto…"
              className="w-full pl-9 pr-3 py-1.5 rounded-lg text-[13px] bg-white border border-brand-100 outline-none focus:border-pepper-300"
            />
          </div>
        </div>
        )}
      </div>

      {pestana === 'devoluciones' && (
        <div className="px-8 py-5 space-y-4"><Devoluciones /></div>
      )}

      {/* Lista */}
      {pestana === 'pqrs' && (
      <div className="px-8 py-5">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-pepper-400" /></div>
        ) : !lista.length ? (
          <div className="text-center py-16 text-ink-muted">
            <ShieldAlert className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No hay PQRS {filtroEstado === 'vivas' ? 'pendientes' : 'con esos filtros'}.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {lista.map(p => {
              const s = SEMAFORO[p.semaforo];
              return (
                <button key={p.id}
                  onClick={() => setSel(p)}
                  className={cn(
                    'w-full text-left bg-white rounded-2xl border p-4 hover:shadow-md transition-shadow flex items-center gap-4',
                    p.semaforo === 'vencida' ? 'border-red-300 bg-red-50/40' :
                    p.semaforo === 'rojo' ? 'border-red-200' : 'border-brand-100',
                  )}
                >
                  <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', s.punto)} />
                  <div className="w-[120px] shrink-0">
                    <p className="text-[12px] font-bold text-ink tabular-nums">{radicadoBonito(p.radicado, p.createdAt)}</p>
                    <p className="text-[11px] text-ink-muted">{formatRelativeTime(p.createdAt)}</p>
                  </div>
                  <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border shrink-0', TIPO_PILL[p.type])}>
                    {TIPOS_PQRS[p.type].etiqueta}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-ink truncate">{p.subject}</p>
                    <p className="text-[12px] text-ink-muted truncate">{p.customer.name}</p>
                  </div>
                  <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border shrink-0', PRIORIDAD_PILL[p.priority])}>
                    {p.priority}
                  </span>
                  <div className="w-[150px] text-right shrink-0">
                    {p.semaforo === 'resuelta' ? (
                      <span className="text-[12px] font-semibold text-emerald-600">{ESTADOS_PQRS[p.status]}</span>
                    ) : (
                      <span className={cn('text-[12px] font-bold', s.texto)}>{s.etiqueta(p.diasRestantes)}</span>
                    )}
                    {p.agent && <p className="text-[11px] text-ink-muted mt-0.5">{p.agent.name}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      )}

      {sel && <DetallePqrs pqrs={sel} usuarias={usuarias} onCerrar={() => setSel(null)} onCambio={alActualizar} />}
      {creando && <NuevaPqrs onCerrar={() => setCreando(false)} onCreada={() => { setCreando(false); cargar(); }} />}
    </div>
  );
}

function Chip({ icon: Icon, color, valor, etiqueta, alerta }: {
  icon: typeof Clock; color: string; valor: number | string; etiqueta: string; alerta?: boolean;
}) {
  return (
    <div className={cn('flex items-center gap-2 bg-white border rounded-xl px-3.5 py-2',
      alerta ? 'border-red-200 bg-red-50/50' : 'border-brand-100')}>
      <Icon className={cn('w-4 h-4', color)} />
      <span className="text-[15px] font-bold text-ink tabular-nums">{valor}</span>
      <span className="text-[12px] text-ink-muted">{etiqueta}</span>
    </div>
  );
}

/* ── Detalle ── */

function DetallePqrs({ pqrs, usuarias, onCerrar, onCambio }: {
  pqrs: PqrsRow; usuarias: Usuaria[]; onCerrar: () => void; onCambio: (p: PqrsRow) => void;
}) {
  const [comentario, setComentario] = useState('');
  const [resolucion, setResolucion] = useState('');
  const [resolviendo, setResolviendo] = useState(false);
  const [ocupada, setOcupada] = useState(false);
  const [abriendoDev, setAbriendoDev] = useState(false);
  // Los mismos campos que al radicar: quien abre la devolución aquí llena
  // exactamente lo que llenaría allá.
  const [dev, setDev] = useState<DatosDevolucion>(() => datosDevolucionVacios(pqrs.customer));
  const ponerDev = (parche: Partial<DatosDevolucion>) => setDev(d => ({ ...d, ...parche }));
  const s = SEMAFORO[pqrs.semaforo];

  const enviar = async (cambios: Record<string, unknown>) => {
    setOcupada(true);
    try { onCambio(await api.patch<PqrsRow>(`/api/pqrs/${pqrs.id}`, cambios)); }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo actualizar.'); }
    finally { setOcupada(false); }
  };

  const historial = Array.isArray(pqrs.history) ? [...pqrs.history].reverse() : [];
  const viva = pqrs.status !== 'RESUELTA' && pqrs.status !== 'CERRADA';

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/30" onClick={onCerrar}>
      <div
        className="w-full max-w-xl h-full bg-white shadow-2xl overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera del panel */}
        <div className="sticky top-0 bg-white border-b border-brand-100 px-6 py-4 flex items-start justify-between gap-3 z-10">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-display font-bold text-ink">{radicadoBonito(pqrs.radicado, pqrs.createdAt)}</p>
              <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border', TIPO_PILL[pqrs.type])}>
                {TIPOS_PQRS[pqrs.type].etiqueta}
              </span>
              <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border', PRIORIDAD_PILL[pqrs.priority])}>
                {pqrs.priority}
              </span>
            </div>
            {viva ? (
              <p className={cn('text-[13px] font-bold mt-1', s.texto)}>
                <Clock className="w-3.5 h-3.5 inline -mt-0.5 mr-1" />
                {s.etiqueta(pqrs.diasRestantes)} — vence {new Date(pqrs.dueAt).toLocaleDateString('es-CO', { day: 'numeric', month: 'long' })}
              </p>
            ) : (
              <p className="text-[13px] font-semibold text-emerald-600 mt-1">{ESTADOS_PQRS[pqrs.status]}</p>
            )}
          </div>
          <button onClick={onCerrar} className="p-1.5 rounded-lg hover:bg-brand-50"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Asunto y descripción */}
          <div>
            <h2 className="text-[16px] font-bold text-ink">{pqrs.subject}</h2>
            <p className="text-[14px] text-ink-soft mt-1.5 whitespace-pre-wrap">{pqrs.description}</p>
          </div>

          {/* Clienta */}
          <div className="bg-brand-50/60 rounded-2xl p-4 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-brand-100 text-pepper-700 flex items-center justify-center text-[12px] font-bold shrink-0">
              {initials(pqrs.customer.name)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-ink truncate">{pqrs.customer.name}</p>
              <p className="text-[12px] text-ink-muted">{mostrarTelefono(pqrs.customer.phone)}</p>
            </div>
            <Link href={`/customers/${pqrs.customer.id}`}
              className="text-[12px] font-semibold text-pepper-600 hover:underline shrink-0 flex items-center gap-1">
              <User className="w-3.5 h-3.5" /> Ficha
            </Link>
            {pqrs.conversationId && (
              <Link href={`/inbox?c=${pqrs.conversationId}`}
                className="text-[12px] font-semibold text-pepper-600 hover:underline shrink-0 flex items-center gap-1">
                <MessageCircle className="w-3.5 h-3.5" /> Chat
              </Link>
            )}
          </div>

          {/* Acciones */}
          {viva && (
            <div className="flex flex-wrap gap-2">
              <select
                value={pqrs.status} disabled={ocupada}
                onChange={e => enviar({ estado: e.target.value })}
                className="px-3 py-2 rounded-xl text-[13px] font-semibold bg-white border border-brand-100"
              >
                {(['ABIERTA', 'EN_PROCESO', 'ESPERANDO_CLIENTA'] as const).map(x => (
                  <option key={x} value={x}>{ESTADOS_PQRS[x]}</option>
                ))}
              </select>
              <select
                value={pqrs.priority} disabled={ocupada}
                onChange={e => enviar({ prioridad: e.target.value })}
                className="px-3 py-2 rounded-xl text-[13px] font-semibold bg-white border border-brand-100"
              >
                {PRIORIDADES_PQRS.map(x => <option key={x} value={x}>Prioridad {x}</option>)}
              </select>
              <select
                value={pqrs.agent?.id ?? ''} disabled={ocupada}
                onChange={e => enviar({ assignedTo: e.target.value || null })}
                className="px-3 py-2 rounded-xl text-[13px] font-semibold bg-white border border-brand-100"
              >
                <option value="">Sin asignar</option>
                {usuarias.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <button
                onClick={() => setResolviendo(v => !v)}
                className="ml-auto flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-bold px-4 py-2 rounded-xl transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" /> Resolver
              </button>
            </div>
          )}

          {/* Resolución */}
          {resolviendo && viva && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-3">
              <p className="text-[13px] font-semibold text-emerald-800">
                ¿Qué se le respondió a la clienta? Esto queda como constancia de la resolución.
              </p>
              <textarea
                value={resolucion} onChange={e => setResolucion(e.target.value)}
                rows={3} autoFocus
                className="w-full rounded-xl border border-emerald-200 p-3 text-[14px] outline-none focus:border-emerald-400"
                placeholder="Ej.: Se envió reposición del producto por la guía 123456; la clienta quedó conforme."
              />
              <button
                disabled={!resolucion.trim() || ocupada}
                onClick={() => enviar({ estado: 'RESUELTA', resolucion })}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[13px] font-bold px-4 py-2 rounded-xl"
              >
                Confirmar resolución
              </button>
            </div>
          )}

          {pqrs.resolution && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
              <p className="text-[12px] font-bold text-emerald-800 uppercase tracking-wider mb-1">Resolución</p>
              <p className="text-[14px] text-ink-soft whitespace-pre-wrap">{pqrs.resolution}</p>
            </div>
          )}

          {/* Devolución de dinero */}
          {pqrs.devolucion ? (
            <div className="bg-white border border-brand-100 rounded-2xl p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Wallet className="w-4 h-4 text-pepper-600 shrink-0" />
                <p className="text-[12px] font-bold text-ink tabular-nums">
                  {consecutivoBonito(pqrs.devolucion.consecutivo, pqrs.devolucion.createdAt)}
                </p>
                <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border',
                  PILL_DEVOLUCION[pqrs.devolucion.estado])}>
                  {ESTADOS_DEVOLUCION[pqrs.devolucion.estado]}
                </span>
                <span className="text-[15px] font-bold text-ink tabular-nums ml-auto">
                  {formatCOP(pqrs.devolucion.monto)}
                </span>
              </div>
              <p className="text-[12px] text-ink-muted mt-1.5">
                Se gestiona en la pestaña <b>Devoluciones</b>.
              </p>
            </div>
          ) : abriendoDev ? (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
              <p className="text-[13px] font-semibold text-amber-800">
                ¿Cuánto hay que devolverle y a qué cuenta?
              </p>
              <CamposDevolucion datos={dev} set={ponerDev} />
              <div className="flex gap-2">
                <button
                  disabled={parsearMonto(dev.monto) === null || ocupada}
                  onClick={async () => {
                    setOcupada(true);
                    try {
                      await api.post('/api/devoluciones', {
                        pqrsId: pqrs.id,
                        ...cuerpoDevolucion(dev, pqrs.subject),
                      });
                      setAbriendoDev(false);
                      setDev(datosDevolucionVacios(pqrs.customer));
                      // Se recarga la PQRS para que aparezca ya con su devolución.
                      onCambio(await api.get<PqrsRow>(`/api/pqrs/${pqrs.id}`));
                    } catch (e) {
                      alert(e instanceof Error ? e.message : 'No se pudo abrir la devolución.');
                    } finally { setOcupada(false); }
                  }}
                  className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-[13px] font-bold px-4 py-2 rounded-xl"
                >Abrir devolución</button>
                <button
                  onClick={() => setAbriendoDev(false)}
                  className="text-[13px] font-semibold text-ink-muted px-3 py-2 rounded-xl hover:bg-white"
                >Cancelar</button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAbriendoDev(true)}
              className="w-full flex items-center justify-center gap-2 border border-dashed border-brand-100 hover:border-pepper-300 hover:bg-brand-50/60 text-ink-soft text-[13px] font-semibold py-2.5 rounded-2xl transition-colors"
            ><Wallet className="w-4 h-4" /> Registrar devolución de dinero</button>
          )}

          {/* Comentario */}
          {viva && (
            <div className="flex gap-2">
              <input
                value={comentario} onChange={e => setComentario(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && comentario.trim()) { enviar({ comentario }); setComentario(''); } }}
                placeholder="Agregar seguimiento…"
                className="flex-1 px-4 py-2.5 rounded-xl text-[14px] bg-brand-50/60 border border-brand-100 outline-none focus:border-pepper-300"
              />
              <button
                disabled={!comentario.trim() || ocupada}
                onClick={() => { enviar({ comentario }); setComentario(''); }}
                className="p-2.5 bg-pepper-600 hover:bg-pepper-700 disabled:opacity-50 text-white rounded-xl"
              ><Send className="w-4 h-4" /></button>
            </div>
          )}

          {/* Bitácora */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-2">Bitácora</p>
            <div className="space-y-2.5">
              {historial.map((h, i) => (
                <div key={i} className="flex gap-3">
                  <div className={cn('w-1.5 rounded-full shrink-0',
                    h.tipo === 'resolucion' ? 'bg-emerald-300' :
                    h.tipo === 'comentario' ? 'bg-sky-200' : 'bg-brand-100')} />
                  <div className="py-0.5">
                    <p className="text-[13px] text-ink-soft whitespace-pre-wrap">{h.texto}</p>
                    <p className="text-[11px] text-ink-muted mt-0.5">
                      {h.por} — {formatRelativeTime(h.at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
