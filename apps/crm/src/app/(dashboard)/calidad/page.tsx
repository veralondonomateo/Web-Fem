'use client';
/**
 * Calidad de la atención: qué nota le ponen las clientas a cada asesora.
 *
 * Solo la ve gerencia. El filtro de verdad está en la API —una agente que
 * escribiera la URL a mano recibe un 403—; esto es la otra mitad, para que no
 * aparezca ni en el menú ni al entrar por error.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Star, MessageSquare, TrendingUp, AlertTriangle, Send } from 'lucide-react';
import { cn, formatRelativeTime, mostrarTelefono } from '@/lib/utils';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { ESPERA_MINUTOS, UMBRAL_REVISAR, DIAS_ENTRE_ENCUESTAS } from '@/lib/encuestas';

interface Agente {
  agentId: string | null;
  agentName: string;
  enviadas: number;
  respondidas: number;
  promedio: number | null;
  distribucion: Record<string, number>;
  tasaRespuesta: number | null;
}

interface Respuesta {
  id: string;
  estrellas: number | null;
  respondidaAt: string | null;
  comentario: string | null;
  agentName: string | null;
  conversationId: string;
  customer: { id: string; name: string; phone: string };
}

interface Datos {
  dias: number;
  metricas: {
    programadas: number; enviadas: number; respondidas: number; omitidas: number;
    promedio: number | null; bajas: number; tasaRespuesta: number | null;
  };
  porAgente: Agente[];
  ultimas: Respuesta[];
  porDia: { dia: string; respondidas: number; promedio: number | null }[];
}

/** Las estrellas pintadas. Media estrella no: se redondea a la más cercana. */
function Estrellas({ valor, size = 14 }: { valor: number | null; size?: number }) {
  if (valor == null) return <span className="text-ink-muted text-[13px]">sin datos</span>;
  const llenas = Math.round(valor);
  return (
    <span className="inline-flex items-center gap-0.5 align-middle">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          style={{ width: size, height: size }}
          className={i <= llenas ? 'fill-amber-400 text-amber-400' : 'text-brand-200'}
        />
      ))}
    </span>
  );
}

const COLOR_NOTA = (n: number | null) =>
  n == null ? 'text-ink-muted'
  : n >= 4.5 ? 'text-emerald-600'
  : n >= 4   ? 'text-emerald-700'
  : n >= 3   ? 'text-amber-600'
  :            'text-red-600';

