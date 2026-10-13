import bundledAssets from './assets.mjs';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {randomBytes} from 'node:crypto';
import {root,config,adminPassword,adminPasswordHash,preview,port,publicOrigin} from './config.mjs';
import {session,issue,equal,verifyPassword,limited,sameOrigin,sessions,revoke} from './auth.mjs';
import {dataset,orderDetail} from './data.mjs';
import {cartPayload,paymentError} from './cart.mjs';
import {milestone} from './milestone.mjs';
const STORE=(process.env.STORE_INTERNAL_URL||'http://127.0.0.1:3001').replace(/\/$/,''),CHECKOUT=(process.env.CHECKOUT_INTERNAL_URL||'http://127.0.0.1:3002').replace(/\/$/,''),CRM=(process.env.CRM_INTERNAL_URL||'http://127.0.0.1:3111').replace(/\/$/,'');
const secret=process.env.FEM_INTERNAL_SECRET;
if(!adminPasswordHash||!secret)throw Error('Falta configurar acceso administrador o clave interna');
const visitors=new Map();
const secure=publicOrigin.startsWith('https:')?'; Secure':'';
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}).end(JSON.stringify(value));};
function messagePage(res,title,message,href,label){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+' · FEM</title><link rel="stylesheet" href="/__theme/fem-fonts.css"></head><body style="margin:0;background:#fff7f7;color:#613c46;font-family:Poppins,Arial,sans-serif;display:grid;place-items:center;min-height:100vh"><main style="max-width:500px;text-align:center;padding:40px 24px"><p style="font-size:38px;font-weight:700">fem</p><h1 style="font-size:28px">'+title+'</h1><p style="line-height:1.8">'+message+'</p><a style="display:inline-block;background:#f1b3b9;padding:16px 24px;border-radius:30px;color:inherit;text-decoration:none;margin-top:20px" href="'+href+'">'+label+' →</a></main></body></html>');}
const redirect=(res,path)=>res.writeHead(302,{Location:path}).end();
async function body(req){if(req.body!==undefined){const b=Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body));if(b.length>1024*1024)throw Object.assign(Error('Solicitud demasiado grande'),{status:413});return b;}const upload=/^\/admin\/crm\/api\/conversations\/[^/]+\/adjunto(?:\?|$)/.test(req.url||'');const max=upload?17*1024*1024:1024*1024;let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>max)throw Object.assign(Error('Solicitud demasiado grande'),{status:413});chunks.push(c);}return Buffer.concat(chunks);}
function cookies(req){return (req.headers.cookie||'').split(';').filter(c=>!c.trim().startsWith('fem_admin=')).join(';');}
async function cart(req){const r=await fetch(STORE+'/cart.js',{headers:{cookie:cookies(req)},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('No pudimos cargar el carrito');return r.json();}
async function proxy(req,res,origin,path,extra={},payload){
 const headers={...req.headers,...extra,host:new URL(origin).host,'accept-encoding':'identity',cookie:cookies(req)};
 delete headers.connection;delete headers['content-length'];delete headers['x-admin-password'];
 if(extra['x-admin-password'])headers['x-admin-password']=extra['x-admin-password'];
 if(origin===STORE){if(headers.origin)headers.origin=STORE;headers['x-fem-internal']=secret;}
 const data=payload??(!['GET','HEAD'].includes(req.method)?await body(req):undefined);
 const r=await fetch(origin+path,{method:req.method,headers,body:data?.length?data:undefined,redirect:'manual',signal:AbortSignal.timeout(60000)});
 res.statusCode=r.status;
 for(const [key,value] of r.headers)if(!['content-length','content-encoding','transfer-encoding','connection','set-cookie','location'].includes(key))res.setHeader(key,value);
 const setCookies=r.headers.getSetCookie();if(setCookies.length)res.setHeader('Set-Cookie',setCookies);
 const location=r.headers.get('location');if(location){res.setHeader('Location',location.replace(origin,publicOrigin));res.end();return;}
 if(req.method==='HEAD'){res.end();return;}
 if(r.headers.get('content-type')?.includes('text/html')){
 let html=await r.text();
 if(origin===CRM)html=html.replace('<head>','<head><script src="/admin/assets/crm-adapter.js"></script>');
 if(origin===STORE)html=html.replace('</body>','<div style="text-align:center;padding:24px;background:#fff3f3;font-family:Poppins,sans-serif"><a href="/camino-al-millon" style="color:#68454d;text-decoration:none;font-size:14px">Nuestro camino al millón de órdenes ♡ →</a></div><script src="/fem-presence.js" defer></script></body>');
 res.end(html);
 }else res.end(Buffer.from(await r.arrayBuffer()));
}
const checkoutAPI=/^\/api\/(?:checkout(?:\/|$)|cities\/|ec\/|webhooks\/mercadopago$|crm\/|cron\/(?:sync-orders|carritos)$)/;
const crmPages=new Set(['login','dashboard','inbox','orders','customers','abandoned-carts','pqrs','flows','templates','settings','calidad']);
async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
 res.setHeader('X-Frame-Options','SAMEORIGIN');res.setHeader('Permissions-Policy','camera=(), microphone=(self), geolocation=()');
 if(secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
 const u=new URL(req.url,publicOrigin),p=u.pathname,method=req.method||'GET';
 if(!['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(method))return json(res,405,{error:'Método no permitido'});
 if(p.includes('/api/')&&method==='POST'&&p.endsWith('/auth/login')&&limited(req.socket.remoteAddress+'auth'))return json(res,429,{error:'Demasiados intentos'});
 delete req.headers['x-fem-internal'];delete req.headers['x-fem-cart'];
 if(!['GET','HEAD','OPTIONS'].includes(method)&&!p.includes('/webhooks/')&&!p.includes('/cron/')&&!sameOrigin(req,publicOrigin))return json(res,403,{error:'Origen no autorizado'});
 if(method==='POST'&&p.startsWith('/api/checkout')&&limited(req.socket.remoteAddress+':checkout:'+Math.floor(Date.now()/60000)))return json(res,429,{error:'Demasiadas solicitudes. Espera un momento.'});
 if(p==='/api/fem/milestone'&&method==='GET')return json(res,200,milestone());
 if(p==='/camino-al-millon'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(Buffer.from(bundledAssets['milestone/index.html'],'base64'));}
 if(p.startsWith('/milestone-assets/')){const name=p.slice('/milestone-assets/'.length);if(!['style.css','app.js','equipo.jpg'].includes(name))return json(res,404,{error:'No encontrado'});res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.jpg')?'image/jpeg':'text/javascript');return res.end(name.endsWith('.jpg')?await readFile(join(root,'milestone',name)):Buffer.from(bundledAssets['milestone/'+name],'base64'));}
 if(p==='/__health')return json(res,200,{ok:true,mode:preview?'preview':'live',services:['storefront','checkout','crm','admin']});
 if(p==='/fem-presence.js'){res.setHeader('Content-Type','text/javascript');return res.end("(()=>{let id=sessionStorage.getItem('fem_visit');if(!id){id=crypto.randomUUID();sessionStorage.setItem('fem_visit',id)}const tick=()=>{if(document.visibilityState==='visible')fetch('/api/fem/presence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,path:location.pathname})}).catch(()=>{})};tick();setInterval(tick,30000)})();");}
 if(p==='/api/fem/presence'&&method==='POST'){const b=JSON.parse((await body(req)).toString());if(!/^[a-f\d-]{36}$/.test(b.id)||typeof b.path!=='string'||b.path.length>300)return json(res,400,{error:'Evento inválido'});for(const [k,v] of visitors)if(v.time<Date.now()-90000)visitors.delete(k);if(visitors.size<10000)visitors.set(b.id,{time:Date.now(),path:b.path.split('?')[0]});return json(res,200,{ok:true});}
 if(p.startsWith('/admin/assets/')){const file=p.slice('/admin/assets/'.length);if(file!==basename(file))return json(res,400,{});try{const data=Buffer.from(bundledAssets['admin/'+file],'base64');res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(data);return;}catch{return json(res,404,{error:'Archivo no encontrado'});}}
 if(p==='/api/fem/session'&&method==='GET')return json(res,200,{authenticated:!!(await session(req)),preview});
 if(p==='/api/fem/login'&&method==='POST'){if(limited(req.socket.remoteAddress))return json(res,429,{error:'Demasiados intentos. Intenta de nuevo en 15 minutos.'});const b=JSON.parse((await body(req)).toString());if(!verifyPassword(b.password,adminPasswordHash))return json(res,401,{error:'Contraseña incorrecta'});res.setHeader('Set-Cookie',`fem_admin=${await issue()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`);return json(res,200,{ok:true});}
 if(p==='/api/fem/logout'&&method==='POST'){const s=await session(req);if(s)await revoke(s.id);res.setHeader('Set-Cookie',`fem_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);return json(res,200,{ok:true});}
 if(p.startsWith('/api/fem/')){
 if(!['GET','HEAD'].includes(method))return json(res,405,{error:'Método no permitido'});
 if(!(await session(req)))return json(res,401,{error:'Inicia sesión como administrador'});
 if(p.startsWith('/api/fem/orders/')){const order=await orderDetail(p.split('/').at(-1));return json(res,order?200:404,order||{error:'Pedido no encontrado'});}
 if(p==='/api/fem/live')return json(res,200,{active:[...visitors.values()].filter(v=>v.time>Date.now()-90000).length});
 if(p==='/api/fem/overview'){const data=await dataset(u.searchParams.get('range')||'30d');return json(res,200,{...data,preview,live:{active:[...visitors.values()].filter(v=>v.time>Date.now()-90000).length,scope:'Pestañas activas en los últimos 90 segundos, solo en esta instancia.'}});}
 if(p==='/api/fem/products'){const r=await fetch(STORE+'/products.json?limit=250',{signal:AbortSignal.timeout(15000)});if(!r.ok)return json(res,200,{available:false});return json(res,200,{available:true,...await r.json()});}
 if(p==='/api/fem/services'){const values=await Promise.all([['storefront',STORE+'/__health'],['checkout',CHECKOUT+'/checkout/health'],['crm',CRM+'/admin/crm/login']].map(async([name,url])=>{try{const r=await fetch(url,{signal:AbortSignal.timeout(10000)});return {name,ok:r.ok,status:r.status};}catch{return {name,ok:false,status:null};}}));return json(res,200,{services:values,preview});}
 return json(res,404,{error:'Ruta no encontrada'});
 }
 if(p==='/admin/crm')return redirect(res,'/admin/crm/login');
 if(p.startsWith('/admin/crm/')){
 if(preview&&!process.env.VERCEL&&p==='/admin/crm/api/auth/login'&&method==='POST'){const b=await body(req),v=JSON.parse(b.toString());if(limited(req.socket.remoteAddress+'crm')||!verifyPassword(v.password,adminPasswordHash))return json(res,401,{error:'Contraseña incorrecta'});return proxy(req,res,CRM,p+u.search,{},b);}
 return proxy(req,res,CRM,p+u.search);
 }
 if(crmPages.has(p.split('/')[1]))return redirect(res,'/admin/crm'+p+u.search);
 if(p==='/fem-icon.png'||p==='/fem-logo.png')return proxy(req,res,CRM,'/admin/crm'+p);
 if(p==='/admin'||p.startsWith('/admin/')){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(Buffer.from(bundledAssets['admin/index.html'],'base64'));}
 if(p.startsWith('/api/admin/')){if(!(await session(req)))return json(res,401,{error:'No autorizado'});return proxy(req,res,CHECKOUT,p+u.search,{'x-admin-password':secret});}
 if(p==='/checkout'){
 if(u.searchParams.has('r'))return proxy(req,res,CHECKOUT,p+u.search);
 const c=await cart(req);let data;try{data=cartPayload(c);}catch(error){return messagePage(res,'Revisa tu plan de suscripción','El checkout integrado procesa compras únicas en pesos colombianos. Para tu suscripción, utiliza el proceso de planes FEM.','/pages/planes-or-fem','Ver planes FEM');}
 if(!data)return messagePage(res,'Tu carrito está esperando por ti','Explora nuestros productos y elige cómo quieres cuidarte. Aquí podrás revisar tu pedido y decidir cómo pagar.','/collections/todos-los-productos','Descubrir productos');
 return proxy(req,res,CHECKOUT,p+u.search,{'x-fem-internal':secret,'x-fem-cart':Buffer.from(JSON.stringify(data)).toString('base64url')});
 }
 if(checkoutAPI.test(p)){
 if(preview&&(!['GET','HEAD'].includes(method)||p.includes('/cron/')||p.includes('/webhooks/')))return json(res,409,{error:'Vista local: no se crean pedidos ni cobros reales. La integración de pago está disponible para activar en despliegue tras validar las credenciales.',preview:true,codigo:'vista_local'});
 if(p==='/api/checkout'&&method==='POST'){
 const b=JSON.parse((await body(req)).toString());
 let c;
 if(b.recoveryToken){
 const recovered=await fetch(CHECKOUT+'/api/unified/recovery?token='+encodeURIComponent(b.recoveryToken),{headers:{'x-fem-internal':secret},signal:AbortSignal.timeout(20000)});
 const d=await recovered.json();
 if(!recovered.ok||!d.disponible)return json(res,409,{error:'El enlace de recuperación ya no está disponible.',codigo:'carrito_no_disponible'});
 c={items:d.lineas.map(l=>({id:l.id,name:l.nombre,variant:l.variante,price:l.precio,quantity:l.cantidad,image:l.imagen,shopifyVariantId:l.variant_id})),total:d.total,subtotal:d.subtotal,discount:d.descuento,coupon:d.cupon};
 }else c=cartPayload(await cart(req));
 if(!c)return json(res,400,{error:'Carrito vacío'});
 const paymentIssue=paymentError(c,b);if(paymentIssue)return json(res,409,paymentIssue);
 // Only server-verified cart lines and prices are accepted in the unified checkout.
 if(b.couponCode&&b.couponCode!==c.coupon)return json(res,400,{error:'Aplica el descuento en el carrito antes de continuar.'});
 if(Math.abs(Number(b.total)-c.total)>0.01)return json(res,409,{error:'Tu carrito cambió. Vuelve al carrito para revisar el total antes de pagar.',codigo:'carrito_cambiado'});
 b.items=c.items;b.subtotal=c.subtotal??c.total;b.total=c.total;b.shipping=0;b.discount=c.discount??0;b.couponCode=c.coupon||undefined;
 return proxy(req,res,CHECKOUT,p+u.search,{},Buffer.from(JSON.stringify(b)));
 }
 return proxy(req,res,CHECKOUT,p+u.search);
 }
 if(p.startsWith('/api/'))return proxy(req,res,CRM,'/admin/crm'+p+u.search);
 if(p.startsWith('/_next/')||p.startsWith('/checkout/')||p.startsWith('/r/')||p.startsWith('/ec/')||['/logo.svg','/states.json'].includes(p))return proxy(req,res,CHECKOUT,p+u.search);
 return proxy(req,res,STORE,p+u.search);
}
export default function requestHandler(req,res){return handler(req,res).catch(error=>{console.error('FEM gateway',error.code||error.name,error.code==='ENOENT'?error.path:'upstream failure');if(!res.headersSent)json(res,error.status===413?413:error instanceof SyntaxError?400:502,{error:'No pudimos conectar con este módulo. Reintenta en un momento.'});else res.end();});}
if(!process.env.VERCEL)createServer(requestHandler).listen(port,'127.0.0.1',()=>console.log(`FEM unificado: ${publicOrigin}`));
