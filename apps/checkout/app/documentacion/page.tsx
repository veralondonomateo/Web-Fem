import type { ReactNode } from "react";

export const metadata = {
  title: "FEM | API de carritos abandonados",
  description: "Documentación de la API de recuperación de carritos para el CRM.",
  // Documentación interna: no debe aparecer en Google.
  robots: { index: false, follow: false },
};

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "https://checkoutfem.com";

// ── Piezas de presentación ──────────────────────────────────────────────────

function Codigo({ children }: { children: string }) {
  return (
    <pre className="bg-gray-900 text-gray-100 rounded-lg p-4 overflow-x-auto text-[13px] leading-relaxed my-4">
      <code>{children}</code>
    </pre>
  );
}

function Metodo({ verbo, ruta }: { verbo: string; ruta: string }) {
  const color =
    verbo === "GET" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700";
  return (
    <div className="flex items-center gap-3 flex-wrap mb-3">
      <span className={`${color} text-xs font-bold px-2.5 py-1 rounded`}>{verbo}</span>
      <code className="text-sm font-mono text-gray-800 break-all">{ruta}</code>
    </div>
  );
}

function Seccion({ id, titulo, children }: { id: string; titulo: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 mb-14">
      <h2 className="text-2xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Aviso({ tipo = "info", children }: { tipo?: "info" | "alerta"; children: ReactNode }) {
  const estilos =
    tipo === "alerta"
      ? "bg-red-50 border-red-200 text-red-900"
      : "bg-blue-50 border-blue-200 text-blue-900";
  return (
    <div className={`${estilos} border rounded-lg p-4 my-4 text-sm leading-relaxed`}>
      {children}
    </div>
  );
}

function Tabla({ cabeceras, filas }: { cabeceras: string[]; filas: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto my-4">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50">
            {cabeceras.map((c) => (
              <th key={c} className="text-left font-semibold text-gray-700 px-3 py-2 border-b border-gray-200">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((fila, i) => (
            <tr key={i} className="border-b border-gray-100 align-top">
              {fila.map((celda, j) => (
                <td key={j} className="px-3 py-2 text-gray-600">
                  {celda}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const INDICE = [
  ["como-funciona", "Cómo funciona"],
  ["autenticacion", "Autenticación"],
  ["tipos", "Tipos de carrito"],
  ["listar", "Listar carritos"],
  ["detalle", "Consultar un carrito"],
  ["eventos", "Reportar eventos"],
  ["webhook", "Webhook (opcional)"],
  ["link", "Link de recuperación"],
  ["reglas", "Reglas obligatorias"],
  ["pedidos-sendura", "Aviso de Sendura (pedidos nuevos)"],
  ["integracion", "Integración paso a paso"],
  ["configuracion", "Configuración"],
  ["errores", "Errores"],
];

export default function DocumentacionPage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-gray-900">API del checkout para el CRM</h1>
            <p className="text-xs text-gray-500">Checkout FEM · carritos abandonados y aviso de Sendura</p>
          </div>
          <span className="text-xs font-mono text-gray-400 hidden sm:block">v1</span>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-10">
        <nav className="hidden lg:block">
          <ul className="sticky top-28 space-y-1.5 text-sm">
            {INDICE.map(([id, texto]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-gray-600 hover:text-[#fc5245] transition-colors">
                  {texto}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0">
          <Seccion id="como-funciona" titulo="Cómo funciona">
            <p className="text-gray-600 leading-relaxed mb-4">
              El checkout detecta cada carrito abandonado, le aplica las reglas de supresión y lo
              deja en una cola. El CRM lee esa cola, espera sus 45 minutos y envía el mensaje de
              WhatsApp con el link para terminar la compra.
            </p>

            <Codigo>{`Clienta abandona el checkout
        │
        │  15 min sin actividad
        ▼
Detector (corre cada 5 min)
        │  descarta: ya compró · pidió no ser contactada ·
        │            sin celular válido · ya está en la cola
        ▼
Cola de carritos  ──────────────►  CRM  (GET /api/crm/carritos)
        │                            │
        │                            │  espera 45 min
        │                            ▼
        │                          Revalida (GET /api/crm/carritos/{id})
        │                            │  ¿debe_contactar sigue en true?
        │                            ▼
        │                          Envía WhatsApp con link_recuperacion
        ▼                            │
Se marca recuperado  ◄───────────────┘  POST .../eventos`}</Codigo>

            <p className="text-gray-600 leading-relaxed">
              Hay dos formas de recibir los carritos y se pueden usar juntas:{" "}
              <strong>consultando la cola</strong> (recomendado, nada se pierde si el CRM se cae) o{" "}
              <strong>recibiendo un webhook</strong> por cada carrito nuevo.
            </p>
          </Seccion>

          <Seccion id="autenticacion" titulo="Autenticación">
            <p className="text-gray-600 leading-relaxed">
              Todas las rutas <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">/api/crm/*</code>{" "}
              exigen la llave del CRM en la cabecera <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">Authorization</code>.
              Sin ella o con una llave equivocada, la respuesta es <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">401</code>.
            </p>
            <Codigo>{`Authorization: Bearer <CRM_API_KEY>`}</Codigo>
            <Aviso tipo="alerta">
              <strong>La llave da acceso a nombres, celulares y direcciones de clientas.</strong>{" "}
              Guárdala como variable de entorno del CRM, nunca en el navegador ni en un repositorio
              público. Si se filtra, se rota cambiando <code>CRM_API_KEY</code> en Vercel.
            </Aviso>
          </Seccion>

          <Seccion id="tipos" titulo="Tipos de carrito">
            <p className="text-gray-600 leading-relaxed mb-2">
              El campo <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">tipo</code>{" "}
              indica qué tan avanzada iba la compra. Conviene mandar mensajes distintos.
            </p>
            <Tabla
              cabeceras={["tipo", "Qué pasó", "Datos disponibles"]}
              filas={[
                [
                  <code key="a" className="text-xs">pago_no_completado</code>,
                  "Llenó todo el formulario, eligió Mercado Pago y el pago nunca se aprobó. Es el más caliente: ya había decidido comprar.",
                  "Nombre, celular, email, dirección, ciudad y productos exactos.",
                ],
                [
                  <code key="b" className="text-xs">datos_parciales</code>,
                  "Dejó al menos nombre y celular pero nunca envió el pedido.",
                  "Nombre, celular y lo que alcanzó a llenar. Puede no traer dirección.",
                ],
              ]}
            />
            <Aviso>
              Para <code>pago_no_completado</code> el mensaje que mejor funciona no es
              &quot;olvidaste tu carrito&quot;, sino ofrecer <strong>contra entrega</strong>: el pago
              falló, no el interés.
            </Aviso>
          </Seccion>

          <Seccion id="listar" titulo="Listar carritos">
            <Metodo verbo="GET" ruta={`${BASE}/api/crm/carritos`} />
            <p className="text-gray-600 leading-relaxed">
              Devuelve los carritos en orden de llegada. Se pagina con un cursor: guarda el{" "}
              <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">cursor</code> que
              devuelve la respuesta y mándalo en la siguiente llamada. Así nunca ves dos veces el
              mismo carrito ni se te escapa uno, aunque el CRM se caiga y vuelva horas después.
            </p>

            <h3 className="font-semibold text-gray-900 mt-6 mb-2">Parámetros</h3>
            <Tabla
              cabeceras={["Parámetro", "Descripción"]}
              filas={[
                [<code key="1" className="text-xs">cursor</code>, "Número devuelto por la llamada anterior. Sin él, empieza desde el carrito más antiguo disponible."],
                [<code key="2" className="text-xs">limite</code>, "Cuántos traer, de 1 a 200. Por defecto 50."],
                [<code key="3" className="text-xs">estado</code>, "Filtra por un estado exacto. Por defecto trae los que aún se pueden trabajar (pendiente, entregado, contactado)."],
                [<code key="4" className="text-xs">desde</code>, "Fecha ISO 8601. Solo carritos detectados después de ese instante."],
              ]}
            />

            <h3 className="font-semibold text-gray-900 mt-6 mb-2">Ejemplo</h3>
            <Codigo>{`curl "${BASE}/api/crm/carritos?limite=50&cursor=1284" \\
  -H "Authorization: Bearer $CRM_API_KEY"`}</Codigo>

            <Codigo>{`{
  "carritos": [
    {
      "id": "46949eb5-6d29-4c4c-9998-1657b4618640",
      "tipo": "pago_no_completado",
      "estado": "pendiente",
      "nombre": "Adriana Paola",
      "nombre_completo": "Adriana Paola Burgos Viloria",
      "telefono": "+573001234567",
      "telefono_local": "3001234567",
      "email": "adriana@ejemplo.com",
      "ciudad": "Sincelejo",
      "departamento": "Sucre",
      "productos": [
        {
          "nombre": "Alimento con probióticos y prebióticos x 60 UND",
          "variante": "Compra Única 1 / 1 unidad",
          "cantidad": 1,
          "precio": 110000
        }
      ],
      "total": 110000,
      "link_recuperacion": "${BASE}/r/o.352801fb-a3c7-44a1-8f5d-023e2912f181.6cee0641d18587cc7cbc",
      "link_recuperacion_descuento": "${BASE}/r/od.352801fb-a3c7-44a1-8f5d-023e2912f181.4a91b7e2c0f5d8a36b14",
      "cupon_descuento": "VUELVE10",
      "descuento_porcentaje": 10,
      "detectado_at": "2026-08-04T19:45:20.047Z",
      "contactar_desde": "2026-08-04T20:30:20.047Z",
      "mensajes_enviados": 0,
      "debe_contactar": true
    }
  ],
  "cursor": 1334,
  "cantidad": 1,
  "hay_mas": false
}`}</Codigo>

            <h3 className="font-semibold text-gray-900 mt-6 mb-2">Campos</h3>
            <Tabla
              cabeceras={["Campo", "Descripción"]}
              filas={[
                [<code key="1" className="text-xs">id</code>, "Identificador del carrito. Se usa para consultar y reportar eventos."],
                [<code key="2" className="text-xs">nombre</code>, "Solo el primer nombre — es el que se usa para saludar."],
                [<code key="3" className="text-xs">telefono</code>, "Celular en formato internacional (+57…), listo para WhatsApp."],
                [<code key="4" className="text-xs">telefono_local</code>, "Los mismos 10 dígitos sin indicativo, por si el CRM los prefiere así."],
                [<code key="5" className="text-xs">link_recuperacion</code>, "Link para terminar la compra, con los datos y el producto ya cargados."],
                [<code key="5b" className="text-xs">link_recuperacion_descuento</code>, "El mismo link, pero además deja el cupón aplicado. Úsalo solo en el mensaje donde ofrezcas el descuento."],
                [<code key="5c" className="text-xs">cupon_descuento</code>, "Código de ese cupón, por si quieres nombrarlo en el mensaje."],
                [<code key="5d" className="text-xs">descuento_porcentaje</code>, "Cuánto descuenta (10 = 10 %)."],
                [<code key="6" className="text-xs">contactar_desde</code>, "Momento a partir del cual conviene enviar el primer mensaje (detección + 45 min)."],
                [<code key="7" className="text-xs">debe_contactar</code>, "Si es false, no envíes nada. En esta lista viene del estado guardado; el valor en vivo está en el endpoint de detalle."],
                [<code key="8" className="text-xs">hay_mas</code>, "true si quedan más carritos por leer: vuelve a llamar con el nuevo cursor."],
              ]}
            />
          </Seccion>

          <Seccion id="detalle" titulo="Consultar un carrito">
            <Metodo verbo="GET" ruta={`${BASE}/api/crm/carritos/{id}`} />
            <Aviso tipo="alerta">
              <strong>Llama a este endpoint justo antes de enviar cada mensaje.</strong> Entre que
              el carrito entra a la cola y pasan los 45 minutos, la clienta pudo terminar de comprar
              sola. Aquí <code>debe_contactar</code> se recalcula en el momento contra las compras
              aprobadas y las bajas; en la lista viene del último estado guardado.
            </Aviso>
            <Codigo>{`curl "${BASE}/api/crm/carritos/46949eb5-6d29-4c4c-9998-1657b4618640" \\
  -H "Authorization: Bearer $CRM_API_KEY"`}</Codigo>
            <p className="text-gray-600 leading-relaxed">
              Devuelve el mismo objeto de la lista más{" "}
              <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">motivo_no_contactar</code>,
              que explica por qué se bloqueó:
            </p>
            <Tabla
              cabeceras={["Motivo", "Significa"]}
              filas={[
                [<code key="1" className="text-xs">ya_compro</code>, "Hay una compra aprobada con ese celular. No escribir."],
                [<code key="2" className="text-xs">opt_out</code>, "Pidió no recibir más mensajes. No escribir nunca más."],
                [<code key="3" className="text-xs">estado_recuperado</code>, "El carrito ya se dio por recuperado."],
                [<code key="4" className="text-xs">estado_perdido</code>, "Se descartó desde el CRM."],
                [<code key="5" className="text-xs">null</code>, "Sin bloqueo: se puede contactar."],
              ]}
            />

            <h3 className="font-semibold text-gray-900 mt-6 mb-2">Qué abre el link</h3>
            <p className="text-gray-600 leading-relaxed">
              El detalle trae además{" "}
              <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">link_restaura</code> y{" "}
              <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">link_descuento_restaura</code>:
              el carrito que va a abrir cada link, calculado con la misma función que usa el
              checkout. Si nombras productos en el mensaje, sácalos de aquí.
            </p>
            <Codigo>{`"link_restaura": {
  "disponible": true,
  "motivo": null,
  "productos": [
    { "nombre": "Alimento con probióticos + Jabón íntimo + Óvulos Fem homeopáticos",
      "variante": null, "variant_id": 43640489869400, "cantidad": 1, "precio": 169900 }
  ],
  "subtotal": 169900,
  "cupon": null,
  "descuento": 0,
  "total": 169900,
  "coincide": true
}`}</Codigo>
            <Aviso tipo="alerta">
              <strong>Si <code>coincide</code> es false, no mandes el mensaje.</strong> Significa que
              el link abriría algo distinto de <code>productos</code> y <code>total</code>, o que el
              carrito ya no se puede abrir (<code>motivo</code>: <code>caducado</code>,{" "}
              <code>ya_comprado</code>, <code>producto_no_disponible</code>, <code>no_encontrado</code>).
              En el link con descuento, <code>total</code> ya lleva el cupón, así que ahí{" "}
              <code>coincide</code> solo compara los productos.
            </Aviso>
          </Seccion>

          <Seccion id="eventos" titulo="Reportar eventos">
            <Metodo verbo="POST" ruta={`${BASE}/api/crm/carritos/{id}/eventos`} />
            <p className="text-gray-600 leading-relaxed">
              El CRM avisa qué hizo con cada carrito. Sin esto no hay forma de saber a quién ya se
              le escribió, quién pidió que no lo contacten ni cuántas ventas trajo la recuperación.
            </p>
            <Codigo>{`curl -X POST "${BASE}/api/crm/carritos/{id}/eventos" \\
  -H "Authorization: Bearer $CRM_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"evento": "mensaje_enviado"}'`}</Codigo>
            <Tabla
              cabeceras={["evento", "Cuándo mandarlo", "Efecto"]}
              filas={[
                [<code key="1" className="text-xs">mensaje_enviado</code>, "Justo después de enviar cada mensaje.", "Suma al contador y pasa el carrito a contactado."],
                [<code key="2" className="text-xs">respondio</code>, "La clienta contestó.", "Queda registrado para métricas."],
                [<code key="3" className="text-xs">recuperado</code>, "Terminó comprando.", "Cierra el carrito como recuperado."],
                [<code key="4" className="text-xs">opt_out</code>, "Pidió no recibir más mensajes.", "Bloquea ese celular de forma permanente, en todos sus carritos futuros."],
                [<code key="5" className="text-xs">descartado</code>, "El CRM decide no insistir más.", "Cierra el carrito como perdido."],
              ]}
            />
            <p className="text-gray-600 leading-relaxed text-sm">
              Acepta además un campo opcional{" "}
              <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">nota</code> (máx. 500
              caracteres), útil sobre todo para dejar el motivo de una baja.
            </p>
            <Aviso>
              El evento <code>recuperado</code> es opcional: el checkout detecta solo las compras
              del mismo celular y cierra el carrito cada 5 minutos. Mandarlo igual hace la
              atribución inmediata y más precisa.
            </Aviso>
          </Seccion>

          <Seccion id="webhook" titulo="Webhook (opcional)">
            <p className="text-gray-600 leading-relaxed">
              Si configuras <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">CRM_WEBHOOK_URL</code>,
              el checkout envía un POST por cada carrito nuevo, sin esperar a que el CRM pregunte.
              Los reintentos van hasta 5 veces; si el CRM no responde, el carrito igual queda en la
              cola para leerlo por GET.
            </p>
            <Codigo>{`POST https://tu-crm.com/webhooks/carritos
Content-Type: application/json
X-Fem-Timestamp: 1785000000
X-Fem-Evento-Id: 46949eb5-6d29-4c4c-9998-1657b4618640
X-Fem-Firma: sha256=8f3c…

{
  "evento": "carrito_abandonado",
  "carrito": { …el mismo objeto de la lista… }
}`}</Codigo>
            <h3 className="font-semibold text-gray-900 mt-6 mb-2">Verificar la firma</h3>
            <p className="text-gray-600 leading-relaxed">
              Si defines <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">CRM_WEBHOOK_SECRET</code>,
              cada envío llega firmado. Calcula el HMAC sobre{" "}
              <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">timestamp + &quot;.&quot; + cuerpo</code>{" "}
              y compáralo con la cabecera:
            </p>
            <Codigo>{`import crypto from "crypto";

function firmaValida(cuerpoCrudo, cabeceras, secreto) {
  const ts = cabeceras["x-fem-timestamp"];
  const esperada = "sha256=" + crypto
    .createHmac("sha256", secreto)
    .update(ts + "." + cuerpoCrudo)
    .digest("hex");

  // Rechaza envíos viejos: evita que alguien reenvíe uno capturado.
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;

  return crypto.timingSafeEqual(
    Buffer.from(esperada),
    Buffer.from(cabeceras["x-fem-firma"])
  );
}`}</Codigo>
            <Aviso>
              Responde <code>200</code> apenas guardes el carrito. Cualquier otro código cuenta como
              fallo y se reintenta. El <code>X-Fem-Evento-Id</code> sirve para descartar repetidos.
            </Aviso>
          </Seccion>

          <Seccion id="link" titulo="Link de recuperación">
            <p className="text-gray-600 leading-relaxed">
              El campo <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">link_recuperacion</code>{" "}
              abre el checkout con el carrito completo que la clienta dejó —todas las líneas, con su
              variante, cantidad, precio y el cupón que tenía— y los datos que ya había escrito
              (nombre, celular, dirección, ciudad). No tiene que volver a llenar nada. Si el carrito
              ya no se puede abrir, la página lo dice; nunca abre otro producto en su lugar.
            </p>
            <Codigo>{`${BASE}/r/o.352801fb-a3c7-44a1-8f5d-023e2912f181.6cee0641d18587cc7cbc`}</Codigo>
            <p className="text-gray-600 leading-relaxed">
              El token va firmado, así que nadie puede fabricar uno para ver los datos de otra
              persona. Los datos de la clienta se rellenan durante 30 días; los productos del carrito
              se abren durante 90. <strong>Manda el link tal como viene</strong>: si lo
              cortas, deja de funcionar. El carrito se reconstruye al abrirse, en el servidor, así que
              funciona en el navegador de WhatsApp sin cookies ni sesión.
            </p>

            <h3 className="font-semibold text-gray-900 mt-6 mb-2">Con descuento</h3>
            <p className="text-gray-600 leading-relaxed">
              <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">link_recuperacion_descuento</code>{" "}
              es el mismo link pero con el cupón ya aplicado: la clienta ve el descuento en pantalla
              sin escribir ningún código. Es un token distinto y firmado aparte —{" "}
              <strong>nadie puede convertir un link normal en uno con descuento</strong> — así que
              el descuento solo llega a quien tú se lo mandes.
            </p>
            <Aviso tipo="alerta">
              Úsalo solo en el mensaje donde realmente ofreces el descuento. Si mandas siempre el
              link con cupón, estás regalando margen a gente que iba a comprar de todos modos.
            </Aviso>

            <h3 className="font-semibold text-gray-900 mt-6 mb-2">En la plantilla de Meta</h3>
            <p className="text-gray-600 leading-relaxed">
              El link es corto y de una sola pieza justamente para el botón de URL dinámica, que
              aprueba más fácil que meter el link como variable dentro del texto:
            </p>
            <Codigo>{`URL del botón:  ${BASE}/r/{{1}}
Variable {{1}}: o.352801fb-a3c7-44a1-8f5d-023e2912f181.6cee0641d18587cc7cbc

(el token es lo que va después de /r/ en el link que devuelve la API)`}</Codigo>
            <Aviso>
              Cada carrito tiene su propio link. No reutilices el de una clienta con otra.
            </Aviso>
          </Seccion>

          <Seccion id="reglas" titulo="Reglas obligatorias">
            <p className="text-gray-600 leading-relaxed mb-4">
              El checkout ya filtra a quien compró, a quien se dio de baja y a quien no tiene
              celular válido. Estas son las reglas que le tocan al CRM:
            </p>
            <ol className="space-y-3 text-gray-600 text-sm leading-relaxed list-decimal pl-5">
              <li>
                <strong>Revalidar antes de cada mensaje.</strong> Consulta el detalle del carrito y
                si <code>debe_contactar</code> es <code>false</code>, no envíes. En los últimos 30
                días, 4 de cada 10 clientas que no completaron el pago de Mercado Pago terminaron
                comprando solas: escribirles cuando el pedido ya va en camino quema la marca y
                genera reportes de spam.
              </li>
              <li>
                <strong>Respetar el opt-out.</strong> Ante cualquier señal de que no quiere más
                mensajes, reporta <code>opt_out</code> de inmediato. El bloqueo es permanente y
                aplica a todos sus carritos futuros.
              </li>
              <li>
                <strong>Poner un tope de mensajes.</strong> El campo{" "}
                <code>mensajes_enviados</code> te dice cuántos lleva ese carrito. Tres es un
                máximo razonable.
              </li>
              <li>
                <strong>Horario.</strong> Evita escribir de noche. El carrito no se vence: si
                madura a las 11 p. m., el mensaje puede salir a la mañana siguiente.
              </li>
              <li>
                <strong>Reportar siempre.</strong> Cada mensaje enviado debe tener su evento. De ahí
                salen las métricas de recuperación.
              </li>
            </ol>
            <Aviso tipo="alerta">
              Estos datos son personales (Ley 1581 de 2012). El checkout debe tener visible el aviso
              de tratamiento de datos y la clienta debe poder pedir la baja en cualquier momento —
              respetarla es lo que hace legal la operación.
            </Aviso>
          </Seccion>

          <Seccion id="pedidos-sendura" titulo="Aviso de Sendura (pedidos nuevos)">
            <Aviso tipo="alerta">
              <strong>Para qué existe esto.</strong> Cuando un pedido sale por Sendura, ellos
              llaman a la clienta desde un número que no conoce para coordinar la entrega. Mucha
              gente se asusta —&laquo;¿de dónde sacaron mi teléfono?&raquo;— desconfía y hasta
              rechaza el pedido. El CRM le escribe antes por WhatsApp avisándole de que esa
              llamada va a llegar y de quién es.
            </Aviso>

            <p className="text-gray-600 leading-relaxed mb-4">
              Esta cola es <strong>independiente de la de carritos abandonados</strong>. Aquí no
              hay gente que no compró: son pedidos <strong>confirmados y ya despachados</strong>.
              Los que salen por Shopify viajan igual pero marcados, porque el CRM ya tiene su
              propio flujo para esos; los que hay que trabajar son los de Sendura.
            </p>

            <Aviso>
              <strong>Solo aparecen pedidos ya despachados.</strong> Antes del despacho la
              transportadora todavía no está decidida: el ruteo se resuelve en ese momento y un
              fallo de Sendura manda el pedido a Shopify. Avisar antes sería avisar de algo que
              puede cambiar. En contraentrega el despacho ocurre entre 1 y 20 minutos después de
              la compra; en pago anticipado, en cuanto se acredita el pago.
            </Aviso>

            <h3 className="text-lg font-semibold text-gray-900 mt-8 mb-3">Listar pedidos</h3>
            <Metodo verbo="GET" ruta="/api/crm/pedidos?transportadora=sendura&cursor=<n>&limite=50" />
            <Tabla
              cabeceras={["Parámetro", "Descripción"]}
              filas={[
                [<code key="a">cursor</code>, "El número que devolvió la llamada anterior. Sin él empieza por el principio de la cola."],
                [<code key="b">transportadora</code>, <span key="b2"><code>sendura</code> o <code>shopify</code>. Para este flujo, siempre <code>sendura</code>.</span>],
                [<code key="c">desde</code>, "Solo pedidos despachados después de ese instante (ISO 8601)."],
                [<code key="d">limite</code>, "1 a 200. Por defecto 50."],
              ]}
            />

            <p className="text-gray-600 leading-relaxed mb-2">Respuesta:</p>
            <Codigo>{`{
  "pedidos": [
    {
      "id": "8f3a...",
      "transportadora": "sendura",
      "guia": "830146719870",
      "referencia_operador": "61689",
      "cliente": {
        "nombre": "Ana",
        "nombre_completo": "Ana Ruiz",
        "telefono": "+57 310 778 7191",
        "telefono_local": "573107787191",
        "email": "ana@gmail.com",
        "cedula": "1020...",
        "direccion": "Carrera 13 # 12-09",
        "complemento": "Apto 301",
        "ciudad": "Medellín",
        "departamento": "Antioquia"
      },
      "productos": [
        { "nombre": "Alimento con probióticos", "variante": "1 unidad", "cantidad": 1, "precio": 110000 }
      ],
      "subtotal": 110000, "envio": 0, "descuento": 11000,
      "cupon": "NEW10", "total": 99000,
      "metodo_pago": "contraentrega",
      "creado_at": "2026-09-04T15:02:11.000Z",
      "despachado_at": "2026-09-04T15:04:38.000Z",
      "avisado_at": null,
      "debe_avisar": true
    }
  ],
  "cursor": 1842,
  "cantidad": 1,
  "hay_mas": false
}`}</Codigo>

            <h3 className="text-lg font-semibold text-gray-900 mt-8 mb-3">Revalidar antes de escribir</h3>
            <Metodo verbo="GET" ruta="/api/crm/pedidos/{id}" />
            <p className="text-gray-600 leading-relaxed mb-4">
              Devuelve el pedido con <code>debe_avisar</code> recalculado. Es obligatorio
              consultarlo <strong>justo antes de mandar el mensaje</strong>: si otro proceso ya
              avisó, viene en <code>false</code> y no hay que mandar nada. Sin esta revalidación,
              un CRM que reintente una tanda le escribe dos veces a la misma persona.
            </p>

            <h3 className="text-lg font-semibold text-gray-900 mt-8 mb-3">Reportar el aviso</h3>
            <Metodo verbo="POST" ruta="/api/crm/pedidos/{id}/eventos" />
            <Codigo>{`{ "evento": "aviso_enviado" }`}</Codigo>
            <p className="text-gray-600 leading-relaxed mb-4">
              Sella <code>avisado_at</code> y hace <code>debe_avisar</code> false a partir de ese
              momento. Hay que llamarlo <strong>siempre</strong> después de enviar el mensaje: es
              lo único que impide que la misma clienta reciba el aviso dos veces si el cursor del
              CRM se pierde. Si el pedido ya estaba avisado responde{" "}
              <code>{`{ "ok": true, "ya_estaba": true }`}</code> y no pisa la hora original.
            </p>

            <h3 className="text-lg font-semibold text-gray-900 mt-8 mb-3">El mensaje</h3>
            <p className="text-gray-600 leading-relaxed mb-4">
              Se manda <strong>lo antes posible tras el despacho</strong>: tiene que llegar antes
              que la llamada de Sendura, que es justo lo que se quiere evitar que sorprenda. Corto,
              con el nombre de la clienta y nombrando a Sendura de forma explícita.
            </p>
            <Codigo>{`Hola {nombre} 👋 Tu pedido quedó confirmado ✅

Lo vamos a enviar con Sendura, nuestra transportadora de última milla,
para que te llegue mucho más rápido 🛵

Ellos se van a comunicar contigo para coordinar la entrega.
¡Gracias por tu compra! 💜`}</Codigo>
            <Aviso>
              <strong>Nombrar a Sendura es el punto.</strong> El mensaje existe para que, cuando
              llegue una llamada de un número desconocido diciendo que son Sendura, la clienta ya
              sepa quiénes son. Si el mensaje no dice el nombre, no sirve para nada.
            </Aviso>

            <h3 className="text-lg font-semibold text-gray-900 mt-8 mb-3">Reglas</h3>
            <ol className="list-decimal list-inside space-y-2 text-gray-600 leading-relaxed">
              <li>
                Enviar <strong>solo</strong> a <code>transportadora: "sendura"</code>. Los de
                Shopify ya tienen su flujo en el CRM.
              </li>
              <li>
                Revalidar con <code>GET /api/crm/pedidos/{"{id}"}</code> y comprobar{" "}
                <code>debe_avisar</code> antes de cada mensaje.
              </li>
              <li>
                Reportar <code>aviso_enviado</code> siempre después de enviar.
              </li>
              <li>
                <strong>Un solo mensaje por pedido.</strong> Esto no es una secuencia de
                recuperación: es un aviso. Si la misma clienta hace dos pedidos, recibe dos
                avisos, uno por cada uno.
              </li>
              <li>
                Guardar el <code>cursor</code> de cada llamada. Es lo que evita releer la cola
                entera y volver a avisar a todo el mundo.
              </li>
              <li>
                No hay horario nocturno bloqueado como en carritos, porque el aviso pierde sentido
                si llega después de la llamada. Aun así, conviene no escribir de madrugada.
              </li>
            </ol>

            <Aviso>
              <strong>La cola arranca vacía.</strong> Los pedidos despachados antes de que esto
              existiera no entran: avisar hoy de una compra de la semana pasada solo confundiría.
              Solo aparecen los pedidos despachados a partir de la puesta en marcha.
            </Aviso>
          </Seccion>
          <Seccion id="integracion" titulo="Integración paso a paso">
            <p className="text-gray-600 leading-relaxed">
              El CRM necesita dos procesos: uno que lee la cola y otro que envía los mensajes
              cuando se cumple la espera.
            </p>
            <Codigo>{`// 1. Cada minuto: traer los carritos nuevos
let cursor = await db.leerCursor();          // guardado de la corrida anterior

while (true) {
  const url = \`${BASE}/api/crm/carritos?limite=100\` +
              (cursor ? \`&cursor=\${cursor}\` : "");

  const r = await fetch(url, {
    headers: { Authorization: \`Bearer \${process.env.CRM_API_KEY}\` },
  });
  const { carritos, cursor: siguiente, hay_mas } = await r.json();

  for (const c of carritos) {
    await db.guardarCarrito(c);              // idempotente por c.id
    await db.programarMensaje(c.id, c.contactar_desde);
  }

  cursor = siguiente;
  await db.guardarCursor(cursor);
  if (!hay_mas) break;
}`}</Codigo>

            <Codigo>{`// 2. Cuando llega la hora de escribir
async function enviarMensaje(carritoId) {
  const cabeceras = { Authorization: \`Bearer \${process.env.CRM_API_KEY}\` };

  // Revalidar SIEMPRE: pudo comprar durante la espera.
  const r = await fetch(\`${BASE}/api/crm/carritos/\${carritoId}\`, { headers: cabeceras });
  const carrito = await r.json();

  if (!carrito.debe_contactar) {
    console.log("No enviar:", carrito.motivo_no_contactar);
    return;
  }
  if (carrito.mensajes_enviados >= 3) return;

  // El link tiene que abrir justo lo que el mensaje nombra.
  if (!carrito.link_restaura.coincide) {
    console.log("Link no coincide:", carrito.link_restaura.motivo);
    return;
  }

  await whatsapp.enviar({
    para: carrito.telefono,
    plantilla: "recuperacion_carrito",
    variables: [carrito.nombre, carrito.link_recuperacion],
  });

  await fetch(\`${BASE}/api/crm/carritos/\${carritoId}/eventos\`, {
    method: "POST",
    headers: { ...cabeceras, "Content-Type": "application/json" },
    body: JSON.stringify({ evento: "mensaje_enviado" }),
  });
}`}</Codigo>
          </Seccion>

          <Seccion id="configuracion" titulo="Configuración">
            <p className="text-gray-600 leading-relaxed">
              Variables de entorno del checkout (en Vercel). Solo las dos primeras son obligatorias.
            </p>
            <Tabla
              cabeceras={["Variable", "Para qué", "Por defecto"]}
              filas={[
                [<code key="1" className="text-xs">CRM_API_KEY</code>, "Llave con la que el CRM lee la API.", "— (obligatoria)"],
                [<code key="2" className="text-xs">RECOVERY_SECRET</code>, "Firma de los links de recuperación.", "usa CRON_SECRET si falta"],
                [<code key="3" className="text-xs">CRM_WEBHOOK_URL</code>, "Si se define, el checkout empuja cada carrito al CRM.", "vacío (modo consulta)"],
                [<code key="4" className="text-xs">CRM_WEBHOOK_SECRET</code>, "Firma HMAC de los webhooks.", "vacío (sin firma)"],
                [<code key="5" className="text-xs">CARRITO_MADURACION_MIN</code>, "Minutos de inactividad antes de encolar.", "15"],
                [<code key="6" className="text-xs">CARRITO_VENTANA_HORAS</code>, "Antigüedad máxima de un carrito para encolarlo.", "24"],
                [<code key="7" className="text-xs">CRM_ESPERA_MIN</code>, "Espera que se refleja en contactar_desde.", "45"],
                [<code key="8" className="text-xs">RECUPERACION_VIGENCIA_DIAS</code>, "Días que sirve un link de recuperación.", "30"],
                [<code key="9" className="text-xs">CUPON_RECUPERACION</code>, "Cupón que aplica el link con descuento.", "VUELVE10 (10 %)"],
              ]}
            />
          </Seccion>

          <Seccion id="errores" titulo="Errores">
            <Tabla
              cabeceras={["Código", "Qué pasó", "Qué hacer"]}
              filas={[
                ["400", "Parámetro o cuerpo inválido.", "Revisa el mensaje del campo error."],
                ["401", "Falta la llave o no coincide.", "Revisa la cabecera Authorization."],
                ["404", "El carrito no existe.", "No reintentar."],
                ["500", "Error del servidor.", "Reintentar con espera creciente."],
              ]}
            />
            <p className="text-gray-600 leading-relaxed text-sm">
              Los errores siempre llegan como{" "}
              <code className="text-sm bg-gray-100 px-1.5 py-0.5 rounded">{`{ "error": "descripción" }`}</code>.
            </p>
          </Seccion>

          <footer className="pt-8 border-t border-gray-200 text-xs text-gray-400">
            Documentación interna de FEM · Checkout {BASE}
          </footer>
        </main>
      </div>
    </div>
  );
}
