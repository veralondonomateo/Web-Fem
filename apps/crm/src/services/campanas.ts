/**
 * Envío masivo de una plantilla de marketing.
 *
 * QUÉ PROTEGE, Y POR QUÉ ESTÁ ESCRITO ASÍ
 *
 * Mandar 40.000 mensajes de marketing es la forma más rápida de perder el
 * número de WhatsApp, y ese número sostiene la confirmación de pedidos, el
 * seguimiento de envíos y la atención. Meta ya frena ~100 mensajes al día por
 * «healthy ecosystem engagement», que es su forma de decir «mucho marketing y
 * poca interacción». Así que esto no es un bucle que dispara: es una cola con
 * frenos.
 *
 *   · Tope por día, configurable por campaña.
 *   · Ritmo por hora: el cupo del día no se gasta en media hora.
 *   · Franja horaria: nada de madrugada.
 *   · Orden por interacción: primero quien más responde. No es un capricho —
 *     una tanda que interactúa sube la calificación, y una que no la baja, así
 *     que empezar por las mejores protege al resto de la campaña.
 *   · Se para sola si la línea deja de estar en GREEN.
 *   · Se para sola si Meta empieza a rechazar por saturación.
 *   · Una fila por destinataria, con marca de enviado: nadie recibe dos veces
 *     aunque el proceso se reinicie a mitad.
 *
 * NO usa la línea de postcompra por defecto. Si Meta castiga ese número, se cae
 * el seguimiento de pedidos de todo el negocio.
 */
import { prisma } from '@/lib/prisma';
import { sendWhatsAppTemplate } from '@/services/whatsapp';
import { registrarPlantillaEnLinea } from '@/services/linea-postcompra';

/**
 * Cuántos salen por pasada del cron (cada minuto) y cuántos a la vez.
 *
 * De uno en uno el ritmo era de 16/min —medido en producción—, que para 40.000
 * son 41 horas. El tiempo se va esperando a Meta, no calculando: cada envío
 * tarda ~1,8 s de los cuales casi todo es red. Mandando de a 8 en paralelo,
 * 150 caben en ~35 s, con margen frente al límite de 60 s de la función.
 *
 * 150/min son 9.000 por hora. El freno real deja de ser la máquina y pasa a ser
 * el tope diario, que es donde debe estar la decisión.
 */
const POR_PASADA = 500;
const EN_PARALELO = 25;

/**
 * Cuánto puede durar la tanda antes de ceder el turno.
 *
 * La función serverless muere a los 60 s, y la campaña corre DESPUÉS de los
 * flujos de pedido, los carritos y las encuestas: el tiempo que sobra no es
 * siempre el mismo. Cortando por reloj, la tanda deja lo que no le dio tiempo
 * para la pasada siguiente en vez de que la plataforma la mate a mitad.
 *
 * No se pierde nada al cortar: cada envío se marca en su fila en cuanto sale,
 * así que lo enviado queda enviado y lo pendiente sigue pendiente.
 */
const TOPE_SEGUNDOS = 40;

/**
 * Cuántos rechazos de Meta seguidos bastan para parar la campaña.
 *
 * Cuando Meta empieza a devolver «healthy ecosystem engagement» está avisando
 * de que el número se está quemando. Seguir enviando después de eso es
 * cambiar una campaña por la línea entera.
 */
const RECHAZOS_PARA_PARAR = 8;

export interface ResultadoCampana {
  campana?: string;
  enviados: number;
  fallidos: number;
  restantes: number;
  motivo?: string;
}

const horaColombia = (d = new Date()) => new Date(d.getTime() - 5 * 3_600_000).getUTCHours();

/**
 * Manda la siguiente tanda de la campaña activa.
 *
 * Una campaña a la vez: dos campañas en paralelo duplican el ritmo sobre el
 * mismo número y es justo lo que se está tratando de evitar.
 */
