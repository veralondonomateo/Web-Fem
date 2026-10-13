/**
 * Confirmar un pedido en Mastershop.
 *
 * La API pública de Mastershop (`prod.api.mastershop.com`) NO tiene endpoint
 * para esto: se probaron unas treinta rutas y todas responden igual que una
 * ruta inexistente. La confirmación va por otro camino — un disparador de
 * automatización en `hooks.mstr.tools`, el mismo que usaba el flujo de n8n que
 * el equipo tenía montado sobre Kommo.
 *
 * Dos cosas que costó descubrir y que no se pueden cambiar a la ligera:
 *
 *   · La nota tiene que decir EXACTAMENTE «Confirmada a través de Kommo». La
 *     automatización filtra por ese texto: con cualquier otro devuelve
 *     `{"success": true}` igual, pero no hace nada. Se comprobó mandando el
 *     mismo pedido con una nota distinta (sin efecto) y luego con esta
 *     (confirmó en 8 segundos). Suena a que el nombre quedó pegado de cuando
 *     se montó con Kommo; conviene pedirle a Mastershop que lo documenten.
 *
 *   · El endpoint responde `success` pase lo que pase, así que su respuesta no
 *     sirve para saber si funcionó. La confirmación real se ve cuando llega el
 *     webhook del pedido con `id_confirmation_status = 61`.
 *
 * Al confirmar, Mastershop pasa el pedido a «Por Alistar» por su cuenta en
 * unos segundos, y ese cambio es el que dispara el mensaje con la guía.
 */

const URL_CONFIRMACION = process.env.MASTERSHOP_CONFIRM_WEBHOOK
  || 'https://hooks.mstr.tools/start/28719';

/** Texto que la automatización de Mastershop espera. No cambiar. */
const NOTA_REQUERIDA = 'Confirmada a través de Kommo';

/** Estado al que se lleva el pedido, y el código de «confirmado por plataforma externa». */
const ID_STATUS_CONFIRMADO = '2';
const ID_CONFIRMACION_EXTERNA = 61;

export class ConfirmacionNoConfigurada extends Error {}

/**
 * Marca el pedido como confirmado en Mastershop.
 *
 * `idOrder` es el id de Mastershop —lo que el CRM guarda en
 * `order.shopifyOrderId`—, no el id interno del CRM.
 */
export async function confirmarEnMastershop(idOrder: string): Promise<void> {
  if (!idOrder?.trim()) throw new Error('Falta el id del pedido en Mastershop.');
  if (!URL_CONFIRMACION) throw new ConfirmacionNoConfigurada('Sin URL de confirmación configurada');

  const res = await fetch(URL_CONFIRMACION, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      idStatus: ID_STATUS_CONFIRMADO,
      idOrder: String(idOrder),
      idConfirmationStatus: ID_CONFIRMACION_EXTERNA,
      notes: NOTA_REQUERIDA,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const cuerpo = await res.text().catch(() => '');
    throw new Error(`Mastershop respondió ${res.status}: ${cuerpo.slice(0, 160)}`);
  }
}
