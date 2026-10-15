const origin='https://femprobiotics.co';
export const isCartJSON=path=>/^\/cart(?:\/(?:add|change|update|clear))?\.js$/.test(path);
export function mergeCookies(current,updates){const jar=new Map(current.split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const n=x.indexOf('=');return [x.slice(0,n),x.slice(n+1)];}));for(const cookie of updates){const pair=cookie.split(';')[0],n=pair.indexOf('=');jar.set(pair.slice(0,n),pair.slice(n+1));}return [...jar].map(([k,v])=>`${k}=${v}`).join('; ');}
// Cart requests bypass the storefront rendering service; no shared cart cache.
export async function proxyCart(req,res,payload,request=fetch){
 const path=new URL(req.url,'http://local'),method=req.method||'GET';
 if(!isCartJSON(path.pathname)||!['GET','POST','HEAD'].includes(method)||(method==='POST'&&path.pathname==='/cart.js')){res.writeHead(405).end();return;}
 const cookie=(req.headers.cookie||'').split(';').filter(x=>!/^fem_admin(?:_v2)?=/.test(x.trim())).join(';');
 const headers={Accept:'application/json',Cookie:cookie,...(payload?{'Content-Type':req.headers['content-type']||'application/json'}:{})};
 const response=await request(origin+path.pathname+path.search,{method,headers,body:payload,redirect:'manual',signal:AbortSignal.timeout(20000)});
 const setCookies=[...response.headers.getSetCookie()];let data=await response.text();
 // Only opt-in clients receive the authoritative full cart after a successful add.
 // If the read fails, return the original add response: never retry a successful mutation.
 if(response.ok&&method==='POST'&&path.pathname==='/cart/add.js'&&req.headers['x-fem-cart-state']==='1'){
  try{const state=await request(origin+'/cart.js',{headers:{Accept:'application/json',Cookie:mergeCookies(cookie,setCookies)},signal:AbortSignal.timeout(10000)});if(state.ok){const value=await state.json();if(Array.isArray(value.items)&&typeof value.total_price==='number'){data=JSON.stringify(value);setCookies.push(...state.headers.getSetCookie());}}}catch{/* Client can safely retry only the cart read. */}
 }
 const consent=/(?:^|;\s*)fem_consent=all(?:;|$)/.test(cookie);
 const safeCookies=setCookies.filter(c=>consent||!/^(_shopify_analytics|_shopify_marketing|_fbp|_fbc|_ga|_ttp)=/.test(c)).map(c=>c.replace(/;\s*domain=[^;]+/ig,'').replace(/;\s*secure\b/ig,process.env.VERCEL?'; Secure':'').replace(/SameSite=None/ig,'SameSite=Lax'));
 res.statusCode=response.status;res.setHeader('Content-Type',response.headers.get('content-type')||'application/json');res.setHeader('Cache-Control','private, no-store');if(safeCookies.length)res.setHeader('Set-Cookie',safeCookies);
 res.end(method==='HEAD'?'':data);
}