export async function procesarCampanas(): Promise<ResultadoCampana> {
  const vacio = { enviados: 0, fallidos: 0, restantes: 0 };

  const campana = await prisma.campana.findFirst({
    where: { estado: 'enviando' },
    orderBy: { createdAt: 'asc' },
  });
  if (!campana) return vacio;

  // Pasada la hora de fin, lo pendiente se queda sin enviar: anunciar una
  // promo que ya acabó es peor que no anunciarla.
  if (campana.finAt && new Date() >= campana.finAt) {
    await prisma.campana.update({ where: { id: campana.id }, data: { estado: 'terminada' } });
    return { ...vacio, campana: campana.nombre, motivo: 'pasó la hora de fin de la campaña' };
  }

  const hora = horaColombia();
  if (hora < campana.horaInicio || hora >= campana.horaFin) {
    return { ...vacio, campana: campana.nombre, motivo: 'fuera de la franja horaria' };
  }

  // Sin plantilla aprobada no se manda nada, y la cola se queda quieta.
  const plantilla = await prisma.messageTemplate.findFirst({
    where: { name: campana.plantilla, status: 'APPROVED' },
    select: { id: true, content: true },
  });
  if (!plantilla) {
    return { ...vacio, campana: campana.nombre, motivo: 'la plantilla todavía no está aprobada' };
  }

  // El nombre solo va si la plantilla tiene dónde ponerlo. Mandarle un
  // parámetro a una plantilla sin {{1}} no se ignora: Meta rechaza el envío
  // entero por número de parámetros incorrecto.
  const llevaNombre = /\{\{1\}\}/.test(plantilla.content ?? '');

  // Tope diario: se cuenta lo enviado en las últimas 24 h de ESTA campaña.
  const enviadosHoy = await prisma.campanaDestinatario.count({
    where: { campanaId: campana.id, enviadoAt: { gte: new Date(Date.now() - 86_400_000) } },
  });
  if (enviadosHoy >= campana.topeDiario) {
    return { ...vacio, campana: campana.nombre, motivo: `tope diario alcanzado (${enviadosHoy})` };
  }

  /**
   * Ritmo por hora: lo que convierte la campaña en tandas y no en una ráfaga.
   *
   * Con solo el tope diario, 500 por pasada y una pasada por minuto, un cupo de
   * 14.000 se gasta en media hora. Eso es exactamente lo que castiga Meta, y
   * además deja sin efecto el freno por rechazos: cuando avisa, ya salieron
   * todos. Con el goteo, el freno llega a tiempo de proteger al resto.
   */
  let cupo = Math.min(POR_PASADA, campana.topeDiario - enviadosHoy);

  if (campana.topePorHora) {
    const enviadosUltimaHora = await prisma.campanaDestinatario.count({
      where: { campanaId: campana.id, enviadoAt: { gte: new Date(Date.now() - 3_600_000) } },
    });

    /**
     * Tandas de verdad, no cuatro ráfagas y 56 minutos de silencio.
     *
     * Con solo el tope de la hora, 1.800 salen en cuatro pasadas de 500 y
     * después la campaña calla hasta que la ventana rueda. Limitando cada
     * pasada a una doceava parte del ritmo, la misma hora se reparte en tandas
     * de ~150 cada cinco minutos.
     *
     * Se mide contra la ventana de una hora y no contra un reloj fijo a
     * propósito: si una pasada se pierde —el candado del cron, una pasada larga
     * de otro flujo—, lo que no salió se recupera dentro de la misma hora en
     * vez de perderse.
     */
    const porTanda = Math.max(1, Math.ceil(campana.topePorHora / 12));
    cupo = Math.min(cupo, porTanda, campana.topePorHora - enviadosUltimaHora);
    if (cupo <= 0) {
      return {
        ...vacio, campana: campana.nombre,
        motivo: `ritmo por hora alcanzado (${enviadosUltimaHora}/${campana.topePorHora})`,
      };
    }
  }

  const tanda = await prisma.campanaDestinatario.findMany({
    where: { campanaId: campana.id, estado: 'pendiente' },
    orderBy: [{ prioridad: 'asc' }, { id: 'asc' }],
    take: cupo,
  });

  if (!tanda.length) {
    await prisma.campana.update({ where: { id: campana.id }, data: { estado: 'terminada' } });
    return { ...vacio, campana: campana.nombre, motivo: 'no quedan destinatarias' };
  }

  const res: ResultadoCampana = { campana: campana.nombre, enviados: 0, fallidos: 0, restantes: 0 };
  let rechazosSeguidos = 0;
  let parar = false;
  const empezo = Date.now();

  /**
   * Las bajas de toda la tanda en UNA consulta, no una por destinataria.
   *
   * Releerlas en cada envío costaba un viaje a Montreal por mensaje —~35 ms— y
   * con 150 por pasada eso es más de cinco segundos gastados en preguntar lo
   * mismo. La tanda dura segundos, así que consultarlas al empezar mantiene la
   * garantía que importa: quien pidió la baja antes de esta tanda no recibe.
   */
  const bajas = new Set(
    (await prisma.bajaMarketing.findMany({
      where: { customerId: { in: tanda.map(d => d.customerId) } },
      select: { customerId: true },
    })).map(b => b.customerId),
  );

  const enviarUno = async (d: (typeof tanda)[number]) => {
    if (parar) return;
    if (bajas.has(d.customerId)) {
      await marcar(d.id, 'omitido', 'Pidió no recibir promociones.');
      return;
    }

    try {
      const nombre = (d.nombre || '').trim().split(/\s+/)[0] || 'hermosa';
      const params = llevaNombre ? [nombre] : [];
      const envio = await sendWhatsAppTemplate(
        d.telefono, campana.plantilla, 'es', params,
        campana.imagenUrl ? { headerImageUrl: campana.imagenUrl } : {},
        campana.linea ?? undefined,
      );
      const wamid = envio?.messages?.[0]?.id ?? null;

      await prisma.campanaDestinatario.update({
        where: { id: d.id },
        data: { estado: 'enviado', enviadoAt: new Date(), wamid },
      });
      res.enviados++;
      rechazosSeguidos = 0;

      // Queda en la bandeja para que la agente vea el contexto si contesta.
      await registrarPlantillaEnLinea(d.customerId, campana.linea, campana.plantilla, params, wamid ?? undefined)
        .catch(() => {});
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      await marcar(d.id, 'fallido', motivo.slice(0, 200));
      res.fallidos++;

      /**
       * El freno que de verdad importa.
       *
       * «healthy ecosystem engagement» no es un fallo de ese mensaje: es Meta
       * diciendo que el número está mandando demasiado marketing sin respuesta.
       * Insistir cuesta la calificación, y con ella los mensajes de pedido de
       * todo el negocio. La campaña se pausa sola y queda dicho por qué.
       */
      if (/healthy ecosystem|engagement/i.test(motivo)) {
        rechazosSeguidos++;
        if (rechazosSeguidos >= RECHAZOS_PARA_PARAR) {
          parar = true;
          await prisma.campana.update({
            where: { id: campana.id },
            data: { estado: 'pausada' },
          });
          res.motivo = `pausada: Meta rechazó ${rechazosSeguidos} seguidos por saturación de marketing`;
          console.error('[Campaña] pausada por rechazos de Meta:', campana.nombre);
        }
      }
    }
  };

  // De a EN_PARALELO. El corte por rechazos se comprueba entre grupos, así que
  // como mucho salen los del grupo en curso después del aviso de Meta.
  for (let i = 0; i < tanda.length && !parar; i += EN_PARALELO) {
    if (Date.now() - empezo > TOPE_SEGUNDOS * 1000) {
      res.motivo = 'tanda cortada por tiempo; sigue en la próxima pasada';
      break;
    }
    await Promise.all(tanda.slice(i, i + EN_PARALELO).map(enviarUno));
  }

  res.restantes = await prisma.campanaDestinatario.count({
    where: { campanaId: campana.id, estado: 'pendiente' },
  });
  return res;
}

async function marcar(id: string, estado: string, error?: string) {
  await prisma.campanaDestinatario.update({
    where: { id },
    data: { estado, error: error ?? null, enviadoAt: new Date() },
  }).catch(() => {});
}
