-- Todo lo que la base necesita y Prisma no sabe escribir.
--
-- HAY QUE CORRERLO DESPUÉS DE CADA `prisma db push`.
--
-- Prisma no sabe expresar índices parciales (los que llevan `WHERE`), índices
-- GIN ni triggers. Los que no sabe escribir tampoco los reconoce, y `db push`
-- borra por su cuenta los índices que no están en el esquema. Los triggers sí
-- sobreviven, porque Prisma no los gestiona en absoluto.
--
-- Si no se corre, nada se rompe: todas las consultas siguen dando el resultado
-- correcto. Lo que pasa es que el CRM vuelve a ir lento, que es exactamente de
-- donde veníamos. Es idempotente: correrlo de más no hace daño.
--
--   psql "$DIRECT_URL" -f scripts/despues-de-db-push.sql
--
-- ============================================================
-- 1) EL ÚLTIMO MENSAJE DE CADA CONVERSACIÓN
-- ============================================================
--
-- Cómo quedó el último mensaje, guardado en la propia conversación en vez de
-- deducirlo en cada consulta.
--
-- POR QUÉ
-- Las pestañas «Sin resp.» y «No llegaron» de la bandeja preguntan lo mismo de
-- cada conversación ABIERTA: ¿la última palabra fue de la clienta?, ¿lo último
-- que le escribimos llegó? Deducirlo al vuelo era una búsqueda por conversación
-- abierta (544 en una línea, 5.307 en total) cada ocho segundos y por cada
-- agente: el 70% del tiempo total de la base de datos se iba en eso. Con la
-- respuesta guardada y un índice parcial, el contador pasó de 28,8 ms a 0,6 ms
-- y la lista de 30 de 4,4 ms a 0,7 ms, devolviendo exactamente lo mismo.

-- 1.1 Las columnas. Nulables a propósito: así añadirlas no reescribe la tabla, y
--    una conversación sin ningún mensaje se queda en NULL y no aparece en
--    ninguna de las dos pestañas, que es justo lo que hacía el JOIN de antes.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_message_direction message_direction,
  ADD COLUMN IF NOT EXISTS last_message_status    message_status;

-- 1.2 Quien las mantiene al día. Va en la base y no en la aplicación para que
--    ninguna vía de escritura pueda olvidarse: el webhook de Meta, «Escribir a
--    alguien», los flujos automáticos y cualquier script futuro pasan todos por
--    aquí. El `UPDATE OF status` es imprescindible: un mensaje nace SENT y pasa
--    a DELIVERED o a FAILED después, y «No llegaron» vive de ese cambio.
CREATE OR REPLACE FUNCTION conversations_sync_ultimo_mensaje() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE conv text := COALESCE(NEW.conversation_id, OLD.conversation_id);
BEGIN
  -- El subselect va dentro del propio UPDATE, no en una variable calculada
  -- antes: bajo READ COMMITTED, si dos mensajes de la misma conversación entran
  -- a la vez, el segundo espera el bloqueo de fila y vuelve a evaluarlo con el
  -- del primero ya visible. Calculado aparte, el segundo pisaría al primero.
  UPDATE conversations c
     SET (last_message_direction, last_message_status) = (
           SELECT m.direction, m.status FROM messages m
           WHERE m.conversation_id = c.id
           ORDER BY m.created_at DESC, m.id DESC LIMIT 1)
   WHERE c.id = conv;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS messages_sync_ultimo ON messages;
CREATE TRIGGER messages_sync_ultimo
AFTER INSERT OR DELETE OR UPDATE OF status, direction, created_at, conversation_id ON messages
FOR EACH ROW EXECUTE FUNCTION conversations_sync_ultimo_mensaje();

-- 1.3 El relleno inicial. Va DESPUÉS del trigger a propósito: al revés queda un
--    hueco entre lo que se rellenó y lo que empieza a vigilarse, y los mensajes
--    que entren en ese hueco no los recoge nadie.
UPDATE conversations c
   SET (last_message_direction, last_message_status) = (
         SELECT m.direction, m.status FROM messages m
         WHERE m.conversation_id = c.id
         ORDER BY m.created_at DESC, m.id DESC LIMIT 1);

