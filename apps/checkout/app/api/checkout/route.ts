import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import MercadoPagoConfig, { Preference } from "mercadopago";
import { OrderItem } from "@/types/checkout";
import { createServerClient } from "@/lib/supabase";
import { sendPurchaseEvent } from "@/lib/meta";
import { coberturaSendura } from "@/lib/cobertura-sendura";
import { senduraActivo } from "@/lib/despacho";
import { COUPON_CODES, COUPON_USAGE_LIMITS } from "@/lib/coupons";
import { soloPagoAnticipado, MENSAJE_SOLO_PAGO_ANTICIPADO } from "@/lib/zonas-pago-anticipado";
import {validateOwnedItems} from '@/lib/commerce';

const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN!,
});

// Los cupones viven en lib/coupons (los comparte con el cliente). El servidor
// sigue siendo la autoridad: aquí se revalida el código y se recalcula el
// descuento, nunca se confía en el monto que manda el navegador.

interface CheckoutBody {
  privacyAccepted?: boolean;
  thirdPartyPay?: boolean;
  email: string;
  firstName: string;
  lastName: string;
  cedula?: string;
  phone: string;
  address: string;
  complement?: string;
  state: string;
  city: string;
  paymentMethod: "mercadopago" | "contraentrega";
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  total: number;
  couponCode?: string;
  discount?: number;
  /** Clave estable por intento de compra — evita pedidos duplicados. */
  idempotencyKey?: string;
  /** Sesión de seguimiento de carrito, para cerrarla al comprar. */
  sessionId?: string;
  /** URL del checkout, para el evento de Meta. */
  eventSourceUrl?: string;
  /** `fbclid` de la URL, por si el pixel aún no creó la cookie `_fbc`. */
  fbclid?: string;
  /** Identificadores de Meta que arma el navegador (ver lib/meta-tracking). */
  fbp?: string;
  fbc?: string;
}

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://checkoutfem.com";

/**
 * Ventana en la que dos pedidos con el mismo contenido se consideran el mismo
 * intento. Coincide con el TTL de la clave de idempotencia del navegador.
 */
const DEDUP_WINDOW_MS = 30 * 60 * 1000;

/**
 * Huella del contenido del pedido, calculada en el servidor.
 *
 * La clave de idempotencia la genera el navegador y vive en `sessionStorage`,
 * que es **por pestaña**: si la clienta vuelve a abrir el link desde WhatsApp
 * o Instagram, recibe una clave nueva y su pedido entra otra vez. Esta huella
 * no depende del navegador, así que atrapa ese caso.
 */
