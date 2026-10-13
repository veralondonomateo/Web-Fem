'use client';
import { useEffect, useState } from 'react';
import {
  CheckCircle2, XCircle, AlertTriangle, Loader2, Copy, Check,
  RefreshCw, Plug, ChevronDown,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatRelativeTime } from '@/lib/utils';

interface VarState { name: string; required: boolean; help: string; present: boolean }
interface PlatformState {
  key: string;
  label: string;
  purpose: string;
  where: string;
  webhooks: { path: string; note: string }[];
  vars: VarState[];
  ready: boolean;
  missingRequired: string[];
}
interface StatusPayload {
  origin: string;
  platforms: PlatformState[];
  lastSync: Record<string, string | null>;
}
interface TestState { loading: boolean; ok?: boolean; detail?: string }

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      className="shrink-0 p-1.5 rounded-lg text-ink-muted hover:text-pepper-600 hover:bg-brand-50 transition-colors"
      aria-label="Copiar"
      title="Copiar"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

export default function SettingsPage() {
  const [data, setData]     = useState<StatusPayload | null>(null);
  const [error, setError]   = useState('');
  const [tests, setTests]   = useState<Record<string, TestState>>({});
  const [open, setOpen]     = useState<Record<string, boolean>>({});
  const [syncing, setSyncing]     = useState(false);
  const [syncResult, setSyncResult] = useState<string>('');

  const load = () =>
    api.get<StatusPayload>('/api/integrations/status')
      .then(setData)
      .catch(e => setError(e.message || 'No se pudo cargar el estado'));

  useEffect(() => { load(); }, []);

  async function runTest(key: string) {
    setTests(t => ({ ...t, [key]: { loading: true } }));
    try {
      const r = await api.post<{ ok: boolean; detail: string }>('/api/integrations/test', { platform: key });
      setTests(t => ({ ...t, [key]: { loading: false, ok: r.ok, detail: r.detail } }));
    } catch (e: any) {
      setTests(t => ({ ...t, [key]: { loading: false, ok: false, detail: e.message || 'Falló la prueba' } }));
    }
  }

  async function runSync() {
    setSyncing(true);
    setSyncResult('');
    try {
      const r = await api.post<any>('/api/sync/mastershop', { days: 30 });
      setSyncResult(`${r.total} pedidos revisados · ${r.created} nuevos · ${r.updated} actualizados${r.errors ? ` · ${r.errors} con error` : ''}`);
      load();
    } catch (e: any) {
      setSyncResult(e.message || 'Falló la sincronización');
    } finally {
      setSyncing(false);
    }
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#FFF8F7] p-8">
        <div className="text-center max-w-sm">
          <AlertTriangle className="w-8 h-8 text-pepper-600 mx-auto mb-3" />
          <p className="font-semibold text-ink">No se pudo cargar Ajustes</p>
          <p className="text-sm text-ink-muted mt-1">{error}</p>
          <p className="text-xs text-ink-muted mt-3">Esta página solo la ve un usuario con rol ADMIN.</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#FFF8F7]">
        <Loader2 className="w-5 h-5 animate-spin text-brand-600" />
      </div>
    );
  }

  const listas = data.platforms.filter(p => p.ready).length;

  return (
    <div className="flex-1 overflow-auto bg-[#FFF8F7]">
      {/* Header */}
      <div className="sticky top-0 bg-white/95 backdrop-blur border-b border-[#F7E4E2] px-8 py-4 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[17px] font-bold text-ink">Ajustes e integraciones</h1>
            <p className="text-xs text-ink-muted mt-0.5">
              {listas} de {data.platforms.length} integraciones listas · las credenciales viven en variables de entorno
            </p>
          </div>
          <button
            onClick={load}
            className="flex items-center gap-2 border border-brand-200 hover:border-pepper-500 text-ink-soft px-3 py-2 rounded-xl text-xs font-semibold transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Revisar de nuevo
          </button>
        </div>
      </div>

      <div className="p-8 space-y-4 max-w-4xl">

        {/* Aviso de seguridad: el CRM nunca muestra el valor de un secreto */}
        <div className="flex gap-3 bg-brand-50 border border-brand-200 rounded-2xl px-4 py-3">
          <Plug className="w-4 h-4 text-pepper-600 shrink-0 mt-0.5" />
          <p className="text-xs text-ink-soft leading-relaxed">
            Esta pantalla solo dice si cada credencial <strong>está puesta</strong> y si <strong>responde</strong>.
            Nunca muestra su valor. Para cambiarlas, edítalas en Vercel → Settings → Environment Variables
            (o en <code className="bg-white px-1 py-0.5 rounded border border-brand-200">.env.local</code> en tu equipo)
            y vuelve a desplegar.
          </p>
        </div>

        {data.platforms.map(p => {
          const test = tests[p.key];
          const sync = data.lastSync[p.key];
          const isOpen = open[p.key];

          return (
            <div key={p.key} className="bg-white rounded-2xl border border-[#F7E4E2] overflow-hidden">
              <div className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {p.ready
                        ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        : <XCircle className="w-4 h-4 text-pepper-600 shrink-0" />}
                      <p className="font-bold text-[15px] text-ink">{p.label}</p>
                      <span className={cn(
                        'text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border',
                        p.ready
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-pepper-50 text-pepper-700 border-pepper-200',
                      )}>
                        {p.ready ? 'Configurada' : 'Faltan datos'}
                      </span>
                    </div>
                    <p className="text-xs text-ink-muted mt-1.5 leading-relaxed">{p.purpose}</p>
                    <p className="text-[11px] text-ink-muted mt-1">
                      Dónde se saca: <span className="text-ink-soft">{p.where}</span>
                    </p>
                    {sync && (
                      <p className="text-[11px] text-ink-muted mt-1">
                        Última sincronización: <span className="text-ink-soft">{formatRelativeTime(sync)}</span>
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {p.key === 'MASTERSHOP' && p.ready && (
                      <button
                        onClick={runSync}
                        disabled={syncing}
                        className="flex items-center gap-1.5 bg-pepper-600 hover:bg-pepper-700 disabled:opacity-60 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                      >
                        {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        Sincronizar
                      </button>
                    )}
                    <button
                      onClick={() => runTest(p.key)}
                      disabled={test?.loading}
                      className="flex items-center gap-1.5 border border-brand-200 hover:border-pepper-500 text-ink-soft px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-60"
                    >
                      {test?.loading && <Loader2 className="w-3 h-3 animate-spin" />}
                      Probar conexión
                    </button>
                  </div>
                </div>

                {/* Resultado de la prueba */}
                {test && !test.loading && test.detail && (
                  <div className={cn(
                    'mt-3 text-xs rounded-xl px-3 py-2 border flex gap-2',
                    test.ok
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-pepper-50 border-pepper-200 text-pepper-700',
                  )}>
                    {test.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-px" /> : <XCircle className="w-3.5 h-3.5 shrink-0 mt-px" />}
                    <span className="leading-relaxed">{test.detail}</span>
                  </div>
                )}

                {p.key === 'MASTERSHOP' && syncResult && (
                  <div className="mt-2 text-xs rounded-xl px-3 py-2 border bg-brand-50 border-brand-200 text-ink-soft">
                    {syncResult}
                  </div>
                )}

                {!p.ready && (
                  <p className="mt-3 text-xs text-pepper-700">
                    Faltan: <span className="font-mono">{p.missingRequired.join(', ')}</span>
                  </p>
                )}
              </div>

              {/* Detalle plegable */}
              <button
                onClick={() => setOpen(o => ({ ...o, [p.key]: !o[p.key] }))}
                className="w-full flex items-center justify-between px-5 py-2.5 border-t border-[#F7E4E2] text-xs font-semibold text-ink-soft hover:bg-brand-50 transition-colors"
              >
                <span>{p.vars.length} variables{p.webhooks.length > 0 && ` · ${p.webhooks.length} webhook${p.webhooks.length === 1 ? '' : 's'}`}</span>
                <ChevronDown className={cn('w-4 h-4 transition-transform', isOpen && 'rotate-180')} />
              </button>

              {isOpen && (
                <div className="px-5 py-4 border-t border-[#F7E4E2] bg-[#FFFBFA] space-y-4">
                  <div className="space-y-2">
                    {p.vars.map(v => (
                      <div key={v.name} className="flex items-start gap-2.5">
                        {v.present
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                          : v.required
                            ? <XCircle className="w-3.5 h-3.5 text-pepper-600 shrink-0 mt-0.5" />
                            : <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />}
                        <div className="min-w-0">
                          <p className="text-xs font-mono text-ink">
                            {v.name}
                            {!v.required && <span className="ml-2 font-sans text-[10px] text-ink-muted">opcional</span>}
                          </p>
                          <p className="text-[11px] text-ink-muted mt-0.5 leading-relaxed">{v.help}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {p.webhooks.length > 0 && (
                    <div className="space-y-2 pt-3 border-t border-[#F7E4E2]">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                        URLs para registrar en el panel del proveedor
                      </p>
                      {p.webhooks.map(w => (
                        <div key={w.path}>
                          <div className="flex items-center gap-1 bg-white border border-brand-200 rounded-lg pl-3 pr-1 py-1.5">
                            <code className="text-[11px] text-ink-soft truncate flex-1">{data.origin}{w.path}</code>
                            <CopyButton text={`${data.origin}${w.path}`} />
                          </div>
                          <p className="text-[11px] text-ink-muted mt-1 ml-1">{w.note}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
