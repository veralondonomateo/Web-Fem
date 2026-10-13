import {privacyMarkup,cookiePolicy} from './privacy.ts';
import {type IncomingMessage,type ServerResponse} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {STORE_ORIGIN} from '../src/lib/navigation.ts';
import {checkoutPermalink,type CheckoutLine} from '../src/lib/checkout.ts';
import {transformStorefront} from './transform.ts';
import {sendBody} from './response.ts';
import {readAsset} from './assets.ts';
import {restoreSearchResults} from './search.ts';
const port=Number(process.env.PORT ?? 3000);
const redirectData=JSON.parse(await readFile('audit/redirects.json','utf8')) as {path:string;target:string}[];
const redirects=new Map(redirectData.map(row=>[row.path,row.target]));
const mime:Record<string,string>={css:'text/css',js:'text/javascript',svg:'image/svg+xml',json:'application/json',woff2:'font/woff2',ttf:'font/ttf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',mp4:'video/mp4'};
const upstreamPaths=/^\/(?:$|products(?:\/|\.json)|collections(?:\/|$|\.json)|pages\/|blogs\/|policies\/|search(?:\/|$|\.json)|cart(?:\/|$|\.js)|cdn\/|recommendations\/|localization|robots\.txt|sitemap.*\.xml|favicon\.ico)/;
async function body(req:IncomingMessage):Promise<Buffer> {
  const parsed=(req as IncomingMessage & {body?:unknown}).body;
  if(parsed!==undefined){const value=Buffer.isBuffer(parsed)?parsed:Buffer.from(typeof parsed==='string'?parsed:JSON.stringify(parsed));if(value.length>1024*1024)throw Error('Request too large');return value;}
  const chunks:Buffer[]=[];let length=0;
  for await(const chunk of req){length+=chunk.length;if(length>1024*1024)throw new Error('Request too large');chunks.push(Buffer.from(chunk));}
  return Buffer.concat(chunks);
}
async function serve(req:IncomingMessage,res:ServerResponse):Promise<void> {
  if(req.url?.split('?')[0]==='/pages/politica-de-cookies'){res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(req.method==='HEAD'?'':cookiePolicy);return;}
  const url=new URL(req.url??'/',`http://127.0.0.1:${port}`);
  const redirect=redirects.get(url.pathname);
  if(redirect){res.writeHead(301,{Location:redirect}).end();return;}
  if(url.pathname==='/__health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,mode:'shopify-connected-review',origin:STORE_ORIGIN}));return;}
  if(url.pathname.startsWith('/__theme/')){
    const name=decodeURIComponent(url.pathname.slice('/__theme/'.length));
    if(name!==basename(name)||name.includes('\0')){res.writeHead(400).end();return;}
    const file=join(process.cwd(),'theme-dev/assets',name);
    try{
      const metadata=await stat(file);
      if(!metadata.isFile()){res.writeHead(404).end();return;}
      const etag=`W/"${metadata.size.toString(16)}-${metadata.mtimeMs.toString(16)}"`;
      res.setHeader('Content-Type',mime[name.split('.').pop()!]??'application/octet-stream');
      res.setHeader('Cache-Control','no-cache');
      res.setHeader('ETag',etag);
      if(['GET','HEAD'].includes(req.method??'GET') && req.headers['if-none-match']?.split(',').map(v=>v.trim()).includes(etag)){
        res.writeHead(304).end();return;
      }
      const data=await readAsset(file,etag);
      if(name.endsWith('.mp4')){
        res.setHeader('Accept-Ranges','bytes');
        const range=req.method==='GET' && !req.headers['if-range'] ? req.headers.range : undefined;
        if(range){
          const match=/^bytes=(\d*)-(\d*)$/.exec(range);
          const start=match?.[1] ? Number(match[1]) : Math.max(0,data.length-Number(match?.[2]));
          const end=match?.[1] && match[2] ? Math.min(Number(match[2]),data.length-1) : data.length-1;
          if(!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start>end || start>=data.length){
            res.writeHead(416,{'Content-Range':`bytes */${data.length}`}).end();return;
          }
          res.statusCode=206;
          res.setHeader('Content-Range',`bytes ${start}-${end}/${data.length}`);
          await sendBody(req,res,data.subarray(start,end+1));return;
        }
      }
      await sendBody(req,res,data);
    }catch{res.writeHead(404).end('Asset not found');}return;
  }
  if(url.pathname==='/__review'){
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await readFile('docs/review.html','utf8'));return;
  }
  if(url.pathname==='/checkout'){
    const response=await fetch(STORE_ORIGIN+'/cart.js',{headers:{Cookie:req.headers.cookie??''},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error('Shopify cart unavailable');
    const cart=await response.json() as {items:CheckoutLine[];attributes?:Record<string,string>};
    const target=checkoutPermalink(cart.items,cart.attributes);
    if(target){res.writeHead(302,{Location:target}).end();return;}
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.end('<h1>Continúa en la tienda oficial</h1><p>Los planes de suscripción y los atributos especiales se validan en Shopify. Esta vista local no puede transferirlos mediante un enlace de carrito.</p><a href="https://femprobiotics.co/cart">Abrir tienda oficial</a><br><a href="/cart">Volver al carrito local</a>');return;
  }
  if(/^\/(checkout|checkouts|account|customer_authentication|discount|apps|challenge)(\/|$)/.test(url.pathname)){
    res.writeHead(302,{Location:STORE_ORIGIN+url.pathname+url.search}).end();return;
  }
  if(!upstreamPaths.test(url.pathname)){res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'}).end('<h1>Página no encontrada</h1><a href="/">Volver a Fem</a>');return;}
  const method=req.method??'GET';
  if(!['GET','HEAD'].includes(method)&&!(method==='POST'&&/^\/cart(?:\/(add|change|update|clear)(\.js)?)?$/.test(url.pathname))){res.writeHead(405).end('Este formulario se completa en la tienda oficial.');return;}
  if(method==='POST') {
    const origin=req.headers.origin;
    const allowed=process.env.VERCEL ? [`https://${req.headers.host}`] : [`http://localhost:${port}`,`http://127.0.0.1:${port}`];
    if(origin&&!allowed.includes(origin)&&!(process.env.FEM_INTERNAL_SECRET&&req.headers['x-fem-internal']===process.env.FEM_INTERNAL_SECRET)){res.writeHead(403).end();return;}
  }
  const headers:Record<string,string>={'User-Agent':req.headers['user-agent']??'Fem Local Review','Accept':req.headers.accept??'*/*','Accept-Language':req.headers['accept-language']??'es-CO,es;q=0.9'};
  if(req.headers.cookie)headers.Cookie=req.headers.cookie;
  if(req.headers['content-type'])headers['Content-Type']=req.headers['content-type'];
  const payload=method==='POST'?await body(req):undefined;
  const upstream=await fetch(STORE_ORIGIN+url.pathname+url.search,{method,headers,body:payload ? new Uint8Array(payload) : undefined,redirect:'manual',signal:AbortSignal.timeout(30000)});
  res.statusCode=upstream.status;
  res.setHeader('X-Robots-Tag','noindex, nofollow');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  const cookies=upstream.headers.getSetCookie().filter(c=>/(?:^|;\s*)fem_consent=all(?:;|$)/.test(req.headers.cookie||'')||!/^(_shopify_analytics|_shopify_marketing|_fbp|_fbc|_ga|_ttp)=/.test(c)).map(c=>c.replace(/;\s*domain=[^;]+/ig,'').replace(/;\s*secure\b/ig,process.env.VERCEL?'; Secure':'').replace(/SameSite=None/ig,'SameSite=Lax'));
  if(cookies.length)res.setHeader('Set-Cookie',cookies);
  const location=upstream.headers.get('location');
  if(location){const target=new URL(location,STORE_ORIGIN);res.setHeader('Location',target.origin===STORE_ORIGIN&&!/^\/(checkouts|account|customer_authentication|discount|apps|challenge)(\/|$)/.test(target.pathname)?target.pathname+target.search+target.hash:target.href);res.end();return;}
  const type=upstream.headers.get('content-type')??'application/octet-stream';res.setHeader('Content-Type',type);
  if(method==='HEAD'){res.end();return;}
  if(type.includes('text/html')){
    const html=await restoreSearchResults(await upstream.text(),url,headers);
    await sendBody(req,res,privacyMarkup(transformStorefront(html,url.pathname),req.headers.cookie));
  }
  else if(type.includes('application/json')) {
    const data:unknown=await upstream.json();
    const transformSections=(value:unknown):unknown=>{
      if(typeof value==='string'&&/^\s*</.test(value))return transformStorefront(value);
      if(Array.isArray(value))return value.map(transformSections);
      if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,transformSections(item)]));
      return value;
    };
    await sendBody(req,res,JSON.stringify(transformSections(data)));
  }
  else res.end(Buffer.from(await upstream.arrayBuffer()));
}
export default async function handler(req:IncomingMessage,res:ServerResponse):Promise<void>{try{await serve(req,res);}catch(error){console.error(error instanceof Error?error.message:error);if(!res.headersSent)res.writeHead(502,{"Content-Type":"text/html; charset=utf-8"});res.end('<h1>No pudimos consultar Shopify</h1><p>Inténtalo nuevamente.</p><a href="/">Volver a intentar</a>');}}
