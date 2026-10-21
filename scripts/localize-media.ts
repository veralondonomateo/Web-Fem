/** Explicit asset migration. The application never downloads assets at request time. */
import {readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const mediaHost=/^(?:cdn\.shopify\.com|videos\.shopifycdn\.com|cdn\.instant\.so|femprobiotics\.co|www\.femprobiotics\.co|fonts\.gstatic\.com|a\.klaviyo\.com)$/;
async function sources(dir:string):Promise<string[]>{const result:string[]=[];for(const e of await readdir(dir,{withFileTypes:true})){if(e.isDirectory())result.push(...await sources(dir+'/'+e.name));else if(/\.(ts|tsx)$/.test(e.name))result.push(dir+'/'+e.name);}return result;}
const candidates=[...(await readdir('content/pages')).map(f=>'content/pages/'+f),'content/catalog.json',...(await readdir('theme-source/assets')).filter(f=>/\.(css|js)$/.test(f)).map(f=>'theme-source/assets/'+f),...await sources('apps/checkout/app'),...await sources('apps/checkout/components'),...await sources('apps/checkout/lib')];
const files=new Map<string,string>();
const resources=new Map<string,string>();
let manifest:Record<string,string>={};
try{manifest=JSON.parse(await readFile('content/media.json','utf8'));}catch{}
for(const file of candidates){
 const source=await readFile(file,'utf8');files.set(file,source);
 for(const match of source.matchAll(/(?:https?:)?\/\/[^\s<>"'()\\]+/g)){
  const original=match[0].replace(/[,;]$/,'');let url:URL;
  try{url=new URL((original.startsWith('//')?'https:'+original:original).replaceAll('&amp;','&'));}catch{continue;}
  if(!mediaHost.test(url.hostname))continue;
  if(url.hostname.endsWith('femprobiotics.co')&&!url.pathname.startsWith('/cdn/'))continue;
  if(!/\.(?:avif|webp|png|jpe?g|gif|svg|woff2?|ttf|mp4|webm|css)(?:$|\?)/i.test(url.pathname))continue;
  if(url.pathname.includes('/cdn/shop/t/9/assets/')){
   const name=url.pathname.split('/').pop()!;
   try{await stat('theme-source/assets/'+name);manifest[original]='/__theme/'+name;continue;}catch{}
  }
  const ext=url.pathname.split('.').pop()!.toLowerCase();
  const name='fem-owned-'+createHash('sha256').update(url.href).digest('hex').slice(0,20)+'.'+ext;
  manifest[original]='/__theme/'+name;resources.set(url.href,name);
 }
}
console.log(`Media inventory: ${resources.size} unique remote files.`);
if(process.argv.includes('--inventory')){await writeFile('work/media-inventory.json',JSON.stringify([...resources],null,2));process.exit(0);}
const pending=[...resources],failures:{url:string;error:string}[]=[];
await Promise.all(Array.from({length:6},async()=>{
 while(pending.length){const [url,name]=pending.shift()!;
  try{await stat('theme-source/assets/'+name);continue;}catch{}
  try{
   const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
   if(!response.ok)throw Error('HTTP '+response.status);
   if(/text\/html/.test(response.headers.get('content-type')??''))throw Error('Unexpected HTML response');
   const data=Buffer.from(await response.arrayBuffer());if(!data.length)throw Error('Empty asset');
   await writeFile('theme-source/assets/'+name,data);
  }catch(error){failures.push({url,error:String(error)});}
 }
}));
await writeFile('work/media-failures.json',JSON.stringify(failures,null,2));
if(failures.length)throw Error(`${failures.length} assets could not be copied. Source files have not been rewritten.`);
const mappings=Object.entries(manifest).sort((a,b)=>b[0].length-a[0].length);
for(const [file,source]of files){let next=source;for(const [url,local]of mappings)next=next.replaceAll(url,local);if(next!==source)await writeFile(file,next);}
await writeFile('content/media.json',JSON.stringify(manifest,null,2)+'\n');
console.log(`Localized ${resources.size} files. No runtime CDN fallback.`);
