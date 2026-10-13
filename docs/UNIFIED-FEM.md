# FEM unificado · local y Vercel

## Arranque

Node 24+. Instalar dependencias con `npm ci` en la raíz, `apps/checkout` y `apps/crm`.
Configurar `.env.unified.local` con rutas a archivos privados existentes:

```
FEM_CHECKOUT_ENV=/ruta/privada/checkout.env
FEM_CRM_ENV=/ruta/privada/crm.env
FEM_DROP_ENV=/ruta/privada/drop.env
FEM_PUBLIC_ORIGIN=http://localhost:3000
FEM_LIVE_CHECKOUT=false
FEM_PRODUCTION=true
```

La contraseña se lee de `FEM_ADMIN_PASSWORD`, del checkout o de `ADMIN_PASSWORD` del archivo Drop. Nunca subir archivos de credenciales.
`FEM_PRODUCTION=true` selecciona la compilación de Next, no activa cobros. Compilar checkout con `node scripts/build-checkout.mjs`; ejecutar `npm run build` y `npm run dev:unified`. El proceso mantiene cuatro servicios en loopback: gateway3000, tienda3001, checkout3002, CRM3111. No exponer directamente los puertos internos.

## Rutas y datos

- `/`: tienda existente; imágenes de Nicolás incorporadas desde ad32687.
- `/admin`: dashboard protegido por sesión HttpOnly, métricas de los pedidos existentes del checkout, clientes, detalle de pedido, productos y calculadora de economía unitaria.
- `/admin/crm`: misma aplicación original y permisos, con adaptación de rutas en el gateway. La vista local usa una base de demostración aislada. Los archivos funcionales originales se conservan.
- `/checkout`: carrito completo de Shopify, con cantidades, precios y modalidad validados de nuevo en servidor. Las suscripciones continúan en su flujo original.
- `/camino-al-millon`: contador de demostración compartido entre visitas; no alimenta las métricas de ventas reales.
- `/checkout/regalo`: demostración visual de la tarjeta para pedir que otra persona pague.

La facturación incluye pedidos aprobados contra entrega; no significa dinero ya recaudado. El total cobrado por Mercado Pago se muestra separado. LTV y recompra usan el historial disponible del checkout, no todos los pedidos históricos de Shopify. Costos y ROAS son una calculadora manual, no contabilidad integrada. El contador de visitantes representa sesiones recientes visibles.

## Pago compartido

La opción «Que pague mi novio o amigo» mantiene Mercado Pago como pasarela. La compradora completa sus datos de envío antes de crear el pedido. En modo real se genera una preferencia sin precargar la identidad de la compradora como pagadora, con vencimiento de 24 horas. Se comparte el `init_point` de Mercado Pago, no la URL del formulario con datos personales. La persona que paga puede necesitar identificarse ante la pasarela, pero no vuelve a completar la dirección de entrega.

WhatsApp abre un borrador; nunca envía automáticamente. Instagram copia el mensaje para pegar en un DM. Compartir usa Web Share cuando está disponible y copiar enlace como alternativa. Compartir en privado: la pasarela puede mostrar el contenido del pedido. El gorro es una instrucción de preparación de un pedido anticipado aprobado, no un SKU ni una reserva de inventario.

En localhost los cobros y creación de pedidos están bloqueados. La tarjeta de demostración no es un enlace de pago válido y solo funciona en este equipo. Para compartir entre dispositivos se necesita un dominio desplegado. La aprobación del pago debe verificarse mediante webhook, nunca por haber compartido un enlace o por la URL de retorno.

## Verificación y límites del despliegue

`npm run test:unified` valida sesiones, métricas y carrito. `node scripts/check-unified.mjs` ejecuta las diez fases de integración HTTP; usa carrito de prueba y no crea pedidos. La compilación de checkout verifica TypeScript. Los tests de galería y búsqueda validan el cambio de Nicolás.

La tienda actual es una vista transformada del Shopify publicado. No cambiar DNS de femprobiotics.co hacia este servidor sin configurar un origen Shopify independiente; de otro modo el proxy se apuntaría a sí mismo. Antes de producción: almacenamiento compartido de sesiones/contador, HTTPS y proxy inverso, secretos del despliegue, CRM real, revisión de inventario, prueba integral de Mercado Pago con credenciales de prueba y validación de notificaciones/despacho. No se ha realizado una transacción financiera real.

El dashboard es de consulta; las operaciones de atención continúan en CRM. No sustituye todavía todos los módulos de Shopify. La configuración de Vercel incluye todos los módulos en un despliegue atómico.

## Estado de revisión · 13 octubre 2026

- Commit remoto `ad326877b84500ffbb6c3811a9c93978773d3adc` integrado por avance directo; respaldo local y comparación de 333 archivos de integración sin cambios por el pull.
- Siete pruebas unitarias de integración aprobadas, incluyendo bloqueo de contraentrega en el flujo anticipado y pago compartido solo por Mercado Pago.
- Diez fases HTTP aprobadas: rutas, autenticación, CSRF, carrito múltiple, traslado al checkout, modalidad, CRM, métricas, recursos y cierre de sesión.
- Doce pruebas existentes de galería/buscador aprobadas tras incorporar a Nicolás.
- El conjunto histórico general presenta 3 fallos previos entre 77 casos, relacionados con fixtures de páginas migradas y referencias Instant. No se afirma que toda la suite histórica esté verde.
- Build de checkout y verificación TypeScript aprobados. Modo compilado local evita conflictos de chunks del servidor de desarrollo detrás del gateway.
- Pago compartido revisado en navegador: selección, botón contextual y tarjeta modal. Prueba bancaria real y entrega de webhook pendientes antes del despliegue.

## Despliegue unificado

`vercel.json` define store, gateway, checkout y crm con bindings privados. Vercel Services está en beta. La raíz sirve la tienda; `/checkout` usa el carrito; `/admin` requiere sesión y `/admin/crm` conserva el login individual original. El build del gateway empaqueta sus plantillas y el contador; las fotos grandes se sirven como recursos estáticos.

Variables privadas: FEM_CHECKOUT_ENV_JSON, FEM_CRM_ENV_JSON, FEM_ADMIN_PASSWORD_HASH, FEM_INTERNAL_SECRET. Configuración: FEM_LIVE_CHECKOUT=false hasta completar pagos; FEM_MILESTONE_STARTED_AT fija el inicio del contador de demostración. No activar ALLOW_DEV_LOGIN en Vercel. La tabla fem_admin_sessions conserva únicamente hashes de tokens, con RLS y acceso de backend.

Las credenciales de proveedor se recuperan solo en servidor, no se hashean porque deben usarse para autenticar llamadas. No se publican .env ni carpetas internas. Ver docs/security/REVISION-2026-10-13.md para límites pendientes, incluida la carga de archivos grandes en Functions.
