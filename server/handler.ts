import {cookiePolicy} from './cookie-policy.ts';
import {type IncomingMessage,type ServerResponse} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {sendBody,preferredEncoding} from './response.ts';
import {readAsset} from './assets.ts';
import {renderOwnedBody,ownedPaths,productCard} from './owned-renderer.ts';
import {catalog,productByHandle,searchCatalog} from './catalog.ts';
import {readCartCookie,cartCookie,cartState,mutateCart} from './local-cart.ts';
import {handleCommerceProxy,saveContact} from './owned-commerce.ts';
const port=Number(process.env.PORT ?? 3000);
const assets=(await import(new URL('../dist/assets.json',import.meta.url).href,{with:{type:'json'}})).default as {version:string;files:Record<string,{etag:string;bytes:number}>};
const redirectData=JSON.parse(await readFile('audit/redirects.json','utf8')) as {path:string;target:string}[];
const redirects=new Map(redirectData.map(row=>[row.path,row.target]));
const mime:Record<string,string>={css:'text/css',js:'text/javascript',svg:'image/svg+xml',json:'application/json',woff:'font/woff',woff2:'font/woff2',ttf:'font/ttf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',avif:'image/avif',gif:'image/gif',mp4:'video/mp4',webm:'video/webm'};
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
  if(url.pathname==='/__health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,mode:'independent',catalog:catalog.length}));return;}
  if(url.pathname.startsWith('/__theme/')){
    const name=decodeURIComponent(url.pathname.slice('/__theme/'.length));
    if(name!==basename(name)||name.includes('\0')){res.writeHead(400).end();return;}
    const file=join(process.cwd(),'dist/assets',name);
    try{
      const metadata=await stat(file);
      if(!metadata.isFile()){res.writeHead(404).end();return;}
      const etag='W/"'+(assets.files[name]?.etag??`${metadata.size.toString(16)}-${metadata.mtimeMs.toString(16)}`)+'"';
      res.setHeader('Content-Type',mime[name.split('.').pop()!]??'application/octet-stream');
      res.setHeader('Cache-Control',url.searchParams.get('v')===assets.version?'public, max-age=31536000, immutable':'no-cache');
      res.setHeader('ETag',etag);
      if(/\.(?:css|js|json|svg)$/.test(name))res.setHeader('Vary','Accept-Encoding');
      if(['GET','HEAD'].includes(req.method??'GET') && req.headers['if-none-match']?.split(',').map(v=>v.trim()).includes(etag)){
        res.writeHead(304).end();return;
      }
      const encoding=/\.(?:css|js|json|svg)$/.test(name)?preferredEncoding(req.headers['accept-encoding']??''):null;
      if(encoding){
        try{
          const encoded=await readAsset(file+(encoding==='br'?'.br':'.gz'),etag);
          res.setHeader('Content-Encoding',encoding);res.setHeader('Content-Length',encoded.length);
          res.end(req.method==='HEAD'?undefined:encoded);return;
        }catch{/* Small resources need no compressed copy. */}
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
  const method=req.method??'GET';
  if(!['GET','HEAD','POST'].includes(method)){res.writeHead(405).end();return;}
  if(method==='POST'){
    const origin=req.headers.origin;
    const host=req.headers.host??'localhost:'+port;
    if(origin&&!['http://'+host,'https://'+host].includes(origin)&&!(process.env.FEM_INTERNAL_SECRET&&req.headers['x-fem-internal']===process.env.FEM_INTERNAL_SECRET)){res.writeHead(403).end();return;}
  }
  const json=async(value:unknown,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','private, no-store');await sendBody(req,res,JSON.stringify(value));};
  if(/^\/cart(?:\/(?:add|change|update|clear))?\.js$/.test(url.pathname)){
    let cart=readCartCookie(req.headers.cookie);
    const action=url.pathname.match(/^\/cart\/(\w+)\.js$/)?.[1];
    if(method==='POST'&&action){const raw=(await body(req)).toString();const input=req.headers['content-type']?.includes('application/json')?JSON.parse(raw):Object.fromEntries(new URLSearchParams(raw));cart=mutateCart(cart,action,input);res.setHeader('Set-Cookie',cartCookie(cart,!!process.env.VERCEL));}
    else if(action||method==='POST'){res.writeHead(405).end();return;}
    await json(cartState(cart));return;
  }
  if(url.pathname==='/products.json'){await json({products:catalog});return;}
  const productJSON=url.pathname.match(/^\/products\/([^/]+)\.(?:js|json)$/);
  if(productJSON){const p=productByHandle(productJSON[1]);await json(p??{error:'Producto no encontrado'},p?200:404);return;}
  if(url.pathname==='/recommendations/products.json'){const id=Number(url.searchParams.get('product_id'));await json({products:catalog.filter(p=>p.id!==id&&p.available).slice(0,6)});return;}
  if(url.pathname==='/search/suggest.json'){await json({resources:{results:{products:searchCatalog(url.searchParams.get('q')??'').slice(0,6)}}});return;}
  if(url.pathname==='/search/suggest'){
    res.setHeader('Content-Type','text/html; charset=utf-8');
    const matches=searchCatalog(url.searchParams.get('q')??'').slice(0,6);
    await sendBody(req,res,'<div id="predictive-search-results" ref="predictiveSearchResults"><div id="predictive-search-products" class="fem-owned-search-grid">'+matches.map(productCard).join('')+'</div></div>');return;
  }
  if(url.pathname==='/contact'&&method==='POST'){await saveContact(req,res,(await body(req)).toString());return;}
  if(await handleCommerceProxy(req,res,url,()=>body(req)))return;
  if(method==='POST'){res.writeHead(405).end();return;}
  if(url.pathname==='/robots.txt'){res.setHeader('Content-Type','text/plain');res.end('User-agent: *\nAllow: /\nDisallow: /cart\nDisallow: /checkout\n');return;}
  if(url.pathname==='/sitemap.xml'){res.setHeader('Content-Type','application/xml');res.end('<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+ownedPaths().map(p=>'<url><loc>'+url.origin+p+'</loc></url>').join('')+'</urlset>');return;}
  const html=renderOwnedBody(url,req.headers.cookie);
  if(!html){res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'}).end('<h1>Página no encontrada</h1><a href="/">Volver a Fem</a>');return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');
  if(url.searchParams.has('sections')){const ids=url.searchParams.get('sections')!.split(',').slice(0,10);await json(Object.fromEntries(ids.map(id=>[id,html.toString()])));return;}
  await sendBody(req,res,html);
}
export default async function handler(req:IncomingMessage,res:ServerResponse):Promise<void>{try{await serve(req,res);}catch(error){const status=(error as {status?:number}).status??500;console.error(error instanceof Error?error.message:error);if(!res.headersSent)res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify({description:error instanceof Error?error.message:'No pudimos procesar la solicitud. Inténtalo nuevamente.'}));}}
