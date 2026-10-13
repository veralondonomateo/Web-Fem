# Fem CRM

CRM omnicanal de Fem: bandeja de WhatsApp / Instagram / Facebook, seguimiento de
pedidos de Mastershop y Shopify, flujos automáticos de mensajes y analítica.

Next.js 14 (App Router) · Prisma · PostgreSQL en Supabase · Tailwind · desplegado en Vercel.

---

## 1 · Poner en marcha en local

```bash
cd apps/web
npm install
cp .env.example .env.local     # y rellena los valores (ver sección 2)
npm run db:push                # crea las tablas en Supabase
npm run seed:admin hola@fem.com.co "Tu Nombre" 'unaClaveLarga'
npm run seed:flows             # crea los 8 pasos del flujo de pedido, APAGADOS
npm run check                  # comprueba que todo lo anterior quedó bien
npm run dev                    # http://localhost:3000
```

`npm run check` revisa de una pasada las variables, la conexión a Postgres, las
tablas, las usuarias enlazadas con Supabase Auth y los flujos. Con credenciales
(`npm run check hola@fem.com.co 'laClave'`) prueba además el inicio de sesión.

Los flujos nacen apagados a propósito: encenderlos manda WhatsApps reales a
clientas reales. Se activan uno a uno desde **Flujos** cuando el negocio lo decida.

Comprobación rápida de que todo respira: entra en **Ajustes** y pulsa
«Probar conexión» en cada integración. También hay una sonda sin sesión en
`/api/health`.

---

### Vista previa sin credenciales

Para ver el CRM funcionando antes de tener Supabase, Meta o Mastershop:

```bash
npm run preview            # o `npm run preview -- --reset` para resembrar
```

Levanta un Postgres propio en el puerto 55432, siembra clientas, pedidos y
conversaciones de mentira, y abre <http://localhost:3111>. Entras con
`hola@fem.com.co` y cualquier contraseña.

Ese atajo es `ALLOW_DEV_LOGIN`, y **solo se activa si `DATABASE_URL` apunta a
localhost** (`src/app/api/auth/login/route.ts:16`). En Vercel, con Supabase en un
host remoto, no puede encenderse aunque se ponga la variable por error. Si
prefieres no tenerlo en el código, borra la función `devLoginAllowed` y su rama.

---

## 2 · Credenciales

El detalle de cada variable, con su ayuda en línea, está en `.env.example` y
también en la pantalla **Ajustes** del CRM. Resumen de dónde se saca cada cosa:

| Proveedor | Qué hay que pedir | Dónde |
|---|---|---|
| **Supabase** | `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → Database y → API |
| **Meta / WhatsApp** | `WHATSAPP_ACCESS_TOKEN` (permanente), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` | developers.facebook.com → app → WhatsApp |
| **Mastershop** | `MASTERSHOP_API_KEY`, `MASTERSHOP_WEBHOOK_SECRET` | Mastershop → Configuración → Integraciones |
| **Shopify** | `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_WEBHOOK_SECRET` | Admin → Settings → Apps → Develop apps |
| **Propias** | `JWT_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL` | las generas tú (`openssl rand -base64 48`) |

> El token de WhatsApp tiene que ser el **permanente de un usuario de sistema**.
> El que muestra el panel de pruebas caduca a las 24 horas y deja los flujos mudos.

### Webhooks a registrar

Con el CRM ya desplegado, registra estas URLs en cada panel. La pantalla
**Ajustes** las arma con tu dominio real y las deja listas para copiar.

| Proveedor | URL | Eventos |
|---|---|---|
| Meta | `https://TU-DOMINIO/api/webhooks/meta` | `messages`, `message_status` |
| Mastershop | `https://TU-DOMINIO/api/webhooks/mastershop` | cambios de estado de pedido |
| Shopify | `https://TU-DOMINIO/api/webhooks/shopify/orders/create` | `orders/create` |
| Shopify | `https://TU-DOMINIO/api/webhooks/shopify/orders/fulfilled` | `orders/fulfilled` |

---

## 3 · Cómo está montado

