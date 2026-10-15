import {randomBytes,createHash,timingSafeEqual,scryptSync} from 'node:crypto';
export const sessions=new Map(),attempts=new Map();
export function equal(a,b){const hash=x=>createHash('sha256').update(String(x||'')).digest();return timingSafeEqual(hash(a),hash(b));}
function localSession(req){const id=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('fem_admin_v2='))?.slice(13);const s=sessions.get(id);if(!s||s.until<Date.now()){sessions.delete(id);return null;}return {id,...s};}
function localIssue(){const id=randomBytes(32).toString('hex');sessions.set(id,{until:Date.now()+8*3600000});return id;}
export function limited(key){const now=Date.now();for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);let a=attempts.get(key);if(!a){a={count:0,until:now+900000};attempts.set(key,a);}return ++a.count>10;}
export function sameOrigin(req,origin){return req.headers.origin===origin||(process.env.VERCEL&&req.headers.origin===`https://${req.headers.host}`);}

export function hashPassword(value){const salt=randomBytes(16).toString('hex');return `scrypt$${salt}$${scryptSync(value,salt,64).toString('hex')}`;}
export function verifyPassword(value,encoded){if(typeof value!=='string'||value.length>1024)return false;const [algorithm,salt,hash]=String(encoded||'').split('$');if(algorithm!=='scrypt'||!/^([a-f0-9]{32})$/.test(salt||'')||!/^([a-f0-9]{128})$/.test(hash||''))return false;return timingSafeEqual(scryptSync(value,salt,64),Buffer.from(hash,'hex'));}

async function sessionRequest(method,token,payload){
 const env=JSON.parse(process.env.FEM_CHECKOUT_ENV_JSON||'{}');
 const hash=createHash('sha256').update('gerencia-v2:'+token).digest('hex');
 const url=new URL('/rest/v1/fem_admin_sessions',env.SUPABASE_URL);
 if(method!=='POST'){url.searchParams.set('token_hash','eq.'+hash);url.searchParams.set('select','expires_at');}
 const r=await fetch(url,{method,headers:{apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=minimal'},body:payload?JSON.stringify({token_hash:hash,...payload}):undefined,signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('No se pudo verificar la sesión');return method==='GET'?r.json():null;
}
export function session(req){if(!process.env.VERCEL)return localSession(req);return (async()=>{const id=(req.headers.cookie||'').match(/(?:^|;\s*)fem_admin_v2=([a-f0-9]{64})(?:;|$)/)?.[1];if(!id)return null;const rows=await sessionRequest('GET',id);const until=Date.parse(rows[0]?.expires_at||'');return until>Date.now()?{id,until}:null;})();}
export function issue(){if(!process.env.VERCEL)return localIssue();return(async()=>{const id=randomBytes(32).toString('hex');await sessionRequest('POST',id,{expires_at:new Date(Date.now()+8*3600000).toISOString()});return id;})();}
export async function revoke(id){if(process.env.VERCEL)await sessionRequest('DELETE',id);else sessions.delete(id);}
