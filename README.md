# FEM Storefront

Web FEM con contenido y catálogo propios. La compilación prepara el HTML y los recursos locales; el servidor público utiliza solo las bibliotecas integradas de Node.js. No necesita Shopify ni un motor de plantillas al recibir visitas. Se conservan los componentes y estilos de FEM.

```powershell
npm ci
npm run build
npm run dev
```

Abrir http://localhost:3000.

```powershell
npm run typecheck
npm test
```

- `content/`: catálogo, rutas y contenido de las páginas.
- `theme-source/`: plantillas locales, estilos, imágenes, fuentes y videos.
- `src/`: interacciones, carruseles, filtros y carrito.
- `server/`: entrega de páginas preparadas, búsqueda, APIs del catálogo y sesión del carrito.
- `dist/`: páginas, variantes y recursos compilados; se genera localmente y no se guarda en Git.
- `apps/checkout/`: checkout existente con Mercado Pago y base de pedidos en Supabase.

El catálogo privado y el registro de pedidos se preparan con `docs/independent-commerce.sql` y `scripts/seed-owned-catalog.ts`. Los cobros reales requieren la configuración privada del checkout y del webhook; no se activa un modo de cobro simulado.

Consulta [la instalación y el estado de la migración](docs/INDEPENDENT-STORE.md) antes del cambio a producción. Los planes conservan sus enlaces de suscripción existentes. El despacho que dependía del antiguo operador necesita un reemplazo configurado.

`npm run build` prepara todas las variantes y comprueba que sus recursos existan. `npm run dev` compila antes de iniciar el servidor; `npm test` compila antes de ejecutar las pruebas. Los cambios de catálogo, plantillas y recursos requieren reconstruir la web.

La entrega utiliza compresión Brotli/gzip, recursos versionados y una caché acotada de las páginas preparadas. `npm run assets:audit` inventaría los recursos sin uso; la eliminación exige ejecutar expresamente `scripts/prune-assets.ts --apply`.
