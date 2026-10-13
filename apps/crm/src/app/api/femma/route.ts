import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import {
  anthropic, TOOLS, ejecutarHerramienta, construirSystem, PARAMETROS, TurnoChat,
} from '@/services/femma';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Tope de vueltas al bucle de herramientas: evita un bucle infinito si algo va mal. */
const MAX_VUELTAS = 6;

/** Historial que se manda a la API. Más atrás no aporta y encarece cada consulta. */
const MAX_TURNOS = 20;

/**
 * Chat con Femma, en streaming.
 *
 * Responde SSE con tres tipos de evento:
 *   texto        fragmento de la respuesta, para pintarlo según llega
 *   herramienta  aviso de que está consultando el CRM, para mostrarlo en la UI
 *   fin          fin del turno, con el gasto de la consulta
 *
 * El bucle es manual —y no el tool runner del SDK— porque hay que decidir qué
 * se reenvía al navegador: el texto sí, las llamadas a herramientas solo como
 * aviso, y los resultados crudos del CRM nunca.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: 'Femma no está configurada: falta ANTHROPIC_API_KEY.' },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => null);
  const turnos: TurnoChat[] = Array.isArray(body?.mensajes) ? body.mensajes : [];
  const contexto: string | undefined = typeof body?.contexto === 'string' ? body.contexto : undefined;

  if (!turnos.length) {
    return NextResponse.json({ error: 'No hay mensajes.' }, { status: 400 });
  }

  const client = anthropic();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enviar = (tipo: string, datos: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ tipo, ...(datos as object) })}\n\n`));
      };

      const mensajes: Anthropic.MessageParam[] = turnos
        .slice(-MAX_TURNOS)
        .map(t => ({ role: t.role, content: t.content }));

      let entrada = 0, salida = 0, cache = 0;

      try {
        for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
          const respuesta = await new Promise<Anthropic.Message>((resolve, reject) => {
            const s = client.messages.stream({
              ...PARAMETROS,
              system: construirSystem(contexto),
              tools: TOOLS,
              messages: mensajes,
            });
            s.on('text', delta => enviar('texto', { delta }));
            s.on('error', reject);
            s.finalMessage().then(resolve, reject);
          });

          entrada += respuesta.usage.input_tokens;
          salida  += respuesta.usage.output_tokens;
          cache   += respuesta.usage.cache_read_input_tokens ?? 0;

          if (respuesta.stop_reason === 'refusal') {
            enviar('texto', { delta: '\n\n(No puedo ayudarte con eso.)' });
            break;
          }

          const llamadas = respuesta.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
          );
          if (!llamadas.length) break;

          mensajes.push({ role: 'assistant', content: respuesta.content });

          // En paralelo, no una detrás de otra: son consultas independientes
          // y encadenarlas sumaba su tiempo. Con tres preguntas al CRM en el
          // mismo turno, la agente esperaba el triple para nada.
          for (const llamada of llamadas) enviar('herramienta', { nombre: llamada.name });

          const resultados: Anthropic.ToolResultBlockParam[] = await Promise.all(
            llamadas.map(async llamada => {
              const salidaHerramienta = await ejecutarHerramienta(llamada.name, llamada.input);
              // El borrador se pinta en la pantalla de la agente: viaja aparte
              // porque no es algo que Femma diga, es algo que hace.
              if (llamada.name === 'poner_borrador') {
                const texto = (llamada.input as any)?.texto;
                if (typeof texto === 'string' && texto.trim()) enviar('borrador', { texto });
              }
              return {
                type: 'tool_result' as const,
                tool_use_id: llamada.id,
                content: salidaHerramienta,
              };
            }),
          );
          mensajes.push({ role: 'user', content: resultados });
        }

        // Precios de Claude Opus 5: 5 USD por millón de entrada, 25 de salida;
        // lo que se lee de caché cuesta la décima parte de la entrada.
        const costo = (entrada * 5 + cache * 0.5 + salida * 25) / 1_000_000;
        enviar('fin', { entrada, salida, cache, costo });
      } catch (e) {
        console.error('[Femma]', e);
        enviar('error', { mensaje: e instanceof Error ? e.message : 'Error inesperado' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
