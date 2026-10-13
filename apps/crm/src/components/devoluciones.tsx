'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Loader2, Search, X, CheckCircle2, XCircle, Clock, Wallet,
  CalendarDays, FileText, User, TrendingUp,
} from 'lucide-react';
import { cn, formatCOP, formatRelativeTime, mostrarTelefono } from '@/lib/utils';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { radicadoBonito } from '@/lib/pqrs';
import {
  ESTADOS_DEVOLUCION, EstadoDevolucion, METODOS_DEVOLUCION, MetodoDevolucion,
  ESTADOS_CERRADOS, ESTADOS_SIN_PAGAR, PILL_DEVOLUCION, faltaParaGirar,
  consecutivoBonito, diasEsperando, EntradaHistorialDevolucion, metodoDesdeEntidad,
} from '@/lib/devoluciones';
import { CamposDevolucion, DatosDevolucion } from '@/components/devolucion-campos';

/* ── Presentación ── */

const ESTADO_PILL = PILL_DEVOLUCION;

const ESTADO_PUNTO: Record<EstadoDevolucion, string> = {
  PENDIENTE:           'bg-amber-400',
  LISTA_PARA_DEVOLVER: 'bg-sky-500',
  HECHA:               'bg-emerald-500',
  RECHAZADA:           'bg-slate-400',
};

/** Los dos estados en los que la plata todavía no ha salido. */
const sinPagar = (e: EstadoDevolucion) => ESTADOS_SIN_PAGAR.includes(e);

export interface DevolucionRow {
  id: string;
  consecutivo: number;
  monto: number;
  estado: EstadoDevolucion;
  metodo: MetodoDevolucion | null;
  referencia: string | null;
  motivo: string;
  notas: string | null;
  orderId: string | null;
  titular: string | null;
  cedula: string | null;
  contacto: string | null;
  entidad: string | null;
  tipoCuenta: string | null;
  numeroCuenta: string | null;
  fechaLimite: string | null;
  customer: { id: string; name: string; phone: string };
  pqrs: { id: string; radicado: number; subject: string; type: string; status: string; createdAt: string };
  solicitadaPorName: string | null;
  resueltaPorName: string | null;
  resueltaAt: string | null;
  history: EntradaHistorialDevolucion[];
  createdAt: string;
}

interface Metricas {
  pendientes: number; listas: number; montoPendiente: number;
  hechas: number; montoHecho: number;
  rechazadas: number;
}

interface Mes { mes: string; estado: string; n: number; total: number }

/** «2026-09-21» → «21/09». La fecha límite se lee de un vistazo, no se calcula. */
const fechaCorta = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** Se compara por día, en UTC, porque la fecha límite se guarda como fecha
 *  suelta (sin hora): mezclarla con la hora local adelantaría el vencimiento
 *  cinco horas y la marcaría en rojo el día antes. */
