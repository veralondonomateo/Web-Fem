# Tienda FEM independiente

La compilación lee `content/catalog.json`, `content/routes.json` y las páginas de `content/pages/`, y prepara todas las variantes en `dist/`. El servidor público entrega esos documentos, sin interpretar plantillas ni consultar una tienda remota para mostrar contenido, buscar, seleccionar variantes o mantener el carrito. Las imágenes, fuentes y videos están en `theme-source/assets/`; las URL originales se conservan únicamente como registro de procedencia en `content/media.json`.

Se reutilizan las mismas clases y hojas de estilo. Las plantillas de FEM se procesan con LiquidJS exclusivamente al compilar, como biblioteca local. No forman parte del código que atiende visitas. Se eliminaron los archivos de publicación del tema y las dependencias de validación de Shopify. Los nombres y números históricos de algunos campos se conservan para que los pedidos anteriores, los componentes y el CRM sigan siendo compatibles.

## Desarrollo

```powershell
npm ci
npm run build
npm run dev
```

La tienda se abre en http://localhost:3000. `npm test` compila primero y comprueba también las rutas con la red bloqueada, recursos locales, variantes, búsqueda y persistencia del carrito. El servidor observa los manifiestos de `dist/` y reinicia después de una nueva compilación.

## Entrega y limpieza

`scripts/build-store.ts` empaqueta el JavaScript, minimiza CSS/JS y prepara copias Brotli/gzip. Los recursos incluyen una versión de su contenido para permitir su caché; las páginas y los datos privados no se guardan en cachés HTTP compartidas. El HTML y la compresión reutilizan memoria con límites definidos. La búsqueda inserta únicamente texto escapado y tarjetas del catálogo propio.

La limpieza conserva las imágenes originales. Los archivos duplicados se identifican por SHA-256 y solo se eliminan después de verificar que sus bytes sean idénticos. El compilador rechaza una página que mencione un recurso ausente, incluidos los scripts de los cuestionarios.

## Compras reales

Se conserva la interfaz del checkout de `apps/checkout`, Mercado Pago y la base de pedidos existente. La tienda pública pasa el carrito a ese servicio, sin crear un carrito externo ni transferirlo a Shopify.

Antes de habilitar cobros:

1. Cargar el archivo privado de entorno existente del checkout. No guardar secretos en Git.
2. Aplicar `docs/independent-commerce.sql` en esa misma base de checkout. La operación añade tablas y columnas; no modifica pedidos históricos.
3. Ejecutar `node --env-file=RUTA_PRIVADA scripts/seed-owned-catalog.ts` desde la raíz. Actualiza los precios y la disponibilidad; conserva el inventario operativo que ya exista.
4. Configurar `FEM_CART_SECRET` con una clave persistente compartida por las instancias de la tienda, `FEM_INTERNAL_SECRET` compartida con el checkout y `CHECKOUT_INTERNAL_URL` con la URL interna de este servicio. Mantener las credenciales existentes de Mercado Pago, el secreto del webhook y Supabase exclusivamente en el servidor.
5. Verificar el webhook y el flujo de pago en el entorno de pruebas del proveedor antes del cambio de producción. No se han realizado cobros durante la migración.

El checkout comprueba los precios, la disponibilidad y la cantidad total de cada variante en el catálogo privado antes de aceptar una compra. Con la configuración incompleta no se cobra y no se simula una compra exitosa. El registro `fem_order_registry` permite reintentos sin duplicar el registro ni descontar inventario dos veces, también para pedidos de Sendura. El jabón de oferta, el total y su inventario se actualizan en una sola transacción.

El catálogo inicial conserva la disponibilidad pública recopilada durante la migración, sin publicar cantidades privadas. El inventario operativo se administra en `fem_catalog_variants`; un stock nulo significa que no se descuenta una cantidad limitada. Es necesario cargar el inventario inicial verificado antes de producción. Si se cambian precios o disponibilidad pública, actualizar `content/catalog.json`, ejecutar la semilla y reconstruir la web.

Los scripts `predev` y `prebuild` del checkout preparan sus recursos locales en `apps/checkout/public/__theme/`. Ese directorio generado permite que el checkout se publique por separado y no se guarda en Git.

Los planes mantienen sus enlaces externos actuales de Treli. Una variante de suscripción no se cobra como compra única en Mercado Pago. Migrar los cobros recurrentes o los contratos ya existentes requiere una migración propia del proveedor de suscripciones.

## Despacho

Sendura conserva su integración y sus reglas actuales de cobertura. Al retirar el antiguo operador de respaldo, los demás pedidos quedan registrados en la cola propia FEM para preparación; esta cola no emite una guía de transporte por sí sola. Es necesario definir el operador de reemplazo antes del cambio de producción para conservar el despacho automático de esas zonas.

## Contacto y bienvenida

El formulario de contacto y el cupón de bienvenida usan `/contact`. Los datos se guardan en `fem_contact_messages` con acceso exclusivo del servidor. En desarrollo sin credenciales se guardan en `.local/contact-messages.jsonl`, que Git ignora. La bienvenida conserva el diseño, el raspado y la espera de apertura; muestra el código FEM10. El envío de correos exige conectar el servicio de correo correspondiente.

## Qué queda pendiente de activar

La migración de base no se ha aplicado a producción. Faltan la configuración privada, el inventario inicial verificado y la definición del despacho de respaldo. El conector Vercel sigue devolviendo 403 para el equipo `veralondonomateos-projects`; se ha solicitado habilitar el acceso. No se ha desplegado ni publicado el cambio. Las herramientas y capturas antiguas se conservan como referencias y pruebas; el servidor público no las usa para obtener contenido.
