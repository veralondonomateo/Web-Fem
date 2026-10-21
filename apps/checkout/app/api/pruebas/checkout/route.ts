import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getProducts } from "@/lib/commerce";
import {
  coberturaSendura,
  provinciaSendura,
} from "@/lib/cobertura-sendura";
import {
  crearOrdenSendura,
  resolverItemsSendura,
  SenduraError,
  type SenduraOrderInput,
} from "@/lib/sendura";

/** Isolated Sendura tests. Outside coverage, only record a FEM simulation.
 * Test rows never enter orders/order_items or reserve real inventory.
 */

interface ItemBody {
  shopifyVariantId?: number | null;
  name: string;
  variant?: string | null;
  price: number;
  quantity: number;
}

interface PruebaBody {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  complement?: string;
  state: string;
  city: string;
  paymentMethod: "contraentrega" | "anticipado";
  items: ItemBody[];
  /** Arma el payload y lo muestra, sin llamar a nadie. */
  dryRun?: boolean;
}

const NOTA_PRUEBA =
  "PEDIDO DE PRUEBA del entorno de integracion FEM x Sendura. No despachar sin confirmar con FEM.";

function idCorto(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

export async function POST(req: NextRequest) {
  // A Sendura test can issue a real guide. Do not invoke it in automated verification.
  let body: PruebaBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  const faltaCampo = (["firstName", "lastName", "phone", "address", "state", "city"] as const).find(
    (campo) => !String(body[campo] ?? "").trim()
  );
  if (faltaCampo) {
    return NextResponse.json({ error: `Falta el campo ${faltaCampo}` }, { status: 400 });
  }
  if (!body.items?.length) {
    return NextResponse.json({ error: "El pedido no tiene productos" }, { status: 400 });
  }

  const subtotal = body.items.reduce((s, i) => s + i.price * i.quantity, 0);
  const shipping = 0; // el checkout real ofrece envío gratis a todo el país
  const total = subtotal + shipping;

  const cobertura = coberturaSendura(body.state, body.city);
  const carrier = cobertura.cubierta ? "sendura" : "fem";
  const nombreCompleto = `${body.firstName} ${body.lastName}`.trim();
  const referencia = `PRUEBA-${idCorto()}`;

  const supabase = createServerClient();

  // Fila base: se escribe pase lo que pase, para que ningún intento —ni los
  // fallidos— desaparezca del registro de la prueba.
  const registro = {
    email: body.email || null,
    first_name: body.firstName,
    last_name: body.lastName,
    phone: body.phone,
    address: body.address,
    complement: body.complement || null,
    state: body.state,
    city: body.city,
    payment_method: body.paymentMethod,
    items: body.items,
    subtotal,
    shipping,
    total,
    carrier,
    cobertura: cobertura.cubierta,
  };

  // ── Camino A: la ciudad tiene cobertura Sendura ───────────────────────────
  if (cobertura.cubierta && cobertura.municipio) {
    // Sendura exige SKU por item y **ignora en silencio** los que no conoce:
    // mandar un pedido con un SKU sin registrar devuelve 201 y guía, pero
    // despacha incompleto. Si falta uno solo, no se manda nada.
    let catalogo: Awaited<ReturnType<typeof getProducts>> = [];
    try {
      catalogo = await getProducts();
    } catch (err) {
      console.error("[Pruebas] No se pudo leer el catálogo FEM:", err);
    }

    const { items: resueltos, faltantes } = resolverItemsSendura(body.items, catalogo);

    if (faltantes.length > 0) {
      const error = `No se pudo resolver el SKU de: ${faltantes.join(", ")}. Sendura ignora los SKU que no conoce y despacharía el pedido incompleto, así que no se envió.`;
      await supabase.from("pruebas_sendura").insert({
        ...registro,
        motivo: "Cobertura Sendura, pero falta SKU",
        status: "error",
        error,
      });
      return NextResponse.json({ carrier, status: "error", error }, { status: 200 });
    }

    // El corregimiento va en la segunda línea: la base de ciudades de Sendura
    // conoce municipios, no las 8.193 veredas del catálogo colombiano.
    const direccion2 = [cobertura.corregimiento, body.complement]
      .filter(Boolean)
      .join(" — ");

    // Los dos identificadores viajan vacíos y los genera Sendura.
    //
    // `shopify_id` con texto tumbaba su servidor con un 500; ellos ajustaron
    // para aceptarlo vacío, y de paso pidieron mandar `order_number` igual.
    // Verificado contra su API: con ambos en "" responde 201 y devuelve los
    // suyos (`order_number: "202608191429"`, `shopify_id: "20260819201429"`).
    //
    // El precio de eso es que nuestra referencia ya no viaja en ningún campo
    // indexado, así que va en las notas: sin ella, un pedido de prueba en su
    // panel no se puede reconciliar con el nuestro salvo por la guía.
    const payload: SenduraOrderInput = {
      order_number: "",
      shopify_id: "",
      customer_name: nombreCompleto,
      customer_email: body.email || undefined,
      customer_phone: body.phone.replace(/\D/g, ""),
      shipping_address_1: body.address,
      shipping_address_2: direccion2 || undefined,
      shipping_city: cobertura.municipio.city,
      shipping_province: provinciaSendura(cobertura.municipio),
      shipping_country: "Colombia",
      notes: `${NOTA_PRUEBA} Ref FEM: ${referencia}.`,
      total_price: total,
      financial_status: body.paymentMethod === "contraentrega" ? "pending" : "paid",
      items: resueltos.map((i) => ({
        sku: i.sku as string,
        name: i.variant ? `${i.name} – ${i.variant}` : i.name,
        quantity: i.quantity,
        price: i.price,
      })),
    };

    if (body.dryRun) {
      return NextResponse.json({
        carrier,
        status: "dry_run",
        cobertura: true,
        municipio: cobertura.municipio.city,
        request_payload: payload,
      });
    }

    try {
      const { ok } = await crearOrdenSendura(payload);

      const { data } = await supabase
        .from("pruebas_sendura")
        .insert({
          ...registro,
          motivo: `Cobertura Sendura: ${cobertura.municipio.city}`,
          status: "ok",
          sendura_order_id: String(ok.order_id),
          sendura_guia: ok.guia_number ?? null,
          request_payload: payload,
          response_payload: ok,
        })
        .select("id")
        .maybeSingle();

      console.log(`[Pruebas] Orden ${referencia} → Sendura, guía ${ok.guia_number}`);

      return NextResponse.json({
        id: data?.id,
        carrier,
        status: "ok",
        municipio: cobertura.municipio.city,
        sendura_order_id: ok.order_id,
        sendura_guia: ok.guia_number,
        order_number: ok.order_number ?? referencia,
        request_payload: payload,
        response_payload: ok,
      });
    } catch (err) {
      const e = err instanceof SenduraError ? err : null;
      const mensaje = err instanceof Error ? err.message : String(err);
      const detalle = e ? `[${e.motivo}] ${mensaje}` : mensaje;

      console.error(`[Pruebas] Sendura rechazó ${referencia}: ${detalle}`);

      await supabase.from("pruebas_sendura").insert({
        ...registro,
        motivo: `Cobertura Sendura: ${cobertura.municipio.city}`,
        status: "error",
        error: detalle,
        request_payload: payload,
        response_payload: e?.respuesta ?? null,
      });

      return NextResponse.json({
        carrier,
        status: "error",
        motivo: e?.motivo ?? "desconocido",
        error: detalle,
        request_payload: payload,
        response_payload: e?.respuesta ?? null,
      });
    }
  }

  // Outside Sendura coverage there is no carrier to contact in this module.
  // Real registration requires an approved orders row; tests stay isolated.
  const simulation = {...registro, reference: referencia};
  if (body.dryRun) {
    return NextResponse.json({carrier, status: "dry_run", cobertura: false, request_payload: simulation});
  }
  const {data, error} = await supabase.from("pruebas_sendura").insert({
    ...registro,
    motivo: "Simulación FEM, sin guía: " + body.city + " (" + body.state + ")",
    status: "ok",
    request_payload: simulation,
    response_payload: {simulated: true},
  }).select("id").maybeSingle();
  if (error) return NextResponse.json({error: "No se pudo guardar la prueba"}, {status: 500});
  return NextResponse.json({id: data?.id, carrier, status: "dry_run", simulated: true, request_payload: simulation});
}
