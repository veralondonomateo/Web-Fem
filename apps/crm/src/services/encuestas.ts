/**
 * Encuesta de satisfacción: se le pregunta a la clienta qué tal la atendieron.
 *
 * CÓMO FUNCIONA
 *
 *   1. La conversación se cierra.
 *   2. Diez minutos después se le manda una lista de cinco opciones (1 a 5
 *      estrellas). Un toque y listo: no hay que escribir nada.
 *   3. La respuesta entra por el webhook de Meta, se guarda aquí y NO se
 *      registra como mensaje de la conversación.
 *
 * POR QUÉ NADA DE ESTO SE GUARDA COMO MENSAJE
 *
 * Si la pregunta y la nota vivieran en el hilo, la agente vería en su bandeja la
 * calificación que le pusieron —y podría pedirle a la clienta que le ponga
 * cinco—. Medir así no mide nada. Por eso el intercambio existe en el teléfono
 * de la clienta y en esta tabla, pero no en la bandeja.
 *
 * POR QUÉ NO SE ENGANCHA AL CIERRE DE LA CONVERSACIÓN
 *
 * Hay cuatro sitios distintos que marcan una conversación como resuelta (la
 * bandeja, responder, mandar un adjunto y la asistente). Enganchar el disparo a
 * cada uno es garantizarse que el quinto que aparezca se olvide. En vez de eso
 * el cron pregunta cada minuto «¿qué se cerró y todavía no tiene encuesta?»:
 * una sola consulta, y ningún camino de cierre se puede escapar.
 */
import { prisma } from '@/lib/prisma';
import { sendWhatsAppInteractiveList, sendWhatsAppMessage } from '@/services/whatsapp';
import {
  DIAS_ENTRE_ENCUESTAS, ESPERA_MINUTOS, OPCIONES_ESTRELLAS, TEXTO_ENCUESTA,
  VENTANA_HORAS, calificacionDe, calificacionDeLista, idOpcion,
} from '@/lib/encuestas';

/** Cuántas conversaciones se revisan y cuántas encuestas salen por pasada. */
const TOPE_PROGRAMAR = 60;
const TOPE_ENVIAR    = 25;

/**
 * Tope de encuestas en 24 horas.
 *
 * Hoy se cierran unas 430 conversaciones atendidas por una persona al día, así
 * que 600 deja sitio de sobra y solo actúa si algo se descuadra. Importa que
 * sobre: un tope que cortara a la mitad del día no ahorraría nada y además
 * sesgaría la medición, porque solo quedarían medidas las mañanas.
 *
 * Existe porque un número de WhatsApp que empieza a mandar cientos de mensajes
 * que nadie contesta pierde calidad ante Meta, y perder la línea cuesta mucho
 * más que perder unas encuestas.
 */
const TOPE_DIARIO = 600;

/**
 * Interruptor de emergencia: `ENCUESTAS_PAUSADAS=true` en el entorno y deja de
 * preguntar sin tener que desplegar nada. Lo programado se queda en cola y sale
 * cuando se vuelva a activar (si para entonces sigue teniendo sentido: la
 * ventana de 24 h se comprueba igual en cada intento).
 */
const pausadas = () => process.env.ENCUESTAS_PAUSADAS === 'true';

/**
 * Cuánto hacia atrás se mira para programar.
 *
 * Corto a propósito. El cron corre cada minuto, así que tres cuartos de hora
 * sobran para cubrir cualquier tropiezo; y el día que esto se encienda por
 * primera vez evita que salgan de golpe cien encuestas de conversaciones que se
 * cerraron esta mañana, que es lo que haría una ventana generosa.
 */
const VENTANA_PROGRAMACION = '45 minutes';

interface FilaProgramable {
  id: string;
  customer_id: string;
  meta_account_id: string | null;
  /** Lo último que pasó entre una persona y la clienta. De ahí cuelga la espera. */
  fin_atencion: Date;
  agente_id: string | null;
  agente_nombre: string | null;
}

