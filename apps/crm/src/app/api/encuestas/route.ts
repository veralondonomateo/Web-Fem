import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { prisma } from '@/lib/prisma';
import { UMBRAL_REVISAR } from '@/lib/encuestas';

export const dynamic = 'force-dynamic';

/**
 * Cómo califican las clientas la atención, por asesora.
 *
 * SOLO ADMIN, y se comprueba aquí y no en la pantalla. Una agente que supiera la
 * URL podría ver sus notas —y las de la otra— si el filtro viviera solo en el
 * navegador. Esto es lo único que separa «medir» de «que cada quien se mida a
 * sí misma».
 */
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();
  if (user.role !== 'ADMIN') return forbidden();

  const dias = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get('dias') ?? 30)));
  const desde = new Date(Date.now() - dias * 86_400_000);

  const [porAgente, global, ultimas, porDia] = await Promise.all([
    prisma.$queryRaw<{
      agent_id: string | null; agent_name: string | null;
      enviadas: bigint; respondidas: bigint; promedio: number | null;
      e5: bigint; e4: bigint; e3: bigint; e2: bigint; e1: bigint;
    }[]>`
      SELECT agent_id, agent_name,
             count(*) FILTER (WHERE estado IN ('ENVIADA','RESPONDIDA')) AS enviadas,
             count(*) FILTER (WHERE estado = 'RESPONDIDA')              AS respondidas,
             avg(estrellas)::float8                                     AS promedio,
             count(*) FILTER (WHERE estrellas = 5) AS e5,
             count(*) FILTER (WHERE estrellas = 4) AS e4,
             count(*) FILTER (WHERE estrellas = 3) AS e3,
             count(*) FILTER (WHERE estrellas = 2) AS e2,
             count(*) FILTER (WHERE estrellas = 1) AS e1
      FROM encuestas_conversacion
      WHERE created_at >= ${desde}
      GROUP BY 1, 2
      ORDER BY respondidas DESC`,

    prisma.$queryRaw<{
      programadas: bigint; enviadas: bigint; respondidas: bigint;
      omitidas: bigint; promedio: number | null; bajas: bigint;
    }[]>`
      SELECT count(*) FILTER (WHERE estado = 'PROGRAMADA')              AS programadas,
             count(*) FILTER (WHERE estado IN ('ENVIADA','RESPONDIDA')) AS enviadas,
             count(*) FILTER (WHERE estado = 'RESPONDIDA')              AS respondidas,
             count(*) FILTER (WHERE estado = 'OMITIDA')                 AS omitidas,
             avg(estrellas)::float8                                      AS promedio,
             count(*) FILTER (WHERE estrellas <= ${UMBRAL_REVISAR})      AS bajas
      FROM encuestas_conversacion
      WHERE created_at >= ${desde}`,

    // Las últimas respuestas, con las malas primero dentro del mismo día: son
    // las que hay que abrir y leer.
    prisma.encuestaConversacion.findMany({
      where: { estado: 'RESPONDIDA', respondidaAt: { gte: desde } },
      orderBy: { respondidaAt: 'desc' },
      take: 100,
      select: {
        id: true, estrellas: true, respondidaAt: true, comentario: true,
        agentName: true, conversationId: true,
        customer: { select: { id: true, name: true, phone: true } },
      },
    }),

    prisma.$queryRaw<{ dia: string; respondidas: bigint; promedio: number | null }[]>`
      SELECT to_char(respondida_at, 'YYYY-MM-DD') AS dia,
             count(*)            AS respondidas,
             avg(estrellas)::float8 AS promedio
      FROM encuestas_conversacion
      WHERE estado = 'RESPONDIDA' AND respondida_at >= ${desde}
      GROUP BY 1 ORDER BY 1`,
  ]);

  const n = (v: bigint | null | undefined) => Number(v ?? 0);
  const g = global[0];

  return NextResponse.json({
    dias,
    metricas: {
      programadas: n(g?.programadas),
      enviadas:    n(g?.enviadas),
      respondidas: n(g?.respondidas),
      omitidas:    n(g?.omitidas),
      promedio:    g?.promedio != null ? Math.round(g.promedio * 10) / 10 : null,
      bajas:       n(g?.bajas),
      tasaRespuesta: n(g?.enviadas) ? Math.round(100 * n(g?.respondidas) / n(g?.enviadas)) : null,
    },
    porAgente: porAgente.map(a => ({
      agentId: a.agent_id,
      agentName: a.agent_name ?? 'Sin asignar',
      enviadas: n(a.enviadas),
      respondidas: n(a.respondidas),
      promedio: a.promedio != null ? Math.round(a.promedio * 10) / 10 : null,
      distribucion: { 5: n(a.e5), 4: n(a.e4), 3: n(a.e3), 2: n(a.e2), 1: n(a.e1) },
      tasaRespuesta: n(a.enviadas) ? Math.round(100 * n(a.respondidas) / n(a.enviadas)) : null,
    })),
    ultimas,
    porDia: porDia.map(d => ({
      dia: d.dia,
      respondidas: n(d.respondidas),
      promedio: d.promedio != null ? Math.round(d.promedio * 10) / 10 : null,
    })),
  });
}
