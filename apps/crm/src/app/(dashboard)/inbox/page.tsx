'use client';
import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, memo } from 'react';
import {
  Search, Send, Lock, MessageSquare, Instagram, Facebook, Mic, Square, Paperclip,
  Clock, CheckCheck, AlertCircle, ChevronRight, Loader2, X, ShieldAlert, MessageSquarePlus,
  ArrowDown, ArrowUp, Pencil, Check, Reply, Pin
} from 'lucide-react';
import { NuevaPqrs } from '@/components/pqrs-nueva';
import { NuevoChat } from '@/components/nuevo-chat';
import { cn, formatRelativeTime, mostrarTelefono, horaBogota, fechaHoraBogota } from '@/lib/utils';
import { api } from '@/lib/api';
import { MediaBubble } from '@/components/media-bubble';
import { aOggOpus } from '@/lib/opus-remux';
import { ACCEPT_ADJUNTOS, revisarTipoAdjunto } from '@/lib/adjuntos';
import { SelectorEmojis } from '@/components/emojis';

type Channel  = 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK';
type ConvStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';

interface MessageMedia {
  url: string; mimeType: string; size: number;
  filename?: string | null;
}
interface Message {
  id: string; content: string;
  direction: 'INBOUND' | 'OUTBOUND';
  createdAt: string; isInternal?: boolean;
  sentBy?: { id: string; name: string } | null;
  status?: 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  errorMotivo?: string | null;
  replyToId?: string | null;
  /** Burbuja provisional: aún no ha vuelto la confirmación del servidor. */
  enviando?: boolean;
  media?: MessageMedia | null;
}
interface CustomerInfo {
  id: string; name: string; phone: string; email?: string | null;
  city?: string | null; ltv?: string | number | null; totalOrders?: number | null;
}
interface Conversation {
  /** Cuántos mensajes viejos quedaron fuera del tope de carga. */
  anteriores?: number;
  id: string; channel: Channel; status: ConvStatus;
  tags: string[]; isRead: boolean;
  /** Le falta respuesta de una PERSONA. Lo decide el servidor. */
  sinResponder?: boolean;
  /** Fijada por ESTA usuaria. Cada quien tiene las suyas. */
  fijada?: boolean;
  /** Cuándo escribió ELLA por última vez. Es lo que mide la espera. */
  ultimoSuyoAt?: string | null;
  lastMessageAt: string | null;
  customer: CustomerInfo;
  agent?: { id: string; name: string } | null;
  messages: Message[];
  /** Últimos pedidos de la clienta, para el panel lateral. */
  pedidos?: PedidoEnChat[];
  /** De qué línea de WhatsApp es. Solo lo ve quien tiene acceso a varias. */
  metaAccount?: { accountName: string | null } | null;
}

/** Una línea de WhatsApp con su carga pendiente, para el selector. */
interface Linea {
  id: string;
  nombre: string;
  telefono: string | null;
  sinLeer: number;
}

const CH = {
  WHATSAPP: { label: 'WhatsApp', short: 'WA', icon: MessageSquare,
    pill: 'bg-[#E8F8F0] text-[#1A7A4A] border border-[#B7DFD0]',
    dot: 'bg-[#25D366]', header: 'from-[#E8F8F0] to-white', activeBg: 'bg-[#1A7A4A]' },
  INSTAGRAM: { label: 'Instagram', short: 'IG', icon: Instagram,
    pill: 'bg-[#FDE8F4] text-[#9B2C6F] border border-[#F4B8DC]',
    dot: 'bg-[#E1306C]', header: 'from-[#FDE8F4] to-white', activeBg: 'bg-[#9B2C6F]' },
  FACEBOOK: { label: 'Facebook', short: 'FB', icon: Facebook,
    pill: 'bg-[#E7EFFE] text-[#1A4A9B] border border-[#B3C8F8]',
    dot: 'bg-[#1877F2]', header: 'from-[#E7EFFE] to-white', activeBg: 'bg-[#1A4A9B]' },
} as const;

interface Template {
  id: string; name: string; content: string;
  variables: string[]; status: string; category: string; language: string;
  headerFormat?: string | null; hasUrlButton?: boolean;
}

// Rellena {{1}}, {{2}}… con los valores dados (para preview y para el texto guardado)
function fillTemplate(content: string, params: string[]): string {
  return content.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => params[Number(n) - 1] || `{{${n}}}`);
}

/** Texto del mensaje con los enlaces clicables (ubicaciones, rastreo, catálogo). */
function MessageText({ text }: { text: string }) {
  const partes = text.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {partes.map((parte, i) =>
        /^https?:\/\//.test(parte) ? (
          <a
            key={i}
            href={parte}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 break-all hover:opacity-80"
          >
            {parte}
          </a>
        ) : (
          parte
        ),
      )}
    </>
  );
}

const TPL_STATUS: Record<string, { dot: string; label: string }> = {
  APPROVED: { dot: 'bg-emerald-500', label: 'Aprobada' },
  PENDING:  { dot: 'bg-amber-400',   label: 'En revisión' },
  REJECTED: { dot: 'bg-rose-400',    label: 'Rechazada' },
};

const TPL_CATEGORY: Record<string, string> = {
  CONFIRMATION: 'Confirmación', LOGISTICS: 'Logística', REPURCHASE: 'Recompra',
  SUPPORT: 'Atención', PROMOTIONAL: 'Promocional',
};


// El listado trae el último mensaje (desc, take 1); el detalle los trae todos (asc)
const lastMsg = (c: Conversation): Message | undefined =>
  c.messages.length ? c.messages[c.messages.length - 1] : undefined;

/** Cuántas conversaciones se piden por tanda al bajar en la lista. */
const POR_PAGINA = 50;

/**
 * ¿Le falta respuesta?
 *
 * Lo dice el servidor (`sinResponder`), no el último mensaje de la lista. Con
 * el último mensaje, un aviso automático del envío hacía desaparecer la
 * pregunta de la clienta: parecía atendida sin que nadie la hubiera leído.
 *
 * El respaldo por dirección se queda para las conversaciones que se abrieron
 * antes de que existiera la columna y aún no han recibido nada nuevo.
 */
/** Las fijadas arriba, y dentro de cada grupo el orden que ya traía la lista. */
function ordenarConFijadas(lista: Conversation[]): Conversation[] {
  const fijadas = lista.filter(c => c.fijada);
  return fijadas.length ? [...fijadas, ...lista.filter(c => !c.fijada)] : lista;
}

const isWaiting = (c: Conversation) =>
  c.status !== 'RESOLVED' &&
  (c.sinResponder ?? lastMsg(c)?.direction === 'INBOUND');

/**
 * Desde cuándo espera respuesta: la fecha de SU mensaje, no la del último de la
 * conversación. Con la segunda, un aviso automático del pedido le reiniciaba el
 * cronómetro y una clienta que llevaba dos días esperando aparecía como recién
 * llegada.
 */
const esperandoDesde = (c: Conversation) => c.ultimoSuyoAt ?? c.lastMessageAt;

function waitPriority(c: Conversation): 'urgent' | 'high' | 'normal' {
  const desde = esperandoDesde(c);
  if (!isWaiting(c) || !desde) return 'normal';
  const mins = (Date.now() - new Date(desde).getTime()) / 60000;
  return mins > 60 ? 'urgent' : mins > 15 ? 'high' : 'normal';
}

function WaitBadge({ since }: { since: string }) {
  const mins = Math.floor((Date.now() - new Date(since).getTime()) / 60000);
  const hours = Math.floor(mins / 60);
  const label = hours >= 1 ? `${hours}h ${mins % 60}m` : `${mins}m`;
  const urgent = mins > 60;
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full',
      urgent ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-700')}>
      <Clock className="w-2.5 h-2.5" />{label} sin resp.
    </span>
  );
}

const initials = (n: string) => n.split(' ').map(x => x[0]).join('').toUpperCase().slice(0, 2);

// ─── Pedido en la barra lateral ──────────────────────────────────────────────

interface PedidoEnChat {
  id: string;
  shopifyOrderNumber?: string | null;
  shopifyOrderId?: string | null;
  status: string;
  totalAmount?: string | number | null;
  trackingNumber?: string | null;
  createdAt: string;
  deliveredAt?: string | null;
  confirmedAt?: string | null;
  items?: unknown;
  /** { address, city, state, zip } tal como lo manda Mastershop. */
  shippingAddress?: unknown;
  mastershopGuides?: { guideNumber: string; carrier?: string | null; statusDetail?: string | null }[];
}

/** Los productos del pedido, con su cantidad y variante. */
interface ItemPedido {
  name?: string; name_product?: string; name_variant?: string; quantity?: number;
}

/** La dirección tal como viene de Mastershop. */
interface DireccionPedido {
  address?: string; city?: string; state?: string;
}

/** Color y nombre legible de cada estado, para leerlo de un vistazo. */
const ESTADO_PEDIDO: Record<string, { label: string; pill: string; texto: string }> = {
  PENDING_CONFIRMATION: { label: 'Por confirmar', pill: 'bg-amber-50 text-amber-700 border-amber-200',   texto: 'text-amber-700' },
  CONFIRMED:            { label: 'Confirmado',    pill: 'bg-sky-50 text-sky-700 border-sky-200',         texto: 'text-sky-700' },
  PREPARING:            { label: 'Por alistar',   pill: 'bg-sky-50 text-sky-700 border-sky-200',         texto: 'text-sky-700' },
  DISPATCHED:           { label: 'Despachado',    pill: 'bg-indigo-50 text-indigo-700 border-indigo-200', texto: 'text-indigo-700' },
  IN_TRANSIT:           { label: 'En tránsito',   pill: 'bg-indigo-50 text-indigo-700 border-indigo-200', texto: 'text-indigo-700' },
  IN_DESTINATION:       { label: 'En oficina',    pill: 'bg-violet-50 text-violet-700 border-violet-200', texto: 'text-violet-700' },
  DELIVERED:            { label: 'Entregado',     pill: 'bg-emerald-50 text-emerald-700 border-emerald-200', texto: 'text-emerald-700' },
  FAILED_DELIVERY:      { label: 'Con novedad',   pill: 'bg-rose-50 text-rose-700 border-rose-200',       texto: 'text-rose-700' },
  RETURNED:             { label: 'Devuelto',      pill: 'bg-rose-50 text-rose-700 border-rose-200',       texto: 'text-rose-700' },
  CANCELLED:            { label: 'Cancelado',     pill: 'bg-stone-100 text-stone-600 border-stone-200',   texto: 'text-stone-600' },
};