/**
 * Crea las encuestas de lo que se acaba de cerrar.
 *
 * QUÉ CUENTA COMO «SE CERRÓ», Y POR QUÉ NO ES `updated_at`
 *
 * La primera versión miraba `conversations.updated_at`. Estaba mal, y en
 * producción se vio enseguida: cada mensaje automático —el paso del pedido, el
 * recordatorio del carrito, el seguimiento postventa— toca la fila de la
 * conversación y le mueve esa fecha. Una conversación cerrada el lunes volvía a
 * parecer recién cerrada el jueves porque le salió un aviso de envío, y la
 * clienta recibía «¿cómo te pareció la atención?» sin venir a cuento. De las
 * primeras 124 encuestas, 13 salieron así, una de ellas seis días tarde.
 *
 * Lo que se exige ahora son dos cosas, y las dos hacen falta:
 *
 *   1. Que el ÚLTIMO mensaje nuestro sea de una persona. Si lo último que le
 *      salió a la clienta fue un aviso de envío, la conversación no la cerró
 *      nadie: la cerró un flujo, y no hay atención que calificar.
 *   2. Que ese mensaje sea de hace un rato. Es lo que significa «acaba de
 *      terminar de hablar con alguien».
 *
 * La segunda sin la primera no basta, y eso también se vio en producción. Una
 * clienta reacciona con un ❤️ al mensaje del pedido, o contesta «no estoy en
 * casa»: eso es lo más reciente que ha escrito, así que parecía que la
 * conversación acabara de terminar. Cuatro encuestas salieron por ahí, y una de
 * ellas le puso una estrella a Luciana por una conversación que Luciana no tuvo
 * —su último mensaje era de 28 horas antes—. Calificar a alguien por lo que
 * hizo un flujo es exactamente lo contrario de lo que este módulo existe para
 * hacer.
 *
 * La espera de diez minutos sí cuelga del último mensaje entre personas, sea de
 * la agente o de la clienta: si ella contesta «gracias» después, la encuesta
 * espera a partir de ahí.
 */
export async function programarEncuestas(): Promise<number> {
  const candidatas = await prisma.$queryRaw<FilaProgramable[]>`
    SELECT c.id, c.customer_id, c.meta_account_id,
           GREATEST(h.escrito_at, e.escrito_at) AS fin_atencion,
           COALESCE(c.assigned_to, h.sent_by_id) AS agente_id,
           u.name AS agente_nombre
    FROM conversations c
    JOIN customers cl ON cl.id = c.customer_id
    -- El último mensaje NUESTRO, venga de quien venga. Que lo haya escrito una
    -- persona se exige abajo, en el WHERE, y no aquí dentro: filtrando aquí,
    -- esta consulta se saltaría por encima del aviso automático que salió
    -- después y volvería el mismo agujero que se quiso cerrar.
    --
    -- Quien lo escribió es además a quien califica la clienta, más que la
    -- asignación formal: quien contestó es quien atendió.
    JOIN LATERAL (
      SELECT sent_by_id, created_at AS escrito_at FROM messages
      WHERE conversation_id = c.id AND direction = 'OUTBOUND'
      ORDER BY created_at DESC LIMIT 1
    ) h ON true
    -- Y lo último que escribió ella, que además es lo que abre la ventana de 24 h.
    JOIN LATERAL (
      SELECT created_at AS escrito_at FROM messages
      WHERE conversation_id = c.id AND direction = 'INBOUND'
      ORDER BY created_at DESC LIMIT 1
    ) e ON true
    LEFT JOIN crm_users u ON u.id = COALESCE(c.assigned_to, h.sent_by_id)
    WHERE c.status = 'RESOLVED'
      AND c.channel = 'WHATSAPP'
      -- Filtro barato primero, y no cambia el resultado: si la última palabra
      -- humana es de hace un rato, el último mensaje de la conversación también
      -- lo es. Sirve para que el índice recorte a un puñado de filas antes de
      -- que los LATERAL miren mensaje por mensaje.
      AND c.last_message_at >= now() - ${VENTANA_PROGRAMACION}::interval
      -- Lo último que le salió a la clienta lo escribió una persona…
      AND h.sent_by_id IS NOT NULL
      -- …y lo escribió hace un rato.
      AND h.escrito_at >= now() - ${VENTANA_PROGRAMACION}::interval
      -- Sin ventana de WhatsApp abierta no se va a poder preguntar: no se
      -- programa siquiera, para no llenar la tabla de omitidas.
      AND e.escrito_at >= now() - ${`${VENTANA_HORAS} hours`}::interval
      -- Se admite tanto el celular como la identidad de Meta de quien oculta su
      -- número («CO.834743…»): a las dos se les puede escribir texto libre
      -- dentro de la ventana, que es justo lo que es la encuesta.
      AND (cl.phone LIKE '+%' OR cl.phone ~ '^[A-Z]{2}\.[0-9]+$')
      AND NOT EXISTS (SELECT 1 FROM encuestas_conversacion x WHERE x.conversation_id = c.id)
      AND NOT EXISTS (
        SELECT 1 FROM encuestas_conversacion x
        WHERE x.customer_id = c.customer_id
          AND x.created_at >= now() - ${`${DIAS_ENTRE_ENCUESTAS} days`}::interval
      )
    ORDER BY GREATEST(h.escrito_at, e.escrito_at) DESC
    LIMIT ${TOPE_PROGRAMAR}`;

  if (!candidatas.length) return 0;

  const creadas = await prisma.encuestaConversacion.createMany({
    data: candidatas.map(c => ({
      conversationId: c.id,
      customerId: c.customer_id,
      metaAccountId: c.meta_account_id,
      agentId: c.agente_id,
      agentName: c.agente_nombre,
      enviarAt: new Date(new Date(c.fin_atencion).getTime() + ESPERA_MINUTOS * 60_000),
    })),
    // Una conversación, una encuesta: lo garantiza el índice único de
    // `conversation_id`. Con `skipDuplicates`, si dos pasadas llegaran a
    // solaparse la segunda no tumba la tanda entera, simplemente no repite.
    skipDuplicates: true,
  });

  return creadas.count;
}