export default function CalidadPage() {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [loading, setLoading] = useState(true);
  const [dias, setDias] = useState(30);
  const [esAdmin, setEsAdmin] = useState<boolean | null>(null);

  useEffect(() => { setEsAdmin(getUser()?.role === 'ADMIN'); }, []);

  const cargar = useCallback(() => {
    if (!esAdmin) return;
    api.get<Datos>(`/api/encuestas?dias=${dias}`)
      .then(setDatos)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [dias, esAdmin]);

  useEffect(() => { cargar(); }, [cargar]);

  if (esAdmin === false) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#FFF8F7]">
        <div className="text-center max-w-sm px-6">
          <p className="font-display font-bold text-ink">Esta sección es de gerencia</p>
          <p className="text-[13px] text-ink-muted mt-1.5">
            Las calificaciones de las clientas solo las ve la cuenta principal.
          </p>
        </div>
      </div>
    );
  }

  if (esAdmin === null || loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#FFF8F7]">
        <Loader2 className="w-6 h-6 animate-spin text-pepper-400" />
      </div>
    );
  }

  const m = datos?.metricas;

  return (
    <div className="flex-1 overflow-auto bg-[#FFF8F7]">

      <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-[#F7E4E2] px-8 py-4 z-10">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="font-display text-xl font-bold text-ink flex items-center gap-2">
              <Star className="w-5 h-5 text-amber-500" /> Calidad de la atención
            </h1>
            <p className="text-[13px] text-ink-muted mt-0.5">
              La clienta califica {ESPERA_MINUTOS} minutos después de que se cierra su conversación.
              Ni la pregunta ni la nota aparecen en la bandeja de las asesoras.
            </p>
          </div>
          <div className="flex items-center gap-1">
            {[7, 30, 90].map(d => (
              <button key={d}
                onClick={() => setDias(d)}
                className={cn('px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors',
                  dias === d ? 'bg-pepper-600 text-white' : 'bg-white border border-brand-100 text-ink-soft hover:bg-brand-50')}
              >{d} días</button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-8 space-y-6">

        {/* Resumen */}
        <div className="flex gap-3 flex-wrap">
          <div className="bg-white border border-brand-100 rounded-2xl px-5 py-4 min-w-[210px]">
            <p className="text-[12px] font-semibold text-ink-muted">Nota promedio</p>
            <p className={cn('text-[30px] font-bold tabular-nums leading-none mt-1.5', COLOR_NOTA(m?.promedio ?? null))}>
              {m?.promedio?.toFixed(1) ?? '—'}
            </p>
            <div className="mt-1.5"><Estrellas valor={m?.promedio ?? null} /></div>
          </div>
          <Tarjeta icon={MessageSquare} color="text-sky-600"
            titulo="Respondieron" valor={String(m?.respondidas ?? 0)}
            pie={m?.tasaRespuesta != null ? `${m.tasaRespuesta}% de las enviadas` : 'todavía sin envíos'} />
          <Tarjeta icon={Send} color="text-ink-muted"
            titulo="Encuestas enviadas" valor={String(m?.enviadas ?? 0)}
            pie={`${m?.programadas ?? 0} en cola · ${m?.omitidas ?? 0} omitidas`} />
          <Tarjeta icon={AlertTriangle} color={m?.bajas ? 'text-red-600' : 'text-emerald-600'}
            titulo={`Notas de ${UMBRAL_REVISAR} o menos`} valor={String(m?.bajas ?? 0)}
            pie="conversaciones para leer" destacar={!!m?.bajas} />
        </div>

        {/* Por asesora */}
        <div className="bg-white border border-brand-100 rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-brand-100 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-pepper-600" />
            <p className="text-[13px] font-bold text-ink">Por asesora</p>
          </div>

          {!datos?.porAgente.length ? (
            <p className="px-5 py-10 text-center text-[13px] text-ink-muted">
              Todavía no hay calificaciones en este periodo.
            </p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-ink-muted">
                  <th className="text-left  font-bold px-5 py-2.5">Asesora</th>
                  <th className="text-left  font-bold px-5 py-2.5">Nota</th>
                  <th className="text-left  font-bold px-5 py-2.5 w-[240px]">Cómo se reparte</th>
                  <th className="text-right font-bold px-5 py-2.5">Respondidas</th>
                  <th className="text-right font-bold px-5 py-2.5">Respuesta</th>
                </tr>
              </thead>
              <tbody>
                {datos.porAgente.map(a => (
                  <tr key={a.agentId ?? a.agentName} className="border-t border-brand-100/70">
                    <td className="px-5 py-3 text-[14px] font-semibold text-ink">{a.agentName}</td>
                    <td className="px-5 py-3">
                      <span className={cn('text-[17px] font-bold tabular-nums mr-2', COLOR_NOTA(a.promedio))}>
                        {a.promedio?.toFixed(1) ?? '—'}
                      </span>
                      <Estrellas valor={a.promedio} size={12} />
                    </td>
                    <td className="px-5 py-3">
                      <Reparto distribucion={a.distribucion} total={a.respondidas} />
                    </td>
                    <td className="px-5 py-3 text-[14px] text-right tabular-nums text-ink-soft">
                      {a.respondidas}<span className="text-ink-muted"> / {a.enviadas}</span>
                    </td>
                    <td className="px-5 py-3 text-[14px] text-right tabular-nums text-ink-soft">
                      {a.tasaRespuesta != null ? `${a.tasaRespuesta}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Últimas calificaciones */}
        <div className="bg-white border border-brand-100 rounded-2xl overflow-hidden">
          <div className="px-5 py-3.5 border-b border-brand-100">
            <p className="text-[13px] font-bold text-ink">Últimas calificaciones</p>
            <p className="text-[12px] text-ink-muted mt-0.5">
              Abre la conversación para leer qué pasó. A cada clienta se le pregunta
              como mucho una vez cada {DIAS_ENTRE_ENCUESTAS} días.
            </p>
          </div>

          {!datos?.ultimas.length ? (
            <p className="px-5 py-10 text-center text-[13px] text-ink-muted">
              Nadie ha calificado todavía.
            </p>
          ) : (
            <div className="divide-y divide-brand-100/70">
              {datos.ultimas.map(r => (
                <div key={r.id} className={cn('flex items-center gap-4 px-5 py-3',
                  (r.estrellas ?? 5) <= UMBRAL_REVISAR && 'bg-red-50/40')}>
                  <div className="w-[92px] shrink-0">
                    <Estrellas valor={r.estrellas} size={13} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-ink truncate">{r.customer.name}</p>
                    <p className="text-[12px] text-ink-muted">{mostrarTelefono(r.customer.phone)}</p>
                  </div>
                  <p className="text-[13px] text-ink-soft w-[130px] truncate">{r.agentName ?? '—'}</p>
                  <p className="text-[12px] text-ink-muted w-[110px] text-right">
                    {r.respondidaAt ? formatRelativeTime(r.respondidaAt) : ''}
                  </p>
                  <Link
                    // `?c=` es el parámetro que ya usa la bandeja para abrir un
                    // chat concreto, venga de una PQRS, de un carrito o de aquí.
                    href={`/inbox?c=${r.conversationId}`}
                    className="text-[12px] font-semibold text-pepper-600 hover:underline shrink-0"
                  >Ver chat</Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** La barra de cómo se reparten las notas: de un vistazo, dónde está el bulto. */
function Reparto({ distribucion, total }: { distribucion: Record<string, number>; total: number }) {
  if (!total) return <span className="text-[12px] text-ink-muted">—</span>;
  const COLORES: Record<string, string> = {
    '5': 'bg-emerald-500', '4': 'bg-emerald-300',
    '3': 'bg-amber-300',   '2': 'bg-orange-400', '1': 'bg-red-500',
  };
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-2 rounded-full overflow-hidden flex-1 bg-brand-50">
        {['5', '4', '3', '2', '1'].map(k => {
          const n = distribucion[k] ?? 0;
          if (!n) return null;
          return (
            <div key={k} className={COLORES[k]} style={{ width: `${(100 * n) / total}%` }}
                 title={`${n} de ${k} ${Number(k) === 1 ? 'estrella' : 'estrellas'}`} />
          );
        })}
      </div>
      <span className="text-[11px] text-ink-muted tabular-nums shrink-0">
        {distribucion['5'] ?? 0}★
      </span>
    </div>
  );
}

function Tarjeta({ icon: Icon, color, titulo, valor, pie, destacar }: {
  icon: typeof Star; color: string; titulo: string; valor: string; pie: string; destacar?: boolean;
}) {
  return (
    <div className={cn('bg-white border rounded-2xl px-5 py-4 min-w-[190px]',
      destacar ? 'border-red-200 bg-red-50/40' : 'border-brand-100')}>
      <div className="flex items-center gap-2">
        <Icon className={cn('w-4 h-4', color)} />
        <span className="text-[12px] font-semibold text-ink-muted">{titulo}</span>
      </div>
      <p className="text-[24px] font-bold text-ink tabular-nums mt-1 leading-none">{valor}</p>
      <p className="text-[11px] text-ink-muted mt-1.5">{pie}</p>
    </div>
  );
}