const vencida = (iso?: string | null) => {
  if (!iso) return false;
  const hoy = new Date();
  return iso.slice(0, 10) < `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
};

const nombreMes = (yyyymm: string) => {
  const [a, m] = yyyymm.split('-');
  const etiqueta = new Date(Number(a), Number(m) - 1, 1)
    .toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  return etiqueta.charAt(0).toUpperCase() + etiqueta.slice(1);
};

export function Devoluciones() {
  const [lista, setLista] = useState<DevolucionRow[]>([]);
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [porMes, setPorMes] = useState<Mes[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<EstadoDevolucion | ''>('PENDIENTE');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<DevolucionRow | null>(null);
  const [verMeses, setVerMeses] = useState(false);

  const cargar = useCallback(() => {
    const p = new URLSearchParams();
    if (filtro) p.set('estado', filtro);
    if (q.trim()) p.set('q', q.trim());
    api.get<{ lista: DevolucionRow[]; metricas: Metricas; porMes: Mes[] }>(`/api/devoluciones?${p}`)
      .then(r => { setLista(r.lista); setMetricas(r.metricas); setPorMes(r.porMes); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filtro, q]);

  useEffect(() => { const t = setTimeout(cargar, q ? 300 : 0); return () => clearTimeout(t); }, [cargar, q]);

  // El control mensual solo cuenta lo que efectivamente se devolvió. Las
  // rechazadas también tienen fecha de resolución, pero no son plata que salió.
  const mesesHechas = useMemo(
    () => porMes.filter(m => m.estado === 'HECHA').slice(0, 12),
    [porMes],
  );

  const alActualizar = (d: DevolucionRow) => {
    setSel(d);
    setLista(xs => xs.map(x => (x.id === d.id ? d : x)));
    cargar();
  };

  return (
    <>
      {/* Métricas */}
      {metricas && (
        <div className="flex gap-3 flex-wrap">
          <Tarjeta
            icon={Clock} color="text-amber-600" destacar={metricas.pendientes + metricas.listas > 0}
            titulo="Por devolver" valor={formatCOP(metricas.montoPendiente)}
            // Se desglosa porque son dos trabajos distintos: a las pendientes les
            // falta un dato, a las listas solo les falta que salga la plata.
            pie={`${metricas.pendientes} esperando datos · ${metricas.listas} ${metricas.listas === 1 ? 'lista' : 'listas'} para pagar`}
          />
          <Tarjeta
            icon={CheckCircle2} color="text-emerald-600"
            titulo="Devuelto en total" valor={formatCOP(metricas.montoHecho)}
            pie={`${metricas.hechas} ${metricas.hechas === 1 ? 'devolución hecha' : 'devoluciones hechas'}`}
          />
          <Tarjeta
            icon={XCircle} color="text-slate-500"
            titulo="Rechazadas" valor={String(metricas.rechazadas)}
            pie="no se devolvió el dinero"
          />
          <button
            onClick={() => setVerMeses(v => !v)}
            className="flex items-center gap-2 bg-white border border-brand-100 rounded-2xl px-4 py-3 hover:bg-brand-50 transition-colors text-left"
          >
            <TrendingUp className="w-4 h-4 text-pepper-600" />
            <span className="text-[13px] font-semibold text-ink-soft">
              {verMeses ? 'Ocultar' : 'Ver'} control por mes
            </span>
          </button>
        </div>
      )}

      {/* Control mensual */}
      {verMeses && (
        <div className="bg-white border border-brand-100 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-brand-100 flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-pepper-600" />
            <p className="text-[13px] font-bold text-ink">Devoluciones hechas, mes a mes</p>
            <span className="text-[12px] text-ink-muted">— últimos 12 meses, por la fecha en que salió la plata</span>
          </div>
          {!mesesHechas.length ? (
            <p className="px-4 py-6 text-center text-[13px] text-ink-muted">
              Todavía no hay ninguna devolución hecha que contar.
            </p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-ink-muted">
                  <th className="text-left font-bold px-4 py-2">Mes</th>
                  <th className="text-right font-bold px-4 py-2">Cuántas</th>
                  <th className="text-right font-bold px-4 py-2">Cuánto</th>
                </tr>
              </thead>
              <tbody>
                {mesesHechas.map(m => (
                  <tr key={m.mes} className="border-t border-brand-100/70">
                    <td className="px-4 py-2.5 text-[13px] font-semibold text-ink">{nombreMes(m.mes)}</td>
                    <td className="px-4 py-2.5 text-[13px] text-right tabular-nums text-ink-soft">{m.n}</td>
                    <td className="px-4 py-2.5 text-[13px] text-right tabular-nums font-bold text-ink">{formatCOP(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        {([
          ['PENDIENTE', 'Pendientes'],
          ['LISTA_PARA_DEVOLVER', 'Listas para devolver'],
          ['HECHA', 'Hechas'],
          ['RECHAZADA', 'Rechazadas'],
          ['', 'Todas'],
        ] as const).map(([v, l]) => (
          <button key={v || 'todas'}
            onClick={() => setFiltro(v)}
            className={cn('px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors',
              filtro === v ? 'bg-pepper-600 text-white' : 'bg-white border border-brand-100 text-ink-soft hover:bg-brand-50')}
          >{l}</button>
        ))}
        <div className="relative flex-1 min-w-[180px] max-w-xs ml-auto">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder="Clienta, titular, cuenta, radicado…"
            className="w-full pl-9 pr-3 py-1.5 rounded-lg text-[13px] bg-white border border-brand-100 outline-none focus:border-pepper-300"
          />
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-pepper-400" /></div>
      ) : !lista.length ? (
        <div className="text-center py-16 text-ink-muted">
          <Wallet className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">
            {filtro === 'PENDIENTE'
              ? 'No hay devoluciones pendientes. Todo al día.'
              : filtro === 'LISTA_PARA_DEVOLVER'
                ? 'Ninguna lista para girar todavía. Se marcan cuando están los datos del pago.'
                : 'No hay devoluciones con esos filtros.'}
          </p>
          <p className="text-[12px] mt-1">Las devoluciones se abren desde la PQRS que las motiva.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lista.map(d => (
            <button key={d.id}
              onClick={() => setSel(d)}
              className={cn(
                'w-full text-left bg-white rounded-2xl border p-4 hover:shadow-md transition-shadow flex items-center gap-4',
                d.estado === 'PENDIENTE' ? 'border-amber-200'
                  : d.estado === 'LISTA_PARA_DEVOLVER' ? 'border-sky-200'
                  : 'border-brand-100',
              )}
            >
              <span className={cn('w-2.5 h-2.5 rounded-full shrink-0', ESTADO_PUNTO[d.estado])} />
              <div className="w-[120px] shrink-0">
                <p className="text-[12px] font-bold text-ink tabular-nums">{consecutivoBonito(d.consecutivo, d.createdAt)}</p>
                <p className="text-[11px] text-ink-muted">{formatRelativeTime(d.createdAt)}</p>
              </div>
              <div className="w-[130px] shrink-0">
                <p className="text-[15px] font-bold text-ink tabular-nums">{formatCOP(d.monto)}</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-semibold text-ink truncate">{d.customer.name}</p>
                <p className="text-[12px] text-ink-muted truncate">{d.motivo}</p>
              </div>
              <span className="text-[11px] font-semibold text-ink-muted tabular-nums shrink-0">
                {radicadoBonito(d.pqrs.radicado, d.pqrs.createdAt)}
              </span>
              <div className="w-[135px] text-right shrink-0">
                <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border', ESTADO_PILL[d.estado])}>
                  {ESTADOS_DEVOLUCION[d.estado]}
                </span>
                {/* La antigüedad también en las listas: seguir esperando la plata
                    con los datos ya completos es peor, no mejor. */}
                {sinPagar(d.estado) && (
                  <p className={cn('text-[11px] font-semibold mt-1',
                    vencida(d.fechaLimite) ? 'text-red-600'
                      : d.estado === 'LISTA_PARA_DEVOLVER' ? 'text-sky-700' : 'text-amber-700')}>
                    {vencida(d.fechaLimite)
                      ? `pasada de plazo (${fechaCorta(d.fechaLimite)})`
                      : diasEsperando(d.createdAt) === 0 ? 'abierta hoy' : `${diasEsperando(d.createdAt)} días esperando`}
                  </p>
                )}
                {d.estado === 'HECHA' && d.metodo && (
                  <p className="text-[11px] text-ink-muted mt-1 truncate">{METODOS_DEVOLUCION[d.metodo]}</p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {sel && <DetalleDevolucion dev={sel} onCerrar={() => setSel(null)} onCambio={alActualizar} />}
    </>
  );
}

/** Los datos de la fila llegan de la API con nulls; el formulario trabaja con
 *  cadenas. La conversión vive aquí para no repetirla en cada apertura. */
function datosDe(d: DevolucionRow): DatosDevolucion {
  return {
    monto: String(d.monto ?? ''),
    motivo: d.motivo ?? '',
    titular: d.titular ?? '',
    cedula: d.cedula ?? '',
    contacto: d.contacto ?? '',
    entidad: d.entidad ?? '',
    tipoCuenta: d.tipoCuenta ?? '',
    numeroCuenta: d.numeroCuenta ?? '',
    fechaLimite: d.fechaLimite ? d.fechaLimite.slice(0, 10) : '',
    notas: '',
  };
}

function Dato({ titulo, valor, copiable, alerta }: {
  titulo: string; valor?: string | null; copiable?: boolean; alerta?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] text-ink-muted">{titulo}</dt>
      <dd className={cn('text-[13px] font-semibold', alerta ? 'text-red-600' : 'text-ink')}>
        {valor
          ? (copiable
              ? <button
                  onClick={() => navigator.clipboard?.writeText(valor)}
                  title="Copiar" className="tabular-nums hover:text-pepper-600 transition-colors"
                >{valor}</button>
              : valor)
          : <span className="text-ink-muted font-normal">—</span>}
      </dd>
    </div>
  );
}

function Tarjeta({ icon: Icon, color, titulo, valor, pie, destacar }: {
  icon: typeof Clock; color: string; titulo: string; valor: string; pie: string; destacar?: boolean;
}) {
  return (
    <div className={cn('bg-white border rounded-2xl px-4 py-3 min-w-[190px]',
      destacar ? 'border-amber-200 bg-amber-50/40' : 'border-brand-100')}>
      <div className="flex items-center gap-2">
        <Icon className={cn('w-4 h-4', color)} />
        <span className="text-[12px] font-semibold text-ink-muted">{titulo}</span>
      </div>
      <p className="text-[18px] font-bold text-ink tabular-nums mt-1">{valor}</p>
      <p className="text-[11px] text-ink-muted">{pie}</p>
    </div>
  );
}

/* ── Detalle ── */

function DetalleDevolucion({ dev, onCerrar, onCambio }: {
  dev: DevolucionRow; onCerrar: () => void; onCambio: (d: DevolucionRow) => void;
}) {
  // El método viene puesto a partir de la entidad que ya se escribió: si la
  // cuenta es Nequi, el método es Nequi. Preguntarlo otra vez es trabajo doble.
  const [metodo, setMetodo] = useState<MetodoDevolucion | ''>(() => metodoDesdeEntidad(dev.entidad));
  const [referencia, setReferencia] = useState('');
  const [motivoRechazo, setMotivoRechazo] = useState('');
  const [nota, setNota] = useState('');
  const [panel, setPanel] = useState<'' | 'hecha' | 'rechazo'>('');
  const [ocupada, setOcupada] = useState(false);
  const [editando, setEditando] = useState(false);
  const [datos, setDatos] = useState<DatosDevolucion>(() => datosDe(dev));

  const esAdmin = getUser()?.role === 'ADMIN';
  /** Mientras no esté hecha ni rechazada todo se puede corregir. */
  const pendiente = !ESTADOS_CERRADOS.includes(dev.estado);
  /** Lo que le falta para poder girar, o null si ya está lista. */
  const falta = faltaParaGirar(dev);
  const historial = Array.isArray(dev.history) ? [...dev.history].reverse() : [];

  /** Devuelve si el cambio se guardó: quien llama decide qué cerrar. Cerrar el
   *  formulario tras un error borraría lo que la usuaria acaba de escribir. */
  const enviar = async (cambios: Record<string, unknown>) => {
    setOcupada(true);
    try {
      onCambio(await api.patch<DevolucionRow>(`/api/devoluciones/${dev.id}`, cambios));
      setPanel('');
      return true;
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo actualizar.');
      return false;
    } finally {
      setOcupada(false);
    }
  };

  const guardarDatos = async () => {
    // Abrir el formulario y guardar sin tocar nada es normal. La API responde
    // «nada que actualizar» —correcto— pero como alerta de error asusta, así
    // que ese caso ni siquiera sale de aquí.
    if (JSON.stringify(datos) === JSON.stringify(datosDe(dev))) { setEditando(false); return; }
    const ok = await enviar({
      monto: datos.monto,
      titular: datos.titular, cedula: datos.cedula, contacto: datos.contacto,
      entidad: datos.entidad, tipoCuenta: datos.tipoCuenta,
      numeroCuenta: datos.numeroCuenta, fechaLimite: datos.fechaLimite,
    });
    if (ok) setEditando(false);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink/30" onClick={onCerrar}>
      <div className="w-full max-w-xl h-full bg-white shadow-2xl overflow-y-auto" onClick={e => e.stopPropagation()}>

        {/* Cabecera */}
        <div className="sticky top-0 bg-white border-b border-brand-100 px-6 py-4 flex items-start justify-between gap-3 z-10">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-display font-bold text-ink">{consecutivoBonito(dev.consecutivo, dev.createdAt)}</p>
              <span className={cn('text-[11px] font-bold px-2 py-0.5 rounded-full border', ESTADO_PILL[dev.estado])}>
                {ESTADOS_DEVOLUCION[dev.estado]}
              </span>
            </div>
            <p className="text-[24px] font-bold text-ink tabular-nums mt-1">{formatCOP(dev.monto)}</p>
          </div>
          <button onClick={onCerrar} className="p-1.5 rounded-lg hover:bg-brand-50"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Motivo */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-1">Por qué se devuelve</p>
            <p className="text-[15px] font-semibold text-ink">{dev.motivo}</p>
          </div>

          {/* El PQRS que la originó — el problema de fondo */}
          <Link
            href={`/pqrs?radicado=${dev.pqrs.radicado}`}
            className="block bg-brand-50/60 hover:bg-brand-50 rounded-2xl p-4 transition-colors"
          >
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-pepper-600 shrink-0" />
              <p className="text-[12px] font-bold text-pepper-700 tabular-nums">
                {radicadoBonito(dev.pqrs.radicado, dev.pqrs.createdAt)}
              </p>
              <span className="text-[11px] text-ink-muted">— el reclamo que la originó</span>
            </div>
            <p className="text-[14px] text-ink-soft mt-1.5">{dev.pqrs.subject}</p>
          </Link>

          {/* Clienta */}
          <div className="flex items-center gap-3 border border-brand-100 rounded-2xl p-4">
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-ink truncate">{dev.customer.name}</p>
              <p className="text-[12px] text-ink-muted">{mostrarTelefono(dev.customer.phone)}</p>
            </div>
            <Link href={`/customers/${dev.customer.id}`}
              className="text-[12px] font-semibold text-pepper-600 hover:underline shrink-0 flex items-center gap-1">
              <User className="w-3.5 h-3.5" /> Ficha
            </Link>
          </div>

          {/* Datos del pago — lo que necesita quien va a girar la plata */}
          <div className={cn('rounded-2xl border p-4',
            editando ? 'bg-amber-50 border-amber-200' : 'border-brand-100')}>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
                Datos para el pago
              </p>
              {pendiente && !editando && (
                <button
                  onClick={() => { setDatos(datosDe(dev)); setEditando(true); }}
                  className="text-[12px] font-semibold text-pepper-600 hover:underline"
                >{dev.numeroCuenta ? 'Corregir' : 'Completar'}</button>
              )}
            </div>

            {editando ? (
              <div className="space-y-3">
                <CamposDevolucion datos={datos} set={p => setDatos(d => ({ ...d, ...p }))} modo="edicion" />
                <div className="flex gap-2">
                  <button
                    disabled={ocupada}
                    onClick={guardarDatos}
                    className="bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-[13px] font-bold px-4 py-2 rounded-xl"
                  >Guardar</button>
                  <button
                    onClick={() => setEditando(false)}
                    className="text-[13px] font-semibold text-ink-muted px-3 py-2 rounded-xl hover:bg-white"
                  >Cancelar</button>
                </div>
              </div>
            ) : !dev.numeroCuenta && !dev.entidad && !dev.titular ? (
              <p className="text-[13px] text-ink-muted">
                Todavía no están. Sin la cuenta no se puede girar: pídeselos a la clienta y
                {pendiente ? ' complétalos aquí.' : ' quedaron sin registrar.'}
              </p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Dato titulo="Titular" valor={dev.titular} />
                <Dato titulo="Cédula" valor={dev.cedula} />
                <Dato titulo="Contacto" valor={dev.contacto} />
                <Dato titulo="Entidad" valor={dev.entidad} />
                <Dato titulo="Tipo de cuenta" valor={dev.tipoCuenta} />
                <Dato titulo="N° de cuenta" valor={dev.numeroCuenta} copiable />
                <Dato
                  titulo="Fecha límite"
                  valor={dev.fechaLimite ? fechaCorta(dev.fechaLimite) : null}
                  alerta={pendiente && vencida(dev.fechaLimite)}
                />
                <Dato titulo="Radicada por" valor={dev.solicitadaPorName} />
              </dl>
            )}
          </div>

          {/* Cómo quedó */}
          {dev.estado === 'HECHA' && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4">
              <p className="text-[12px] font-bold text-emerald-800 uppercase tracking-wider mb-1">Dinero devuelto</p>
              <p className="text-[14px] text-ink-soft">
                {dev.metodo ? METODOS_DEVOLUCION[dev.metodo] : '—'} · comprobante <b>{dev.referencia}</b>
              </p>
              <p className="text-[12px] text-ink-muted mt-1">
                {dev.resueltaPorName} — {dev.resueltaAt ? formatRelativeTime(dev.resueltaAt) : ''}
              </p>
            </div>
          )}
          {dev.estado === 'RECHAZADA' && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
              <p className="text-[12px] font-bold text-slate-700 uppercase tracking-wider mb-1">No se devolvió</p>
              <p className="text-[14px] text-ink-soft whitespace-pre-wrap">{dev.notas}</p>
              <p className="text-[12px] text-ink-muted mt-1">
                {dev.resueltaPorName} — {dev.resueltaAt ? formatRelativeTime(dev.resueltaAt) : ''}
              </p>
            </div>
          )}

          {/* Acciones — mientras no esté resuelta */}
          {pendiente && (
            <div className="flex flex-wrap gap-2">
              {/* Dejarla lista no mueve plata: lo puede hacer quien consigue los
                  datos, no hace falta que sea administración. */}
              {dev.estado === 'PENDIENTE' && (
                <button
                  disabled={ocupada || !!falta}
                  title={falta ? `Falta ${falta}` : undefined}
                  onClick={() => enviar({ estado: 'LISTA_PARA_DEVOLVER' })}
                  className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-[13px] font-bold px-4 py-2 rounded-xl transition-colors"
                ><Wallet className="w-4 h-4" /> Lista para devolver</button>
              )}
              {dev.estado === 'LISTA_PARA_DEVOLVER' && (
                <button
                  disabled={ocupada}
                  onClick={() => enviar({ estado: 'PENDIENTE' })}
                  className="flex items-center gap-1.5 bg-white border border-brand-100 hover:bg-brand-50 disabled:opacity-50 text-ink-soft text-[13px] font-bold px-4 py-2 rounded-xl transition-colors"
                ><Clock className="w-4 h-4" /> Volver a pendiente</button>
              )}
              {esAdmin && (
                <>
                  <button
                    onClick={() => setPanel(p => (p === 'hecha' ? '' : 'hecha'))}
                    className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-bold px-4 py-2 rounded-xl transition-colors"
                  ><CheckCircle2 className="w-4 h-4" /> Marcar como devuelta</button>
                  <button
                    onClick={() => setPanel(p => (p === 'rechazo' ? '' : 'rechazo'))}
                    className="flex items-center gap-1.5 bg-white border border-brand-100 hover:bg-brand-50 text-ink-soft text-[13px] font-bold px-4 py-2 rounded-xl transition-colors"
                  ><XCircle className="w-4 h-4" /> No se va a devolver</button>
                </>
              )}
            </div>
          )}
          {pendiente && dev.estado === 'PENDIENTE' && falta && (
            <p className="text-[12px] text-ink-muted bg-brand-50/60 rounded-xl px-4 py-3">
              Para dejarla lista para devolver falta {falta}. Complétalo arriba y así
              administración ve de un vistazo cuáles ya se pueden girar.
            </p>
          )}
          {pendiente && !esAdmin && (
            <p className="text-[12px] text-ink-muted bg-brand-50/60 rounded-xl px-4 py-3">
              Esta devolución está pendiente de pago. Marcarla como devuelta o rechazarla lo hace administración.
            </p>
          )}

          {/* Confirmar pago */}
          {panel === 'hecha' && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-3">
              <p className="text-[13px] font-semibold text-emerald-800">
                ¿Por dónde salió la plata? Queda como constancia de la devolución.
              </p>
              <select
                value={metodo} onChange={e => setMetodo(e.target.value as MetodoDevolucion)}
                className="w-full px-3 py-2 rounded-xl text-[14px] bg-white border border-emerald-200 outline-none"
              >
                <option value="">Elige el método…</option>
                {Object.entries(METODOS_DEVOLUCION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input
                value={referencia} onChange={e => setReferencia(e.target.value)}
                placeholder="Referencia del comprobante (nº de transferencia, reverso…)"
                className="w-full px-3 py-2 rounded-xl text-[14px] bg-white border border-emerald-200 outline-none focus:border-emerald-400"
              />
              <button
                disabled={!metodo || !referencia.trim() || ocupada}
                onClick={() => enviar({ estado: 'HECHA', metodo, referencia })}
                className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[13px] font-bold px-4 py-2 rounded-xl"
              >Confirmar que se devolvió</button>
            </div>
          )}

          {/* Rechazo */}
          {panel === 'rechazo' && (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
              <p className="text-[13px] font-semibold text-slate-700">
                ¿Por qué no se devuelve? Esto es lo que se le explica a la clienta si vuelve a preguntar.
              </p>
              <textarea
                value={motivoRechazo} onChange={e => setMotivoRechazo(e.target.value)}
                rows={3} autoFocus
                className="w-full rounded-xl border border-slate-200 p-3 text-[14px] outline-none focus:border-slate-400"
                placeholder="Ej.: el producto llegó completo y en buen estado; se verificó con la guía y la foto de entrega."
              />
              <button
                disabled={!motivoRechazo.trim() || ocupada}
                onClick={() => enviar({ estado: 'RECHAZADA', notas: motivoRechazo })}
                className="bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white text-[13px] font-bold px-4 py-2 rounded-xl"
              >Confirmar rechazo</button>
            </div>
          )}

          {/* Nota de seguimiento */}
          <div className="flex gap-2">
            <input
              value={nota} onChange={e => setNota(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && nota.trim()) { enviar({ nota }); setNota(''); } }}
              placeholder="Agregar seguimiento…"
              className="flex-1 px-4 py-2.5 rounded-xl text-[14px] bg-brand-50/60 border border-brand-100 outline-none focus:border-pepper-300"
            />
            <button
              disabled={!nota.trim() || ocupada}
              onClick={() => { enviar({ nota }); setNota(''); }}
              className="px-4 bg-pepper-600 hover:bg-pepper-700 disabled:opacity-50 text-white text-[13px] font-bold rounded-xl"
            >Anotar</button>
          </div>

          {/* Bitácora */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted mb-2">Bitácora</p>
            <div className="space-y-2.5">
              {historial.map((h, i) => (
                <div key={i} className="flex gap-3">
                  <div className={cn('w-1.5 rounded-full shrink-0',
                    h.tipo === 'estado' ? 'bg-emerald-300' :
                    h.tipo === 'monto'  ? 'bg-amber-300' : 'bg-brand-100')} />
                  <div className="py-0.5">
                    <p className="text-[13px] text-ink-soft whitespace-pre-wrap">{h.texto}</p>
                    <p className="text-[11px] text-ink-muted mt-0.5">{h.por} — {formatRelativeTime(h.at)}</p>
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
