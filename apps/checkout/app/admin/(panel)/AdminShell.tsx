"use client";

/**
 * Marco del panel: una sola contraseña y el menú de módulos a la izquierda.
 *
 * Vive en un layout para que la sesión sobreviva al navegar entre módulos.
 * Si cada página tuviera su propio formulario, cambiar de Dashboard a Links
 * pediría la contraseña otra vez.
 *
 * `/admin/pruebas` queda deliberadamente fuera de este grupo de rutas: se
 * decidió en su momento dejarlo sin contraseña, y meterlo aquí lo cambiaría.
 */

import { createContext, useContext, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { diaCOT } from "@/lib/metricas";

const CLAVE_SESION = "fem-admin-pw";

/**
 * La contraseña viaja por contexto porque cada módulo la manda en la cabecera
 * `x-admin-password` de sus peticiones. No hay sesión en el servidor.
 */
const ContextoAdmin = createContext<string | null>(null);

export function useAdminPassword(): string {
  const clave = useContext(ContextoAdmin);
  if (clave === null) {
    throw new Error("useAdminPassword se usó fuera del panel del admin");
  }
  return clave;
}

const MODULOS = [
  { href: "/admin", nombre: "Dashboard", descripcion: "Ventas y facturación" },
  { href: "/admin/links", nombre: "Links de productos", descripcion: "Enlaces de checkout" },
  { href: "/admin/descuentos", nombre: "Descuentos", descripcion: "Cupones y links de campaña" },
  { href: "/admin/ecuador", nombre: "Ecuador", descripcion: "Links y pedidos en dólares" },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const [password, setPassword] = useState("");
  const [clave, setClave] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [entrando, setEntrando] = useState(false);
  const [listo, setListo] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const pathname = usePathname();

  // La contraseña se guarda en la sesión de la pestaña para no reescribirla al
  // cambiar de módulo. Se borra al salir y al cerrar la pestaña.
  useEffect(() => {
    try {
      const guardada = sessionStorage.getItem(CLAVE_SESION);
      if (guardada) setClave(guardada);
    } catch {
      // Modo privado o almacenamiento bloqueado: simplemente se pide entrar.
    }
    setListo(true);
  }, []);

  useEffect(() => setMenuAbierto(false), [pathname]);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEntrando(true);
    setError("");
    try {
      // Se valida contra una consulta barata: un solo día y sin comparación.
      const hoy = diaCOT(new Date());
      const res = await fetch(`/api/admin/metricas?desde=${hoy}&hasta=${hoy}&comparar=0`, {
        headers: { "x-admin-password": password },
      });
      if (res.status === 401) {
        setError("Contraseña incorrecta");
        return;
      }
      if (!res.ok) {
        setError("No se pudo conectar con la base de datos");
        return;
      }
      try {
        sessionStorage.setItem(CLAVE_SESION, password);
      } catch {}
      setClave(password);
    } catch {
      setError("Error de conexión");
    } finally {
      setEntrando(false);
    }
  };

  const salir = () => {
    try {
      sessionStorage.removeItem(CLAVE_SESION);
    } catch {}
    setClave(null);
    setPassword("");
  };

  // Sin esto, el formulario aparece medio segundo antes de leer la sesión y
  // parpadea cada vez que se cambia de módulo.
  if (!listo) return <div className="min-h-screen bg-[#f5f5f5]" />;

  if (!clave) {
    return (
      <div className="min-h-screen bg-[#f5f5f5] flex items-center justify-center px-4">
        <div className="bg-white rounded-xl border border-gray-200 p-8 w-full max-w-sm shadow-sm">
          <div className="text-center mb-6">
            <Link href="/">
              <Image src="/logo.svg" alt="FEM" width={80} height={26} className="h-7 w-auto mx-auto" />
            </Link>
            <p className="text-sm text-gray-500 mt-3">Panel de administración</p>
          </div>
          <form onSubmit={entrar} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1.5">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 rounded-md border border-gray-300 text-sm focus:outline-none focus:ring-1 focus:ring-[#fc5245] focus:border-[#fc5245]"
                autoFocus
              />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <button
              type="submit"
              disabled={entrando || !password}
              className="w-full py-2.5 bg-[#fc5245] text-white text-sm font-semibold rounded-md hover:bg-[#e83d30] transition-colors disabled:opacity-50"
            >
              {entrando ? "Entrando..." : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <ContextoAdmin.Provider value={clave}>
      <div className="min-h-screen bg-[#f5f5f5]">
        {/* Barra superior: en escritorio solo lleva la marca; en móvil abre el menú. */}
        <header className="lg:hidden bg-white border-b border-gray-200 sticky top-0 z-30">
          <div className="px-4 py-3 flex items-center justify-between">
            <Image src="/logo.svg" alt="FEM" width={80} height={26} className="h-6 w-auto" />
            <button
              onClick={() => setMenuAbierto((v) => !v)}
              className="text-xs font-medium text-gray-600 border border-gray-200 rounded px-2.5 py-1.5"
            >
              {menuAbierto ? "Cerrar" : "Menú"}
            </button>
          </div>
          {menuAbierto && (
            <nav className="border-t border-gray-100 px-3 py-2 space-y-0.5">
              {MODULOS.map((m) => (
                <ItemMenu key={m.href} modulo={m} activo={pathname === m.href} />
              ))}
              <PieMenu onSalir={salir} />
            </nav>
          )}
        </header>

        <div className="flex">
          {/* `h-screen` + `self-start`, no `min-h-screen`: como elemento flex la
              barra se estiraría a la altura de toda la página, y entonces el pie
              con "Cerrar sesión" quedaría al final del scroll en vez de abajo a
              la vista, y el `sticky` no serviría de nada. */}
          <aside className="hidden lg:flex w-56 flex-shrink-0 flex-col self-start border-r border-gray-200 bg-white h-screen sticky top-0">
            <div className="px-5 py-5">
              <Link href="/">
                <Image src="/logo.svg" alt="FEM" width={80} height={26} className="h-7 w-auto" />
              </Link>
            </div>
            <nav className="px-3 space-y-0.5">
              {MODULOS.map((m) => (
                <ItemMenu key={m.href} modulo={m} activo={pathname === m.href} />
              ))}
            </nav>
            <div className="mt-auto px-3 pb-4">
              <PieMenu onSalir={salir} />
            </div>
          </aside>

          <div className="flex-1 min-w-0">{children}</div>
        </div>
      </div>
    </ContextoAdmin.Provider>
  );
}

function ItemMenu({
  modulo,
  activo,
}: {
  modulo: (typeof MODULOS)[number];
  activo: boolean;
}) {
  return (
    <Link
      href={modulo.href}
      className={`block rounded-md px-3 py-2 transition-colors ${
        activo ? "bg-[#fc5245] text-white" : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      <span className="block text-sm font-medium">{modulo.nombre}</span>
      <span className={`block text-[11px] ${activo ? "text-white/70" : "text-gray-400"}`}>
        {modulo.descripcion}
      </span>
    </Link>
  );
}

function PieMenu({ onSalir }: { onSalir: () => void }) {
  return (
    <div className="border-t border-gray-100 pt-2 mt-2 space-y-0.5">
      {/* No es un módulo del panel; se deja a mano porque el entorno de pruebas
          de Sendura se sigue usando y si no, no hay cómo llegar. */}
      <Link
        href="/admin/pruebas"
        className="block rounded-md px-3 py-1.5 text-[11px] text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
      >
        Pruebas Sendura
      </Link>
      <button
        onClick={onSalir}
        className="block w-full text-left rounded-md px-3 py-1.5 text-[11px] text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
      >
        Cerrar sesión
      </button>
    </div>
  );
}
