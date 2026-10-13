'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Smile } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Selector de emojis para la bandeja.
 *
 * Va escrito a mano en vez de traer una librería: las que hay pesan entre 1 y 2
 * MB —cargan el catálogo completo de Unicode con todos los tonos de piel y las
 * banderas— y la bandeja ya es la pantalla más pesada del CRM. Aquí solo están
 * los que de verdad se usan escribiéndole a una clienta, con su nombre en
 * español para poder buscarlos.
 */
type Grupo = { nombre: string; icono: string; emojis: [string, string][] };

const GRUPOS: Grupo[] = [
  {
    nombre: 'Cariño', icono: '💕',
    emojis: [
      ['💕', 'corazones amor cariño'], ['❤️', 'corazón rojo amor'], ['💖', 'corazón brillante'],
      ['💗', 'corazón creciendo'], ['💘', 'corazón flecha'], ['💝', 'corazón regalo'],
      ['🩷', 'corazón rosado'], ['💜', 'corazón morado'], ['🧡', 'corazón naranja'],
      ['💛', 'corazón amarillo'], ['💚', 'corazón verde'], ['💙', 'corazón azul'],
      ['🤍', 'corazón blanco'], ['🥰', 'enamorada cariño feliz'], ['😍', 'ojos corazón amor'],
      ['😘', 'beso'], ['🤗', 'abrazo'], ['💋', 'labios beso'],
    ],
  },
  {
    nombre: 'Caritas', icono: '😊',
    emojis: [
      ['😊', 'sonrisa feliz contenta'], ['😃', 'feliz alegre'], ['😄', 'risa feliz'],
      ['😁', 'sonrisa dientes'], ['😆', 'risa carcajada'], ['🤣', 'muerta de risa'],
      ['😂', 'llorando de risa'], ['🙂', 'sonrisa leve'], ['😉', 'guiño'],
      ['😌', 'aliviada tranquila'], ['🤩', 'estrellas emocionada'], ['🥳', 'fiesta celebración'],
      ['😅', 'risa nervios'], ['🙈', 'pena vergüenza mono'], ['🥺', 'ojitos porfa'],
      ['😢', 'triste llorar'], ['😔', 'triste decaída'], ['😞', 'decepcionada'],
      ['😟', 'preocupada'], ['🤔', 'pensando duda'], ['😮', 'sorpresa asombro'],
      ['😴', 'dormida sueño'], ['🤒', 'enferma'], ['🙄', 'ojos arriba'],
    ],
  },
  {
    nombre: 'Gestos', icono: '👋',
    emojis: [
      ['👋', 'hola saludo chao'], ['🙌', 'manos arriba celebración'], ['👏', 'aplausos bravo'],
      ['🙏', 'gracias porfavor rezar'], ['👍', 'bien pulgar arriba ok'], ['👌', 'perfecto ok'],
      ['🤝', 'trato acuerdo manos'], ['💪', 'fuerza músculo ánimo'], ['✌️', 'paz victoria'],
      ['🫶', 'corazón manos'], ['👇', 'abajo mira'], ['👉', 'derecha señala'],
      ['☝️', 'importante ojo'], ['🤞', 'dedos cruzados suerte'], ['✍️', 'escribir anotar'],
    ],
  },
  {
    nombre: 'Fem', icono: '🌸',
    emojis: [
      ['🌸', 'flor rosada fem'], ['🌺', 'flor'], ['🌷', 'tulipán flor'],
      ['🌹', 'rosa flor'], ['💐', 'ramo flores'], ['✨', 'brillos magia'],
      ['⭐', 'estrella'], ['🌟', 'estrella brillante'], ['💫', 'destello'],
      ['🎀', 'moño lazo'], ['👑', 'corona reina'], ['💎', 'diamante joya'],
      ['🦋', 'mariposa'], ['🤰', 'embarazada mamá gestación'], ['🤱', 'lactancia bebé mamá'],
      ['👶', 'bebé'], ['🍼', 'tetero bebé'], ['🌿', 'natural hierba planta'],
    ],
  },
  {
    nombre: 'Pedido', icono: '📦',
    emojis: [
      ['📦', 'paquete pedido caja'], ['🚚', 'envío camión transporte'], ['🛵', 'domicilio moto'],
      ['✈️', 'avión envío'], ['📍', 'ubicación dirección'], ['🏠', 'casa dirección'],
      ['🛍️', 'compras bolsa'], ['🛒', 'carrito compra'], ['💳', 'tarjeta pago'],
      ['💵', 'dinero efectivo pago'], ['🧾', 'factura recibo'], ['📄', 'documento guía'],
      ['📸', 'foto imagen'], ['📱', 'celular teléfono'], ['📞', 'llamada teléfono'],
      ['⏰', 'hora tiempo reloj'], ['📅', 'fecha calendario'], ['🎁', 'regalo obsequio'],
    ],
  },
  {
    nombre: 'Señales', icono: '✅',
    emojis: [
      ['✅', 'listo confirmado bien'], ['☑️', 'chulo marcado'], ['❌', 'no error mal'],
      ['⚠️', 'atención cuidado alerta'], ['❗', 'importante'], ['❓', 'pregunta duda'],
      ['🔔', 'aviso campana'], ['🎉', 'celebración fiesta'], ['🥂', 'brindis celebración'],
      ['🔥', 'fuego tendencia'], ['💯', 'cien perfecto'], ['🆕', 'nuevo'],
      ['🎯', 'objetivo meta'], ['💡', 'idea tip consejo'], ['🩺', 'salud médico'],
    ],
  },
];

