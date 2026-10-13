'use client';
import { useMemo, useState } from 'react';
import { X, Plus, AlertCircle, Loader2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const CRM_CATEGORIES: { key: string; label: string; hint: string }[] = [
  { key: 'CONFIRMATION', label: 'Confirmación', hint: 'Confirmar el pedido' },
  { key: 'LOGISTICS', label: 'Logística', hint: 'Despacho, guía, entrega' },
  { key: 'REPURCHASE', label: 'Recompra', hint: 'Volver a comprar' },
  { key: 'SUPPORT', label: 'Atención', hint: 'Soporte y dudas' },
  { key: 'PROMOTIONAL', label: 'Promocional', hint: 'Ofertas, reseñas, guías' },
];

const META_LABELS: Record<string, string> = {
  UTILITY: 'Utilidad (UTILITY)',
  MARKETING: 'Marketing (MARKETING)',
  AUTHENTICATION: 'Autenticación (AUTHENTICATION)',
};

const CRM_TO_META: Record<string, string> = {
  CONFIRMATION: 'UTILITY',
  LOGISTICS: 'UTILITY',
  SUPPORT: 'UTILITY',
  REPURCHASE: 'MARKETING',
  PROMOTIONAL: 'MARKETING',
};

// Valida el cuerpo con las mismas reglas de Meta que aplica el servidor.
function validateBody(body: string): { error: string | null; variables: string[] } {
  const trimmed = body.trim();
  if (!trimmed) return { error: null, variables: [] }; // vacío: no mostramos error hasta enviar
  if (trimmed.length > 1024) return { error: 'El cuerpo supera los 1024 caracteres.', variables: [] };
  if (/\{\{\s*[a-zA-Z]/.test(trimmed)) return { error: 'Usa variables numeradas: {{1}}, {{2}}…', variables: [] };
  if (/^\s*\{\{/.test(trimmed)) return { error: 'No puede empezar con una variable. Antepón texto (ej. "Hola ").', variables: [] };
  if (/\}\}\s*$/.test(trimmed)) return { error: 'No puede terminar con una variable. Agrega texto después.', variables: [] };
  if (/\}\}\s*\{\{/.test(trimmed)) return { error: 'No puede haber dos variables juntas; sepáralas con texto.', variables: [] };

  const nums = Array.from(trimmed.matchAll(/\{\{\s*(\d+)\s*\}\}/g)).map(m => Number(m[1]));
  const unique = Array.from(new Set(nums)).sort((a, b) => a - b);
  for (let i = 0; i < unique.length; i++) {
    if (unique[i] !== i + 1) return { error: `Las variables deben ir en orden desde 1 (falta {{${i + 1}}}).`, variables: [] };
  }
  return { error: null, variables: unique.map(String) };
}

export function TemplateFormModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('CONFIRMATION');
  const [metaOverride, setMetaOverride] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [header, setHeader] = useState('');
  const [body, setBody] = useState('');
  const [footer, setFooter] = useState('');
  const [examples, setExamples] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const { error: bodyError, variables } = useMemo(() => validateBody(body), [body]);
  const metaCategory = metaOverride || CRM_TO_META[category];

  function updateName(v: string) {
    setName(v.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+/, ''));
  }

  function insertVariable() {
    const next = variables.length ? Math.max(...variables.map(Number)) + 1 : 1;
    setBody(b => `${b}${b && !b.endsWith(' ') ? ' ' : ''}{{${next}}} `);
  }

  const preview = useMemo(() => {
    return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => examples[n]?.trim() || `[ejemplo ${n}]`);
  }, [body, examples]);

  const missingExamples = variables.some(v => !examples[v]?.trim());
  const nameValid = /^[a-z0-9_]{1,512}$/.test(name);
  const canSubmit = nameValid && body.trim() && !bodyError && !missingExamples && !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await api.post('/api/templates', {
        name,
        language: 'es',
        category,
        metaCategory: metaOverride || undefined,
        header: header.trim() || undefined,
        footer: footer.trim() || undefined,
        body,
        examples: variables.map(v => examples[v]?.trim() || ''),
      });
      onCreated();
      onClose();
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'No se pudo crear la plantilla.');
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-brand-100 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-ink">Nueva plantilla de WhatsApp</h2>
            <p className="text-xs text-muted-foreground">Se enviará a Meta para aprobación y aparecerá aquí como pendiente.</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-brand-50 rounded-lg transition-colors">
            <X className="w-5 h-5 text-ink-muted" />
          </button>
        </div>

        <div className="flex-1 overflow-auto grid grid-cols-1 lg:grid-cols-[1fr_360px]">
          {/* Formulario */}
          <div className="p-6 space-y-5 border-r border-brand-100">
            {/* Nombre */}
            <div>
              <label className="text-sm font-medium text-ink-soft">Nombre interno</label>
              <Input
                value={name}
                onChange={e => updateName(e.target.value)}
                placeholder="pedido_por_confirmar"
                className="mt-1 font-mono"
              />
              <p className="text-xs text-ink-muted mt-1">Solo minúsculas, números y guion bajo. No lo ve el cliente.</p>
            </div>

            {/* Categoría */}
            <div>
              <label className="text-sm font-medium text-ink-soft">Categoría</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1.5">
                {CRM_CATEGORIES.map(c => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => { setCategory(c.key); setMetaOverride(null); }}
                    className={cn(
                      'text-left px-3 py-2 rounded-lg border transition-all',
                      category === c.key ? 'border-pepper-600 bg-brand-50 ring-1 ring-pepper-500' : 'border-brand-100 hover:border-brand-200',
                    )}
                  >
                    <div className="text-sm font-medium text-ink">{c.label}</div>
                    <div className="text-[11px] text-ink-muted">{c.hint}</div>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-2 text-xs text-ink-muted">
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>Se enviará a Meta como <strong className="text-ink-soft">{META_LABELS[metaCategory]}</strong>.</span>
                <button type="button" onClick={() => setShowAdvanced(s => !s)} className="text-pepper-600 hover:underline">
                  {showAdvanced ? 'ocultar' : 'ajustar'}
                </button>
              </div>
              {showAdvanced && (
                <select
                  value={metaCategory}
                  onChange={e => setMetaOverride(e.target.value)}
                  className="mt-2 w-full text-sm border border-brand-100 rounded-lg px-3 py-2 bg-white"
                >
                  {Object.entries(META_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Encabezado (opcional) */}
            <div>
              <label className="text-sm font-medium text-ink-soft">Encabezado <span className="text-ink-muted font-normal">· opcional</span></label>
              <Input value={header} onChange={e => setHeader(e.target.value)} placeholder="Título corto (texto fijo)" className="mt-1" maxLength={60} />
            </div>

            {/* Cuerpo */}
            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-ink-soft">Mensaje</label>
                <button type="button" onClick={insertVariable} className="flex items-center gap-1 text-xs text-pepper-600 hover:underline">
                  <Plus className="w-3 h-3" /> Insertar variable
                </button>
              </div>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={6}
                placeholder="Hola {{1}} 👋 Tenemos listo tu pedido de {{2}}…"
                className="mt-1 w-full text-sm border border-brand-100 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-1 focus:ring-pepper-500 focus:border-pepper-600"
              />
              <div className="flex items-center justify-between mt-1">
                {bodyError ? (
                  <span className="flex items-center gap-1 text-xs text-red-500"><AlertCircle className="w-3.5 h-3.5" />{bodyError}</span>
                ) : (
                  <span className="text-xs text-ink-muted">Usa {'{{1}}, {{2}}…'} para datos que cambian por cliente.</span>
                )}
                <span className={cn('text-xs', body.length > 1024 ? 'text-red-500' : 'text-ink-muted')}>{body.length}/1024</span>
              </div>
            </div>

            {/* Ejemplos de variables */}
            {variables.length > 0 && (
              <div className="rounded-lg border border-brand-100 bg-brand-50 p-3">
                <p className="text-xs font-medium text-ink-soft mb-2">Valores de ejemplo <span className="font-normal text-ink-muted">— Meta los pide para revisar la plantilla</span></p>
                <div className="space-y-2">
                  {variables.map(v => (
                    <div key={v} className="flex items-center gap-2">
                      <code className="text-xs bg-yellow-50 text-yellow-700 border border-yellow-100 px-1.5 py-1 rounded shrink-0">{`{{${v}}}`}</code>
                      <Input
                        value={examples[v] || ''}
                        onChange={e => setExamples(x => ({ ...x, [v]: e.target.value }))}
                        placeholder={`Ejemplo para la variable ${v}`}
                        className="h-8 text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Pie (opcional) */}
            <div>
              <label className="text-sm font-medium text-ink-soft">Pie de página <span className="text-ink-muted font-normal">· opcional</span></label>
              <Input value={footer} onChange={e => setFooter(e.target.value)} placeholder="Fem · Bienestar íntimo" className="mt-1" maxLength={60} />
            </div>
          </div>

          {/* Vista previa */}
          <div className="p-6 bg-[#EDE4DC]/40">
            <p className="text-xs font-medium text-ink-muted mb-3">Vista previa</p>
            <div className="rounded-xl bg-[#E7FFDB] shadow-sm p-3 relative">
              <div className="absolute -left-1.5 top-3 w-3 h-3 bg-[#E7FFDB] rotate-45" />
              {header.trim() && <p className="text-sm font-bold text-ink mb-1">{header}</p>}
              <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">
                {preview || <span className="text-ink-muted">Tu mensaje aparecerá aquí…</span>}
              </p>
              {footer.trim() && <p className="text-[11px] text-ink-muted mt-2">{footer}</p>}
              <p className="text-[10px] text-ink-muted text-right mt-1">12:00 ✓✓</p>
            </div>
            <p className="text-[11px] text-ink-muted mt-3 leading-relaxed">
              Así la verá el cliente en WhatsApp. Los valores en gris son ejemplos; en cada envío se reemplazan por los datos reales.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-brand-100 shrink-0">
          {serverError && (
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-3">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>Cancelar</Button>
            <Button size="sm" onClick={submit} disabled={!canSubmit} className="gap-2 min-w-[160px]">
              {submitting ? (<><Loader2 className="w-4 h-4 animate-spin" /> Enviando a Meta…</>) : 'Crear y enviar a revisión'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