function contentHash(body: CheckoutBody): string {
  const items = body.items
    .map((i) => `${i.shopifyVariantId ?? i.id}:${i.quantity}:${i.price}`)
    .sort()
    .join("|");
  const base = [
    body.email.trim().toLowerCase(),
    body.phone.replace(/\D/g, ""),
    JSON.stringify([body.firstName,body.lastName,body.address,body.complement??"",body.state,body.city]),
    body.paymentMethod,
    body.thirdPartyPay === true ? "shared" : "self",
    Math.round(body.total),
    items,
  ].join("~");
  return createHash("sha256").update(base).digest("hex");
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient();

  let body: CheckoutBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  if(body.privacyAccepted !== true) return NextResponse.json({error:"Acepta el tratamiento de datos para gestionar el pedido",codigo:"consentimiento_requerido"},{status:400});
  if (!body.items || body.items.length === 0) {
    return NextResponse.json({ error: "La orden no tiene productos" }, { status: 400 });
  }
  try { body.items = await validateOwnedItems(body.items); } catch(error) { return NextResponse.json({error:error instanceof Error?error.message:'Carrito inválido',codigo:'carrito_cambiado'},{status:409}); }
  const subtotal = body.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  if (body.subtotal !== subtotal || body.shipping !== 0 || !Number.isFinite(body.total)) {
    return NextResponse.json({error:'Tu carrito cambió. Revisa el total antes de continuar.',codigo:'carrito_cambiado'},{status:409});
  }

  if (!["mercadopago", "contraentrega"].includes(body.paymentMethod)) {
    return NextResponse.json({ error: "Método de pago inválido" }, { status: 400 });
  }

  // Ciudades donde el costo de envío hace inviable el contra entrega. El
  // checkout ya esconde la opción, pero esta es la validación que manda: el
  // navegador puede mentir.
  if (body.paymentMethod === "contraentrega" && soloPagoAnticipado(body.state, body.city)) {
    return NextResponse.json({ error: MENSAJE_SOLO_PAGO_ANTICIPADO }, { status: 400 });
  }

  // Validate coupon and compute discount server-side — never trust client-sent amounts
  let discount = 0;
  if (body.couponCode) {
    const code = body.couponCode.trim().toUpperCase();
    const rate = COUPON_CODES[code];
    if (rate === undefined) {
      // `codigo` es para el navegador, no para la clienta: le permite
      // distinguir "el problema es el cupón" de cualquier otro fallo y quitarlo
      // en vez de dejar el pedido atascado. El texto de `error` sí se muestra.
      return NextResponse.json(
        { error: "Ese código de descuento no existe.", codigo: "cupon_invalido" },
        { status: 400 }
      );
    }

    const usageLimit = COUPON_USAGE_LIMITS[code];
    if (usageLimit !== undefined) {
      // El conteo se hace en Postgres, no en memoria: antes se traían todos los
      // pedidos del cupón y PostgREST corta en 1.000 filas, así que con un cupón
      // popular los clientes que quedaban fuera del corte podían reutilizarlo.
      const { data: usageCount, error: usageError } = await supabase.rpc(
        "count_coupon_uses",
        { p_code: code, p_email: body.email }
      );

      if (usageError) {
        console.error("Supabase coupon usage lookup error:", usageError);
        return NextResponse.json({ error: "No se pudo validar el cupón" }, { status: 500 });
      }

      if ((usageCount ?? 0) >= usageLimit) {
        return NextResponse.json(
          {
            error: "Ya usaste este cupón antes y es de uso limitado.",
            codigo: "cupon_limite",
          },
          { status: 400 }
        );
      }
    }

    discount = Math.round(body.subtotal * rate);
  } else if ((body.discount ?? 0) > 0) {
    // Discount without a coupon code is not allowed
    return NextResponse.json({ error: "Descuento sin código de cupón" }, { status: 400 });
  }

  // Validate totals server-side
  const expectedTotal = body.subtotal + body.shipping - discount;
  if (body.total <= 0) {
    return NextResponse.json({ error: "El total debe ser mayor a cero" }, { status: 400 });
  }
  if (Math.round(expectedTotal) !== Math.round(body.total)) {
    console.warn(`[Checkout] Total mismatch: expected ${expectedTotal}, got ${body.total}`);
    return NextResponse.json({ error: "Total inconsistente" }, { status: 400 });
  }
  if (discount > 0 && discount >= body.subtotal) {
    return NextResponse.json({ error: "El descuento no puede ser mayor o igual al subtotal" }, { status: 400 });
  }

  // Datos de atribución de Meta, tomados de la petición del navegador.
  //
  // `_fbc` la crea el pixel al aterrizar con `?fbclid=`, pero el pixel carga
  // diferido: si la clienta llega y compra rápido, la cookie todavía no
  // existe. En ese caso la reconstruimos con el formato que Meta espera
  // (`fb.1.<timestamp>.<fbclid>`) para no perder la atribución del anuncio.
  // El cuerpo va primero que la cookie: el pixel de FEM no está escribiendo
  // `_fbp` ni `_fbc` (cookies propias desactivadas en el Events Manager), así
  // que lo que manda el navegador es la fuente fiable.
  const marketingConsent=req.cookies.get("fem_consent")?.value === "all";
  const fbcCookie = body.fbc ?? req.cookies.get("_fbc")?.value;
  const atribucion = {
    fbp: body.fbp ?? req.cookies.get("_fbp")?.value,
    fbc:
      fbcCookie ??
      (body.fbclid ? `fb.1.${Date.now()}.${body.fbclid}` : undefined),
    clientIp: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    clientUserAgent: req.headers.get("user-agent") ?? undefined,
    eventSourceUrl: body.eventSourceUrl,
  };

  if(!marketingConsent)for(const key of Object.keys(atribucion))atribucion[key as keyof typeof atribucion]=undefined;

  // ── 1. Insertar la orden (siempre, antes de cualquier redirect) ──────────
  // Idempotencia: el cliente manda una clave estable por intento de compra.
  // Si esa clave ya existe reutilizamos la fila en vez de crear un pedido
  // nuevo — así un doble clic o un reintento tras un corte de red no se
  // convierte en dos órdenes en Shopify.
  const idempotencyKey = body.idempotencyKey?.trim() || null;
  const huella = contentHash(body);
  let orderId: string | null = null;
  let reusedExisting = false;

  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from("orders")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) {
      orderId = existing.id;
      reusedExisting = true;
      console.log(`[Checkout] Intento repetido (${idempotencyKey}) → reutilizando orden ${orderId}`);
    }
  }

  // Segunda red: mismo contenido en los últimos 30 minutos. Atrapa el caso que
  // la clave de idempotencia no puede ver, porque esa vive en sessionStorage y
  // no cruza pestañas ni dispositivos.
  if (!orderId) {
    const desde = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString();
    const { data: mismoContenido } = await supabase
      .from("orders")
      .select("id, payment_status")
      .eq("content_hash", huella)
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Nunca reutilizar un pedido de Mercado Pago que ya quedó pagado: el
    // webhook solo crea la orden en Shopify si aún no existe, así que la
    // clienta terminaría pagando dos veces y recibiendo un solo envío. Si ya
    // pagó y vuelve a pagar, es una compra nueva de verdad.
    //
    // Contraentrega no tiene ese riesgo — no hay cobro — y es justamente donde
    // aparecían los duplicados, así que ahí sí se deduplica siempre.
    const yaPagado =
      body.paymentMethod === "mercadopago" &&
      mismoContenido?.payment_status === "approved";

    if (mismoContenido && !yaPagado) {
      orderId = mismoContenido.id;
      reusedExisting = true;
      console.log(`[Checkout] Pedido idéntico reciente → reutilizando orden ${orderId}`);
    }
  }

  if (!orderId) {
    const { data: order, error: insertError } = await supabase
    .from("orders")
    .insert({
      marketing_consent: marketingConsent,
      privacy_consent_at: new Date().toISOString(),
      email: body.email,
      first_name: body.firstName,
      last_name: body.lastName,
      cedula: body.cedula ?? null,
      phone: body.phone,
      address: body.address,
      complement: body.complement ?? null,
      state: body.state,
      city: body.city,
      payment_method: body.paymentMethod,
      payment_status:
        body.paymentMethod === "contraentrega" ? "approved" : "pending",
      subtotal: body.subtotal,
      shipping: body.shipping,
      discount,
      coupon_code: body.couponCode ? body.couponCode.trim().toUpperCase() : null,
      total: body.total,
      idempotency_key: idempotencyKey,
      content_hash: huella,
      // Atribución de Meta. Este es el único momento en que existen: el
      // Purchase de Mercado Pago sale del webhook, que lo llama el servidor de
      // MP y no ve ni cookies ni IP de la clienta.
      fbp: atribucion.fbp ?? null,
      fbc: atribucion.fbc ?? null,
      client_ip: atribucion.clientIp ?? null,
      client_user_agent: atribucion.clientUserAgent ?? null,
      event_source_url: atribucion.eventSourceUrl ?? null,
    })
    .select("id")
    .single();

    if (insertError || !order) {
      // 23505 = índice único de idempotencia: dos peticiones idénticas llegaron
      // a la vez y la otra ganó la carrera. Reutilizamos su fila.
      if (insertError?.code === "23505" && idempotencyKey) {
        const { data: winner } = await supabase
          .from("orders")
          .select("id")
          .eq("idempotency_key", idempotencyKey)
          .maybeSingle();

        if (winner) {
          orderId = winner.id;
          reusedExisting = true;
          console.log(`[Checkout] Carrera de doble envío (${idempotencyKey}) → orden ${orderId}`);
        }
      }

      if (!orderId) {
        console.error("Supabase insert error:", insertError);
        return NextResponse.json(
          { error: "No se pudo registrar la orden" },
          { status: 500 }
        );
      }
    } else {
      orderId = order.id;
    }
  }

  if (!orderId) {
    // Inalcanzable: las ramas anteriores retornan o asignan. Guarda explícita
    // para que ningún cambio futuro deje pasar una orden sin id.
    return NextResponse.json({ error: "No se pudo registrar la orden" }, { status: 500 });
  }

  // ── 2. Guardar los items de la orden ─────────────────────────────────────
  // En un intento repetido los items ya están guardados: insertarlos otra vez
  // duplicaría el contenido del pedido.
  if (!reusedExisting) {
    const { error: itemsError } = await supabase.from("order_items").insert(
      body.items.map((item) => ({
        order_id: orderId,
        product_id: item.id,
        name: item.name,
        variant: item.variant ?? null,
        price: item.price,
        quantity: item.quantity,
        image: item.image,
        shopify_variant_id: item.shopifyVariantId ?? null,
      }))
    );

    if (itemsError) {
      console.error("Supabase items insert error:", itemsError);
      return NextResponse.json({error:'No pudimos guardar los productos. Inténtalo nuevamente.'},{status:503});
    }
  }

  // ── 2b. Cerrar la sesión de seguimiento ──────────────────────────────────
  // Quien envía el pedido deja de ser un carrito abandonado. Va sin `await` y
  // con el error tragado: es un dato de marketing y no puede demorar ni
  // tumbar una compra que ya está confirmada.
  if (body.sessionId) {
    supabase
      .from("checkout_sessions")
      .update({ converted_at: new Date().toISOString(), order_id: orderId })
      .eq("session_id", body.sessionId)
      .is("converted_at", null)
      .then(
        ({ error }) => {
          if (error) console.error("[Checkout] No se pudo cerrar la sesión:", error);
        },
        () => {}
      );
  }

  // ── 3. Contraentrega: solo guardar en Supabase, NO crear en Shopify aún ──
  // La orden se crea en Shopify desde /finalize, que se llama desde el
  // thank-you page cuando el usuario decide sobre el upsell del jabón
  // (acepta o descarta). Así llega completa a Shopify y a MasterShop.
  if (body.paymentMethod === "contraentrega") {
    // Conversions API: Purchase (contraentrega se considera conversión al registrar el pedido).
    // En un intento repetido ya se envió: no lo contamos dos veces.
    if (!reusedExisting) {
      sendPurchaseEvent({
        marketingConsent,
        orderId,
        email: body.email,
        phone: body.phone,
        value: body.total,
        firstName: body.firstName,
        lastName: body.lastName,
        city: body.city,
        state: body.state,
        contents: body.items.map((i) => ({
          id: String(i.shopifyVariantId ?? i.id),
          quantity: i.quantity,
          price: i.price,
        })),
        ...atribucion,
      }).catch(() => {});
    }

    // La página de gracias necesita saber por dónde va a salir el pedido: con
    // Sendura la ventana del upsell es más larga, porque su API no permite
    // añadir un producto a una guía ya creada. Es una pista para la interfaz;
    // la decisión de verdad la vuelve a tomar el servidor al despachar.
    const destino =
      senduraActivo() && coberturaSendura(body.state, body.city).cubierta
        ? "sendura"
        : "fem";

    return NextResponse.json({
      type: "contraentrega",
      status: "approved",
      order_id: orderId,
      destino,
    });
  }

  // ── 4. Mercado Pago: crear preferencia con order_id en back_urls ─────────
  try {
    const preference = new Preference(client);

    const mpItems = body.items.map((item) => ({
      id: item.id,
      title: item.variant ? `${item.name} – ${item.variant}` : item.name,
      description: item.variant ? `${item.name} – ${item.variant}` : item.name,
      category_id: "health_and_beauty",
      quantity: item.quantity,
      unit_price: item.price,
      currency_id: "COP",
      picture_url: item.image,
    }));

    // Apply discount as a line item so MP totals match exactly
    if (body.couponCode && discount > 0) {
      mpItems.push({
        id: "discount",
        title: `Descuento ${body.couponCode.trim().toUpperCase()}`,
        description: `Descuento ${body.couponCode.trim().toUpperCase()}`,
        category_id: "health_and_beauty",
        quantity: 1,
        unit_price: -discount,
        currency_id: "COP",
        picture_url: "",
      });
    }

    const result = await preference.create({
      body: {
        items: mpItems,
        payer: body.thirdPartyPay === true ? undefined : {
          name: body.firstName,
          surname: body.lastName,
          email: body.email,
          // area_code is required by MP Colombia — without it payment validation fails
          phone: { area_code: "57", number: body.phone },
          address: {
            street_name: body.address,
          },
          ...(body.cedula
            ? { identification: { type: "CC", number: body.cedula } }
            : {}),
        },
        // El order_id viaja en la back_url para que MP lo devuelva en el redirect
        back_urls: {
          success: `${APP_URL}/checkout/thank-you?status=success&order_id=${orderId}`,
          failure: `${APP_URL}/checkout/thank-you?status=failure&order_id=${orderId}`,
          pending: `${APP_URL}/checkout/thank-you?status=pending&order_id=${orderId}`,
        },
        ...(body.thirdPartyPay === true ? { expires: true, expiration_date_to: new Date(Date.now()+24*60*60*1000).toISOString() } : {}),
        notification_url: `${APP_URL}/api/webhooks/mercadopago`,
        auto_return: "approved",
        statement_descriptor: "FEM SUPLEMENTOS",
        external_reference: orderId,
      },
    });

    // Actualizar la orden con el preference_id de MP
    await supabase
      .from("orders")
      .update({ mp_preference_id: result.id })
      .eq("id", orderId);

    return NextResponse.json({
      type: "mercadopago",
      init_point: result.init_point ?? result.sandbox_init_point,
      preference_id: result.id,
      order_id: orderId,
    });
  } catch (err) {
    console.error("MP checkout error:", err);

    // Marcar la orden como fallida para no dejarla huérfana en pending
    await supabase
      .from("orders")
      .update({ payment_status: "failure" })
      .eq("id", orderId);

    return NextResponse.json(
      { error: "Error creando la orden de pago" },
      { status: 500 }
    );
  }
}