const CLAVE_RECIENTES = 'fem_emojis_recientes';

function leerRecientes(): string[] {
  try { return JSON.parse(localStorage.getItem(CLAVE_RECIENTES) ?? '[]').slice(0, 18); }
  catch { return []; }
}

export function SelectorEmojis({
  onElegir, disabled,
}: { onElegir: (emoji: string) => void; disabled?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [grupo, setGrupo] = useState(0);
  const [recientes, setRecientes] = useState<string[]>([]);
  const caja = useRef<HTMLDivElement>(null);
  const buscador = useRef<HTMLInputElement>(null);

  useEffect(() => { if (abierto) { setRecientes(leerRecientes()); buscador.current?.focus(); } }, [abierto]);

  // Se cierra al hacer clic afuera o con Esc: si no, el panel tapa la
  // conversación y hay que volver a apuntarle al botón para quitarlo.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', tecla); };
  }, [abierto]);

  const resultados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return null;
    return GRUPOS.flatMap(g => g.emojis).filter(([e, nombres]) => nombres.includes(q) || e === q);
  }, [busqueda]);

  function elegir(emoji: string) {
    onElegir(emoji);
    // El panel se queda abierto a propósito: casi siempre se ponen dos o tres
    // seguidos y cerrarlo obligaría a reabrirlo cada vez.
    const nuevos = [emoji, ...leerRecientes().filter(x => x !== emoji)].slice(0, 18);
    setRecientes(nuevos);
    try { localStorage.setItem(CLAVE_RECIENTES, JSON.stringify(nuevos)); } catch { /* modo incógnito */ }
  }

  const visibles = resultados ?? GRUPOS[grupo].emojis.map(([e]) => e).map(e => [e, ''] as [string, string]);

  return (
    <div className="relative" ref={caja}>
      <button
        type="button"
        onClick={() => setAbierto(a => !a)}
        disabled={disabled}
        title="Emojis"
        className={cn('p-1.5 rounded-lg transition-colors disabled:opacity-30',
          abierto ? 'text-[#D33A22] bg-brand-100' : 'text-ink-muted hover:text-[#D33A22] hover:bg-brand-50')}
      >
        <Smile className="w-4 h-4" />
      </button>

      {abierto && (
        <div className="absolute bottom-full left-0 mb-2 w-[298px] bg-white rounded-2xl border border-brand-100
                        shadow-[0_12px_32px_rgba(46,22,20,0.16)] overflow-hidden z-50">
          <div className="p-2 border-b border-brand-100">
            <input
              ref={buscador}
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar: corazón, gracias, pedido…"
              className="w-full bg-brand-50 rounded-lg px-2.5 py-1.5 text-[12px] outline-none
                         focus:bg-white focus:ring-2 focus:ring-[#ED5340]/25 text-ink placeholder:text-ink-muted"
            />
          </div>

          {!busqueda && recientes.length > 0 && (
            <div className="px-2 pt-2">
              <p className="text-[10px] font-bold text-ink-muted uppercase tracking-wide mb-1 px-1">Usados hace poco</p>
              <div className="grid grid-cols-9 gap-0.5">
                {recientes.map(e => (
                  <button key={`r-${e}`} type="button" onClick={() => elegir(e)}
                    className="text-[19px] leading-none h-8 rounded-lg hover:bg-brand-50 active:scale-90 transition-transform">
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="max-h-[188px] overflow-y-auto p-2">
            {resultados && resultados.length === 0 ? (
              <p className="text-[12px] text-ink-muted text-center py-6">Ningún emoji se llama así.</p>
            ) : (
              <div className="grid grid-cols-9 gap-0.5">
                {visibles.map(([e], i) => (
                  <button key={`${e}-${i}`} type="button" onClick={() => elegir(e)}
                    className="text-[19px] leading-none h-8 rounded-lg hover:bg-brand-50 active:scale-90 transition-transform">
                    {e}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!busqueda && (
            <div className="flex border-t border-brand-100 bg-brand-50/60">
              {GRUPOS.map((g, i) => (
                <button key={g.nombre} type="button" onClick={() => setGrupo(i)} title={g.nombre}
                  className={cn('flex-1 py-2 text-[16px] leading-none transition-colors',
                    i === grupo ? 'bg-white border-t-2 border-[#ED5340] -mt-px' : 'opacity-55 hover:opacity-100')}>
                  {g.icono}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
