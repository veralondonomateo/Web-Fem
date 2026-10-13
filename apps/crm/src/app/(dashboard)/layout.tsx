'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/sidebar';
import { FemmaChat } from '@/components/femma-chat';
import { isAuthenticated } from '@/lib/auth';

/** Donde se recuerda si el menú está plegado. */
const CLAVE_MENU = 'fem_menu_plegado';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  /**
   * El menú se pliega a una tira de iconos para dejarle la pantalla a la
   * bandeja, que es donde se pasa el día. La decisión se recuerda: quien lo
   * pliega no quiere volver a plegarlo cada mañana.
   *
   * Arranca desplegado y se corrige en un efecto, no leyendo `localStorage` al
   * pintar: hacerlo al pintar da un HTML distinto en el servidor y en el
   * navegador, y React lo descarta con un error de hidratación.
   */
  const [plegado, setPlegado] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) router.push('/login');
    try { setPlegado(localStorage.getItem(CLAVE_MENU) === '1'); } catch { /* modo privado */ }
  }, [router]);

  const alternar = () => {
    setPlegado(p => {
      try { localStorage.setItem(CLAVE_MENU, p ? '0' : '1'); } catch { /* modo privado */ }
      return !p;
    });
  };

  return (
    <div className="flex h-screen bg-[#FFF8F7]">
      <Sidebar plegado={plegado} onAlternar={alternar} />
      <main
        className={`flex-1 overflow-hidden flex flex-col transition-[margin] duration-200 ${
          plegado ? 'ml-[64px]' : 'ml-[215px]'
        }`}
      >
        {children}
      </main>
      {/* Femma acompaña a la agente en todas las pantallas del CRM. */}
      <FemmaChat />
    </div>
  );
}