-- 1.4 Los índices. `INCLUDE (meta_account_id)` para que el contador se resuelva
--    sin bajar a la tabla, y el orden por `last_message_at` dentro del índice
--    para que la lista salga ya ordenada y no haya que ordenar nada.
CREATE INDEX CONCURRENTLY IF NOT EXISTS conversations_bandeja_pendientes_idx
ON conversations (last_message_direction, last_message_at DESC)
INCLUDE (meta_account_id)
WHERE status <> 'RESOLVED';

CREATE INDEX CONCURRENTLY IF NOT EXISTS conversations_bandeja_fallidos_idx
ON conversations (last_message_at DESC)
INCLUDE (meta_account_id)
WHERE status <> 'RESOLVED' AND last_message_direction = 'OUTBOUND' AND last_message_status = 'FAILED';

-- 1.5 La comprobación. Tiene que dar 0 y 0. Si alguna vez diera otra cosa, el
--    UPDATE del punto 1.3 lo deja al día otra vez.
--
--    Un detalle al leerlo: el trigger corre dentro de la misma transacción que
--    el mensaje, así que no existe ningún instante en que la columna vaya por
--    detrás. Si sale un desajuste, no es retraso: o falta el trigger, o alguien
--    tocó la tabla con el trigger deshabilitado.
WITH verdad AS (
  SELECT c.id, c.last_message_direction gd, c.last_message_status ge,
         (SELECT m.direction FROM messages m WHERE m.conversation_id = c.id
           ORDER BY m.created_at DESC, m.id DESC LIMIT 1) rd,
         (SELECT m.status FROM messages m WHERE m.conversation_id = c.id
           ORDER BY m.created_at DESC, m.id DESC LIMIT 1) re
  FROM conversations c)
SELECT count(*) AS conversaciones,
       count(*) FILTER (WHERE rd IS DISTINCT FROM gd) AS direccion_desviada,
       count(*) FILTER (WHERE re IS DISTINCT FROM ge) AS estado_desviado
FROM verdad;

-- ============================================================
-- 2) BUSCAR CLIENTA POR NOMBRE O TELÉFONO
-- ============================================================
--
-- POR QUÉ
-- El buscador de la bandeja hace `name ILIKE '%loquesea%' OR phone LIKE
-- '%loquesea%'`. Un índice normal no sirve para eso: al empezar por comodín no
-- hay prefijo por el que bajar, así que Postgres leía las 25.746 clientas
-- enteras en cada búsqueda. Un índice trigrama sí, porque indexa los trocitos
-- de tres letras y encuentra el patrón esté donde esté.
--
-- Lo que más se nota es buscar por teléfono, que es lo que más se hace y era el
-- peor caso: cuando no hay coincidencias o hay pocas, no puede parar antes de
-- tiempo y recorre el listín completo. Medido en producción con un número:
-- 64,4 ms → 0,7 ms, la misma clienta al final.
--
-- Con menos de tres letras escritas el índice no aplica y se vuelve a recorrer
-- todo; da igual, porque con dos letras la lista sale igual de larga que sin
-- filtrar y nadie busca así.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS customers_name_trgm_idx
ON customers USING gin (name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS customers_phone_trgm_idx
ON customers USING gin (phone gin_trgm_ops);

-- ============================================================
-- 3) EL MOTOR DE FLUJOS
-- ============================================================
--
-- POR QUÉ
-- Antes de programar un paso, el motor comprueba qué pedidos ya lo tienen
-- («NOT IN … WHERE metadata->'step' = …»). Ese `metadata` es jsonb y no había
-- por dónde buscarlo, así que cada comprobación leía las 26.237 ejecuciones
-- enteras. Corre desde el cron, no desde la pantalla, pero pelea por la misma
-- CPU y el mismo pool que la bandeja.
--
-- El índice es sobre la expresión, no sobre la columna: es la expresión lo que
-- aparece en el WHERE. Prisma la genera con un `::jsonb` de más sobre algo que
-- ya es jsonb; Postgres lo ignora y el índice entra igual (comprobado en el
-- plan, «Index Cond: metadata #> '{step}'»).
CREATE INDEX CONCURRENTLY IF NOT EXISTS flow_executions_step_order_idx
ON flow_executions (((metadata #> '{step}')), order_id)
WHERE order_id IS NOT NULL;
