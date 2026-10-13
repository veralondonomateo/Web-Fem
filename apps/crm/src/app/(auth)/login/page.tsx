'use client';
/**
 * Pantalla de acceso.
 *
 * Una sola columna centrada sobre blanco. Antes era una pantalla partida con
 * panel de marca, círculos decorativos, titular publicitario y una fila de
 * logos de integraciones: cosas que se le cuentan a quien está decidiendo si
 * compra el producto, no a quien lo usa ocho horas al día y solo quiere entrar.
 *
 * Lo que queda es lo único que hace falta —logotipo, dos campos y un botón—,
 * con aire alrededor. La marca aparece en el logotipo y en el rojo del botón,
 * que es exactamente la proporción que pide el manual: mucha superficie limpia,
 * la tinta fuerte solo en la acción.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import Image from 'next/image';
import { setAuth } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const [form,    setForm]    = useState({ email: '', password: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res  = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAuth(data.token, data.user);
      router.push('/dashboard');
    } catch {
      setError('Correo o contraseña incorrectos.');
    } finally {
      setLoading(false);
    }
  }

  // Un blanco con la temperatura de la marca, no el blanco de pantalla. La
  // diferencia no se nombra pero se nota: la página no deslumbra.
  const campo = 'w-full bg-white border border-[#F2E6E5] rounded-xl px-4 py-3 text-[15px] text-ink '
    + 'placeholder:text-ink-muted/50 outline-none transition-colors '
    + 'focus:border-pepper-400 hover:border-[#E8D6D4]';

  return (
    <div className="min-h-screen bg-[#FFFCFB] flex flex-col items-center justify-center px-6 py-12">

      <main className="w-full max-w-[352px]">

        {/* Logotipo */}
        <div className="flex flex-col items-center mb-12">
          <Image
            src="/fem-logo.png"
            alt="Fem"
            width={900}
            height={525}
            priority
            className="w-[86px] h-auto"
          />
          <p className="text-[10px] font-bold uppercase tracking-[0.32em] text-ink-muted mt-3 pl-[0.32em]">
            CRM
          </p>
        </div>

        <h1 className="font-display text-[22px] font-bold text-ink text-center">Bienvenida</h1>
        <p className="text-ink-muted text-[14px] text-center mt-1.5 mb-8">
          Entra con tu correo de Fem
        </p>

        {/* El error va justo encima del formulario y sin caja de color: en una
            pantalla de dos campos no hace falta gritar dónde está el problema. */}
        {error && (
          <p role="alert" className="text-pepper-700 text-[13px] text-center mb-5">
            {error}
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label htmlFor="email" className="sr-only">Correo electrónico</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              placeholder="Correo electrónico"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              required
              className={campo}
            />
          </div>

          <div>
            <label htmlFor="password" className="sr-only">Contraseña</label>
            <div className="relative">
              <input
                id="password"
                type={showPwd ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Contraseña"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
                className={`${campo} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPwd(s => !s)}
                aria-label={showPwd ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ink-muted/60 hover:text-pepper-600 transition-colors"
              >
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-pepper-600 hover:bg-pepper-700
                       disabled:opacity-60 text-white font-semibold text-[15px] py-3 rounded-xl
                       transition-colors !mt-6"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </main>

      <p className="text-ink-muted/70 text-[11px] mt-14">Fem · Colombia</p>
    </div>
  );
}
