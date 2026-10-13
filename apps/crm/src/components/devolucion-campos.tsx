'use client';
/**
 * Los campos de una devolución de dinero, en un solo sitio.
 *
 * Son los mismos que se venían llenando a mano en el Drive (titular, cédula,
 * contacto, entidad, tipo y número de cuenta, valor, fecha límite y
 * observaciones), y se usan igual en los dos puntos desde donde nace una
 * devolución: al radicar la PQRS y desde el radicado ya abierto. Estar aquí una
 * sola vez es lo que garantiza que los dos pidan lo mismo.
 *
 * Solo el valor es obligatorio. Los datos bancarios se piden después —la
 * clienta casi nunca los tiene a mano en el primer mensaje— y se completan
 * luego desde la devolución, así que exigirlos aquí solo lograría que la
 * devolución no se registrara.
 */
import { ENTIDADES_SUGERIDAS, TIPOS_CUENTA, fechaLimitePorDefecto, parsearMonto } from '@/lib/devoluciones';

export interface DatosDevolucion {
  monto: string;
  motivo: string;
  titular: string;
  cedula: string;
  contacto: string;
  entidad: string;
  tipoCuenta: string;
  numeroCuenta: string;
  fechaLimite: string;
  notas: string;
}

/**
 * Todo lo que ya se sabe llega puesto: el titular y el contacto son los de la
 * clienta salvo que la cuenta sea de un tercero, y la fecha límite es dentro de
 * un mes. Escribir menos es la diferencia entre que esto se llene y que no.
 */
export function datosDevolucionVacios(clienta?: { name?: string; phone?: string } | null): DatosDevolucion {
  return {
    monto: '',
    motivo: '',
    titular: clienta?.name ?? '',
    cedula: '',
    contacto: clienta?.phone ?? '',
    entidad: '',
    tipoCuenta: '',
    numeroCuenta: '',
    fechaLimite: fechaLimitePorDefecto(),
    notas: '',
  };
}

/** El cuerpo que espera `POST /api/devoluciones`. `motivoPorDefecto` es el
 *  asunto de la PQRS: si nadie escribió un motivo aparte, ese es el motivo. */
export function cuerpoDevolucion(d: DatosDevolucion, motivoPorDefecto: string) {
  return {
    monto: d.monto,
    motivo: d.motivo.trim() || motivoPorDefecto,
    titular: d.titular.trim() || null,
    cedula: d.cedula.trim() || null,
    contacto: d.contacto.trim() || null,
    entidad: d.entidad.trim() || null,
    tipoCuenta: d.tipoCuenta || null,
    numeroCuenta: d.numeroCuenta.trim() || null,
    fechaLimite: d.fechaLimite || null,
    notas: d.notas.trim() || null,
  };
}

export function CamposDevolucion({ datos, set, modo = 'nueva' }: {
  datos: DatosDevolucion;
  set: (parche: Partial<DatosDevolucion>) => void;
  /**
   * `edicion` es corregir una devolución ya abierta, y ahí el motivo y las
   * observaciones no se tocan: el motivo es el del reclamo y las observaciones
   * quedaron escritas en la bitácora. Lo que sí se corrige son los datos del
   * pago, que es donde se cuela el dígito equivocado.
   */
  modo?: 'nueva' | 'edicion';
}) {
  const montoValido = parsearMonto(datos.monto);
  const campo = 'w-full px-3 py-2 rounded-xl text-[14px] bg-white border border-amber-200 outline-none focus:border-amber-400';

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <Etiqueta>Valor a devolver *</Etiqueta>
          <input
            value={datos.monto} onChange={e => set({ monto: e.target.value })} autoFocus
            inputMode="decimal" placeholder="Ej.: 89.900" className={campo}
          />
        </div>
        <div>
          <Etiqueta>Fecha límite de pago</Etiqueta>
          <input
            type="date" value={datos.fechaLimite}
            onChange={e => set({ fechaLimite: e.target.value })} className={campo}
          />
        </div>
      </div>

      {modo === 'nueva' && (
        <div>
          <Etiqueta>Motivo de la devolución</Etiqueta>
          <input
            value={datos.motivo} onChange={e => set({ motivo: e.target.value })}
            placeholder="Si lo dejas vacío se usa el asunto de la PQRS" className={campo}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <Etiqueta>Titular de la cuenta</Etiqueta>
          <input
            value={datos.titular} onChange={e => set({ titular: e.target.value })}
            placeholder="A nombre de quién está la cuenta" className={campo}
          />
        </div>
        <div>
          <Etiqueta>Cédula</Etiqueta>
          <input
            value={datos.cedula} onChange={e => set({ cedula: e.target.value })}
            inputMode="numeric" placeholder="Cédula del titular" className={campo}
          />
        </div>
        <div>
          <Etiqueta>Contacto</Etiqueta>
          <input
            value={datos.contacto} onChange={e => set({ contacto: e.target.value })}
            inputMode="tel" placeholder="Celular al que se le confirma" className={campo}
          />
        </div>
        <div>
          <Etiqueta>Entidad / banco</Etiqueta>
          {/* `datalist` y no un desplegable: sugiere las de siempre sin cerrar
              la puerta al banco raro que aparece una vez al mes. */}
          <input
            value={datos.entidad} onChange={e => set({ entidad: e.target.value })}
            list="entidades-devolucion" placeholder="Bancolombia, Nequi…" className={campo}
          />
          <datalist id="entidades-devolucion">
            {ENTIDADES_SUGERIDAS.map(e => <option key={e} value={e} />)}
          </datalist>
        </div>
        <div>
          <Etiqueta>Tipo de cuenta</Etiqueta>
          <select
            value={datos.tipoCuenta} onChange={e => set({ tipoCuenta: e.target.value })}
            className={campo}
          >
            <option value="">—</option>
            {TIPOS_CUENTA.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <Etiqueta>N° de cuenta</Etiqueta>
          <input
            value={datos.numeroCuenta} onChange={e => set({ numeroCuenta: e.target.value })}
            inputMode="numeric" placeholder="Número de cuenta o celular" className={campo}
          />
        </div>
      </div>

      {modo === 'nueva' && (
        <div>
          <Etiqueta>Observaciones</Etiqueta>
          <input
            value={datos.notas} onChange={e => set({ notas: e.target.value })}
            placeholder="Lo que haya que advertirle a quien paga" className={campo}
          />
        </div>
      )}

      <p className="text-[12px] text-amber-800">
        {datos.monto && montoValido === null
          ? 'Ese valor no se entiende. Escribe solo el número, ej.: 89.900'
          : modo === 'nueva'
            ? 'Queda PENDIENTE en la pestaña Devoluciones hasta que administración confirme el pago. Los datos bancarios se pueden completar después.'
            : 'Se puede corregir mientras la devolución siga pendiente. En cuanto se marque como devuelta, estos datos quedan fijos.'}
      </p>
    </div>
  );
}

function Etiqueta({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-wider text-amber-800/80 mb-1">{children}</p>;
}
