import { prisma } from './prisma';

/**
 * Candado para que dos pasadas del mismo cron no se encimen.
 *
 * Con el pooler en modo transacción (pgbouncer=true) un advisory lock de
 * sesión de Postgres no sirve: cada consulta puede caer en una conexión
 * física distinta, así que "mantener" el lock durante todo el trabajo no
 * es posible. En su lugar, esto es una fila con comparar-y-cambiar atómico:
 * un solo UPDATE que solo tiene efecto si nadie más tiene el candado vigente.
 *
 * Hace falta desde que el cron de flujos pasó a correr cada minuto: una
 * pasada que tarde cerca de 60 s podía alcanzar a la siguiente y mandar el
 * mismo mensaje dos veces a la misma clienta.
 */
export async function conCandado<T>(
  nombre: string, duracionMs: number, trabajo: () => Promise<T>,
): Promise<T | { omitido: true }> {
  const vence = new Date(Date.now() + duracionMs);

  const filas = await prisma.$queryRaw<{ name: string }[]>`
    INSERT INTO cron_locks (name, locked_until)
    VALUES (${nombre}, ${vence})
    ON CONFLICT (name) DO UPDATE
      SET locked_until = ${vence}
      WHERE cron_locks.locked_until < now()
    RETURNING name
  `;

  if (!filas.length) return { omitido: true };

  try {
    return await trabajo();
  } finally {
    // Se libera apenas termina, en vez de esperar a que `vence` expire sola,
    // para que la siguiente pasada no se quede esperando sin necesidad.
    await prisma.$executeRaw`
      UPDATE cron_locks SET locked_until = now() WHERE name = ${nombre}
    `.catch(() => { /* si esto falla, el candado igual expira solo */ });
  }
}
