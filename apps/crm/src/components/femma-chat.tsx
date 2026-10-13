'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Sparkles, X, Send, Loader2, Database, Trash2, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Femma — asistente de IA, siempre a mano en la esquina inferior derecha.
 *
 * Decisiones de uso que valen la pena conocer:
 *  · El historial vive en sessionStorage, no en la base: la conversación
 *    sobrevive al cambiar de pantalla pero no deja rastro al cerrar sesión.
 *  · Lee el contexto de la pantalla desde `data-femma-contexto` en el DOM, así
 *    que la bandeja puede decirle a Femma con quién está hablando la agente
 *    sin que este componente sepa nada de la bandeja.
 *  · Atajo ⌘K / Ctrl+K para abrir y cerrar sin soltar el teclado.
 */

interface Mensaje {
  role: 'user' | 'assistant';
  content: string;
  /** Herramientas del CRM que consultó para responder. */
  consultas?: string[];
}

const CLAVE = 'femma-chat';

const ETIQUETA_HERRAMIENTA: Record<string, string> = {
  marcar_resuelta:   'Cerrando la conversación…',
  etiquetar_clienta: 'Etiquetando a la clienta…',
  crear_pqrs:        'Radicando la PQRS…',
  poner_borrador:    'Escribiendo el borrador…',
  buscar_clienta:    'Buscando la clienta…',
  estado_pedido:     'Consultando el pedido…',
  buscar_plantilla:  'Buscando plantillas…',
  listar_pedidos:    'Revisando pedidos…',
  historial_clienta: 'Abriendo el historial…',
  buscar_conversaciones: 'Revisando conversaciones…',
  metricas:          'Sacando números…',
  estado_carritos:   'Mirando los carritos…',
  resumen_operacion: 'Revisando la operación…',
};

const SUGERENCIAS = [
  'Mejora este mensaje para la clienta:',
  '¿Dónde va el pedido de…?',
  '¿Qué plantilla mando si el pedido está en oficina?',
  '¿Cómo vamos hoy?',
];