function PanelPedido({
  pedido, confirmando, onConfirmar,
}: {
  pedido: PedidoEnChat;
  confirmando: boolean;
  onConfirmar: (id: string) => void;
}) {
  const estado = ESTADO_PEDIDO[pedido.status] ?? { label: pedido.status, pill: 'bg-stone-100 text-stone-600 border-stone-200', texto: 'text-stone-600' };
  const guia = pedido.trackingNumber || pedido.mastershopGuides?.[0]?.guideNumber;
  const transportadora = pedido.mastershopGuides?.[0]?.carrier;
  const detalle = pedido.mastershopGuides?.[0]?.statusDetail;
  const productos = Array.isArray(pedido.items) ? (pedido.items as ItemPedido[]) : [];
  const porConfirmar = pedido.status === 'PENDING_CONFIRMATION';

  // Dirección completa en una línea, como se la dictaría a la clienta.
  const dir = (pedido.shippingAddress ?? {}) as DireccionPedido;
  const direccion = [dir.address, dir.city, dir.state].map(x => (x ?? '').trim()).filter(Boolean).join(', ');

  return (
    <div className="rounded-xl border border-brand-100 bg-white overflow-hidden">
      <div className="px-3 py-2.5 border-b border-brand-100 flex items-center justify-between gap-2">
        <span className="font-bold text-[13.5px] text-ink truncate">
          {pedido.shopifyOrderNumber ?? pedido.shopifyOrderId}
        </span>
        <span className={cn('text-[11px] font-bold px-2.5 py-1 rounded-full border shrink-0', estado.pill)}>
          {estado.label}
        </span>
      </div>

      <div className="px-3 py-2.5 space-y-2 text-[13px]">
        {/* Producto a producto, con cantidad y variante. Antes se pegaban los
            nombres con « + » y se perdía cuántas unidades pidió y de cuál — que
            es justo lo que pregunta quien llama a reclamar. */}
        {productos.length > 0 && (
          <div className="space-y-1">
            {productos.map((pr, i) => {
              const nombre = (pr.name || pr.name_product || '').trim();
              if (!nombre) return null;
              return (
                <p key={i} className="text-ink-soft leading-snug">
                  {(pr.quantity ?? 1) > 1 && (
                    <span className="font-semibold text-ink">{pr.quantity}× </span>
                  )}
                  {nombre}
                  {pr.name_variant && (
                    <span className="text-ink-muted"> · {pr.name_variant}</span>
                  )}
                </p>
              );
            })}
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-ink-muted">Total</span>
          <span className="font-semibold text-ink">
            {Number(pedido.totalAmount ?? 0).toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })}
          </span>
        </div>

        {guia ? (
          <>
            <div className="flex justify-between gap-2">
              <span className="text-ink-muted shrink-0">Transportadora</span>
              <span className="font-semibold text-ink truncate">{transportadora || '—'}</span>
            </div>
            <div className="flex justify-between gap-2 items-center">
              <span className="text-ink-muted shrink-0">Guía</span>
              <button
                onClick={() => navigator.clipboard?.writeText(guia)}
                title="Copiar la guía"
                className="font-mono font-semibold text-ink hover:text-pepper-600 truncate transition-colors"
              >
                {guia}
              </button>
            </div>
          </>
        ) : (
          <p className="text-ink-muted italic">Aún sin guía asignada.</p>
        )}

        {/* Lo que dice la transportadora, con sus palabras. Se guardaba y no se
            enseñaba: es lo que explica una novedad sin salir del chat. */}
        {detalle && (
          <p className="text-[12px] text-ink-muted leading-snug border-l-2 border-brand-100 pl-2">{detalle}</p>
        )}

        {/* A dónde va. Se copia de un clic para pegarla en la transportadora. */}
        {direccion && (
          <div>
            <span className="text-ink-muted">Envío a</span>
            <button
              onClick={() => navigator.clipboard?.writeText(direccion)}
              title="Copiar la dirección"
              className="block text-left text-ink-soft leading-snug hover:text-pepper-600 transition-colors"
            >{direccion}</button>
          </div>
        )}

        <div className="flex justify-between">
          <span className="text-ink-muted">Pedido</span>
          <span className="text-ink-soft">{new Date(pedido.createdAt).toLocaleDateString('es-CO')}</span>
        </div>

        {pedido.deliveredAt && (
          <div className="flex justify-between">
            <span className="text-ink-muted">Entregado</span>
            <span className="font-semibold text-emerald-700">{new Date(pedido.deliveredAt).toLocaleDateString('es-CO')}</span>
          </div>
        )}
      </div>

      {porConfirmar && !pedido.confirmedAt && (
        <div className="px-3 pb-3">
          <button
            onClick={() => onConfirmar(pedido.id)}
            disabled={confirmando}
            className="w-full flex items-center justify-center gap-2 text-[12px] font-bold px-3 py-2.5 rounded-xl
                       bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white shadow-sm transition-all active:scale-[0.98]"
          >
            {confirmando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
            Confirmar pedido
          </button>
          <p className="text-[10px] text-ink-muted leading-snug mt-1.5 text-center">
            Se confirma también en Mastershop y pasa a <strong>Por alistar</strong>.
          </p>
        </div>
      )}

      {porConfirmar && pedido.confirmedAt && (
        <div className="px-3 pb-3">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <p className="text-[11px] font-bold text-amber-800 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              Confirmado · esperando a Mastershop
            </p>
            <p className="text-[10px] text-amber-700 leading-snug mt-0.5">
              Pasa a <strong>Por alistar</strong> en unos segundos. Si sigue así en unos minutos, revísalo en Mastershop.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Avatar con inicial de canal ─────────────────────────────────────────────
/**
 * El correo de la clienta, en la cabecera del chat.
 *
 * Se copia de un clic —es lo que se pega en Shopify para encontrar el pedido— y,
 * cuando la ficha no lo tiene, se escribe ahí mismo. Hacía falta lo segundo:
 * solo una de cada diez fichas trae correo (WhatsApp no lo manda), así que
 * mostrarlo sin poder añadirlo dejaba el hueco casi siempre vacío y la búsqueda
 * por correo sin nada que encontrar.
 */
function CorreoClienta({ customer, onGuardado }: {
  customer: { id: string; email?: string | null };
  onGuardado: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    const limpio = valor.trim();
    if (!limpio || guardando) return;
    setGuardando(true);
    try {
      await api.patch(`/api/customers/${customer.id}`, { email: limpio });
      setEditando(false);
      setValor('');
      onGuardado();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo guardar el correo.');
    } finally {
      setGuardando(false);
    }
  }

  if (editando) {
    return (
      <input
        autoFocus value={valor} onChange={e => setValor(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') guardar();
          if (e.key === 'Escape') { setEditando(false); setValor(''); }
        }}
        // Se guarda también al salir del campo: escribir el correo y hacer clic
        // en el chat es lo más natural del mundo, y perderlo ahí desanima a
        // volver a intentarlo.
        onBlur={() => { if (valor.trim()) guardar(); else setEditando(false); }}
        disabled={guardando}
        placeholder="correo@ejemplo.com"
        className="text-sm px-2 py-0.5 rounded-lg bg-brand-50/60 border border-brand-100 outline-none focus:border-[#D33A22] w-[230px]"
      />
    );
  }

  if (!customer.email) {
    return (
      <button
        onClick={() => setEditando(true)}
        title="Guardar el correo de la clienta"
        className="text-sm text-ink-muted hover:text-[#D33A22] transition-colors"
      >· + correo</button>
    );
  }

  return (
    <span className="flex items-center gap-1 min-w-0">
      <button
        onClick={() => navigator.clipboard?.writeText(customer.email!)}
        title="Copiar el correo"
        className="text-sm text-ink-muted hover:text-[#D33A22] transition-colors truncate max-w-[240px]"
      >· {customer.email}</button>
      <button
        onClick={() => { setValor(customer.email ?? ''); setEditando(true); }}
        title="Corregir el correo"
        className="text-ink-muted/60 hover:text-[#D33A22] transition-colors shrink-0"
      ><Pencil className="w-3 h-3" /></button>
    </span>
  );
}

function ConvAvatar({ conv, size = 'md' }: { conv: Conversation; size?: 'sm' | 'md' }) {
  const cfg = CH[conv.channel] ?? CH.WHATSAPP;
  const dim = size === 'sm' ? 'w-8 h-8 text-[10px]' : 'w-10 h-10 text-[12px]';
  return (
    <div className="relative shrink-0">
      <div className={cn('rounded-2xl flex items-center justify-center font-black bg-[#FFF8F7] text-[#2E1614]', dim)}>
        {initials(conv.customer.name)}
      </div>
      <span className={cn('absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white flex items-center justify-center', cfg.activeBg)}>
        <cfg.icon className="w-2 h-2 text-white" />
      </span>
    </div>
  );
}


/**
 * Una fila de la lista de conversaciones.
 *
 * Vive fuera de la pantalla y va memorizada a propósito. Antes era JSX suelto
 * dentro del componente de la bandeja: cuando el refresco traía UNA
 * conversación con un mensaje nuevo, React rehacía las doscientas filas
 * porque el array era otro. Con la fila aparte y `memo`, solo se rehace la
 * que de verdad cambió.
 *
 * Las props son valores sueltos y no objetos armados al vuelo: si se le
 * pasara `{activa: ...}` recién creado en cada render, `memo` no serviría de
 * nada. `conv` conserva su identidad gracias a `conservarSiIgual`.
 */
const TarjetaConversacion = memo(function TarjetaConversacion({
  conv, isAct, variasLineas, lineaFiltrada, resolviendoEsta, enVariasConversaciones, onAbrir, onResolver, onFijar,
  minuto: _minuto,
}: {
  conv: Conversation;
  isAct: boolean;
  variasLineas: boolean;
  /** Línea seleccionada en la barra: si hay una, la etiqueta sobra. */
  lineaFiltrada: string;
  /** Cambia cada minuto. No se pinta: obliga a recalcular «Xm sin resp.». */
  minuto: number;
  resolviendoEsta: boolean;
  enVariasConversaciones: boolean;
  onAbrir: (c: Conversation) => void;
  onResolver: (id: string) => void;
  onFijar: (c: Conversation) => void;
}) {
    const last  = lastMsg(conv);
    const cfg   = CH[conv.channel] ?? CH.WHATSAPP;
    const unread = !conv.isRead && !isAct;
    const priority = waitPriority(conv);
    const waiting  = isWaiting(conv);

    return (
      <div key={conv.id} data-conv={conv.id} className="relative group/fila">
      <button
        onClick={() => onAbrir(conv)}
        className={cn(
          'w-full text-left px-3 py-3.5 border-b transition-all relative group',
          /* ── ESTADO ACTIVO: fondo brand sólido ── */
          isAct
            ? 'bg-pepper-600 border-b-pepper-700/10'
            : unread
              ? 'bg-[#FFF5F5] border-b-[#F7E4E2] hover:bg-brand-50'
              : 'bg-white border-b-[#F7E4E2] hover:bg-[#FFF5F5]'
        )}
      >
        {/* Barra lateral de prioridad */}
        {!isAct && priority === 'urgent' && (
          <span className="absolute left-0 top-2 bottom-2 w-[3px] bg-rose-400 rounded-r-full" />
        )}
        {!isAct && priority === 'high' && (
          <span className="absolute left-0 top-2 bottom-2 w-[3px] bg-amber-400 rounded-r-full" />
        )}

        <div className="flex items-start gap-3">
          <ConvAvatar conv={conv} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-1 mb-0.5">
              <p className={cn('text-[13px] font-bold truncate',
                isAct ? 'text-white' : unread ? 'text-[#2E1614]' : 'text-[#2E1614]')}>
                {conv.customer.name}
              </p>
              {conv.lastMessageAt && (
                <span className={cn('text-[10px] shrink-0 font-medium',
                  isAct ? 'text-white/70' : 'text-[#8C6B66]')}>
                  {/* La hora exacta, no «1d»: al repasar la cola hace
                      falta saber si escribió a las 9 de la mañana o a
                      las 11 de la noche para decidir a quién atender. */}
                  <span title={fechaHoraBogota(conv.lastMessageAt)}>
                    {fechaHoraBogota(conv.lastMessageAt)}
                  </span>
                </span>
              )}
            </div>

            {/* Ciudad + canal */}
            <div className="flex items-center gap-1.5 mb-1">
              {conv.customer.city && (
                <span className={cn('text-[10px]', isAct ? 'text-white/70' : 'text-[#8C6B66]')}>
                  {conv.customer.city}
                </span>
              )}
              {conv.fijada && (
                <Pin className={cn('w-3 h-3 shrink-0', isAct ? 'text-white' : 'text-pepper-600')} />
              )}
              <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full border',
                isAct ? 'bg-white/20 text-white border-white/30' : cfg.pill)}>
                {cfg.short}
              </span>
              {/* Solo cuando la lista mezcla líneas: si ya se filtró
                  por una, todas dirían lo mismo y sobraría. */}
              {variasLineas && !lineaFiltrada && conv.metaAccount?.accountName && (
                <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full border',
                  isAct ? 'bg-white/20 text-white border-white/30'
                        : 'bg-violet-50 text-violet-700 border-violet-200')}>
                  {conv.metaAccount.accountName}
                </span>
              )}
              {/* Una misma clienta puede tener hilo en las dos líneas y
                  en la bandeja de la admin salen las dos filas. No es
                  un duplicado, pero lo parece: se dice cuál es cuál. */}
              {conv.metaAccount && enVariasConversaciones && (
                <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-bold border',
                  isAct ? 'bg-white/20 text-white border-white/30'
                        : 'bg-amber-50 text-amber-700 border-amber-200')}>
                  también en la otra línea
                </span>
              )}
            </div>

            {/* Último mensaje */}
            <p className={cn('text-[11px] truncate leading-snug',
              isAct ? 'text-white/80' : 'text-[#8C6B66]')}>
              {last?.direction === 'OUTBOUND' && (
                <span className={isAct ? 'text-white/60' : 'text-[#C6A5A2]'}>Tú: </span>
              )}
              {last?.content}
            </p>

            {/* Badges */}
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {waiting && esperandoDesde(conv) && !isAct && (
                <WaitBadge since={esperandoDesde(conv)!} />
              )}
              {isAct && waiting && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/20 text-white">
                  <Clock className="w-2.5 h-2.5" /> Esperando respuesta
                </span>
              )}
              {conv.tags.slice(0,1).map(t => (
                <span key={t} className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-bold border',
                  isAct ? 'bg-white/20 text-white border-white/30' : 'bg-brand-50 text-pepper-700 border-brand-200')}>
                  {t}
                </span>
              ))}
              {unread && (
                <span className="ml-auto w-2 h-2 bg-pepper-600 rounded-full shrink-0" />
              )}
            </div>
          </div>
        </div>
      </button>

      {/* Fijar: se queda arriba de la bandeja aunque la lista, ordenada por
          fecha, la vaya empujando hacia abajo. Visible siempre si ya está
          fijada —hay que poder soltarla— y al pasar por encima si no. */}
      <button
        onClick={e => { e.stopPropagation(); onFijar(conv); }}
        title={conv.fijada ? 'Soltar el chat' : 'Fijar el chat arriba'}
        className={cn(
          'absolute top-2 w-7 h-7 rounded-lg flex items-center justify-center',
          'transition-all shadow-sm active:scale-90',
          conv.status !== 'RESOLVED' ? 'right-11' : 'right-2',
          conv.fijada
            ? 'opacity-100 ' + (isAct ? 'bg-white/90 text-pepper-700 hover:bg-white' : 'bg-pepper-600 text-white hover:bg-pepper-700')
            : 'opacity-0 group-hover/fila:opacity-100 focus:opacity-100 ' +
              (isAct ? 'bg-white/90 text-ink-soft hover:bg-white' : 'bg-white border border-brand-100 text-ink-muted hover:text-pepper-600'),
        )}
      >
        <Pin className="w-3.5 h-3.5" />
      </button>

      {/* Marcar como atendida sin entrar al chat. Cuando la clienta ya
          fue respondida, abrir la conversación solo para cerrarla es un
          rodeo: con la cola en miles, ese rodeo es el día entero. */}
      {conv.status !== 'RESOLVED' && (
        <button
          onClick={e => { e.stopPropagation(); onResolver(conv.id); }}
          disabled={resolviendoEsta}
          title="Marcar como atendida"
          className={cn(
            'absolute top-2 right-2 w-7 h-7 rounded-lg flex items-center justify-center',
            'opacity-0 group-hover/fila:opacity-100 focus:opacity-100 transition-all',
            'shadow-sm active:scale-90 disabled:opacity-40',
            isAct ? 'bg-white/90 text-emerald-700 hover:bg-white'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700',
          )}
        >
          {resolviendoEsta
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Check className="w-4 h-4" />}
        </button>
      )}
      </div>
    );
});

