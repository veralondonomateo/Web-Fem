'use client';
import { useEffect, useState } from 'react';
import { Plus, Search, MessageSquare, CheckCircle, Clock, XCircle, Copy, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { TemplateFormModal } from '@/components/template-form-modal';

const CATEGORY_LABELS: Record<string, string> = {
  CONFIRMATION: 'Confirmación',
  LOGISTICS: 'Logística',
  REPURCHASE: 'Recompra',
  SUPPORT: 'Atención',
  PROMOTIONAL: 'Promocional',
};

const CATEGORY_COLORS: Record<string, string> = {
  CONFIRMATION: 'bg-blue-50 text-blue-700 border-blue-100',
  LOGISTICS: 'bg-purple-50 text-purple-700 border-purple-100',
  REPURCHASE: 'bg-brand-50 text-brand-700 border-brand-100',
  SUPPORT: 'bg-green-50 text-green-700 border-green-100',
  PROMOTIONAL: 'bg-orange-50 text-orange-700 border-orange-100',
};

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  APPROVED: { icon: CheckCircle, color: 'text-green-600', label: 'Aprobada' },
  PENDING: { icon: Clock, color: 'text-yellow-600', label: 'Pendiente' },
  REJECTED: { icon: XCircle, color: 'text-red-500', label: 'Rechazada' },
};

interface Template {
  id: string;
  name: string;
  shortcut?: string;
  category: string;
  content: string;
  variables: string[];
  status: string;
  channels: string[];
}

const CHANNEL_COLORS: Record<string, string> = {
  WHATSAPP: 'bg-green-100 text-green-700',
  INSTAGRAM: 'bg-pink-100 text-pink-700',
  FACEBOOK: 'bg-blue-100 text-blue-700',
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = () => api.get<Template[]>('/api/templates').then(setTemplates).catch(() => {});

  async function syncWithMeta() {
    setSyncing(true);
    try {
      await api.post('/api/templates/sync', {});
      await load();
    } catch { /* WhatsApp sin configurar o API de Meta caída */ }
    setSyncing(false);
  }

  useEffect(() => {
    // Muestra lo local de inmediato y sincroniza con Meta en segundo plano
    load().then(() => setLoading(false));
    syncWithMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = templates.filter(t => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.content.toLowerCase().includes(search.toLowerCase());
    const matchCat = !filterCategory || t.category === filterCategory;
    return matchSearch && matchCat;
  });

  function copyToClipboard(content: string, id: string) {
    navigator.clipboard.writeText(content);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="sticky top-0 bg-white border-b border-brand-100 px-8 py-4 z-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-ink">Plantillas de mensajes</h1>
            <p className="text-sm text-muted-foreground">{templates.length} plantillas · {templates.filter(t => t.status === 'APPROVED').length} aprobadas</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-2" onClick={syncWithMeta} disabled={syncing}>
              <RefreshCw className={cn('w-4 h-4', syncing && 'animate-spin')} />
              {syncing ? 'Sincronizando…' : 'Sincronizar con WhatsApp'}
            </Button>
            <Button size="sm" className="gap-2" onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4" /> Nueva plantilla
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted" />
            <Input
              placeholder="Buscar plantillas..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => setFilterCategory('')}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-all', !filterCategory ? 'bg-pepper-600 text-white border-pepper-600' : 'bg-white text-ink-soft border-brand-100')}
            >
              Todas
            </button>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilterCategory(filterCategory === key ? '' : key)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-all', filterCategory === key ? 'bg-pepper-600 text-white border-pepper-600' : 'bg-white text-ink-soft border-brand-100 hover:border-brand-200')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-20">
          <MessageSquare className="w-10 h-10 text-brand-600 mx-auto mb-3" />
          <p className="text-ink-muted text-sm font-medium">
            {loading ? 'Cargando plantillas…' : 'No hay plantillas todavía'}
          </p>
          {!loading && (
            <Button size="sm" className="gap-2 mt-4" onClick={() => setShowForm(true)}>
              <Plus className="w-4 h-4" /> Crear la primera plantilla
            </Button>
          )}
        </div>
      )}
      <div className="p-8 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filtered.map(template => {
          const StatusIcon = STATUS_CONFIG[template.status]?.icon || Clock;
          return (
            <Card key={template.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('px-2.5 py-1 rounded-full text-xs font-medium border', CATEGORY_COLORS[template.category])}>
                      {CATEGORY_LABELS[template.category]}
                    </span>
                    <div className={cn('flex items-center gap-1 text-xs', STATUS_CONFIG[template.status]?.color)}>
                      <StatusIcon className="w-3 h-3" />
                      {STATUS_CONFIG[template.status]?.label}
                    </div>
                  </div>
                  <button
                    onClick={() => copyToClipboard(template.content, template.id)}
                    className="p-1.5 hover:bg-brand-50 rounded-lg transition-colors shrink-0"
                    title="Copiar contenido"
                  >
                    {copied === template.id ? (
                      <CheckCircle className="w-3.5 h-3.5 text-green-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-ink-muted" />
                    )}
                  </button>
                </div>

                <h3 className="font-semibold text-ink text-sm mb-1">{template.name}</h3>
                {template.shortcut && (
                  <code className="text-xs bg-brand-50 text-pepper-600 px-1.5 py-0.5 rounded font-mono mb-2 inline-block">
                    {template.shortcut}
                  </code>
                )}

                <p className="text-sm text-ink-soft leading-relaxed mt-2 bg-brand-50 rounded-lg p-3 border border-brand-100">
                  {template.content}
                </p>

                <div className="mt-3 flex items-center justify-between">
                  <div className="flex gap-1">
                    {template.channels.map(ch => (
                      <span key={ch} className={cn('text-[10px] px-2 py-0.5 rounded-full font-medium', CHANNEL_COLORS[ch])}>
                        {ch === 'WHATSAPP' ? 'WA' : ch === 'INSTAGRAM' ? 'IG' : 'FB'}
                      </span>
                    ))}
                  </div>
                  {template.variables.length > 0 && (
                    <div className="flex gap-1">
                      {template.variables.map(v => (
                        <span key={v} className="text-[10px] bg-yellow-50 text-yellow-700 border border-yellow-100 px-1.5 py-0.5 rounded-full">
                          [{v}]
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {showForm && (
        <TemplateFormModal
          onClose={() => setShowForm(false)}
          onCreated={load}
        />
      )}
    </div>
  );
}