export interface ResultadoEnvio {
  enviadas: number;
  omitidas: number;
  errores: number;
}

/** Manda las encuestas que ya cumplieron su espera. */
export async function enviarEncuestasVencidas(): Promise<ResultadoEnvio> {
  const res: ResultadoEnvio = { enviadas: 0, omitidas: 0, errores: 0 };
  if (pausadas()) return res;

  const enviadasHoy = await prisma.encuestaConversacion.count({
    where: { enviadaAt: { gte: new Date(Date.now() - 86_400_000) } },
  });
  if (enviadasHoy >= TOPE_DIARIO) {
    console.warn(`[Encuestas] tope diario alcanzado (${enviadasHoy}); no se manda ninguna más hasta que baje.`);
    return res;
  }

  const pendientes = await prisma.encuestaConversacion.findMany({
    where: { estado: 'PROGRAMADA', enviarAt: { lte: new Date() } },
    orderBy: { enviarAt: 'asc' },
    take: Math.min(TOPE_ENVIAR, TOPE_DIARIO - enviadasHoy),
    include: {
      customer:     { select: { phone: true } },
      conversation: { select: { status: true } },
    },
  });

  for (const encuesta of pendientes) {
    try {
      // La clienta volvió a escribir: el asunto no estaba cerrado y preguntarle
      // qué tal la atendieron en mitad de otra cosa sobra.
      if (encuesta.conversation.status !== 'RESOLVED') {
        await omitir(encuesta.id, 'La conversación se reabrió antes de preguntar.');
        res.omitidas++;
        continue;
      }

      // La ventana se mide desde el último mensaje DE ELLA, que es lo que la
      // abre. El último mensaje de la conversación puede ser nuestro.
      const ultimoSuyo = await prisma.message.findFirst({
        where: { conversationId: encuesta.conversationId, direction: 'INBOUND' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const limite = Date.now() - VENTANA_HORAS * 3_600_000;
      if (!ultimoSuyo || ultimoSuyo.createdAt.getTime() < limite) {
        await omitir(encuesta.id, 'La ventana de 24 h de WhatsApp ya estaba cerrada.');
        res.omitidas++;
        continue;
      }

      await sendWhatsAppInteractiveList(
        encuesta.customer.phone,
        TEXTO_ENCUESTA.cuerpo,
        TEXTO_ENCUESTA.boton,
        TEXTO_ENCUESTA.seccion,
        OPCIONES_ESTRELLAS.map(o => ({
          id: idOpcion(o.estrellas),
          title: o.titulo,
          description: o.descripcion,
        })),
        encuesta.metaAccountId ? await numeroDeLinea(encuesta.metaAccountId) : undefined,
      );

      await prisma.encuestaConversacion.update({
        where: { id: encuesta.id },
        data: { estado: 'ENVIADA', enviadaAt: new Date() },
      });
      res.enviadas++;
    } catch (e) {
      res.errores++;
      const motivo = e instanceof Error ? e.message : String(e);
      console.error('[Encuestas] fallo enviando', encuesta.id, motivo);

      // Un tropiezo de Meta no debe costar la encuesta: se reintenta en un
      // rato. Pero tampoco puede reintentarse para siempre, así que a las seis
      // horas se da por perdida con el motivo escrito.
      const vieja = Date.now() - encuesta.createdAt.getTime() > 6 * 3_600_000;
      if (vieja) {
        await omitir(encuesta.id, `No se pudo enviar: ${motivo.slice(0, 160)}`);
      } else {
        await prisma.encuestaConversacion.update({
          where: { id: encuesta.id },
          data: { enviarAt: new Date(Date.now() + 15 * 60_000) },
        }).catch(() => {});
      }
    }
  }

  return res;
}

async function omitir(id: string, motivo: string) {
  await prisma.encuestaConversacion.update({
    where: { id },
    data: { estado: 'OMITIDA', motivo },
  }).catch(() => {});
}

/** phone_number_id de Meta a partir del id interno de la línea. */
const cacheLinea = new Map<string, string>();
async function numeroDeLinea(metaAccountId: string): Promise<string | undefined> {
  const guardado = cacheLinea.get(metaAccountId);
  if (guardado) return guardado;
  const cuenta = await prisma.metaAccount.findUnique({
    where: { id: metaAccountId },
    select: { accountId: true },
  });
  if (cuenta?.accountId) cacheLinea.set(metaAccountId, cuenta.accountId);
  return cuenta?.accountId;
}

/**
 * ¿Este mensaje entrante es la respuesta a una encuesta?
 *
 * Se llama desde el webhook ANTES de guardar el mensaje. Si devuelve true, el
 * webhook se retira: no crea el mensaje, no reabre la conversación y no dispara
 * nada más. Esa es toda la razón de que la agente no vea su nota.
 *
 * Es estricto a propósito. Un «5» suelto puede ser la respuesta a la encuesta o
 * puede ser «quiero 5 cajas»; ante la duda devuelve false y el mensaje sigue su
 * camino normal, que es el error barato. Tragarse un mensaje de verdad —que la
 * clienta escriba y nadie lo vea— sería el caro.
 */
export async function registrarRespuestaEncuesta(
  customerId: string, metaAccountId: string | null, message: any,
): Promise<boolean> {
  /**
   * Lo primero, y a propósito: esto corre en CADA mensaje que entra —unos dos
   * mil al día— y la inmensa mayoría no se parecen a una calificación. Mirarlo
   * antes de tocar la base deja el coste en una expresión regular en vez de en
   * una consulta por mensaje.
   */
  const porLista = calificacionDeLista(message);
  const estrellas = porLista ?? calificacionDe(message);
  if (estrellas === null) return false;

  // Meta reenvía el mismo mensaje si tardamos en contestarle. La copia se
  // reconoce por el wamid y se descarta sin volver a contarla.
  if (message?.id) {
    const yaContada = await prisma.encuestaConversacion.findFirst({
      where: { respuestaWamid: String(message.id) },
      select: { id: true },
    });
    if (yaContada) return true;
  }

  const encuesta = await prisma.encuestaConversacion.findFirst({
    where: {
      customerId,
      estado: 'ENVIADA',
      // Pasadas seis horas, un número suelto ya no se lee como respuesta a algo
      // que se preguntó esta mañana.
      enviadaAt: { gte: new Date(Date.now() - 6 * 3_600_000) },
      ...(metaAccountId ? { metaAccountId } : {}),
    },
    orderBy: { enviadaAt: 'desc' },
  });
  if (!encuesta?.enviadaAt) return false;

  /**
   * La cautela de «tiene que ser lo primero que contesta» es solo para el
   * número tecleado, y esa distinción costó dieciséis calificaciones.
   *
   * Se aplicaba a todo, y en la práctica la clienta hace esto: le llega la
   * encuesta, escribe «gracias» —o reacciona con un ❤️, o manda una foto, o
   * aprovecha para preguntar cómo se toman las pastillas— y DESPUÉS toca la
   * estrella. Con la cautela puesta, esa estrella se descartaba: la nota se
   * perdía y, peor, el mensaje seguía su camino normal y la agente veía
   * «⭐⭐⭐⭐⭐» en su bandeja, que es justo lo que este módulo no puede permitir.
   *
   * Tocar la opción de la lista no tiene esa ambigüedad: un `csat_4` solo lo
   * puede haber generado nuestra encuesta. Se acepta escribiera lo que
   * escribiera por el medio.
   */
  if (porLista === null) {
    const escribioDespues = await prisma.message.findFirst({
      where: {
        conversationId: encuesta.conversationId,
        direction: 'INBOUND',
        createdAt: { gt: encuesta.enviadaAt },
      },
      select: { id: true },
    });
    if (escribioDespues) return false;
  }

  await prisma.encuestaConversacion.update({
    where: { id: encuesta.id },
    data: {
      estado: 'RESPONDIDA',
      estrellas,
      respondidaAt: new Date(),
      respuestaWamid: message?.id ? String(message.id) : null,
    },
  });

  // El gracias también sale fuera de la bandeja: si se registrara, la agente
  // sabría que hubo calificación y en qué momento.
  const cliente = await prisma.customer.findUnique({
    where: { id: customerId }, select: { phone: true },
  });
  if (cliente?.phone) {
    await sendWhatsAppMessage(
      cliente.phone, TEXTO_ENCUESTA.gracias, undefined,
      encuesta.metaAccountId ? await numeroDeLinea(encuesta.metaAccountId) : undefined,
    ).catch(e => console.error('[Encuestas] no se pudo agradecer', e));
  }

  return true;
}

/** Lo que corre el cron: programar lo nuevo y mandar lo vencido. */
export async function procesarEncuestas() {
  const programadas = await programarEncuestas();
  const envios = await enviarEncuestasVencidas();
  return { programadas, ...envios };
}
