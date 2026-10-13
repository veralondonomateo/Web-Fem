import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import {
  ESTADOS_DEVOLUCION, EstadoDevolucion, ESTADOS_CERRADOS,
  METODOS_DEVOLUCION, MetodoDevolucion,
  agregarHistorialDevolucion, parsearMonto, metodoDesdeEntidad, faltaParaGirar,
} from '@/lib/devoluciones';

export const dynamic = 'force-dynamic';

const INCLUIR = {
  customer: { select: { id: true, name: true, phone: true } },
  pqrs:     { select: { id: true, radicado: true, subject: true, type: true, status: true, createdAt: true } },
} as const;

/**
 * Marca una devolución como hecha o rechazada, corrige el monto o añade notas.
 *
 * Sacar plata (o negarse a sacarla) es de administración, no de la bandeja: las
 * agentes pueden ABRIR una devolución desde la PQRS, pero cerrarla es de ADMIN.
 * Lo que se comprueba es el rol en la base, no lo que diga la pantalla.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const dev = await prisma.devolucion.findUnique({ where: { id: (await params).id } });
  if (!dev) return NextResponse.json({ error: 'Esa devolución no existe.' }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  let historial = dev.history;

  const yaCerrada = ESTADOS_CERRADOS.includes(dev.estado as EstadoDevolucion);

  // Corregir el monto solo mientras está pendiente: después ya se giró una
  // cantidad concreta y cambiar la cifra dejaría la contabilidad mintiendo.
  if (body.monto !== undefined && body.monto !== null && body.monto !== '') {
    if (yaCerrada) {
      return NextResponse.json(
        { error: 'No se puede cambiar el monto de una devolución ya resuelta.' }, { status: 400 },
      );
    }
    const monto = parsearMonto(body.monto);
    if (monto === null) {
      return NextResponse.json({ error: 'El monto tiene que ser un número mayor que cero.' }, { status: 400 });
    }
    if (monto !== Number(dev.monto)) {
      data.monto = monto;
      historial = agregarHistorialDevolucion(historial, {
        por: user.name, tipo: 'monto',
        texto: `Monto: $${Number(dev.monto).toLocaleString('es-CO')} → $${monto.toLocaleString('es-CO')}`,
      }) as unknown as typeof historial;
    }
  }

  /**
   * Los datos del pago se completan después de radicar: la clienta casi nunca
   * los tiene a mano cuando reclama. Se pueden corregir mientras la devolución
   * siga pendiente —un dígito mal en la cuenta es exactamente lo que hay que
   * poder arreglar— y quedan congelados en cuanto la plata sale, porque a
   * partir de ahí describen un giro que ya se hizo.
   */
  const CAMPOS_PAGO = ['titular', 'cedula', 'contacto', 'entidad', 'tipoCuenta', 'numeroCuenta'] as const;
  const ETIQUETA_PAGO: Record<(typeof CAMPOS_PAGO)[number] | 'fechaLimite', string> = {
    titular: 'titular', cedula: 'cédula', contacto: 'contacto',
    entidad: 'entidad', tipoCuenta: 'tipo de cuenta', numeroCuenta: 'n.º de cuenta',
    fechaLimite: 'fecha límite',
  };
  const cambiosPago: string[] = [];

  for (const campo of CAMPOS_PAGO) {
    if (body[campo] === undefined) continue;
    if (yaCerrada) {
      return NextResponse.json(
        { error: 'No se pueden cambiar los datos del pago de una devolución ya resuelta.' }, { status: 400 },
      );
    }
    const valor = String(body[campo] ?? '').trim().slice(0, 200) || null;
    if (valor !== dev[campo]) {
      data[campo] = valor;
      cambiosPago.push(`${ETIQUETA_PAGO[campo]}: ${valor ?? '—'}`);
    }
  }

  if (body.fechaLimite !== undefined) {
    if (yaCerrada) {
      return NextResponse.json(
        { error: 'No se puede cambiar la fecha límite de una devolución ya resuelta.' }, { status: 400 },
      );
    }
    const cruda = String(body.fechaLimite ?? '').trim();
    const fecha = cruda ? new Date(cruda) : null;
    if (fecha && Number.isNaN(fecha.getTime())) {
      return NextResponse.json({ error: 'Esa fecha límite no se entiende.' }, { status: 400 });
    }
    if (fecha?.toISOString().slice(0, 10) !== dev.fechaLimite?.toISOString().slice(0, 10)) {
      data.fechaLimite = fecha;
      cambiosPago.push(`fecha límite: ${fecha ? fecha.toISOString().slice(0, 10) : '—'}`);
    }
  }

  if (cambiosPago.length) {
    historial = agregarHistorialDevolucion(historial, {
      por: user.name, tipo: 'nota',
      texto: `Datos del pago — ${cambiosPago.join(', ')}`,
    }) as unknown as typeof historial;
  }

  if (typeof body.nota === 'string' && body.nota.trim()) {
    historial = agregarHistorialDevolucion(historial, {
      por: user.name, tipo: 'nota', texto: body.nota.trim(),
    }) as unknown as typeof historial;
  }

  if (body.estado && body.estado !== dev.estado) {
    const nuevo = body.estado as EstadoDevolucion;
    if (!ESTADOS_DEVOLUCION[nuevo]) {
      return NextResponse.json({ error: 'Estado inválido.' }, { status: 400 });
    }
    /**
     * Cerrar es de administración; dejarla lista, no.
     *
     * Sacar plata (o negarse) sigue siendo solo de ADMIN. Pero «lista para
     * devolver» no mueve un peso: dice que los datos del pago ya están
     * completos, y quien los consigue es la agente que habla con la clienta.
     * Si esto exigiera ADMIN, el estado no lo pondría nadie y volveríamos a
     * administración revisando una a una a ver cuáles ya se pueden girar.
     */
    const cierra = ESTADOS_CERRADOS.includes(nuevo);
    if (cierra && user.role !== 'ADMIN') return forbidden();
    if (yaCerrada) {
      return NextResponse.json(
        { error: `Esta devolución ya quedó como ${ESTADOS_DEVOLUCION[dev.estado as EstadoDevolucion].toLowerCase()}. Para rectificar, radica una PQRS nueva.` },
        { status: 400 },
      );
    }

    if (nuevo === 'LISTA_PARA_DEVOLVER') {
      // El estado tiene que significar algo para quien paga: si lo dejamos
      // ponerlo sin cuenta a dónde girar, «lista para devolver» no ayuda —hay
      // que abrirla igual para descubrir que falta el dato—.
      /**
       * Se mira el valor que va a quedar, no el que había.
       *
       * La pantalla puede mandar los datos del pago y el cambio de estado en la
       * MISMA petición, así que hay que leer lo que trae `data` cuando viene. Y
       * con `in`, no con `??`: borrar un campo lo deja en `null`, que es
       * exactamente lo que `??` confunde con «no vino» — así se colaba una
       * devolución a «lista para devolver» con la cuenta recién vaciada.
       */
      const quedara = (campo: 'entidad' | 'numeroCuenta') =>
        (campo in data ? (data[campo] as string | null) : dev[campo]);
      const falta = faltaParaGirar({ entidad: quedara('entidad'), numeroCuenta: quedara('numeroCuenta') });
      if (falta) {
        return NextResponse.json(
          { error: `Para dejarla lista falta ${falta}: sin eso no hay a dónde girar la plata.` },
          { status: 400 },
        );
      }
      historial = agregarHistorialDevolucion(historial, {
        por: user.name, tipo: 'estado',
        texto: 'Lista para devolver: los datos del pago están completos',
      }) as unknown as typeof historial;
    }

    // Volver atrás se permite —un dígito mal en la cuenta se descubre justo al
    // ir a girar— y queda escrito, que es lo que importa.
    if (nuevo === 'PENDIENTE') {
      historial = agregarHistorialDevolucion(historial, {
        por: user.name, tipo: 'estado',
        texto: `Vuelve a pendiente${body.nota ? '' : ' — falta revisar los datos del pago'}`,
      }) as unknown as typeof historial;
    }

    if (nuevo === 'HECHA') {
      // Sin método ni referencia no hay forma de demostrar mañana que la plata
      // salió, que es justo lo que se le pide a este módulo.
      const metodo = (body.metodo || metodoDesdeEntidad(dev.entidad)) as MetodoDevolucion;
      const referencia = String(body.referencia ?? '').trim();
      if (!METODOS_DEVOLUCION[metodo]) {
        return NextResponse.json({ error: 'Elige por dónde se devolvió el dinero.' }, { status: 400 });
      }
      if (!referencia) {
        return NextResponse.json(
          { error: 'Escribe la referencia del comprobante: es la constancia de que la plata salió.' },
          { status: 400 },
        );
      }
      data.metodo = metodo;
      data.referencia = referencia;
      historial = agregarHistorialDevolucion(historial, {
        por: user.name, tipo: 'estado',
        texto: `Devuelta por ${METODOS_DEVOLUCION[metodo].toLowerCase()} — comprobante ${referencia}`,
      }) as unknown as typeof historial;
    }

    if (nuevo === 'RECHAZADA') {
      // Un rechazo sin explicación es lo que hace que la clienta vuelva a
      // preguntar y nadie sepa responderle.
      const porQue = String(body.notas ?? body.motivoRechazo ?? '').trim();
      if (!porQue) {
        return NextResponse.json(
          { error: 'Escribe por qué no se va a devolver el dinero.' }, { status: 400 },
        );
      }
      data.notas = porQue;
      historial = agregarHistorialDevolucion(historial, {
        por: user.name, tipo: 'estado', texto: `Rechazada: ${porQue}`,
      }) as unknown as typeof historial;
    }

    data.estado = nuevo;

    /**
     * «Resuelta» solo cuando de verdad se resolvió.
     *
     * Estos tres campos son los que firman el cierre, y `resuelta_at` es además
     * la fecha con la que el control mensual cuenta la plata que salió. Si
     * también se sellaran al dejarla lista, una devolución sin pagar aparecería
     * en el mes como si se hubiera girado.
     */
    if (cierra) {
      data.resueltaAt = new Date();
      data.resueltaPorId = user.id;
      data.resueltaPorName = user.name;
    }
  }

  if (!Object.keys(data).length && historial === dev.history) {
    return NextResponse.json({ error: 'Nada que actualizar.' }, { status: 400 });
  }

  const actualizada = await prisma.devolucion.update({
    where: { id: (await params).id },
    data: { ...data, history: historial as object },
    include: INCLUIR,
  });

  await prisma.activityLog.create({
    data: {
      userId: user.id, action: 'DEVOLUCION_ACTUALIZADA', resource: 'devoluciones',
      metadata: { devolucionId: dev.id, consecutivo: dev.consecutivo, cambios: Object.keys(data) },
    },
  }).catch(() => {});

  return NextResponse.json({ ...actualizada, monto: Number(actualizada.monto) });
}
