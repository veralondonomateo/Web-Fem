'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MessageSquare, Users, ShoppingBag, BarChart3, Zap,
  FileText, LogOut, ShoppingCart, Settings, ShieldAlert, Star, PanelLeftClose, PanelLeftOpen
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { clearAuth, getUser, AuthUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { Avatar, AvatarFallback } from './ui/avatar';
import Image from 'next/image';
import { useState, useEffect } from 'react';

/**
 * `badge` nombra el contador de /api/stats/badges que le corresponde.
 * `soloAdmin` esconde la entrada a las agentes — hoy solo Calidad, que muestra
 * las notas que les ponen las clientas y no deben verlas ellas.
 */
const navItems = [
  { href: '/dashboard',       icon: BarChart3,     label: 'Dashboard',  badge: null },
  { href: '/inbox',           icon: MessageSquare, label: 'Bandeja',    badge: 'inbox'  as const },
  { href: '/customers',       icon: Users,         label: 'Clientas',   badge: null },
  { href: '/orders',          icon: ShoppingBag,   label: 'Pedidos',    badge: 'orders' as const },
  { href: '/abandoned-carts', icon: ShoppingCart,  label: 'Carritos',   badge: 'carts'  as const },
  { href: '/pqrs',            icon: ShieldAlert,   label: 'PQRS',       badge: 'pqrs'   as const },
  { href: '/calidad',         icon: Star,          label: 'Calidad',    badge: null, soloAdmin: true },
  { href: '/flows',           icon: Zap,           label: 'Flujos',     badge: null },
  { href: '/templates',       icon: FileText,      label: 'Plantillas', badge: null },
  { href: '/settings',        icon: Settings,      label: 'Ajustes',    badge: null },
];

type Badges = { inbox: number; carts: number; orders: number; pqrs: number };

export function Sidebar({ plegado = false, onAlternar }: {
  /** Plegado a tira de iconos. Lo decide y lo recuerda el layout. */
  plegado?: boolean;
  onAlternar?: () => void;
}) {
  const pathname = usePathname();
  const router   = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [badges, setBadges] = useState<Badges>({ inbox: 0, carts: 0, orders: 0, pqrs: 0 });

  useEffect(() => { setUser(getUser()); }, []);

  // Los contadores se refrescan solos: el CRM se deja abierto todo el día.
  useEffect(() => {
    let alive = true;
    const load = () => api.get<Badges>('/api/stats/badges')
      .then(b => { if (alive) setBadges(b); })
      .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [pathname]);

  const initials = (n: string) => n.split(' ').map(x => x[0]).join('').toUpperCase().slice(0, 2);

  return (
    <aside className={cn(
      'fixed left-0 top-0 h-screen bg-white border-r border-brand-100 flex flex-col z-30',
      'transition-[width] duration-200',
      plegado ? 'w-[64px]' : 'w-[220px]',
    )}>
      {/* Logo */}
      <div className={cn('h-16 flex items-center border-b border-brand-100 relative',
        plegado ? 'justify-center px-0' : 'px-5')}>
        <Link href="/dashboard" className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl overflow-hidden bg-brand-50 flex items-center justify-center border border-brand-100">
            <Image
              src="/fem-icon.png"
              alt="Fem"
              width={32}
              height={32}
              className="object-contain w-full h-full p-0.5"
              priority
            />
          </div>
          {!plegado && (
            <div>
              <p className="font-display font-bold text-[15px] text-ink leading-none">Fem</p>
              <p className="text-[10px] text-pepper-600 font-semibold uppercase tracking-widest mt-0.5">CRM</p>
            </div>
          )}
        </Link>

        {/* Plegar. Va pegado al borde para que no se coma sitio del menú, y
            siempre visible: escondido tras un hover no lo encuentra nadie. */}
        {onAlternar && (
          <button
            onClick={onAlternar}
            title={plegado ? 'Mostrar el menú' : 'Ocultar el menú'}
            aria-label={plegado ? 'Mostrar el menú' : 'Ocultar el menú'}
            className={cn(
              'absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full',
              'bg-white border border-brand-100 shadow-sm flex items-center justify-center',
              'text-ink-muted hover:text-pepper-600 hover:border-pepper-200 transition-colors z-10',
            )}
          >
            {plegado ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className={cn('flex-1 py-4 space-y-0.5 overflow-y-auto', plegado ? 'px-2' : 'px-3')}>
        {navItems.map(({ href, icon: Icon, label, badge, soloAdmin }) => {
          // Se esconde mientras no se sepa quién es: el usuario se lee del
          // navegador en un efecto, y pintar la entrada y quitarla medio
          // segundo después es peor que no pintarla.
          if (soloAdmin && user?.role !== 'ADMIN') return null;
          const active = pathname === href || pathname.startsWith(href + '/');
          const count  = badge ? badges[badge] : 0;
          return (
            <Link
              key={href}
              href={href}
              // Plegado no hay etiqueta, así que el nombre va en el `title`:
              // sin él la tira de iconos es un acertijo.
              title={plegado ? label : undefined}
              className={cn(
                'flex items-center rounded-xl text-sm font-medium transition-colors relative',
                plegado ? 'justify-center px-0 py-2.5' : 'justify-between px-3 py-2.5',
                active
                  ? 'bg-pepper-600 text-white'
                  : 'text-ink-soft hover:bg-brand-50 hover:text-ink'
              )}
            >
              <span className={cn('flex items-center', plegado ? '' : 'gap-3')}>
                <Icon className="w-4 h-4 shrink-0" />
                {!plegado && label}
              </span>

              {/* Desplegado, el contador va como número. Plegado no cabe, así
                  que se reduce a un punto: se pierde la cifra pero se conserva
                  lo que de verdad importa de un vistazo —que hay algo—. */}
              {count > 0 && !active && (plegado ? (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-pepper-600 rounded-full" />
              ) : (
                <span className="min-w-[20px] h-5 bg-pepper-600 text-white text-[11px] font-bold rounded-full flex items-center justify-center px-1.5 tabular-nums">
                  {count > 99 ? '99+' : count}
                </span>
              ))}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className={cn('border-t border-brand-100', plegado ? 'p-2' : 'p-3')}>
        <div className={cn('flex items-center rounded-xl hover:bg-brand-50 group cursor-pointer transition-colors',
          plegado ? 'justify-center py-2' : 'gap-2.5 px-2.5 py-2')}>
          <Avatar className="w-7 h-7 shrink-0">
            <AvatarFallback className="text-xs bg-brand-100 text-pepper-700 font-semibold">
              {initials(user?.name || 'US')}
            </AvatarFallback>
          </Avatar>
          <div className={cn('flex-1 min-w-0', plegado && 'hidden')}>
            <p className="text-sm font-semibold text-ink truncate leading-none">{user?.name || 'Usuaria'}</p>
            <p className="text-xs text-ink-muted capitalize mt-0.5">{user?.role?.toLowerCase() || 'agente'}</p>
          </div>
          <button
            onClick={() => { clearAuth(); router.push('/login'); }}
            title="Cerrar sesión"
            className={cn('transition-opacity p-1 rounded-lg hover:bg-brand-100',
              plegado ? 'hidden' : 'opacity-0 group-hover:opacity-100 focus:opacity-100')}
          >
            <LogOut className="w-3.5 h-3.5 text-ink-muted" />
          </button>
        </div>
      </div>
    </aside>
  );
}
