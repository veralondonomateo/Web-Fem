import {checkoutEnv} from './config.mjs';
import {summarize,rangeFor} from './metrics.mjs';
let cached=null,inflight=null;
const headers=()=>({apikey:checkoutEnv.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+checkoutEnv.SUPABASE_SERVICE_ROLE_KEY});
async function query(table,params,count=false){
 const url=new URL('/rest/v1/'+table,checkoutEnv.SUPABASE_URL);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
 const r=await fetch(url,{headers:{...headers(),...(count?{Prefer:'count=exact'}:{})},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('No se pudo consultar la fuente');return {rows:await r.json(),count:Number(r.headers.get('content-range')?.split('/')[1])};
}
async function refresh(){
 const params={created_at:'lte.'+new Date().toISOString(),select:'id,created_at,total,status:payment_status,payment_method,email,first_name,last_name,city,state',order:'created_at.desc,id.desc',limit:'1000',offset:'0'};
 const first=await query('orders',params,true);if(!Number.isFinite(first.count))throw Error('Conteo no disponible');
 const orders=[...first.rows],limit=Math.min(first.count,100000);
 for(let offset=1000;offset<limit;offset+=8000){
  const pages=[];for(let n=offset;n<Math.min(offset+8000,limit);n+=1000)pages.push(query('orders',{...params,offset:String(n)}));
  for(const page of await Promise.all(pages))orders.push(...page.rows);
 }
 // New orders can shift offset pagination; never count a repeated ID twice.
 cached={orders:[...new Map(orders.map(o=>[o.id,o])).values()],truncated:first.count>100000,until:Date.now()+60000,updatedAt:new Date().toISOString()};
}
export async function dataset(preset){
 if(!checkoutEnv.SUPABASE_URL||!checkoutEnv.SUPABASE_SERVICE_ROLE_KEY)return {available:false,error:'Configura la fuente de pedidos del checkout.'};
 try{
 if(!cached||cached.until<Date.now()){
  if(!inflight)inflight=refresh().finally(()=>{inflight=null;});
  await inflight;
 }
 const summary=summarize(cached.orders,rangeFor(preset));
 return {available:true,source:'Checkout FEM · Supabase',updatedAt:cached.updatedAt,truncated:cached.truncated,...summary,orders:summary.orders.slice(0,1000),customers:summary.customers.slice(0,1000),coverage:'LTV histórico observado en esta fuente; no es una predicción. Contraentrega aprobada no equivale a dinero cobrado.'};
 }catch{return {available:false,error:'La fuente de pedidos no respondió. Puedes reintentar; no se sustituyen cifras reales por datos de ejemplo.'};}
}
export async function orderDetail(id){
 if(!/^[a-f0-9-]{36}$/i.test(id))return null;
 const [{rows:orders},{rows:items}]=await Promise.all([
 query('orders',{id:'eq.'+id,select:'id,created_at,email,first_name,last_name,phone,address,complement,city,state,total,subtotal,shipping,discount,coupon_code,payment_method,payment_status,shopify_order_id,sendura_order_id,sendura_guia,shopify_error,sendura_error'}),
 query('order_items',{order_id:'eq.'+id,select:'name,variant,quantity,price,image,shopify_variant_id'})
 ]);
 return orders[0]?{...orders[0],items}:null;
}