```
src/
  app/
    (auth)/login          entrada; valida contra Supabase Auth y firma un JWT propio
    (dashboard)/          dashboard · bandeja · clientas · pedidos · carritos
                          flujos · plantillas · ajustes
    api/                  rutas del servidor (todas piden sesión salvo webhooks y health)
  services/
    mastershop.ts         cliente de la API (reintentos, paginado, normalización)
    mastershop-sync.ts    sincronización pedidos → CRM y recálculo de métricas
    whatsapp.ts           envío de mensajes y plantillas por la Cloud API
    whatsapp-inbound.ts   traduce cualquier mensaje entrante a algo legible
    order-flow.ts         motor del recorrido del pedido (paso 1 al 8)
    media.ts              descarga y firma de adjuntos de WhatsApp
  lib/
    integrations.ts       catálogo de credenciales — fuente de verdad de Ajustes
```

**Los webhooks son el tiempo real; el cron es la red de seguridad.** Mastershop
avisa de cada cambio de estado al instante, y `/api/cron/sync` vuelve a leer el
último día cada hora para recuperar cualquier evento perdido.
`/api/cron/flows` corre cada 10 minutos y despacha lo programado (el recordatorio
de confirmación a los 90 min y la escalada a una persona 2 h después).
Ambos crons están declarados en `vercel.json`.

### Mastershop: lo que hay que saber antes de tocarlo

Medido contra la cuenta real (agosto de 2026, ~780 pedidos al día):

| | |
|---|---|
| Tamaño de página | **50, fijo.** Pedir `limit=200` sigue devolviendo 50. |
| Latencia | **~12 s por página**, no depende de la página ni del rango. |
| Concurrencia | **12 páginas a la vez** es la meseta. En 16 empiezan los 504. |
| 504 esporádicos | Normales. Se reintentan 5 veces con espera exponencial. |
| Un mes de pedidos | ~470 páginas. **No cabe** en los 300 s de una función. |

De ahí las tres decisiones que no son obvias:

- **El cron mira un solo día** (~120 s), no un mes. Corre cada hora, así que
  sobra: solo tiene que tapar los webhooks que se pierdan.
- **El histórico se carga desde la terminal** con `npm run backfill:mastershop
  [días]`, que no tiene límite de tiempo, avanza en tramos de 7 días y se puede
  cortar y retomar. Es idempotente.
- **`listAllOrders` falla a propósito** si un tramo pasa de 400 páginas, en vez
  de devolver la mitad. Un tramo a medias se marcaría como completo y nadie
  volvería a mirarlo.

La escritura va en bloque (unas pocas sentencias, no una por pedido): 6.269
pedidos entran en ~23 s. Si se vuelve a una escritura fila a fila, el sync deja
de caber en el tiempo de la función.

---

## 4 · Identidad de marca

Definida en `tailwind.config.ts` y `src/app/globals.css`, siguiendo el manual:

- **Rosa Melocotón `#FF9DA3`** — escala `brand-*`. Es el 70 %: superficies,
  tintes, bordes, fondos.
- **Rojo Pimiento `#ED5340`** — escala `pepper-*`. Es el 30 %: acciones, estado
  activo, series de datos.
- **Tinta `#2E1614`** — escala `ink-*` para el texto.

Los colores de marca puros no alcanzan contraste AA con texto blanco
(`#FF9DA3` = 1.98:1, `#ED5340` = 3.55:1), así que **todo lo que lleve texto
encima usa `pepper-600` (4.77:1) o `pepper-700` (6.50:1)**, que son los pasos
«Dark» que el propio manual contempla. El rosa puro se reserva para áreas sin
texto pequeño encima.

Tipografía: Montserrat para texto corrido y Montserrat Alternates para titulares,
ambas servidas en local desde `public/fonts`.

---

## 5 · Despliegue

Proyecto de Vercel apuntando a `apps/web`. Las mismas variables de `.env.example`
van en Settings → Environment Variables. `vercel.json` ya trae los dos crons.

Después de cada despliegue que toque el esquema: `npm run db:push`.
