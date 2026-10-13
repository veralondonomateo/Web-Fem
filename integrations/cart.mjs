export function cartPayload(c){
 if(!c.items?.length)return null;
 if(c.currency!=='COP'||c.items.some(i=>i.selling_plan_allocation))throw Error('Este carrito necesita el checkout de Shopify para validar su moneda o suscripción.');
 if(!Number.isFinite(c.total_price)||c.total_price<=0||c.items.some(i=>!Number.isInteger(i.quantity)||i.quantity<1||!Number.isFinite(i.final_line_price)||i.final_line_price<0||!Number.isSafeInteger(i.variant_id)))throw Error('Carrito inválido');
 return {items:c.items.map(i=>({id:i.key,name:i.product_title||i.title,variant:i.variant_title,price:i.final_line_price/100/i.quantity,quantity:i.quantity,image:i.featured_image?.url||i.image||'',shopifyVariantId:i.variant_id})),payment:c.attributes?.fem_payment_preference==='prepaid'?'mercadopago':'contraentrega',total:c.total_price/100,cupon:null};
}

export function paymentError(cart,body){
 if(cart.payment==='mercadopago'&&body.paymentMethod!=='mercadopago')return {error:'Elegiste pago anticipado. Continúa con Mercado Pago o vuelve al carrito para cambiar la modalidad.',codigo:'pago_anticipado_requerido'};
 if(body.thirdPartyPay===true&&body.paymentMethod!=='mercadopago')return {error:'El pago compartido requiere Mercado Pago.',codigo:'pago_compartido_invalido'};
 if(!['contraentrega','mercadopago'].includes(body.paymentMethod))return {error:'Método de pago inválido',codigo:'pago_invalido'};
 return null;
}