export default function InboxPage() {
  const [convs,    setConvs]    = useState<Conversation[]>([]);
  /**
   * Fijadas que NO están en la página actual. Viven aparte de `convs` a
   * propósito: `convs` es la página, y de su tamaño depende saber si quedan
   * más. Mezclarlas rompió justo eso — ver la ruta de conversaciones.
   */
  const [fijadasFuera, setFijadasFuera] = useState<Conversation[]>([]);
  const [sel,      setSel]      = useState<Conversation | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [sending,  setSending]  = useState(false);
  const [grabando, setGrabando] = useState(false);
  // Imagen pegada con Ctrl+V, a la espera de que la agente confirme el envío.
  const [pegada,   setPegada]   = useState<File | null>(null);
  const [vistaPrevia, setVistaPrevia] = useState<string | null>(null);
  // Cierre contra el doble envío: `sending` es estado y no cambia hasta el
  // siguiente render, así que dos Enter seguidos —o la tecla repetida— pasaban
  // los dos por la guarda y salían dos mensajes de verdad a la clienta.
  const enviando = useRef(false);
  // Qué fila está cerrándose, para no dejar el botón sin respuesta al tocarlo.
  const [resolviendo, setResolviendo] = useState<string | null>(null);
  // La lista de chats y el ancla para no perder el sitio al reordenarse.
  const listaRef = useRef<HTMLDivElement>(null);
  // Mensaje al que se está respondiendo, como el «responder» de WhatsApp.
  const [respondiendo, setRespondiendo] = useState<Message | null>(null);
  // Lista fresca del servidor esperando a que la agente quiera aplicarla.
  const frescasRef = useRef<Conversation[] | null>(null);
  const [nuevasEsperando, setNuevasEsperando] = useState(0);
  const [celularManual, setCelularManual] = useState('');
  const [guardandoCelular, setGuardandoCelular] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canceladoRef = useRef(false);
  const [segundos, setSegundos] = useState(0);

  /**
   * Latido de un minuto para las tarjetas.
   *
   * Las etiquetas «5m sin resp.» y la barrita de urgencia se calculan con la
   * hora actual EN EL MOMENTO DE DIBUJAR. Con las tarjetas memorizadas dejarían
   * de avanzar: una conversación que lleva media hora esperando seguiría
   * diciendo «2m», que es justo el dato con el que las agentes deciden a quién
   * atender primero.
   *
   * Un minuto es la resolución que esas etiquetas muestran, así que refrescar
   * más a menudo no cambiaría nada en pantalla. Antes esto ocurría cada ocho
   * segundos —y además con cada tecla—; ahora, una vez por minuto.
   */
  const [minuto, setMinuto] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setMinuto(m => m + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const [tab,      setTab]      = useState<'pending' | 'all' | 'failed' | 'resolved'>('pending');
  const [filterCh, setFilterCh] = useState<Channel | ''>('');
  const [search,   setSearch]   = useState('');
  const [msg,      setMsg]      = useState('');
  const [internal, setInternal] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showTpl,  setShowTpl]  = useState(false);
  const [tplIndex, setTplIndex] = useState(0);
  const [armed,    setArmed]    = useState<{ tpl: Template; params: string[] } | null>(null);
  const [enlaceBoton, setEnlaceBoton] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [pqrsAbierta, setPqrsAbierta] = useState(false);
  /** Líneas de WhatsApp visibles y cuál está seleccionada ('' = todas). */
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [totalPendientes, setTotalPendientes] = useState<number | null>(null);
  const [totalNoEntregados, setTotalNoEntregados] = useState<number | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [nuevoChat, setNuevoChat] = useState(false);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [linea, setLinea] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  // El contenedor de los mensajes, para saber si la agente está mirando el
  // final o leyendo más arriba.
  const scrollRef = useRef<HTMLDivElement>(null);
  const alFinalRef = useRef(true);
  const [hayNuevosAbajo, setHayNuevosAbajo] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const selIdRef = useRef<string | null>(null);
  selIdRef.current = sel?.id ?? null;
  // En un ref además del estado: `loadConvs` se memoriza sin dependencias
  // porque el sondeo periódico la reusa; leer la línea del ref evita que ese
  // intervalo se reinicie cada vez que se cambia de línea.
  const lineaRef = useRef('');
  lineaRef.current = linea;
  // La pestaña también viaja al servidor: «Sin resp.» no se puede resolver
  // en el navegador porque solo llegan 100 conversaciones de las miles que hay.
  // Cuándo se pidió por última vez el contador de la pestaña. Ver más abajo.
  const ultimoTotalRef = useRef(0);
  const tabRef = useRef<typeof tab>('pending');
  tabRef.current = tab;
  // La búsqueda también va al servidor: buscar solo entre las cargadas no
  // encuentra a nadie que esté más atrás en la lista.
  const searchRef = useRef('');
  const paginaRef = useRef(1);
  searchRef.current = search;

  // Las líneas se recargan con la bandeja para que el contador de pendientes
  // de cada una no se quede viejo mientras la agente trabaja.
  useEffect(() => {
    let vivo = true;
    const cargar = () => api.get<Linea[]>('/api/lineas')
      .then(l => { if (vivo) setLineas(l); })
      .catch(() => {});
    cargar();
    const t = setInterval(cargar, 30_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  /**
   * El contador de «No llegaron», una vez al abrir la bandeja y cada minuto.
   *
   * Va aparte de `loadConvs` —que se pide cada 8 s— a propósito: es una
   * consulta más (~30 ms) y no hace falta tan seguido. Pero tiene que estar sin
   * entrar en la pestaña, porque si el número solo aparece al pinchar, nadie
   * pincha: así fue como 180 conversaciones se quedaron sin que nadie supiera
   * que su último mensaje no había llegado.
   */
  useEffect(() => {
    let vivo = true;
    const cargar = () => api
      .get<{ totalNoEntregados: number | null }>('/api/conversations?noEntregados=1&limit=1&withTotal=1')
      .then(r => { if (vivo && r.totalNoEntregados != null) setTotalNoEntregados(r.totalNoEntregados); })
      .catch(() => {});
    cargar();
    const t = setInterval(cargar, 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  // Cronómetro de la nota de voz, para saber cuánto llevas hablando.
  useEffect(() => {
    if (!grabando) { setSegundos(0); return; }
    const t = setInterval(() => setSegundos(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [grabando]);

  /**
   * Trae la lista. `refrescoCompleto` vuelve a pedir TODAS las páginas que la
   * agente ya tiene abiertas, en una sola consulta: el refresco automático
   * corre cada 8 s y, si pidiera solo la última página, la volvería a agregar
   * al final y la lista se llenaría de conversaciones repetidas.
   */
  /**
   * La lista NO se reordena mientras la agente está trabajando.
   *
   * Cada mensaje que entra sube su conversación al primer puesto y empuja al
   * resto una fila. Quien iba respondiendo en orden perdía el sitio y tenía que
   * bajar a buscar dónde se había quedado, cada pocos segundos.
   *
   * Con la lista desplazada se siguen actualizando los datos de cada fila
   * —último mensaje, sin leer, etiquetas— pero sin moverlas. Lo que llega
   * nuevo se cuenta y se avisa arriba; el orden fresco se aplica cuando la
   * agente lo pide o cuando vuelve al principio.
   */
  /**
   * ¿Dos versiones de lo mismo traen igual contenido? Se compara el JSON, que
   * es exacto y cuesta microsegundos frente a los milisegundos que cuesta
   * volver a dibujar lo que representa.
   */
  function mismoContenido(a: unknown, b: unknown) {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }

  function mezclarSinMover(previas: Conversation[], frescas: Conversation[]) {
    const porId = new Map(frescas.map(c => [c.id, c]));
    const alDia = previas.map(c => conservarSiIgual(c, porId.get(c.id)));
    const yaEstan = new Set(previas.map(c => c.id));
    return { alDia, nuevas: frescas.filter(c => !yaEstan.has(c.id)) };
  }

  /**
   * Devuelve la conversación NUEVA solo si de verdad trae algo distinto; si no,
   * la de antes, con su misma identidad en memoria.
   *
   * Esto es lo que hace que la memorización de las tarjetas sirva de algo. Cada
   * ocho segundos llegan las 200 conversaciones y, aunque vinieran calcadas,
   * eran 200 objetos nuevos: para React eso son 200 tarjetas distintas y las
   * rehacía todas. Conservando el objeto anterior cuando el contenido es igual,
   * un mensaje que entra rehace UNA tarjeta, no doscientas.
   */
  function conservarSiIgual(anterior: Conversation, fresca?: Conversation): Conversation {
    if (!fresca) return anterior;
    return mismoContenido(anterior, fresca) ? anterior : fresca;
  }

  /** La lista fresca, conservando la identidad de lo que no cambió. */
  function conservarIdentidades(previas: Conversation[], frescas: Conversation[]) {
    if (!previas.length) return frescas;
    const porId = new Map(previas.map(c => [c.id, c]));
    let algoCambio = previas.length !== frescas.length;
    const lista = frescas.map((c, i) => {
      const conservada = conservarSiIgual(c, porId.get(c.id) ? c : undefined);
      const anterior = porId.get(c.id);
      const elegida = anterior && mismoContenido(anterior, c) ? anterior : c;
      if (elegida !== previas[i]) algoCambio = true;
      return elegida;
    });
    // Mismo orden y mismos objetos: se devuelve el array de antes, y así ni
    // siquiera se recalcula la lista de tarjetas.
    return algoCambio ? lista : previas;
  }

  /**
   * Busca un celular colombiano dentro de lo que escribió la clienta.
   * Sirve para rescatar a las que tienen el número oculto: casi siempre lo
   * dejan escrito en algún mensaje («mi número es 300…», o al dar sus datos).
   */
  const celularEnElChat = (() => {
    if (!sel?.customer.phone.startsWith('CO.')) return null;
    for (const m of sel.messages) {
      if (m.direction !== 'INBOUND') continue;
      const g = m.content.match(/(?:\+?57)?\s?(3\d{2})[\s.-]?(\d{3})[\s.-]?(\d{4})/);
      if (g) return `+57${g[1]}${g[2]}${g[3]}`;
    }
    return null;
  })();

  async function asignarCelular(valor: string | null) {
    if (!sel || !valor || guardandoCelular) return;
    setGuardandoCelular(true);
    try {
      await api.patch(`/api/customers/${sel.customer.id}`, { phone: valor });
      setCelularManual('');
      await loadDetail(sel.id);
      loadConvs(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo guardar el celular.');
    } finally {
      setGuardandoCelular(false);
    }
  }

  /** ¿Está leyendo más abajo del principio? */
  function listaDesplazada() {
    return (listaRef.current?.scrollTop ?? 0) > 4;
  }

  /** Aplica el orden nuevo y sube al principio: lo que hace el aviso. */
  function ponerAlDia() {
    if (frescasRef.current) setConvs(frescasRef.current);
    frescasRef.current = null;
    setNuevasEsperando(0);
    listaRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const loadConvs = useCallback(async (refrescoCompleto = false) => {
    try {
      const q = refrescoCompleto
        ? new URLSearchParams({ limit: String(POR_PAGINA * paginaRef.current), page: '1' })
        : new URLSearchParams({ limit: String(POR_PAGINA), page: String(paginaRef.current) });
      if (lineaRef.current) q.set('metaAccountId', lineaRef.current);
      if (tabRef.current === 'pending') q.set('pendientes', '1');
      if (tabRef.current === 'failed') q.set('noEntregados', '1');
      if (tabRef.current === 'resolved') q.set('status', 'RESOLVED');
      if (searchRef.current.trim()) q.set('search', searchRef.current.trim());
      // La lista se resuelve en ~2 ms; el contador de la pestaña cuesta ~64 ms
      // porque tiene que mirar la conversación entera de las 4.600 abiertas. Se
      // pide como mucho cada 30 s en vez de en cada sondeo de 8 s: entre medias
      // se mantiene el último número recibido. Ver la ruta para el detalle.
      const pedirTotal = Date.now() - ultimoTotalRef.current > 30_000;
      if (pedirTotal) { q.set('withTotal', '1'); ultimoTotalRef.current = Date.now(); }
      const res = await api.get<{
        data: Conversation[]; fijadas?: Conversation[]; total: number;
        totalPendientes: number | null; totalNoEntregados: number | null;
      }>(`/api/conversations?${q}`);
      setFijadasFuera(res.fijadas ?? []);
      setConvs(prev => {
        // Las tandas siguientes se añaden al final, nunca repetidas: la lista
        // se reordena sola y una conversación puede caer en dos páginas.
        if (!refrescoCompleto && paginaRef.current > 1) {
          const yaEstan = new Set(prev.map(c => c.id));
          return [...prev, ...res.data.filter(c => !yaEstan.has(c.id))];
        }
        // Arriba del todo no hay nada que perder: se aplica el orden fresco.
        if (!listaDesplazada() || !prev.length) {
          frescasRef.current = null;
          setNuevasEsperando(0);
          // Orden fresco, pero conservando el objeto de cada conversación que
          // no haya cambiado. Si no cambió ninguna se devuelve el array de
          // antes y no se redibuja absolutamente nada.
          return conservarIdentidades(prev, res.data);
        }
        // Trabajando más abajo: datos al día, mismo orden, el resto espera.
        const { alDia, nuevas } = mezclarSinMover(prev, res.data);
        frescasRef.current = res.data;
        setNuevasEsperando(nuevas.length);
        // `mezclarSinMover` ya conservó las que no cambiaron; si ninguna lo
        // hizo, se devuelve el array anterior tal cual.
        return alDia.length === prev.length && alDia.every((c, i) => c === prev[i]) ? prev : alDia;
      });
      // `>=` y no `===`: con la igualdad, cualquier cambio que devuelva un
      // elemento de más deja `hayMas` en false y la agente se queda sin el
      // botón de cargar más, viendo una tanda y el contador marcando cientos.
      // Ya pasó una vez, con los chats fijados mezclados en la página.
      if (!refrescoCompleto) setHayMas(res.data.length >= POR_PAGINA);
      if (res.totalPendientes !== null && res.totalPendientes !== undefined) setTotalPendientes(res.totalPendientes);
      if (res.totalNoEntregados !== null && res.totalNoEntregados !== undefined) setTotalNoEntregados(res.totalNoEntregados);
      return res.data;
    } catch {
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string): Promise<boolean> => {
    try {
      const conv = await api.get<Conversation>(`/api/conversations/${id}`);
      setSel(prev => {
        if (selIdRef.current !== id && prev !== null) return prev;
        // Las burbujas que todavía están saliendo no vienen del servidor: se
        // conservan, o desaparecerían de la pantalla a mitad de envío.
        const enElAire = prev?.id === id ? prev.messages.filter(m => m.enviando) : [];
        const siguiente = enElAire.length
          ? { ...conv, messages: [...conv.messages, ...enElAire] }
          : conv;
        // Entre dos sondeos casi nunca entra nada. Si el chat viene idéntico se
        // devuelve el MISMO objeto y las burbujas no se rehacen: antes se
        // redibujaba la conversación entera cada ocho segundos porque el objeto
        // era nuevo, aunque su contenido fuera calcado.
        if (prev && mismoContenido(prev, siguiente)) return prev;
        return siguiente;
      });
      // Igual: si ya estaba marcada como leída, `map` devolvía un array nuevo
      // y con él se redibujaba la lista lateral sin motivo.
      setConvs(p => (p.some(c => c.id === id && !c.isRead)
        ? p.map(c => (c.id === id ? { ...c, isRead: true } : c))
        : p));
      return true;
    } catch { return false; /* borrada, o de una línea que esta agente no ve */ }
  }, []);

  // Carga inicial + selección de conversación.
  // Con `?c=<id>` se abre esa directamente: es lo que permite saltar aquí desde
  // una PQRS, la ficha de una clienta o su carrito abandonado.
  useEffect(() => {
    const pedida = new URLSearchParams(window.location.search).get('c');
    (async () => {
      // La conversación pedida se abre SIEMPRE, esté o no en la lista. Antes se
      // exigía que estuviera entre las 100 cargadas y, como la lista trae solo
      // las más recientes, cualquier chat de ayer se ignoraba en silencio: el
      // enlace de una PQRS abría la primera conversación de la bandeja en vez
      // de la de esa clienta.
      if (pedida && await loadDetail(pedida)) { loadConvs(); return; }
      const data = await loadConvs();
      if (selIdRef.current) return;
      if (data.length) loadDetail(data[0].id);
    })();
  }, [loadConvs, loadDetail]);

  // Al cambiar de línea se vuelve a pedir la lista al servidor: el filtro no
  // se puede hacer aquí porque solo llegan 100 conversaciones a la vez.
  const primeraCarga = useRef(true);
  useEffect(() => {
    if (primeraCarga.current) { primeraCarga.current = false; return; }
    paginaRef.current = 1;
    setLoading(true);
    loadConvs().then(data => {
      // Si la conversación abierta ya no pertenece a la línea elegida, se
      // abre la primera de la nueva lista en vez de dejar una que no se ve.
      if (!data.some(c => c.id === selIdRef.current)) {
        if (data.length) loadDetail(data[0].id); else setSel(null);
      }
    });
  }, [linea, tab, loadConvs, loadDetail]);

  // La búsqueda se manda al servidor con una pausa, para no consultar en cada
  // tecla. Sin esto solo encontraba entre las conversaciones ya cargadas.
  useEffect(() => {
    if (primeraCarga.current) return;
    const t = setTimeout(() => { paginaRef.current = 1; setLoading(true); loadConvs(); }, 350);
    return () => clearTimeout(t);
  }, [search, loadConvs]);

  // Refresco automático: lista + conversación abierta
  useEffect(() => {
    const t = setInterval(() => {
      loadConvs(true);
      if (selIdRef.current) loadDetail(selIdRef.current);
    }, 8000);
    return () => clearInterval(t);
  }, [loadConvs, loadDetail]);

  /**
   * Bajar al último mensaje: al abrir el chat siempre; después, solo si la
   * agente ya estaba abajo.
   *
   * Antes bajaba con cada mensaje nuevo. La agente leía hacia arriba para
   * entender el caso, entraba un mensaje de la clienta y la pantalla se le iba
   * al fondo: perdía el hilo y tenía que volver a subir a buscar dónde estaba.
   */
  const idAnterior = useRef<string | null>(null);
  useEffect(() => {
    const cambioDeChat = idAnterior.current !== (sel?.id ?? null);
    idAnterior.current = sel?.id ?? null;
    if (cambioDeChat) {
      alFinalRef.current = true;
      setHayNuevosAbajo(false);
      endRef.current?.scrollIntoView();
      return;
    }
    if (alFinalRef.current) endRef.current?.scrollIntoView({ behavior: 'smooth' });
    else if (sel?.messages.length) setHayNuevosAbajo(true);
  }, [sel?.id, sel?.messages.length]);

  /** Se considera «abajo» con holgura: el último mensaje puede asomar apenas. */
  function alDesplazar() {
    const c = scrollRef.current;
    if (!c) return;
    const abajo = c.scrollHeight - c.scrollTop - c.clientHeight < 120;
    alFinalRef.current = abajo;
    if (abajo) setHayNuevosAbajo(false);
  }

  function bajarAlFinal() {
    alFinalRef.current = true;
    setHayNuevosAbajo(false);
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  // Ctrl+V con una imagen en el portapapeles la trae aunque el cursor no esté
  // en el cuadro de texto: una acaba de recortar la pantalla y pega, sin tener
  // que apuntarle antes al campo ni guardar el archivo en el computador.
  useEffect(() => {
    document.addEventListener('paste', alPegar);
    return () => document.removeEventListener('paste', alPegar);
  });

  // Borrador que redacta Femma: cae en el cuadro de mensaje, listo para leer y
  // enviar. Nunca se manda solo — la agente decide.
  useEffect(() => {
    const recibir = (e: Event) => {
      const texto = (e as CustomEvent).detail;
      if (typeof texto !== 'string' || !texto.trim()) return;
      setMsg(texto);
      setArmed(null);
      requestAnimationFrame(() => {
        const caja = inputRef.current;
        if (!caja) return;
        caja.focus();
        caja.style.height = 'auto';
        caja.style.height = `${Math.min(caja.scrollHeight, 260)}px`;
        caja.setSelectionRange(texto.length, texto.length);
      });
    };
    window.addEventListener('femma:borrador', recibir);
    return () => window.removeEventListener('femma:borrador', recibir);
  }, []);

  // La URL de la vista previa se libera al salir: son fotos de varios MB que el
  // navegador retiene hasta que se le dice que ya no se usan.
  useEffect(() => () => { if (vistaPrevia) URL.revokeObjectURL(vistaPrevia); }, [vistaPrevia]);

  // Plantillas reales para el selector "/" (aprobadas primero).
  // Si la BD está vacía (arranque en frío), sincroniza con Meta y reintenta.
  useEffect(() => {
    const sortTpls = (list: Template[]) => [...list].sort((a, b) =>
      (a.status === 'APPROVED' ? 0 : 1) - (b.status === 'APPROVED' ? 0 : 1) || a.name.localeCompare(b.name));
    (async () => {
      let list = await api.get<Template[]>('/api/templates').catch(() => [] as Template[]);
      if (list.length === 0) {
        await api.post('/api/templates/sync', {}).catch(() => {});
        list = await api.get<Template[]>('/api/templates').catch(() => [] as Template[]);
      }
      setTemplates(sortTpls(list));
    })();
  }, []);

  const tplQuery = msg.startsWith('/') ? msg.slice(1).toLowerCase() : '';
  const filteredTpls = templates.filter(t =>
    !tplQuery || t.name.toLowerCase().includes(tplQuery) || t.content.toLowerCase().includes(tplQuery));

  // Reinicia el resaltado al abrir/filtrar y mantiene el activo a la vista
  useEffect(() => { setTplIndex(0); }, [tplQuery, showTpl]);
  useEffect(() => {
    pickerRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [tplIndex, showTpl]);

  function selectTemplate(t: Template) {
    if (!sel) return;
    // Sin aprobar no se arma siquiera. Meta las rechaza con «(#132001) Template
    // name does not exist in the translation», que no dice nada, y la agente se
    // quedaba creyendo que había respondido. El caso normal es mandar una
    // plantilla recién creada, minutos antes de que Meta la apruebe.
    if (t.status !== 'APPROVED') return;
    // Prepara los valores de las variables. {{1}} se pre-rellena con el nombre si es un saludo.
    const n = t.variables.length;
    const first = (sel.customer.name || '').trim().split(/\s+/)[0] || '';
    const isGreetingName = /(hola|¡)\s*\{\{\s*1\s*\}\}|\{\{\s*1\s*\}\}\s*,/i.test(t.content);
    const params = Array.from({ length: n }, (_, i) => (i === 0 && isGreetingName ? first : ''));
    setArmed({ tpl: t, params });
    setMsg('');
    setShowTpl(false);
    setTplIndex(0);
  }

  const pending  = convs.filter(isWaiting);
  // Las pestañas, la búsqueda y la línea las resuelve el servidor; aquí solo
  // queda el filtro de canal, que actúa sobre lo ya traído.
  /**
   * Memorizado, y no calculado al vuelo, porque de él dependen las tarjetas.
   * Sin filtro de canal es literalmente `convs`, así que su identidad se
   * mantiene; con filtro, `filter` devolvía un array nuevo EN CADA RENDER —o
   * sea, con cada tecla— y eso por sí solo anulaba toda la memorización de
   * abajo justo para quien estuviera filtrando por WhatsApp o Instagram.
   */
  const filtered = useMemo(() => {
    const pagina = filterCh ? convs.filter(c => c.channel === filterCh) : convs;
    if (!fijadasFuera.length) return pagina;
    // Las fijadas de fuera van arriba. El `Set` evita repetir una que ya
    // apareciera en la página: dos tarjetas con la misma clave desordenan la
    // lista entera en React.
    const enPagina = new Set(pagina.map(c => c.id));
    const arriba = fijadasFuera.filter(
      c => !enPagina.has(c.id) && (!filterCh || c.channel === filterCh),
    );
    return arriba.length ? [...arriba, ...pagina] : pagina;
  }, [convs, filterCh, fijadasFuera]);

  /**
   * Clientas que aparecen en más de una conversación (escriben a las dos
   * líneas). Se calcula UNA vez por lista, no una vez por tarjeta.
   *
   * Antes cada tarjeta recorría la lista entera para saberlo. Con 50
   * conversaciones apenas se notaba; con 200 —que es lo que hay cargado cuando
   * una agente lleva un rato bajando a los chats más viejos— son 40.000
   * comparaciones en cada dibujado, y el dibujado ocurre con cada tecla.
   */
  const clientasEnVariasConversaciones = useMemo(() => {
    const veces = new Map<string, number>();
    for (const c of convs) veces.set(c.customer.id, (veces.get(c.customer.id) ?? 0) + 1);
    const repetidas = new Set<string>();
    veces.forEach((n, id) => { if (n > 1) repetidas.add(id); });
    return repetidas;
  }, [convs]);

  // Con dos números de WhatsApp, quien los ve ambos (la admin) necesita saber
  // de cuál es cada conversación. A una agente restringida el endpoint le
  // devuelve una sola línea, así que ni el selector ni la etiqueta aparecen.
  const variasLineas = lineas.length > 1;

  async function cargarMas() {
    if (cargandoMas) return;
    setCargandoMas(true);
    paginaRef.current += 1;
    try { await loadConvs(); } finally { setCargandoMas(false); }
  }

  /**
   * Envía el mensaje sin hacer esperar a la agente.
   *
   * Antes el cuadro se bloqueaba hasta que volvía todo el viaje —guardar,
   * hablar con Meta, confirmar—, y con la conexión lenta eso son segundos por
   * mensaje. Ahora la burbuja aparece de una y el envío sigue por detrás: si
   * sale bien se reemplaza por la de verdad, y si falla se marca como fallida
   * con su motivo, que es exactamente lo que se vería de todos modos.
   *
   * Las plantillas NO van por aquí: llevan validaciones y variables, y
   * mostrarlas antes de que Meta las acepte engañaría más que ayudar.
   */
  async function send() {
    if (!sel) return;

    /**
     * Fuera de la ventana de 24 h solo salen plantillas. El respaldo de verdad
     * está en el servidor; esto evita el viaje entero y, sobre todo, evita que
     * la burbuja aparezca en pantalla como si el mensaje hubiera salido.
     * Las notas internas y los otros canales no pasan por esta regla.
     */
    if (ventanaCerrada && !armed) return;

    // Con una imagen pegada esperando, Enter y el botón de enviar la mandan a
    // ella —con lo escrito de pie de foto—, que es lo que una espera.
    if (pegada) { enviarPegada(); return; }

    const isTpl = !!armed;
    if (isTpl) return enviarPlantilla();
    if (!msg.trim()) return;

    const texto = msg;
    const citando = respondiendo;
    const interna = internal;
    const conv = sel.id;
    // Identificador provisional: distingue esta burbuja hasta que llegue la
    // real. El prefijo evita que se confunda con un id de la base.
    const provisional = `pendiente-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const enElAire: Message = {
      id: provisional,
      content: texto,
      direction: 'OUTBOUND',
      createdAt: new Date().toISOString(),
      isInternal: interna,
      status: 'SENT',
      replyToId: citando?.id ?? null,
      enviando: true,
    };

    // Se limpia todo de inmediato: la agente puede escribir el siguiente sin
    // esperar, que es el punto de todo esto.
    setSel(p => p && p.id === conv
      ? { ...p, messages: [...p.messages, enElAire] }
      : p);
    setMsg(''); setInternal(false); setShowTpl(false); setRespondiendo(null);
    if (inputRef.current) inputRef.current.style.height = '';
    alFinalRef.current = true;
    setHayNuevosAbajo(false);

    try {
      const m = await api.post<Message & { sendError?: string | null; resuelta?: boolean }>(
        `/api/conversations/${conv}/messages`,
        { content: texto, isInternal: interna, ...(citando && { respondeA: citando.id }) },
      );
      // La provisional se cambia por la real. Si el refresco ya trajo la de
      // verdad, se quita la provisional y no se duplica.
      setSel(p => {
        if (!p || p.id !== conv) return p;
        const yaEsta = p.messages.some(x => x.id === m.id);
        return {
          ...p,
          messages: yaEsta
            ? p.messages.filter(x => x.id !== provisional)
            : p.messages.map(x => (x.id === provisional ? m : x)),
        };
      });
      if (m.sendError) alert(`El mensaje se guardó pero WhatsApp lo rechazó:\n\n${m.sendError}`);
      // Respondida: sale de la bandeja sola, sin tener que marcarla. Vuelve
      // arriba y sin leer en cuanto la clienta escriba.
      if (m.resuelta) {
        setSel(p => p && p.id === conv ? { ...p, status: 'RESOLVED' } : p);
        setConvs(prev => prev.filter(c => c.id !== conv));
      }
      loadConvs();
    } catch (e) {
      const motivo = e instanceof Error ? e.message : 'No se pudo enviar el mensaje';

      /**
       * Antes de pintarlo en rojo, se comprueba si de verdad no salió.
       *
       * Que se caiga la petición no significa que el mensaje no llegara: la
       * ruta habla con Meta y, si tardaba, la plataforma mataba la función
       * DESPUÉS de que Meta lo aceptara. La agente veía «No enviado», lo
       * reescribía, y la clienta lo recibía dos veces. Ya se le puso tope de
       * tiempo a la ruta y a la llamada a Meta, pero un corte de red del lado
       * de la agente produce lo mismo, así que aquí se pregunta al servidor
       * qué pasó en vez de suponerlo.
       */
      const salio = await api.get<Conversation>(`/api/conversations/${conv}`)
        .then(c => c.messages.some(m =>
          m.direction === 'OUTBOUND' && m.content === texto && m.status !== 'FAILED' &&
          Date.now() - new Date(m.createdAt).getTime() < 3 * 60_000))
        .catch(() => false);

      if (salio) {
        setSel(p => p && p.id === conv
          ? { ...p, messages: p.messages.filter(x => x.id !== provisional) }
          : p);
        await loadDetail(conv);
        loadConvs();
        return;
      }

      // No salió: se deja marcada para poder reintentarla sin reescribirla.
      setSel(p => p && p.id === conv
        ? {
            ...p,
            messages: p.messages.map(x =>
              x.id === provisional ? { ...x, enviando: false, status: 'FAILED' as const, errorMotivo: motivo } : x),
          }
        : p);
    }
  }

  /** Las plantillas sí esperan: el servidor valida variables, enlace e imagen. */
  async function enviarPlantilla() {
    if (!sel || sending || enviando.current || !armed) return;
    const params = armed.params;
    if (params.some(p => !p.trim())) {
      alert('Completa todas las variables de la plantilla antes de enviar.');
      return;
    }
    enviando.current = true;
    setSending(true);
    try {
      const m = await api.post<Message & { sendError?: string | null; resuelta?: boolean }>(`/api/conversations/${sel.id}/messages`, {
        content: fillTemplate(armed.tpl.content, params),
        template: {
          name: armed.tpl.name,
          language: armed.tpl.language || 'es',
          params,
          // Solo viaja si la plantilla lleva botón de enlace; el servidor
          // rechaza el envío antes de llamar a Meta si falta.
          ...(armed.tpl.hasUrlButton && { urlButtonParam: enlaceBoton.trim() }),
        },
      });
      setSel(p => p && p.id === sel.id
        ? {
            ...p,
            status: m.resuelta ? 'RESOLVED' : p.status,
            messages: p.messages.some(x => x.id === m.id) ? p.messages : [...p.messages, m],
          }
        : p);
      if (m.resuelta) setConvs(prev => prev.filter(c => c.id !== sel.id));
      setMsg(''); setShowTpl(false); setArmed(null); setEnlaceBoton('');
      alFinalRef.current = true;
      setHayNuevosAbajo(false);
      if (m.sendError) alert(`El mensaje se guardó pero WhatsApp lo rechazó:\n\n${m.sendError}`);
      loadConvs();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo enviar la plantilla');
    } finally {
      enviando.current = false;
      setSending(false);
    }
  }

  /**
   * Cierra la conversación desde la lista, sin abrirla.
   *
   * Se quita de la vista de una vez en vez de esperar al refresco: con la lista
   * recargándose cada 8 s, ver la fila seguir ahí después de tocar el botón
   * hace dudar de si quedó, y se termina tocando dos veces.
   */
  async function resolverRapido(id: string) {
    if (resolviendo) return;
    setResolviendo(id);
    try {
      await api.patch(`/api/conversations/${id}`, { status: 'RESOLVED' });
      setConvs(p => p.filter(c => c.id !== id));
      if (selIdRef.current === id) setSel(null);
      loadConvs(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo marcar como atendida.');
    } finally {
      setResolviendo(null);
    }
  }

  /**
   * Vuelve a mandar un mensaje que WhatsApp rechazó.
   *
   * Se envía como uno nuevo en vez de resucitar el viejo: Meta ya le asignó su
   * suerte al original y no se puede reabrir. El fallido se queda a la vista
   * para que no parezca que el mensaje se mandó dos veces.
   */
  async function reintentar(m: Message) {
    if (!sel || sending) return;
    setSending(true);
    try {
      const nuevo = await api.post<Message & { sendError?: string | null }>(
        `/api/conversations/${sel.id}/messages`, { content: m.content });
      setSel(p => p && { ...p, messages: [...p.messages, nuevo] });
      if (nuevo.sendError) alert(`Volvió a fallar:\n\n${nuevo.sendError}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo reenviar.');
    } finally {
      setSending(false);
    }
  }

  // Misma razón que `selectConvRef`: se recrea en cada render y la lista de
  // mensajes no puede depender de ella si va a memorizarse.
  const reintentarRef = useRef(reintentar);
  reintentarRef.current = reintentar;

  function selectConv(conv: Conversation) {
    // Muestra de inmediato lo que hay en la lista y luego carga el detalle completo
    setRespondiendo(null);
    setSel(conv);
    loadDetail(conv.id);
  }

  /**
   * `selectConv` y `resolverRapido` se recrean en cada render. Ancladas en
   * referencias, la lista de tarjetas de abajo puede memorizarse sin tenerlas
   * como dependencia, y aun así llamar siempre a la versión más reciente.
   */
  const selectConvRef = useRef(selectConv);
  selectConvRef.current = selectConv;
  const resolverRapidoRef = useRef(resolverRapido);
  resolverRapidoRef.current = resolverRapido;

  // Identidad fija: si se recrearan en cada render, `memo` no evitaría nada.
  const abrirConversacion   = useCallback((c: Conversation) => selectConvRef.current(c), []);
  const resolverConversacion = useCallback((id: string) => resolverRapidoRef.current(id), []);

  /**
   * Fijar o soltar. Se pinta al instante y se manda por detrás: es un clic de
   * organización, y esperar el viaje a la base para ver el resultado lo vuelve
   * lento sin ganar nada. Si el servidor falla se deshace y se avisa.
   */
  const fijarConversacion = useCallback(async (c: Conversation) => {
    const fijada = !c.fijada;
    const marcar = (xs: Conversation[]) =>
      ordenarConFijadas(xs.map(x => (x.id === c.id ? { ...x, fijada } : x)));
    setConvs(marcar);
    setFijadasFuera(xs => (fijada ? marcar(xs) : xs.filter(x => x.id !== c.id)));
    setSel(p => (p && p.id === c.id ? { ...p, fijada } : p));
    try {
      if (fijada) await api.post(`/api/conversations/${c.id}/fijar`, {});
      else        await api.delete(`/api/conversations/${c.id}/fijar`);
    } catch {
      const deshacer = (xs: Conversation[]) =>
        ordenarConFijadas(xs.map(x => (x.id === c.id ? { ...x, fijada: !fijada } : x)));
      setConvs(deshacer);
      setSel(p => (p && p.id === c.id ? { ...p, fijada: !fijada } : p));
      alert('No se pudo cambiar el chat fijado.');
    }
  }, []);

  /**
   * La conversación abierta queda anotada en la dirección (?c=<id>), así que al
   * recargar se vuelve a ella en vez de caer en la primera de la lista.
   *
   * Va con `replaceState` y no con `push`: cada chat abierto no debe ser un
   * paso atrás del navegador —volver atrás tiene que sacar de la bandeja, no
   * recorrer las quince conversaciones que se miraron—. El mismo `?c=` que ya
   * usaban los enlaces desde una PQRS o desde el carrito de una clienta.
   */
  useEffect(() => {
    if (!sel?.id) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get('c') === sel.id) return;
    url.searchParams.set('c', sel.id);
    window.history.replaceState(null, '', url.toString());
  }, [sel?.id]);

  // ── Notas de voz ──────────────────────────────────────────────────────────
  // Se graba en ogg/opus cuando el navegador lo permite: es el único formato
  // con el que WhatsApp la muestra como nota de voz y no como adjunto.
  async function iniciarGrabacion() {
    if (!sel) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const tipo = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm']
        .find(t => MediaRecorder.isTypeSupported(t)) || '';
      const rec = new MediaRecorder(stream, tipo ? { mimeType: tipo } : undefined);
      const trozos: BlobPart[] = [];

      rec.ondataavailable = e => { if (e.data.size) trozos.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setGrabando(false);
        const cancelado = canceladoRef.current;
        canceladoRef.current = false;
        if (cancelado) return;

        const blob = new Blob(trozos, { type: tipo || 'audio/ogg' });
        if (blob.size < 1000) return; // pulsación accidental
        try {
          // Chrome graba WebM y WhatsApp no lo acepta: se reempaqueta a Ogg.
          await enviarAudio(await aOggOpus(blob));
        } catch (err) {
          alert(err instanceof Error ? err.message : 'No se pudo preparar la nota de voz.');
        }
      };

      recorderRef.current = rec;
      rec.start();
      setGrabando(true);
    } catch {
      alert('No se pudo acceder al micrófono. Revisa los permisos del navegador.');
    }
  }

  function detenerGrabacion() {
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  /** Descarta la grabación sin enviarla. */
  function cancelarGrabacion() {
    canceladoRef.current = true;
    recorderRef.current?.stop();
    recorderRef.current = null;
  }

  async function enviarAudio(blob: Blob) {
    const fd = new FormData();
    fd.append('audio', blob, 'nota-de-voz.ogg');
    await subirAdjunto(fd, 'No se pudo enviar la nota de voz.');
  }

  /** Foto, video o documento elegido con el clip. */
  /**
   * Inserta el emoji donde está el cursor, no al final.
   * Escribiendo «Hola , ya salió tu pedido» una quiere el emoji después de
   * «Hola», y pegarlo siempre al final obligaría a cortar y pegar a mano.
   */
  function insertarEmoji(emoji: string) {
    const caja = inputRef.current;
    if (!caja) { setMsg(m => m + emoji); return; }
    const ini = caja.selectionStart ?? caja.value.length;
    const fin = caja.selectionEnd ?? ini;
    setMsg(m => m.slice(0, ini) + emoji + m.slice(fin));
    requestAnimationFrame(() => {
      caja.focus();
      caja.setSelectionRange(ini + emoji.length, ini + emoji.length);
    });
  }

  /**
   * Imagen pegada con Ctrl+V (captura de pantalla, foto copiada de otro chat).
   *
   * No se envía de una: primero se muestra y la agente confirma. Un envío
   * inmediato no tiene vuelta atrás —le llega a la clienta al instante— y basta
   * un Ctrl+V equivocado para mandarle a una clienta la captura de otra.
   */
  function alPegar(e: ClipboardEvent) {
    if (!sel || ch.label !== 'WhatsApp' || internal || sending || grabando) return;
    const imagenes = Array.from(e.clipboardData?.items ?? [])
      .filter(it => it.kind === 'file' && it.type.startsWith('image/'));
    if (!imagenes.length) return;
    const archivo = imagenes[0].getAsFile();
    if (!archivo) return;
    e.preventDefault();
    // El portapapeles suele entregar el archivo sin nombre; WhatsApp necesita
    // uno con extensión para saber qué está recibiendo.
    const ext = (archivo.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
    const conNombre = new File([archivo], archivo.name || `imagen-pegada.${ext}`, { type: archivo.type });
    setPegada(conNombre);
    setVistaPrevia(URL.createObjectURL(conNombre));
  }

  function descartarPegada() {
    if (vistaPrevia) URL.revokeObjectURL(vistaPrevia);
    setPegada(null);
    setVistaPrevia(null);
  }

  async function enviarPegada() {
    if (!pegada) return;
    const archivo = pegada;
    descartarPegada();
    await enviarArchivo(archivo);
  }

  async function enviarArchivo(file: File) {
    // El servidor valida lo mismo; aquí es solo para avisar de una vez, sin
    // gastar la subida.
    if (file.size > 16 * 1024 * 1024) {
      alert('El archivo pesa más de 16 MB.');
      return;
    }
    const motivo = revisarTipoAdjunto(file.type);
    if (motivo) {
      alert(motivo);
      return;
    }
    const fd = new FormData();
    fd.append('archivo', file, file.name);
    // Lo que la agente hubiera escrito se manda como pie de foto.
    if (msg.trim()) fd.append('caption', msg.trim());
    await subirAdjunto(fd, 'No se pudo enviar el archivo.');
    setMsg('');
  }

  async function subirAdjunto(fd: FormData, errorPorDefecto: string) {
    if (!sel) return;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${sel.id}/adjunto`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('fem_token') ?? ''}` },
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.sendError || err.error || errorPorDefecto);
      }
      alFinalRef.current = true;
      setHayNuevosAbajo(false);
      await loadDetail(sel.id);
      await loadConvs();
    } catch {
      alert(errorPorDefecto);
    } finally {
      setSending(false);
    }
  }

  /**
   * Confirma el pedido desde el CRM, sin entrar a Mastershop.
   * Ojo: la confirmación queda en el CRM — su API no deja escribir el estado.
   */
  async function confirmarPedido(orderId: string) {
    if (confirmando || !sel) return;
    setConfirmando(true);
    try {
      await api.post(`/api/orders/${orderId}/confirmar`, {});
      await loadDetail(sel.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo confirmar el pedido.');
    } finally {
      setConfirmando(false);
    }
  }

  async function markResolved() {
    if (!sel) return;
    try {
      await api.patch(`/api/conversations/${sel.id}`, { status: 'RESOLVED' });
      setSel(p => p ? { ...p, status: 'RESOLVED' } : p);
      // Desaparece de la lista al instante, sin esperar al refresco: si sigue
      // a la vista, la agente no sabe si el clic tuvo efecto y la vuelve a
      // abrir. `loadConvs(true)` reconsulta todas las tandas abiertas —con
      // loadConvs() a secas se pediría solo la última y se duplicaría—.
      const resuelta = sel.id;
      setConvs(prev => prev.filter(c => c.id !== resuelta));
      loadConvs(true);
    } catch { /* sin permisos o error de red */ }
  }

  const ch = sel ? (CH[sel.channel] ?? CH.WHATSAPP) : CH.WHATSAPP;

  /**
   * La ventana de servicio de WhatsApp: 24 h desde el último mensaje de la
   * clienta. Dentro de ella se puede escribir libremente; fuera, solo
   * plantillas aprobadas tal cual las aprobó Meta, sin tocarles una coma.
   */
  const ultimaEntrante = sel?.messages.filter(m => m.direction === 'INBOUND').at(-1);
  const dentroDeVentana = !!ultimaEntrante &&
    Date.now() - new Date(ultimaEntrante.createdAt).getTime() < 24 * 3600_000;

  /**
   * Cuándo NO se puede mandar texto libre. Las notas internas quedan fuera
   * —no salen a WhatsApp— y los otros canales no tienen esta regla.
   */
  const ventanaCerrada = !!sel && sel.channel === 'WHATSAPP' && !dentroDeVentana && !internal;

  /**
   * Pasa la plantilla ya rellena al cuadro de escribir, para retocarla.
   * Deja de ser un envío de plantilla y se manda como mensaje normal, que es lo
   * que permite añadirle o quitarle algo. Solo tiene sentido dentro de la
   * ventana: fuera, Meta rechaza cualquier texto que no sea la plantilla exacta.
   */
  function editarPlantilla() {
    if (!armed) return;
    const cuerpo = fillTemplate(armed.tpl.content, armed.params);
    // El enlace del botón viaja dentro del texto: como mensaje normal no hay
    // botón donde ponerlo, y sin él la clienta se queda sin el link.
    const conEnlace = armed.tpl.hasUrlButton && enlaceBoton.trim()
      ? `${cuerpo}\n\n${enlaceBoton.trim()}`
      : cuerpo;
    setMsg(conEnlace);
    setArmed(null);
    setEnlaceBoton('');
    setShowTpl(false);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const n = inputRef.current?.value.length ?? 0;
      inputRef.current?.setSelectionRange(n, n);
    });
  }
  const selPriority = sel ? waitPriority(sel) : 'normal';

  // Lo que Femma necesita saber para ayudar con la conversación abierta. Se
  // publica en un atributo del DOM en vez de por props o contexto de React:
  // así el widget vive en el layout y no hace falta cablear nada entre ambos.
  const contextoFemma = sel
    ? [
        `La agente tiene abierta una conversación de ${sel.channel} con ${sel.customer.name} (${mostrarTelefono(sel.customer.phone)}).`,
        sel.customer.city ? `Ciudad: ${sel.customer.city}.` : '',
        sel.customer.totalOrders ? `Lleva ${sel.customer.totalOrders} pedido(s).` : '',
        sel.messages.length
          ? `Últimos mensajes:\n${sel.messages.slice(-8)
              .map(m => `${m.direction === 'INBOUND' ? 'Clienta' : 'Nosotras'}: ${m.content}`)
              .join('\n')}`
          : '',
      ].filter(Boolean).join('\n')
    : '';


  /**
   * Las tarjetas de la izquierda se calculan aparte y solo se rehacen cuando
   * cambia algo que ellas muestran.
   *
   * Cada tarjeta son ~140 líneas de JSX. Con 50 conversaciones eso ya es
   * bastante; cuando una agente baja a los chats más viejos y carga más
   * tandas son 150 o 200 tarjetas, o sea ~28.000 líneas que el navegador
   * rehacía enteras en CADA render. Y como el texto que se escribe vive en
   * este mismo componente, cada tecla provocaba un render. De ahí que la
   * bandeja fuera poniéndose más lenta cuanto más abajo se trabajaba.
   *
   * Memorizado, teclear no las toca, y el refresco de cada ocho segundos
   * tampoco cuando no ha cambiado nada. Se ve y se comporta igual.
   *
   * Depende de `selId` y no de `sel` a propósito: la tarjeta solo necesita
   * saber CUÁL está abierta. Con `sel` entero, cada mensaje que entrara en la
   * conversación abierta rehacía las 200 tarjetas sin motivo.
   */
  const selId = sel?.id ?? null;
  const tarjetasConversaciones = useMemo(
    () => filtered.map(conv => (
      <TarjetaConversacion
        key={conv.id}
        conv={conv}
        isAct={selId === conv.id}
        variasLineas={variasLineas}
        lineaFiltrada={linea}
        minuto={minuto}
        resolviendoEsta={resolviendo === conv.id}
        enVariasConversaciones={clientasEnVariasConversaciones.has(conv.customer.id)}
        onAbrir={abrirConversacion}
        onResolver={resolverConversacion}
        onFijar={fijarConversacion}
      />
    )),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, selId, variasLineas, linea, minuto, resolviendo, clientasEnVariasConversaciones, fijarConversacion],
  );


  /**
   * Las burbujas del chat abierto, calculadas aparte.
   *
   * Vivían sueltas dentro del render de esta pantalla, que es un único
   * componente con casi cuarenta estados —incluido el texto que la agente está
   * escribiendo—. Cada TECLA llamaba a `setMsg` y con ello se rehacían todas
   * las burbujas del chat, audios e imágenes incluidos. Ese era el tirón que
   * se sentía al escribir.
   *
   * Ahora solo se rehacen cuando cambia el chat o el estado de envío. Lo que
   * se ve y lo que se manda es exactamente igual.
   */
  const listaMensajes = useMemo(
    () => (sel
      ? (
      sel.messages.map((m, i) => {
        const isOut = m.direction === 'OUTBOUND';
        const showDate = i === 0 || new Date(m.createdAt).toDateString() !== new Date(sel.messages[i-1].createdAt).toDateString();
        return (
          <div key={m.id}>
            {showDate && (
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-brand-100" />
                <span className="text-xs text-ink-muted font-medium px-3 py-1 bg-white border border-brand-100 rounded-full">
                  {new Date(m.createdAt).toLocaleDateString('es-CO', { weekday:'short', day:'2-digit', month:'short' })}
                </span>
                <div className="flex-1 h-px bg-brand-100" />
              </div>
            )}
            {m.isInternal ? (
              <div className="flex justify-center">
                <div className="bubble-internal">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Lock className="w-3 h-3" />
                    <span className="font-semibold text-xs">Nota interna{m.sentBy ? ` · ${m.sentBy.name}` : ''}</span>
                  </div>
                  {m.content}
                </div>
              </div>
            ) : (
              <div className={cn('flex items-end gap-3', isOut ? 'justify-end' : 'justify-start')}>
                {!isOut && (
                  <div className="w-8 h-8 rounded-xl bg-brand-100 text-ink-soft flex items-center justify-center text-xs font-bold shrink-0">
                    {initials(sel.customer.name)}
                  </div>
                )}
                <div className={cn(
                  'flex flex-col max-w-[68%]',
                  isOut ? 'items-end' : 'items-start'
                )}>
                  {isOut && m.sentBy && (
                    <p className="text-xs text-ink-muted mb-1 pr-1">{m.sentBy.name}</p>
                  )}
                  {/* Lo que se está citando, encima y recortado, como en
                      WhatsApp: sirve para situarse, no para releerlo. */}
                  {m.replyToId && (() => {
                    const citado = sel.messages.find(x => x.id === m.replyToId);
                    if (!citado) return null;
                    return (
                      <div className={cn(
                        'mb-1 px-2.5 py-1.5 rounded-lg border-l-[3px] text-[11px] leading-snug max-w-full',
                        isOut ? 'bg-white/15 border-white/50 text-white/80'
                              : 'bg-brand-50 border-[#ED5340] text-[#8C6B66]',
                      )}>
                        <span className="font-bold block">
                          {citado.direction === 'OUTBOUND' ? 'Tú' : sel.customer.name}
                        </span>
                        <span className="line-clamp-2">{citado.content}</span>
                      </div>
                    );
                  })()}

                  <div className="relative group/msg">
                    {m.media
                      ? <MediaBubble media={m.media} caption={m.content} isOut={isOut} />
                      : <div className={isOut ? 'bubble-out' : 'bubble-in'}><MessageText text={m.content} /></div>}

                    {/* Responder a este mensaje. Solo por WhatsApp y solo si
                        ya salió: Meta cita por el wamid, y una nota interna
                        o un envío fallido no tienen. */}
                    {ch.label === 'WhatsApp' && !m.isInternal && m.status !== 'FAILED' && (
                      <button
                        onClick={() => {
                          setRespondiendo(m);
                          requestAnimationFrame(() => inputRef.current?.focus());
                        }}
                        title="Responder a este mensaje"
                        className={cn(
                          'absolute top-1 w-6 h-6 rounded-full bg-white shadow-md border border-brand-100',
                          'flex items-center justify-center text-ink-muted hover:text-[#D33A22]',
                          'opacity-0 group-hover/msg:opacity-100 focus:opacity-100 transition-opacity',
                          isOut ? '-left-7' : '-right-7',
                        )}
                      >
                        <Reply className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    {/* Hora exacta de Bogotá, no «hace 1h»: al leer una
                        conversación hace falta saber a qué hora pasó cada
                        cosa —es la hora que la clienta menciona y la que
                        aparece en la guía de la transportadora—. */}
                    <p className="text-xs text-ink-muted" title={fechaHoraBogota(m.createdAt)}>
                      {fechaHoraBogota(m.createdAt)}
                    </p>
                    {isOut && m.enviando && (
                      <span className="flex items-center gap-1 text-xs text-ink-muted">
                        <Loader2 className="w-3 h-3 animate-spin" /> enviando
                      </span>
                    )}
                    {isOut && m.status === 'READ'      && <CheckCheck className="w-3.5 h-3.5 text-[#D33A22]" />}
                    {isOut && m.status === 'DELIVERED' && <CheckCheck className="w-3.5 h-3.5 text-ink-muted" />}
                    {/* El motivo que dio WhatsApp, si lo mandó: «No enviado»
                        a secas no dice si hay que reintentar, escribir por
                        plantilla o corregir el número. */}
                    {isOut && m.status === 'FAILED'    && (
                      <span className="flex items-center gap-1 text-xs font-semibold text-rose-500"
                            title={m.errorMotivo ?? undefined}>
                        <AlertCircle className="w-3.5 h-3.5" />
                        No enviado{m.errorMotivo ? ` · ${m.errorMotivo}` : ''}
                        {/* Reintentar sin volver a escribirlo: varios de
                            estos rebotan por un tropiezo pasajero, y copiar
                            a mano un mensaje largo es perderlo dos veces. */}
                        <button
                          onClick={() => reintentarRef.current(m)}
                          disabled={sending}
                          className="ml-1 underline underline-offset-2 hover:text-rose-700 disabled:opacity-40"
                        >
                          reintentar
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })
        )
      : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, sending],
  );

  return (
    <div className="flex h-full bg-[#FFF8F7]" data-femma-contexto={contextoFemma || undefined}>

      {/* ══════════════════════════════════════════════════════════════════════
          LEFT PANEL — Lista de conversaciones
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="w-[300px] shrink-0 flex flex-col bg-white border-r border-[#F7E4E2]">

        {/* Header */}
        <div className="px-4 pt-4 pb-3 border-b border-[#F7E4E2] space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-extrabold text-[16px] text-[#2E1614]">Bandeja</h2>
            <div className="flex items-center gap-2">
              {(totalPendientes ?? pending.length) > 0 && (
                <span className="bg-rose-500 text-white text-[10px] font-black px-2.5 py-1 rounded-full">
                  {totalPendientes ?? pending.length} sin responder
                </span>
              )}
              <button
                onClick={() => setNuevoChat(true)}
                title="Escribirle a alguien que no ha escrito"
                className="p-1.5 rounded-lg bg-pepper-600 hover:bg-pepper-700 text-white transition-colors"
              >
                <MessageSquarePlus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#C6A5A2]" />
            <input
              placeholder="Buscar por nombre, teléfono o correo…"
              value={search}
              onChange={e => { setSearch(e.target.value); setTab('all'); }}
              className="w-full pl-9 pr-3 py-2.5 text-[12px] bg-[#FFF5F5] border border-[#F7E4E2] rounded-xl
                         focus:outline-none focus:ring-2 focus:ring-pepper-500/20 focus:border-pepper-600
                         text-[#2E1614] placeholder:text-[#C6A5A2] transition-all"
            />
          </div>

          {/* Tabs.
              «No llegaron» son las conversaciones cuyo último mensaje WhatsApp
              rechazó. Antes solo se veía entrando al chat de una en una, y por
              eso 180 clientas se quedaron sin su mensaje sin que nadie lo
              supiera. En rojo cuando hay alguna: es trabajo pendiente, no un
              filtro más. */}
          <div className="flex rounded-xl bg-[#FFF8F7] p-1 gap-1">
            {([
              ['pending',  `Sin resp. (${totalPendientes ?? pending.length})`],
              ['all',      'Abiertas'],
              ['failed',   totalNoEntregados ? `No llegaron (${totalNoEntregados})` : 'No llegaron'],
              ['resolved', 'Resueltas'],
            ] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                className={cn('flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all',
                  tab === k ? 'bg-white text-[#2E1614] shadow-sm'
                    : k === 'failed' && totalNoEntregados
                      ? 'text-rose-600 hover:text-rose-700'
                      : 'text-[#8C6B66] hover:text-[#2E1614]')}>
                {l}
              </button>
            ))}
          </div>

          {/* Selector de línea de WhatsApp. Solo aparece si hay más de una:
              para Lina y Luciana, que ven una sola, sería ruido. */}
          {variasLineas && (
            <div className="flex gap-1.5 mb-2">
              <button onClick={() => setLinea('')}
                className={cn('px-2.5 py-1.5 rounded-xl text-[10px] font-bold border transition-all shrink-0',
                  !linea ? 'bg-[#2E1614] text-white border-[#2E1614]'
                         : 'bg-white text-[#8C6B66] border-[#F7E4E2] hover:border-[#C6A5A2]')}>
                Todas
              </button>
              {lineas.map(l => {
                const activa = linea === l.id;
                return (
                  <button key={l.id} onClick={() => setLinea(activa ? '' : l.id)}
                    title={l.telefono ?? undefined}
                    className={cn('flex-1 min-w-0 px-2 py-1.5 rounded-xl text-[10px] font-bold border transition-all flex items-center justify-center gap-1',
                      activa ? 'bg-violet-600 text-white border-violet-600'
                             : 'bg-white text-[#8C6B66] border-[#F7E4E2] hover:border-[#C6A5A2]')}>
                    <span className="truncate">{l.nombre}</span>
                    {l.sinLeer > 0 && (
                      <span className={cn('shrink-0 px-1 rounded-full text-[9px] tabular-nums',
                        activa ? 'bg-white/25' : 'bg-pepper-600 text-white')}>
                        {l.sinLeer > 99 ? '99+' : l.sinLeer}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Channel pills */}
          <div className="flex gap-1.5">
            <button onClick={() => setFilterCh('')}
              className={cn('flex-1 py-1.5 rounded-xl text-[10px] font-bold border transition-all',
                !filterCh ? 'bg-[#2E1614] text-white border-[#2E1614]' : 'bg-white text-[#8C6B66] border-[#F7E4E2] hover:border-[#C6A5A2]')}>
              Todos
            </button>
            {(['WHATSAPP','INSTAGRAM','FACEBOOK'] as const).map(c => {
              const cfg = CH[c]; const active = filterCh === c;
              return (
                <button key={c} onClick={() => setFilterCh(active ? '' : c)}
                  className={cn('flex-1 py-1.5 rounded-xl text-[10px] font-bold border transition-all flex items-center justify-center gap-1',
                    active ? cfg.pill : 'bg-white border-[#F7E4E2] text-[#8C6B66] hover:border-[#C6A5A2]')}>
                  <cfg.icon className="w-3 h-3" />{cfg.short}
                </button>
              );
            })}
          </div>
        </div>

        {/* Conversation list */}
        <div className="relative flex-1 min-h-0">
          {/* Lo que llegó mientras la agente trabajaba más abajo. Sin este
              aviso, congelar el orden escondería conversaciones nuevas. */}
          {nuevasEsperando > 0 && (
            <button
              onClick={ponerAlDia}
              className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5
                         bg-[#ED5340] hover:bg-[#D33A22] text-white text-[11px] font-bold
                         px-3 py-1.5 rounded-full shadow-[0_6px_18px_rgba(237,83,64,0.35)]
                         transition-colors active:scale-95 whitespace-nowrap"
            >
              <ArrowUp className="w-3 h-3" />
              {nuevasEsperando === 1
                ? '1 conversación nueva'
                : `${nuevasEsperando} conversaciones nuevas`}
            </button>
          )}
        <div ref={listaRef} onScroll={() => { if (!listaDesplazada() && frescasRef.current) ponerAlDia(); }}
             className="h-full overflow-y-auto">
          {tarjetasConversaciones}
          {filtered.length === 0 && (
            <div className="text-center py-16">
              <p className="text-[#C6A5A2] text-sm font-medium">
                {loading ? 'Cargando conversaciones…' : 'Sin conversaciones'}
              </p>
            </div>
          )}

          {/* Antes la lista se cortaba en seco tras las primeras conversaciones
              y no había forma de llegar al resto: con miles en cola, bajar no
              traía nada más. */}
          {hayMas && !loading && (
            <button
              onClick={cargarMas}
              disabled={cargandoMas}
              className="w-full py-3 text-[12px] font-bold text-pepper-600 hover:bg-brand-50 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {cargandoMas
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando…</>
                : `Ver más conversaciones (${filtered.length} cargadas)`}
            </button>
          )}
        </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          CENTER — Chat
      ══════════════════════════════════════════════════════════════════════ */}
      {!sel ? (
        <div className="flex-1 flex items-center justify-center bg-white">
          <div className="text-center">
            <MessageSquare className="w-10 h-10 text-[#F7E4E2] mx-auto mb-3" />
            <p className="text-[#C6A5A2] text-sm font-medium">
              {loading ? 'Cargando…' : 'Cuando un cliente te escriba, la conversación aparecerá aquí'}
            </p>
          </div>
        </div>
      ) : (
      <div className="flex-1 flex flex-col min-w-0 bg-white">

        {/* Chat header — dos filas, y la razón es de ancho.

            Con todo en una sola, el nombre, el teléfono y los dos botones se
            pelean los mismos píxeles. En un portátil el resultado era que el
            número salía cortado —«+57 316 727…»— o directamente tapado por el
            botón de PQRS: la información estaba, pero no se podía leer, que
            para quien atiende es lo mismo que no tenerla.

            El contacto baja a su propia fila, que ocupa el ancho entero. Cuesta
            unos píxeles de alto, y a cambio el teléfono se ve completo a
            cualquier tamaño de ventana — que es el dato con el que se busca a
            una clienta y no puede depender de eso. */}
        <div className="bg-white border-b border-brand-100 px-5 py-3 flex flex-col gap-1 shrink-0">

          {/* Fila 1 · quién es y qué se puede hacer */}
          <div className="flex items-center gap-3 min-w-0">
            <ConvAvatar conv={sel} size="md" />

            {/* `min-w-0` y `overflow-hidden` en todos los niveles: sin ellos un
                nombre largo no encoge, empuja, y lo que sobra se pinta encima
                de los botones en vez de recortarse. */}
            <div className="flex items-center gap-2 min-w-0 overflow-hidden flex-1">
              <p className="font-semibold text-base text-ink truncate">{sel.customer.name}</p>
              {selPriority === 'urgent' && (
                <span className="flex items-center gap-1 text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-lg shrink-0">
                  <AlertCircle className="w-3 h-3" /> Urgente
                </span>
              )}
              {selPriority === 'high' && (
                <span className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg shrink-0">
                  Alta prioridad
                </span>
              )}
              {/* Las etiquetas viven aquí y no en la barra derecha: al lado del
                  nombre se leen en contexto.
                  Solo a partir de pantalla ancha, y esto importa: en flex, lo
                  que no encoge obliga al vecino a encogerse. Con las etiquetas
                  presentes el nombre se comía todo el recorte y quedaba en
                  «An…», que no identifica a nadie. Se esconden ellas, que es
                  información de apoyo, y el nombre respira. */}
              <span className="hidden xl:flex items-center gap-2 min-w-0">
                {sel.tags.map(t => (
                  <span key={t} className="text-[11px] bg-brand-50 text-ink-soft border border-brand-100 px-2 py-0.5 rounded-lg font-semibold truncate max-w-[110px]">
                    {t}
                  </span>
                ))}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Si la clienta reporta un problema, la agente lo radica sin
                  salir del chat: la PQRS nace ya ligada a ella y a este hilo. */}
              <button
                onClick={() => setPqrsAbierta(true)}
                title="Radicar una petición, queja, reclamo o sugerencia de esta clienta"
                className="flex items-center gap-1.5 text-[12px] font-bold px-3 py-2 rounded-xl transition-all whitespace-nowrap bg-white border border-brand-100 text-ink-soft hover:bg-brand-50 hover:text-ink"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-pepper-600" />
                PQRS
              </button>
              {/* Cerrar la conversación es la acción más repetida del día: va
                  aquí arriba, a un clic, y no enterrada en la barra lateral. */}
              <button
                onClick={markResolved}
                disabled={sel.status === 'RESOLVED'}
                title={sel.status === 'RESOLVED' ? 'Ya está resuelta' : 'Marcar como resuelta'}
                className={cn(
                  'flex items-center gap-1.5 text-[12px] font-bold px-3 py-2 rounded-xl transition-all whitespace-nowrap',
                  sel.status === 'RESOLVED'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm hover:shadow active:scale-[0.98]',
                )}
              >
                <CheckCheck className="w-3.5 h-3.5" />
                {sel.status === 'RESOLVED' ? 'Resuelta' : 'Resolver'}
              </button>
            </div>
          </div>

          {/* Fila 2 · cómo contactarla. A todo lo ancho y sin competir con nada:
              el teléfono va primero y no encoge, así que si algo se recorta es
              la ciudad o quién atiende, nunca el número. */}
          <div className="flex items-center gap-2 min-w-0 overflow-hidden whitespace-nowrap pl-[52px]">
            <span className="text-sm text-ink-muted shrink-0 tabular-nums">{mostrarTelefono(sel.customer.phone)}</span>
            {/* El correo, al lado del teléfono: es dato de contacto y se
                necesita a mano para buscar el pedido o mandar la factura. */}
            <CorreoClienta
              customer={sel.customer}
              onGuardado={() => { loadDetail(sel.id); loadConvs(true); }}
            />
            {sel.customer.city && <span className="text-sm text-ink-muted truncate">· {sel.customer.city}</span>}
            {sel.agent && <span className="text-sm text-[#D33A22] font-medium truncate">· Atiende {sel.agent.name}</span>}
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} onScroll={alDesplazar}
             className="relative flex-1 overflow-y-auto px-6 py-5 space-y-3 bg-[#FFF8F7]">
          {!!sel.anteriores && sel.anteriores > 0 && (
            <p className="text-center text-[11px] text-ink-muted py-2">
              Hay {sel.anteriores.toLocaleString('es-CO')} mensajes más antiguos que no se muestran
            </p>
          )}
          {listaMensajes}
          {isWaiting(sel) && esperandoDesde(sel) && (
            <div className="flex justify-center">
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 text-amber-700 text-[11px] font-bold px-4 py-2.5 rounded-full shadow-sm">
                <Clock className="w-3.5 h-3.5" />
                Esperando tu respuesta · <WaitBadge since={esperandoDesde(sel)!} />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Aviso de que llegó algo mientras leía más arriba: sin él, quedarse
            arriba significaría no enterarse de que la clienta escribió. */}
        {hayNuevosAbajo && (
          <div className="relative">
            <button
              onClick={bajarAlFinal}
              className="absolute -top-14 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2
                         bg-[#ED5340] hover:bg-[#D33A22] text-white text-[12px] font-bold
                         px-4 py-2 rounded-full shadow-[0_6px_20px_rgba(237,83,64,0.35)]
                         transition-colors active:scale-95"
            >
              <ArrowDown className="w-3.5 h-3.5" /> Mensajes nuevos
            </button>
          </div>
        )}

        {/* Input */}
        <div className="bg-white border-t border-brand-100 p-4 shrink-0">
          {showTpl && !armed && (
            <div className="mb-3 bg-white border border-brand-100 rounded-xl overflow-hidden shadow-lg">
              <div className="flex items-center justify-between px-4 py-2 border-b border-brand-100 bg-brand-50">
                <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide">
                  Plantillas {tplQuery && <span className="text-ink-muted normal-case">· "{tplQuery}"</span>}
                </p>
                <p className="text-[10px] text-ink-muted font-medium hidden sm:block">
                  ↑↓ o Tab para moverte · Enter para elegir · Esc para cerrar
                </p>
              </div>
              <div ref={pickerRef} className="max-h-72 overflow-y-auto">
                {filteredTpls.length === 0 ? (
                  <p className="text-sm text-ink-muted px-4 py-6 text-center">
                    {templates.length === 0 ? 'No hay plantillas todavía' : 'Ninguna plantilla coincide'}
                  </p>
                ) : filteredTpls.map((t, i) => {
                  const st = TPL_STATUS[t.status] ?? TPL_STATUS.PENDING;
                  const active = i === tplIndex;
                  // Solo las aprobadas se pueden mandar. Se siguen viendo —para
                  // que no parezca que la plantilla se perdió— pero apagadas y
                  // diciendo por qué, en vez de dejar que salgan y reboten.
                  const enviable = t.status === 'APPROVED';
                  return (
                    <button
                      key={t.id}
                      data-active={active}
                      disabled={!enviable}
                      title={enviable ? undefined
                        : t.status === 'REJECTED'
                          ? 'Meta rechazó esta plantilla: no se puede enviar.'
                          : 'Meta todavía no la aprueba: no se puede enviar.'}
                      onMouseEnter={() => setTplIndex(i)}
                      onClick={() => selectTemplate(t)}
                      className={cn('w-full flex items-start gap-3 px-4 py-2.5 text-left border-b border-brand-100 last:border-0 transition-colors',
                        !enviable && 'opacity-50 cursor-not-allowed',
                        active ? 'bg-brand-50' : enviable && 'hover:bg-brand-50')}
                    >
                      <span className={cn('w-2 h-2 rounded-full shrink-0 mt-1.5', st.dot)} title={st.label} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <code className="text-xs font-bold text-[#8C6B66] font-mono truncate">/{t.name}</code>
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-brand-50 text-ink-muted shrink-0">
                            {TPL_CATEGORY[t.category] ?? t.category}
                          </span>
                          {!enviable && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600 border border-rose-100 shrink-0">
                              {t.status === 'REJECTED' ? 'rechazada' : 'en revisión'}
                            </span>
                          )}
                          {t.variables.length > 0 && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100 shrink-0">
                              {t.variables.length} {t.variables.length === 1 ? 'variable' : 'variables'}
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] text-ink-muted truncate mt-0.5">{t.content}</p>
                      </div>
                      <ChevronRight className={cn('w-4 h-4 ml-auto shrink-0 mt-1', active ? "text-white" : "text-ink-muted")} />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {internal && (
            <div className="mb-3 flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-xl font-medium">
              <Lock className="w-3.5 h-3.5" /> Nota interna — solo visible para el equipo
            </div>
          )}
          {armed ? (
            <div className="bg-white border border-brand-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#8C6B66]">Plantilla</span>
                  <code className="text-xs font-mono font-bold text-[#8C6B66] bg-brand-50 border border-brand-200 px-2 py-0.5 rounded">/{armed.tpl.name}</code>
                  <span className={cn('w-2 h-2 rounded-full', (TPL_STATUS[armed.tpl.status] ?? TPL_STATUS.PENDING).dot)}
                    title={(TPL_STATUS[armed.tpl.status] ?? TPL_STATUS.PENDING).label} />
                </div>
                <button onClick={() => { setArmed(null); setEnlaceBoton(''); }} className="text-xs text-ink-muted hover:text-ink-soft flex items-center gap-1">
                  <X className="w-3.5 h-3.5" /> Cancelar
                </button>
              </div>

              {armed.tpl.variables.length > 0 && (
                <div className="space-y-2 mb-3">
                  <p className="text-[11px] font-medium text-ink-muted">Completa los datos:</p>
                  {armed.params.map((val, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <code className="text-[11px] bg-amber-50 text-amber-700 border border-amber-100 px-1.5 py-1 rounded shrink-0">{`{{${i + 1}}}`}</code>
                      <input
                        autoFocus={i === armed.params.findIndex(p => !p.trim())}
                        value={val}
                        onChange={e => setArmed(a => a ? { ...a, params: a.params.map((p, idx) => idx === i ? e.target.value : p) } : a)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
                        placeholder={`Valor para la variable ${i + 1}`}
                        className="flex-1 h-8 text-sm border border-brand-100 rounded-lg px-2.5 focus:outline-none focus:ring-1 focus:ring-pepper-500 focus:border-pepper-600"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Plantillas con botón de enlace: Meta exige el link en cada
                  envío. Sin este campo el envío se rechazaba con un 132012. */}
              {armed.tpl.hasUrlButton && (
                <div className="mb-3">
                  <p className="text-[11px] font-medium text-ink-muted mb-1.5">
                    Enlace del botón <span className="text-rose-500">·  obligatorio</span>
                  </p>
                  <input
                    value={enlaceBoton}
                    onChange={e => setEnlaceBoton(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
                    placeholder="https://checkoutfem.com/r/…  (pega el link de la clienta)"
                    className="w-full h-8 text-sm border border-brand-100 rounded-lg px-2.5 focus:outline-none focus:ring-1 focus:ring-pepper-500 focus:border-pepper-600"
                  />
                </div>
              )}

              {armed.tpl.headerFormat === 'IMAGE' && (
                <p className="text-[11px] text-ink-muted mb-2">
                  Esta plantilla lleva imagen de cabecera; se adjunta sola.
                </p>
              )}

              <div className="bg-[#E7FFDB] rounded-lg p-3 mb-3">
                <p className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{fillTemplate(armed.tpl.content, armed.params)}</p>
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-ink-muted leading-snug">
                  {dentroDeVentana
                    ? 'La clienta escribió hace menos de 24 h: puedes retocar el texto antes de enviarlo.'
                    : 'La clienta no escribe hace más de 24 h: WhatsApp solo acepta la plantilla tal cual, sin retoques. Cuando ella responda podrás editar libremente.'}
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Siempre a la vista, apagado cuando no se puede.
                      Antes se escondía fuera de la ventana de 24 h y desde el
                      otro lado eso no se distingue de que el botón no exista:
                      una agente reportó que «no le aparecía» cuando en realidad
                      estaba en chats con la ventana cerrada. Fuera del plazo
                      Meta exige la plantilla palabra por palabra, así que
                      editarla es imposible — pero hay que decirlo, no
                      desaparecer. */}
                  <button
                    onClick={editarPlantilla}
                    disabled={!dentroDeVentana}
                    title={dentroDeVentana
                      ? 'Pasarla al cuadro de escribir para añadirle o quitarle algo'
                      : 'Solo se puede editar si la clienta escribió en las últimas 24 h. Fuera de ese plazo WhatsApp exige la plantilla tal cual fue aprobada.'}
                    className={cn(
                      'px-3 h-9 border rounded-xl text-sm font-semibold flex items-center gap-1.5 transition-colors',
                      dentroDeVentana
                        ? 'border-brand-200 hover:bg-brand-50 text-ink'
                        : 'border-brand-100 text-ink-muted opacity-50 cursor-not-allowed',
                    )}
                  >
                    <Pencil className="w-3.5 h-3.5" /> Editar texto
                  </button>
                  <button onClick={send} disabled={sending || armed.params.some(p => !p.trim())}
                    className="px-4 h-9 bg-[#2E1614] hover:bg-[#3A2921] disabled:opacity-30 text-white rounded-xl text-sm font-semibold flex items-center gap-2">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Enviar plantilla
                  </button>
                </div>
              </div>
            </div>
          ) : (
          <>
          {grabando && (
            <div className="mb-2 flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-[#FFF1EF] border border-brand-200">
              <span className="w-2.5 h-2.5 rounded-full bg-pepper-600 animate-pulse shrink-0" />
              <span className="text-[13px] font-bold text-pepper-700 tabular-nums">
                {String(Math.floor(segundos / 60)).padStart(2, '0')}:{String(segundos % 60).padStart(2, '0')}
              </span>
              <span className="text-[12px] text-ink-muted flex-1">Grabando nota de voz…</span>
              <button
                onClick={cancelarGrabacion}
                className="flex items-center gap-1.5 text-[12px] font-bold text-ink-muted hover:text-pepper-700
                           px-2.5 py-1.5 rounded-lg hover:bg-white transition-colors"
              >
                <X className="w-3.5 h-3.5" /> Cancelar
              </button>
            </div>
          )}

          {/* Número oculto: se avisa ANTES de escribir y, sobre todo, se
              ofrece la salida. Meta no da el celular de estas clientas y no
              acepta su identidad como destinatario —probado: devuelve 131009
              «el formato del número es incorrecto»—. Pero muchas escriben su
              número en el chat, así que se busca y se propone: con un clic la
              conversación vuelve a funcionar, sin irse al celular. */}
          {sel.customer.phone.startsWith('CO.') && (
            <div className="mb-2.5 px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200">
              <div className="flex items-start gap-2.5">
                <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[12px] text-amber-800 leading-snug">
                  <span className="font-bold">Esta clienta tiene el número oculto en WhatsApp.</span>{' '}
                  Puedes responderle aquí con normalidad. Lo que no la alcanza es lo automático
                  —confirmación del pedido, seguimiento del envío, carrito—, que necesita un celular.
                  Si te lo da, guárdalo aquí y empieza a recibirlo todo.
                </p>
              </div>

              <div className="mt-2 pl-6 flex items-center gap-2 flex-wrap">
                {celularEnElChat && (
                  <button
                    onClick={() => asignarCelular(celularEnElChat)}
                    disabled={guardandoCelular}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white
                               text-[11px] font-bold disabled:opacity-40 transition-colors"
                  >
                    {guardandoCelular ? 'Guardando…' : `Usar el que escribió: ${celularEnElChat}`}
                  </button>
                )}
                <input
                  value={celularManual}
                  onChange={e => setCelularManual(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); asignarCelular(celularManual); } }}
                  placeholder="o escribe su celular: 300 123 4567"
                  className="flex-1 min-w-[190px] h-7 px-2 text-[11px] bg-white border border-amber-200 rounded-lg
                             outline-none focus:ring-2 focus:ring-amber-400/40 text-ink placeholder:text-amber-700/50"
                />
                <button
                  onClick={() => asignarCelular(celularManual)}
                  disabled={guardandoCelular || celularManual.replace(/\D/g, '').length < 10}
                  className="px-2.5 py-1.5 rounded-lg border border-amber-300 text-amber-800 hover:bg-amber-100
                             text-[11px] font-bold disabled:opacity-40 transition-colors"
                >
                  Guardar
                </button>
              </div>
            </div>
          )}

          {/* Ventana de 24 h cerrada: se dice antes de escribir, no después de
              que rebote. Hasta ahora la bandeja dejaba mandar el texto, se veía
              como enviado y Meta lo rechazaba con «Re-engagement message» —21
              mensajes de agente entre el 11 y el 14 de agosto—. La agente daba
              la conversación por contestada y la clienta no recibió nada. */}
          {ventanaCerrada && !sel.customer.phone.startsWith('CO.') && (
            <div className="mb-2.5 px-3.5 py-2.5 rounded-xl bg-amber-50 border border-amber-200
                            flex items-start gap-2.5">
              <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[12px] text-amber-800 leading-snug">
                <span className="font-bold">
                  {ultimaEntrante
                    ? 'La clienta no escribe hace más de 24 horas.'
                    : 'Esta clienta todavía no te ha escrito.'}
                </span>{' '}
                WhatsApp solo permite mandarle una <strong>plantilla aprobada</strong>:
                escribe <code className="font-mono font-bold">/</code> para elegirla.
                Cuando ella responda podrás escribirle libremente.
              </p>
            </div>
          )}

          {respondiendo && (
            <div className="mb-2.5 flex items-start gap-2.5 px-3 py-2 rounded-xl bg-brand-50 border border-brand-100 border-l-[3px] border-l-[#ED5340]">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-[#D33A22]">
                  Respondiendo a {respondiendo.direction === 'OUTBOUND' ? 'tu mensaje' : sel.customer.name}
                </p>
                <p className="text-[12px] text-ink-muted truncate">{respondiendo.content}</p>
              </div>
              <button onClick={() => setRespondiendo(null)} title="Quitar la cita"
                className="p-1 rounded-lg text-ink-muted hover:text-pepper-700 hover:bg-white transition-colors shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {vistaPrevia && (
            <div className="flex items-center gap-3 mb-2.5 p-2.5 bg-brand-50 border border-brand-100 rounded-xl">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={vistaPrevia} alt="Imagen pegada"
                   className="w-14 h-14 object-cover rounded-lg border border-brand-100 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-ink">Imagen pegada</p>
                <p className="text-[11px] text-ink-muted">
                  {pegada ? `${(pegada.size / 1024).toFixed(0)} KB` : ''} · escribe un pie de foto si quieres y envía
                </p>
              </div>
              <button onClick={enviarPegada} disabled={sending}
                className="px-3 py-1.5 rounded-lg bg-[#ED5340] hover:bg-[#D33A22] text-white text-[12px] font-bold
                           disabled:opacity-40 transition-colors shrink-0">
                Enviar
              </button>
              <button onClick={descartarPegada} title="Descartar"
                className="p-1.5 rounded-lg text-ink-muted hover:text-pepper-700 hover:bg-white transition-colors shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="flex items-end gap-3">
            <div className="flex-1 bg-brand-50 border border-brand-100 rounded-xl px-4 py-3
                            focus-within:border-[#ED5340] focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(237,83,64,0.12)]
                            transition-all">
              <textarea
                ref={inputRef}
                value={msg}
                onChange={e => { setMsg(e.target.value); setShowTpl(e.target.value.startsWith('/')); }}
                onKeyDown={e => {
                  if (showTpl && filteredTpls.length) {
                    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
                      e.preventDefault(); setTplIndex(i => (i + 1) % filteredTpls.length); return;
                    }
                    if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
                      e.preventDefault(); setTplIndex(i => (i - 1 + filteredTpls.length) % filteredTpls.length); return;
                    }
                    if (e.key === 'Enter') { e.preventDefault(); selectTemplate(filteredTpls[tplIndex]); return; }
                    if (e.key === 'Escape') { e.preventDefault(); setShowTpl(false); return; }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
                }}
                placeholder={internal ? 'Nota interna (solo equipo)...' : `Escribe por ${ch.label}… (/ para plantillas)`}
                rows={3}
                onInput={e => {
                  // Crece con lo escrito en vez de dejar el texto largo dentro
                  // de una rendija de dos líneas, que era lo que obligaba a
                  // desplazarse para releer lo que una acababa de escribir.
                  const t = e.currentTarget;
                  t.style.height = 'auto';
                  t.style.height = `${Math.min(t.scrollHeight, 260)}px`;
                }}
                className="w-full bg-transparent text-[14px] resize-y outline-none min-h-[68px] max-h-[260px] text-ink placeholder:text-ink-muted"
              />
              <div className="flex items-center gap-2 mt-2.5 pt-2.5 border-t border-brand-100">
                <button onClick={() => { setShowTpl(s => !s); requestAnimationFrame(() => inputRef.current?.focus()); }}
                  title="Plantillas (/)"
                  className={cn('text-xs font-bold w-6 h-6 rounded-lg flex items-center justify-center transition-colors',
                    showTpl ? "bg-[#D33A22] text-white" : "text-ink-muted hover:text-[#D33A22] hover:bg-brand-50")}>
                  /
                </button>
                <SelectorEmojis onElegir={insertarEmoji} disabled={sending} />
                <button onClick={() => setInternal(i => !i)}
                  className={cn('p-1.5 rounded-lg transition-colors',
                    internal ? 'text-amber-500 bg-amber-50' : 'text-ink-muted hover:text-ink-soft hover:bg-brand-50')}>
                  <Lock className="w-4 h-4" />
                </button>
                <span className={cn('ml-auto flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border', ch.pill)}>
                  <ch.icon className="w-3 h-3" /> {ch.label}
                </span>
              </div>
            </div>
            {/* Adjunto y nota de voz, apilados: dos botones en el ancho de uno,
                para no comerle espacio al campo de escribir. Solo por WhatsApp. */}
            {ch.label === 'WhatsApp' && !internal && (
              <div className="flex flex-col gap-1 shrink-0">
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept={ACCEPT_ADJUNTOS}
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) enviarArchivo(f);
                    e.target.value = '';
                  }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={sending || grabando || ventanaCerrada}
                  title={ventanaCerrada
                    ? 'Fuera de las 24 horas WhatsApp no acepta adjuntos: manda una plantilla.'
                    : 'Adjuntar foto, video o documento'}
                  className="w-11 h-[38px] rounded-xl bg-brand-50 hover:bg-brand-100 text-[#2E1614]
                             disabled:opacity-30 flex items-center justify-center shadow-sm transition-all
                             active:scale-95"
                >
                  <Paperclip className="w-[18px] h-[18px]" />
                </button>
                <button
                  onClick={grabando ? detenerGrabacion : iniciarGrabacion}
                  disabled={sending || (ventanaCerrada && !grabando)}
                  title={ventanaCerrada && !grabando
                    ? 'Fuera de las 24 horas WhatsApp no acepta notas de voz: manda una plantilla.'
                    : grabando ? 'Detener y enviar la nota de voz' : 'Grabar nota de voz'}
                  className={cn(
                    'w-11 h-[38px] rounded-xl flex items-center justify-center shadow-sm transition-all active:scale-95',
                    grabando
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      : 'bg-brand-50 hover:bg-brand-100 text-[#2E1614] disabled:opacity-30',
                  )}
                >
                  {grabando ? <Send className="w-[18px] h-[18px]" /> : <Mic className="w-[18px] h-[18px]" />}
                </button>
              </div>
            )}
            <button onClick={send}
              disabled={(!msg.trim() && !pegada) || grabando || ventanaCerrada}
              title={ventanaCerrada
                ? 'Fuera de las 24 horas solo se puede enviar una plantilla aprobada: escribe «/».'
                : undefined}
              className="w-11 h-11 bg-[#2E1614] hover:bg-[#3A2921] disabled:opacity-30 text-white rounded-xl flex items-center justify-center shadow-sm transition-all shrink-0">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
          </>
          )}
        </div>
      </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          RIGHT — Contexto del cliente
      ══════════════════════════════════════════════════════════════════════ */}
      {sel && (
      <div className="w-[220px] shrink-0 flex flex-col bg-white border-l border-brand-100">
        <div className="px-4 py-3.5 border-b border-brand-100">
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Contexto</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-5">

          {/* Canal */}
          <div>
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Canal</p>
            <div className={cn('flex items-center gap-2 px-3 py-2 rounded-xl border font-semibold text-sm', ch.pill)}>
              <span className={cn('w-2 h-2 rounded-full shrink-0', ch.dot)} />
              <ch.icon className="w-4 h-4 shrink-0" />
              {ch.label}
            </div>
          </div>

          {/* Cliente */}
          <div>
            <p className="text-[11px] font-bold text-ink-muted uppercase tracking-wider mb-2.5">Cliente</p>
            <div className="space-y-2.5">
              {[
                { label:'Pedidos', value: sel.customer.totalOrders ?? '—' },
                { label:'LTV',     value: Number(sel.customer.ltv || 0) > 0 ? `$${(Number(sel.customer.ltv)/1000).toFixed(0)}K` : '—' },
                { label:'Ciudad',  value: sel.customer.city || '—' },
              ].map(s => (
                <div key={s.label} className="flex justify-between items-center">
                  <span className="text-[14px] text-ink-muted">{s.label}</span>
                  <span className="text-[15px] font-bold text-ink">{s.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Pedido actual: estado real, guía y transportadora sin salir del chat. */}
          {sel.pedidos?.length ? (
            <div>
              <p className="text-[11px] font-bold text-ink-muted uppercase tracking-wider mb-2.5">
                Pedido {sel.pedidos.length > 1 && <span className="normal-case font-normal tracking-normal">· el más reciente</span>}
              </p>
              <PanelPedido
                pedido={sel.pedidos[0]}
                confirmando={confirmando}
                onConfirmar={confirmarPedido}
              />
              {sel.pedidos.length > 1 && (
                <div className="mt-2 space-y-1">
                  {sel.pedidos.slice(1).map(p => (
                    <div key={p.id} className="flex items-center justify-between text-[11px] text-ink-muted">
                      <span>{p.shopifyOrderNumber ?? p.shopifyOrderId}</span>
                      <span className={cn('font-semibold', ESTADO_PEDIDO[p.status]?.texto ?? 'text-ink-soft')}>
                        {ESTADO_PEDIDO[p.status]?.label ?? p.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* Etiquetas: se movieron a la cabecera del chat. */}
          <div className="hidden">
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide mb-2">Etiquetas</p>
            <div className="flex flex-wrap gap-1.5">
              {sel.tags.map(t => (
                <span key={t} className="text-xs bg-brand-50 border border-brand-200 text-brand-700 px-2.5 py-1 rounded-lg font-medium">
                  {t}
                </span>
              ))}
              {!sel.tags.length && <span className="text-sm text-ink-muted">Sin etiquetas</span>}
            </div>
          </div>

          {/* Acciones */}
          <div>
            <p className="text-[11px] font-bold text-ink-muted uppercase tracking-wider mb-2.5">Acciones</p>
            <div className="space-y-1">
              <button
                onClick={markResolved}
                disabled={sel.status === 'RESOLVED'}
                className={cn(
                  'w-full flex items-center justify-center gap-2 text-[13px] font-bold px-3 py-2.5 rounded-xl transition-all',
                  sel.status === 'RESOLVED'
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm hover:shadow active:scale-[0.98]',
                )}
              >
                <CheckCheck className="w-4 h-4" />
                {sel.status === 'RESOLVED' ? 'Conversación resuelta' : 'Marcar como resuelta'}
              </button>
              <a href={`/customers/${sel.customer.id}`}
                className="block w-full text-left text-sm text-ink-soft hover:text-ink hover:bg-brand-50 px-2.5 py-2 rounded-lg transition-colors">
                Ver cliente
              </a>
            </div>
          </div>
        </div>
      </div>
      )}

      {nuevoChat && (
        <NuevoChat
          lineas={lineas.map(l => ({ id: l.id, nombre: l.nombre }))}
          lineaActual={linea}
          onCerrar={() => setNuevoChat(false)}
          onAbierta={async id => {
            setNuevoChat(false);
            await loadDetail(id);
            paginaRef.current = 1;
            loadConvs();
          }}
        />
      )}

      {pqrsAbierta && sel && (
        <NuevaPqrs
          clientaInicial={{ id: sel.customer.id, name: sel.customer.name, phone: sel.customer.phone }}
          conversationId={sel.id}
          onCerrar={() => setPqrsAbierta(false)}
          onCreada={() => setPqrsAbierta(false)}
        />
      )}
    </div>
  );
}
