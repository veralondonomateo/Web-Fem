'use client';
import { useState } from 'react';
import { FileText, Download, X, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MediaBubbleProps {
  media: { url: string; mimeType: string; size: number; filename?: string | null };
  caption?: string;
  isOut: boolean;
}

/** Las etiquetas automáticas (📷 Foto, 🎤 Nota de voz…) no son un pie de foto real. */
const AUTO_LABEL = /^(📷|🎤|🎬|📄|🌟)/;

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaBubble({ media, caption, isOut }: MediaBubbleProps) {
  const [zoom, setZoom] = useState(false);
  const kind = media.mimeType.split('/')[0];
  const realCaption = caption && !AUTO_LABEL.test(caption) ? caption : null;

  const shell = cn(
    'rounded-2xl overflow-hidden border max-w-[320px]',
    isOut ? 'border-[#ED5340]/35 bg-[#FFF0EF]' : 'border-[#F7E4E2] bg-white',
  );

  if (kind === 'image') {
    return (
      <>
        <div className={shell}>
          <button onClick={() => setZoom(true)} className="block w-full group relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={media.url}
              alt={realCaption ?? media.filename ?? 'Foto enviada por la clienta'}
              className="w-full max-h-[300px] object-cover cursor-zoom-in transition-opacity group-hover:opacity-90"
            />
            <span className="absolute top-2 right-2 bg-black/55 text-white rounded-lg p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <ExternalLink className="w-3.5 h-3.5" />
            </span>
          </button>
          {realCaption && (
            <p className="px-3 py-2 text-[13px] leading-snug text-[#2E1614]">{realCaption}</p>
          )}
        </div>

        {zoom && (
          <div
            onClick={() => setZoom(false)}
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
          >
            <button
              onClick={() => setZoom(false)}
              className="absolute top-5 right-5 text-white/80 hover:text-white"
              aria-label="Cerrar"
            >
              <X className="w-7 h-7" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={media.url}
              alt={realCaption ?? 'Foto ampliada'}
              onClick={e => e.stopPropagation()}
              className="max-h-full max-w-full object-contain rounded-xl cursor-default"
            />
            <a
              href={media.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="absolute bottom-6 flex items-center gap-2 bg-white/95 hover:bg-white text-[#2E1614] px-4 py-2 rounded-xl text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" /> Abrir en pestaña nueva
            </a>
          </div>
        )}
      </>
    );
  }

  if (kind === 'audio') {
    return (
      <div className={cn(shell, 'p-3 w-[300px]')}>
        <audio controls preload="metadata" src={media.url} className="w-full h-9" />
        {realCaption && <p className="mt-2 text-[13px] text-[#2E1614]">{realCaption}</p>}
      </div>
    );
  }

  if (kind === 'video') {
    return (
      <div className={shell}>
        <video controls preload="metadata" src={media.url} className="w-full max-h-[300px] bg-black" />
        {realCaption && <p className="px-3 py-2 text-[13px] text-[#2E1614]">{realCaption}</p>}
      </div>
    );
  }

  // Documentos y cualquier otro tipo: se abre o se descarga.
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(shell, 'flex items-center gap-3 p-3 hover:brightness-[0.98] transition')}
    >
      <span className="w-10 h-10 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center shrink-0">
        <FileText className="w-5 h-5 text-pepper-600" />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-[#2E1614] truncate">
          {media.filename || realCaption || 'Documento'}
        </span>
        <span className="block text-[11px] text-[#8C6B66]">{prettySize(media.size)} · abrir</span>
      </span>
      <Download className="w-4 h-4 text-[#8C6B66] shrink-0 ml-auto" />
    </a>
  );
}