export function FemmaChat() {
  const [abierto, setAbierto]   = useState(false);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [entrada, setEntrada]   = useState('');
  const [pensando, setPensando] = useState(false);
  const [actividad, setActividad] = useState<string | null>(null);

  const finRef   = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Historial entre pantallas, sin tocar la base de datos.
  useEffect(() => {
    try {
      const guardado = sessionStorage.getItem(CLAVE);
      if (guardado) setMensajes(JSON.parse(guardado));
    } catch { /* historial corrupto: se empieza de cero */ }
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(CLAVE, JSON.stringify(mensajes.slice(-40))); } catch { /* cuota llena */ }
  }, [mensajes]);

  useEffect(() => { finRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [mensajes, actividad]);
  useEffect(() => { if (abierto) setTimeout(() => inputRef.current?.focus(), 120); }, [abierto]);

  // ⌘K / Ctrl+K abre y cierra; Esc cierra.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setAbierto(a => !a);
      }
      if (e.key === 'Escape' && abierto) setAbierto(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [abierto]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /** Lo que hay en pantalla ahora mismo, si la página lo publica. */
  function leerContexto(): string | undefined {
    const nodo = document.querySelector('[data-femma-contexto]');
    return nodo?.getAttribute('data-femma-contexto') || undefined;
  }

  const enviar = useCallback(async (texto: string) => {
    const limpio = texto.trim();
    if (!limpio || pensando) return;

    const historial: Mensaje[] = [...mensajes, { role: 'user', content: limpio }];
    setMensajes([...historial, { role: 'assistant', content: '' }]);
    setEntrada('');
    setPensando(true);
    setActividad(null);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch('/api/femma', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('fem_token') ?? ''}`,
        },
        body: JSON.stringify({
          // Los avisos de error no se reenvían como turnos de Femma: si van en
          // el historial, ella los lee como algo que dijo de verdad y sigue
          // creyendo que no tiene acceso mucho después de que se arregló.
          mensajes: historial
            .filter(m => !(m.role === 'assistant' && m.content.startsWith('⚠️')))
            .map(m => ({ role: m.role, content: m.content })),
          contexto: leerContexto(),
        }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Femma no está disponible ahora mismo.');
      }

      const lector = res.body.getReader();
      const decoder = new TextDecoder();
      let resto = '';
      const consultas: string[] = [];

      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        resto += decoder.decode(value, { stream: true });

        const lineas = resto.split('\n\n');
        resto = lineas.pop() ?? '';

        for (const linea of lineas) {
          if (!linea.startsWith('data: ')) continue;
          let ev: any;
          try { ev = JSON.parse(linea.slice(6)); } catch { continue; }

          if (ev.tipo === 'texto') {
            setActividad(null);
            setMensajes(prev => {
              const copia = [...prev];
              copia[copia.length - 1] = {
                ...copia[copia.length - 1],
                content: copia[copia.length - 1].content + ev.delta,
              };
              return copia;
            });
          } else if (ev.tipo === 'borrador') {
            // Se avisa por el DOM, igual que se lee el contexto: así Femma vive
            // en el layout y no necesita conocer la bandeja ni al revés.
            window.dispatchEvent(new CustomEvent('femma:borrador', { detail: ev.texto }));
          } else if (ev.tipo === 'herramienta') {
            consultas.push(ev.nombre);
            setActividad(ETIQUETA_HERRAMIENTA[ev.nombre] ?? 'Consultando el CRM…');
          } else if (ev.tipo === 'error') {
            setMensajes(prev => {
              const copia = [...prev];
              copia[copia.length - 1] = { role: 'assistant', content: `⚠️ ${ev.mensaje}` };
              return copia;
            });
          } else if (ev.tipo === 'fin' && consultas.length) {
            setMensajes(prev => {
              const copia = [...prev];
              copia[copia.length - 1] = { ...copia[copia.length - 1], consultas: Array.from(new Set(consultas)) };
              return copia;
            });
          }
        }
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setMensajes(prev => {
        const copia = [...prev];
        copia[copia.length - 1] = {
          role: 'assistant',
          content: `⚠️ ${e instanceof Error ? e.message : 'No se pudo conectar con Femma.'}`,
        };
        return copia;
      });
    } finally {
      setPensando(false);
      setActividad(null);
      abortRef.current = null;
    }
  }, [mensajes, pensando]);

  return (
    <>
      {/* Botón flotante */}
      <button
        onClick={() => setAbierto(a => !a)}
        title="Femma · asistente de IA (⌘K)"
        className={cn(
          'fixed bottom-5 right-5 z-40 w-14 h-14 rounded-2xl shadow-lg flex items-center justify-center',
          'transition-all duration-200 hover:scale-105 active:scale-95',
          abierto
            ? 'bg-[#2E1614] text-white rotate-90'
            : 'bg-gradient-to-br from-pepper-600 to-[#FF9DA3] text-white',
        )}
      >
        {abierto ? <ChevronDown className="w-6 h-6 -rotate-90" /> : <Sparkles className="w-6 h-6" />}
      </button>

      {/* Panel */}
      <div
        className={cn(
          'fixed bottom-24 right-5 z-40 w-[400px] max-w-[calc(100vw-2.5rem)]',
          'h-[min(620px,calc(100vh-9rem))] bg-white rounded-3xl shadow-2xl border border-[#F7E4E2]',
          'flex flex-col overflow-hidden origin-bottom-right transition-all duration-200',
          abierto ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none',
        )}
      >
        {/* Cabecera */}
        <div className="px-4 py-3 bg-gradient-to-r from-[#FFF1EF] to-white border-b border-[#F7E4E2] flex items-center gap-3 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-pepper-600 to-[#FF9DA3] flex items-center justify-center shrink-0">
            <Sparkles className="w-4.5 h-4.5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-[13px] text-[#2E1614] leading-tight">Femma</p>
            <p className="text-[10px] text-[#8C6B66]">Tu asistente · conoce el CRM</p>
          </div>
          {mensajes.length > 0 && (
            <button
              onClick={() => { setMensajes([]); sessionStorage.removeItem(CLAVE); }}
              title="Borrar conversación"
              className="p-1.5 rounded-lg text-[#B9A3A0] hover:text-pepper-600 hover:bg-brand-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => setAbierto(false)}
            className="p-1.5 rounded-lg text-[#B9A3A0] hover:text-[#2E1614] hover:bg-brand-50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Conversación */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {mensajes.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center px-2">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#FFF1EF] to-brand-50 flex items-center justify-center mb-3">
                <Sparkles className="w-7 h-7 text-pepper-600" />
              </div>
              <p className="font-bold text-[14px] text-[#2E1614]">Hola 💗</p>
              <p className="text-[12px] text-[#8C6B66] mt-1 mb-4 leading-relaxed">
                Puedo mejorar un mensaje, buscar un pedido o resolverte una duda.
                Consulto el CRM cuando hace falta.
              </p>
              <div className="w-full space-y-1.5">
                {SUGERENCIAS.map(s => (
                  <button
                    key={s}
                    onClick={() => { setEntrada(s + ' '); inputRef.current?.focus(); }}
                    className="w-full text-left text-[11.5px] px-3 py-2 rounded-xl bg-[#FFF8F7] hover:bg-brand-50 text-[#5C4340] transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mensajes.map((m, i) => (
            <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words',
                  m.role === 'user'
                    ? 'bg-[#2E1614] text-white rounded-br-md'
                    : 'bg-[#FFF8F7] text-[#2E1614] rounded-bl-md',
                )}
              >
                {m.content || (
                  <span className="inline-flex gap-1 py-1">
                    {[0, 150, 300].map(d => (
                      <span key={d} className="w-1.5 h-1.5 rounded-full bg-[#D9BFBB] animate-bounce"
                        style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </span>
                )}
                {m.consultas?.length ? (
                  <span className="mt-2 pt-2 border-t border-[#F0DEDB] flex items-center gap-1 text-[10px] text-[#8C6B66]">
                    <Database className="w-2.5 h-2.5" />
                    Consultó el CRM
                  </span>
                ) : null}
              </div>
            </div>
          ))}

          {actividad && (
            <div className="flex items-center gap-2 text-[11px] text-[#8C6B66] pl-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              {actividad}
            </div>
          )}
          <div ref={finRef} />
        </div>

        {/* Entrada */}
        <div className="p-3 border-t border-[#F7E4E2] bg-white shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={entrada}
              onChange={e => setEntrada(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(entrada); }
              }}
              rows={1}
              placeholder="Pregúntale a Femma…"
              className="flex-1 resize-none max-h-28 px-3.5 py-2.5 rounded-xl bg-[#FFF8F7] border border-transparent
                         focus:border-brand-200 focus:bg-white outline-none text-[12.5px] text-[#2E1614]
                         placeholder:text-[#B9A3A0] transition-colors"
            />
            <button
              onClick={() => enviar(entrada)}
              disabled={!entrada.trim() || pensando}
              className="w-10 h-10 rounded-xl bg-[#2E1614] hover:bg-[#3A2921] disabled:opacity-25
                         text-white flex items-center justify-center shrink-0 transition-all"
            >
              {pensando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[9.5px] text-[#B9A3A0] mt-1.5 px-1">
            Femma puede equivocarse. Revisa antes de enviarle algo a una clienta.
          </p>
        </div>
      </div>
    </>
  );
}
