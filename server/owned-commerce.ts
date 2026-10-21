import type {IncomingMessage,ServerResponse} from 'node:http';
import {appendFile,mkdir} from 'node:fs/promises';
import {readCartCookie,cartState} from './local-cart.ts';
const commercePaths=/^\/(?:checkout(?:\/|$)|api\/(?:checkout(?:\/|$)|cities\/|ec\/|webhooks\/mercadopago$)|_next\/|r\/|ec\/)/;
export async function handleCommerceProxy(req:IncomingMessage,res:ServerResponse,url:URL,body:()=>Promise<Buffer>):Promise<boolean>{
 if(!commercePaths.test(url.pathname))return false;
 const origin=process.env.CHECKOUT_INTERNAL_URL,secret=process.env.FEM_INTERNAL_SECRET;
 if(!origin||!secret){res.writeHead(503,{'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/__theme/fem-fonts.css"><body style="font-family:Poppins,sans-serif;color:#581d18;background:#fff7f7;padding:32px"><h1>El checkout necesita configuración</h1><p>El catálogo y el carrito ya son independientes. Configura Mercado Pago y la base de pedidos para habilitar compras reales.</p><a href="/">Volver a Fem</a>');return true;}
 const cart=cartState(readCartCookie(req.headers.cookie));
 if(url.pathname==='/checkout'&&!cart.items.length&&!url.searchParams.has('product')&&!url.searchParams.has('r')){res.writeHead(303,{Location:'/cart'}).end();return true;}
 if(url.pathname==='/checkout'&&cart.items.some(i=>/suscripci[oó]n/i.test(i.variant_title))){res.writeHead(303,{Location:'/pages/planes-or-fem'}).end();return true;}
 const headers:Record<string,string>={'x-fem-internal':secret,'x-fem-cart':Buffer.from(JSON.stringify({items:cart.items.map(i=>({id:i.key,name:i.product_title,variant:i.variant_title,quantity:i.quantity,price:i.final_line_price/100/i.quantity,image:i.image,shopifyVariantId:i.variant_id})),total:cart.total_price/100,payment:cart.attributes.fem_payment_preference==='prepaid'?'mercadopago':'contraentrega'})).toString('base64url')};
 if(url.pathname==='/checkout'&&!cart.items.length)delete headers['x-fem-cart'];
 // Mercado Pago's signature and request ID must survive the internal proxy.
 for(const key of ['cookie','content-type','x-signature','x-request-id','authorization','user-agent','x-forwarded-for']){
  const value=req.headers[key];if(typeof value==='string')headers[key]=value;
 }
 const payload=req.method==='POST'?await body():undefined;
 const response=await fetch(new URL(url.pathname+url.search,origin),{method:req.method,headers,body:payload?new Uint8Array(payload):undefined,redirect:'manual',signal:AbortSignal.timeout(30000)});
 res.statusCode=response.status;
 for(const [k,v]of response.headers)if(!['content-encoding','content-length','transfer-encoding','connection','set-cookie','location'].includes(k))res.setHeader(k,v);
 const location=response.headers.get('location');if(location)res.setHeader('Location',location.startsWith(origin)?location.replace(origin,process.env.FEM_PUBLIC_ORIGIN??''):location);
 const cookies=response.headers.getSetCookie();if(cookies.length)res.setHeader('Set-Cookie',cookies);
 res.end(req.method==='HEAD'?undefined:Buffer.from(await response.arrayBuffer()));return true;
}
export async function saveContact(req:IncomingMessage,res:ServerResponse,raw:string){
 const json=req.headers['content-type']?.includes('application/json');
 const data=json?JSON.parse(raw):Object.fromEntries(new URLSearchParams(raw));
 if(data.type==='welcome'&&data.privacyAccepted!==true){res.writeHead(422,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Acepta la política de privacidad.'}));return;}
 const email=String(data.email??data['contact[email]']??'').trim();
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){res.writeHead(422,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Escribe un correo válido.'}));return;}
 const message={email,name:String(data.name??data['contact[name]']??'').slice(0,200),message:String(data.message??data['contact[body]']??'').slice(0,10000),created_at:new Date().toISOString()};
 if(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY){
  const response=await fetch(new URL('/rest/v1/fem_contact_messages',process.env.SUPABASE_URL),{method:'POST',headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json'},body:JSON.stringify(message),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('No pudimos guardar tu mensaje. Inténtalo nuevamente.');
 }else{
  if(process.env.VERCEL)throw Error('Configura la recepción de mensajes antes de publicar.');
  await mkdir('.local',{recursive:true});await appendFile('.local/contact-messages.jsonl',JSON.stringify(message)+'\n',{mode:0o600});
 }
 if(json){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,code:'FEM10'}));}else{res.writeHead(303,{Location:'/pages/contact?sent=1'}).end();}
}
