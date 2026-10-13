import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);
  const channel = searchParams.get('channel');
  const status  = searchParams.get('status');
  const tag     = searchParams.get('tag');
  const agentId = searchParams.get('agentId');
  const search  = searchParams.get('search');
  const page    = parseInt(searchParams.get('page')  || '1');
  const limit   = parseInt(searchParams.get('limit') || '30');
  const skip    = (page - 1) * limit;

  const where: any = {};
  if (channel) where.channel = channel;
  if (status) {
    where.status = status;
  } else {
    // Sin filtro explícito, «abiertas» no incluye las resueltas. Antes venían
    // en la misma lista y se descartaban en el navegador: la conversación que
    // la agente acababa de resolver seguía a la vista, y además ocupaba sitio
    // en la tanda, dejando fuera a otra que sí necesitaba atención.
    where.status = { not: 'RESOLVED' };
  }
  if (agentId) where.assignedTo = agentId;
  if (tag)     where.tags = { has: tag };
  // El correo entra en la búsqueda igual que el nombre y el teléfono: la
  // clienta que compró por la tienda se identifica antes por su correo —es lo
  // que aparece en el pedido— que por un celular que puede haber cambiado.
  if (search)  where.customer = { OR: [
    { name:  { contains: search, mode: 'insensitive' } },
    { phone: { contains: search } },
    { email: { contains: search, mode: 'insensitive' } },
  ] };
  // Con dos líneas de WhatsApp en la misma cuenta, cada agente ve solo la
  // suya. NULL (admin) ve todas — no se agrega condición.
  if (user.metaAccountId) {
    // Se incluyen las que quedaron SIN línea. No deberían existir —y ya se
    // corrigió lo que las producía— pero cuando existieron no le salieron a
    // nadie: diez clientas estuvieron un día sin respuesta, una de ellas con un
    // «CONFIRMO» sin procesar. Que la vean las dos agentes es un problema
    // menor; que no la vea ninguna es perder a la clienta.
    where.OR = [{ metaAccountId: user.metaAccountId }, { metaAccountId: null }];
  } else {
    // La admin sí puede elegir una línea concreta desde la bandeja. El filtro
    // va aquí y no en el navegador porque la lista se pide de a 100: filtrar
    // después de recibirlas solo escondería parte de esas 100, no traería las
    // que faltan de la línea elegida.
    const linea = searchParams.get('metaAccountId');
    if (linea) where.metaAccountId = linea;
  }

  /**
   * «Sin responder»: la última palabra la tuvo la clienta.
   *
   * Este filtro tiene que resolverse en la base, no en el navegador. La bandeja
   * pide las 100 conversaciones más recientes y antes filtraba esas 100: con
   * cientos de mensajes automáticos al día, los envíos del CRM copaban la
   * ventana y enterraban a quien de verdad esperaba respuesta. Medido en
   * producción: 2.473 clientas esperando y la agente solo veía 40.
   */
  let totalPendientes: number | null = null;
  let totalNoEntregados: number | null = null;
  let ordenPendientes: string[] | null = null;

  const quierePendientes   = searchParams.get('pendientes') === '1';
  const quiereNoEntregados = searchParams.get('noEntregados') === '1';

  if (quierePendientes || quiereNoEntregados) {
    // La línea y la búsqueda entran aquí dentro, no después. Traer una tanda de
    // ids y filtrarla luego recorta la tanda en vez de correrla: a Lina le
    // llegaban 500 ids de las dos líneas y se quedaba viendo las pocas suyas.
    const filtroLinea = user.metaAccountId
      ? Prisma.sql`AND (c.meta_account_id = ${user.metaAccountId} OR c.meta_account_id IS NULL)`
      : (() => {
          const l = searchParams.get('metaAccountId');
          return l ? Prisma.sql`AND c.meta_account_id = ${l}` : Prisma.empty;
        })();
    // La clienta solo se une cuando se la va a mirar, que es al buscar por
    // nombre o teléfono. `customer_id` es NOT NULL y tiene clave foránea, así
    // que el JOIN no descarta ni duplica ninguna fila: sin búsqueda no cambia
    // el resultado, solo el trabajo. Y el trabajo era todo el listín: Postgres
    // recorría las 25.746 clientas enteras para armar el hash antes de mirar
    // una sola conversación. Medido en producción sobre el contador de la
    // pestaña —el que corre cada 30 s por agente—: 28,8 ms → 11,5 ms, con el
    // mismo número al final (179).
    const unirClienta = search
      ? Prisma.sql`JOIN customers k ON k.id = c.customer_id`
      : Prisma.empty;
    const filtroBusqueda = search
      ? Prisma.sql`AND (k.name ILIKE ${'%' + search + '%'} OR k.phone LIKE ${'%' + search + '%'} OR k.email ILIKE ${'%' + search + '%'})`
      : Prisma.empty;

    /**
     * Las dos vistas miran lo mismo —el ÚLTIMO mensaje de la conversación— y
     * cambian solo en qué esperan de él.
     *
     *  · «sin responder»: la última palabra la tuvo la clienta.
     *  · «no entregados»: lo último que se hizo fue escribirle y no llegó.
     *
     * El segundo hacía falta porque un mensaje rechazado por WhatsApp solo se
     * veía entrando al chat: había 180 conversaciones abiertas cuyo último
     * mensaje nunca llegó a la clienta y nadie tenía forma de saberlo.
     *
     * La respuesta ya viene escrita en la conversación
     * (`last_message_direction` / `last_message_status`). Antes se deducía en
     * cada consulta con un LATERAL al último mensaje, y eso es una búsqueda por
     * conversación ABIERTA: 544 en una línea, 5.307 en total, cada ocho
     * segundos y por cada agente. Con la respuesta guardada, un índice parcial
     * la sirve ya ordenada. Medido en producción sobre el contador de la
     * pestaña: 28,8 ms → 0,6 ms, y la lista de 30, 4,4 ms → 0,7 ms.
     *
     * Quien mantiene esas dos columnas es un trigger en `messages`
     * (`messages_sync_ultimo`), no este código ni el webhook: así ninguna vía
     * de escritura puede olvidarse: el webhook de Meta, «Escribir a alguien»,
     * los flujos y cualquier script futuro pasan todos por ahí. Si algún día se
     * sospecha que se desviaron, el chequeo y el arreglo están en
     * `scripts/despues-de-db-push.sql`.
     */
    const filtroUltimo = quiereNoEntregados
      ? Prisma.sql`AND c.last_message_direction = 'OUTBOUND' AND c.last_message_status = 'FAILED'`
      // «Sin responder» es que le falta respuesta DE UNA PERSONA, no que ella
      // haya hablado última. Antes se miraba `last_message_direction` y por eso
      // un aviso automático del envío borraba su pregunta de esta pestaña:
      // 1.067 conversaciones estaban escondidas así.
      : Prisma.sql`AND c.sin_responder`;

    const condiciones = Prisma.sql`
      FROM conversations c
      ${unirClienta}
      WHERE c.status <> 'RESOLVED' ${filtroUltimo} ${filtroLinea} ${filtroBusqueda}`;

    // Se pagina en la base. Antes se pedían 500 ids y ahí se acababa la lista:
    // con 2.505 clientas esperando, 2.005 no aparecían por ningún lado y el
    // contador decía «500», que no era la cola sino el tope de la consulta.
    //
    // El orden va SIN `NULLS LAST`, y no es un descuido: esas dos palabras
    // impiden usar el índice. Un btree recorrido hacia atrás da NULLS FIRST,
    // así que pedir `DESC NULLS LAST` obliga a Postgres a recorrer y ordenar
    // todas las conversaciones abiertas antes de quedarse con 30, en vez de
    // bajar por el índice y parar en cuanto las junta.
    //
    // Es seguro porque `last_message_at` no es nulo en ninguna de las 9.445
    // conversaciones: lo ponen al crearla tanto el webhook como «Escribir a
    // alguien». Si algún día apareciera uno nulo, esa conversación saldría la
    // primera en vez de la última —un orden raro, no una conversación perdida—.
    /**
     * El contador va aparte, y solo cuando lo piden.
     *
     * Ya no cuesta lo que costaba —0,6 ms contra los 64 ms de cuando había que
     * mirar el último mensaje de cada conversación abierta—, pero sigue siendo
     * una consulta más para recalcular un número que cambia de uno en uno. La
     * bandeja lo pide cada 30 s (`withTotal=1`) y entre medias se queda con el
     * último que recibió: el número puede ir medio minuto por detrás; la lista,
     * que es lo que se mira, va al día.
     */
    /**
     * En «sin responder» ordena la fecha del mensaje DE ELLA, no la del último
     * mensaje de la conversación. Con `last_message_at`, un aviso automático
     * del pedido colaba a una clienta que escribió el sábado en el sitio del
     * domingo: en la lista no parecía la que más llevaba esperando y se la
     * atendía tarde. Medido: 40 conversaciones descolocadas, la peor por 95 h.
     *
     * `COALESCE` por si alguna no tiene mensaje suyo —no debería, para estar
     * aquí ella tuvo que escribir— y así nunca cae al final por un nulo.
     */
    const ordenCola = quiereNoEntregados
      ? Prisma.sql`c.last_message_at DESC`
      : Prisma.sql`COALESCE(c.ultimo_suyo_at, c.last_message_at) DESC`;

    const pagina = await prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id ${condiciones}
      ORDER BY ${ordenCola}
      LIMIT ${limit} OFFSET ${skip}`;
    ordenPendientes = pagina.map(x => x.id);

    if (searchParams.get('withTotal') === '1') {
      const conteo = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) n ${condiciones}`;
      const total = Number(conteo[0]?.n ?? 0);
      if (quiereNoEntregados) totalNoEntregados = total;
      else totalPendientes = total;
    }
  }

  const conversations = await prisma.conversation.findMany({
    /**
     * Las cuatro relaciones se traen en la MISMA consulta, no en cuatro.
     *
     * Por defecto Prisma resuelve cada `include` con una consulta aparte: una
     * para las conversaciones y luego una por la clienta, la agente, el último
     * mensaje y la línea. Cinco viajes en vez de uno.
     *
     * Y ese es el coste real, porque las consultas en sí no tardan nada: las
     * cinco juntas suman ~7 ms de trabajo en Postgres. Lo que se paga es la
     * distancia. Las funciones corren en Washington y la base está en Montreal,
     * así que cada viaje cuesta ~35 ms mirando el reloj —medido comparando esta
     * ruta con `/api/health`, que hace una sola consulta—. Cuatro viajes de más
     * son ~140 ms que no hacen nada salvo viajar, y la bandeja los paga cada
     * ocho segundos por cada agente.
     *
     * Con `join` Prisma resuelve las relaciones con LATERAL JOIN dentro de la
     * misma consulta. Comprobado que devuelve exactamente lo mismo sobre nueve
     * formas distintas de pedir la lista —las dos pestañas, filtrada por línea,
     * paginada, resueltas, conversaciones sin ningún mensaje y lotes de 100—,
     * comparando el JSON completo carácter a carácter.
     */
    relationLoadStrategy: 'join',
    // En «sin responder» la página ya viene resuelta y ordenada por la consulta
    // de arriba; pedir de nuevo skip/take volvería a paginar sobre lo paginado.
    ...(ordenPendientes
      ? { where: { id: { in: ordenPendientes } } }
      : { where, skip, take: limit }),
    // El mismo orden que la consulta de arriba, o Prisma lo desharía: sin esto
    // la cola volvía a ordenarse por `lastMessageAt` y el arreglo no se notaba.
    orderBy: ordenPendientes && !quiereNoEntregados
      ? [{ ultimoSuyoAt: 'desc' as const }, { lastMessageAt: 'desc' as const }]
      : { lastMessageAt: 'desc' as const },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true, city: true, ltv: true, totalOrders: true } },
      agent:    { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      // Solo para quien ve más de una línea (admin): sin esto, las dos
      // bandejas se ven mezcladas y no hay forma de saber cuál es cuál.
      metaAccount: { select: { accountName: true } },
      // Si ESTA usuaria lo tiene fijado. Va dentro del mismo `include` para que
      // `relationLoadStrategy: 'join'` lo resuelva en la consulta que ya se
      // hace, sin un viaje más a Montreal.
      fijaciones: { where: { userId: user.id }, select: { userId: true } },
    },
  });

  // El `count` es una segunda consulta —otros ~100 ms— en la ruta que la bandeja
  // pide cada 8 segundos, y la bandeja no usa el total para nada. Ahora solo se
  // calcula si el llamador lo pide (?withTotal=1), o si la página no se llena y
  // por tanto el total ya se sabe sin preguntar.
  const quiereTotal = searchParams.get('withTotal') === '1';
  const total = ordenPendientes
    ? (totalPendientes ?? totalNoEntregados)
    : conversations.length < limit
      ? skip + conversations.length
      : quiereTotal
        ? await prisma.conversation.count({ where })
        : null;

  /**
   * Los chats fijados van APARTE, no mezclados en `data`.
   *
   * Mezclarlos fue un error caro. La bandeja decide si quedan más páginas
   * comparando `data.length` con el tamaño de página; al meter los fijados
   * dentro, una agente con un chat fijado recibía 51 en vez de 50, la
   * comparación fallaba y el botón «Ver más conversaciones» desaparecía. Se
   * quedaba viendo la primera tanda y sin manera de bajar, con el contador
   * marcando 257: parecía que se hubieran perdido los chats.
   *
   * `data` es la página y nada más. Los fijados viajan en su propio campo y la
   * bandeja los pinta encima. Cuesta una consulta más, pero solo la paga quien
   * tiene alguno fijado.
   */
  const idsEnPagina = conversations.map(c => c.id);
  const fijadasFuera = await prisma.conversation.findMany({
    where: {
      fijaciones: { some: { userId: user.id } },
      id: { notIn: idsEnPagina },
      ...(user.metaAccountId ? { metaAccountId: user.metaAccountId } : {}),
    },
    relationLoadStrategy: 'join',
    orderBy: { lastMessageAt: 'desc' },
    take: 20,
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true, city: true, ltv: true, totalOrders: true } },
      agent:    { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      metaAccount: { select: { accountName: true } },
      fijaciones: { where: { userId: user.id }, select: { userId: true } },
    },
  });

  const marcar = (c: (typeof conversations)[number]) =>
    ({ ...c, fijada: c.fijaciones.length > 0, fijaciones: undefined });

  return NextResponse.json({
    data: conversations.map(marcar),
    fijadas: fijadasFuera.map(marcar),
    total, totalPendientes, totalNoEntregados,
  });
}
