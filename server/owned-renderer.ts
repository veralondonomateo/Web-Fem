import {readFileSync} from 'node:fs';
import {searchCatalog,type CatalogProduct} from './catalog.ts';

interface Page {required:string;all:string}
const root=new URL('../dist/',import.meta.url);
const pages=(await import(new URL('pages.json',root).href,{with:{type:'json'}})).default as Record<string,Page>;
const cards=(await import(new URL('cards.json',root).href,{with:{type:'json'}})).default as Record<string,string>;
const cache=new Map<string,string>();
const buffers=new Map<string,Buffer>();
let bufferedBytes=0;
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const ownedPaths=()=>Object.keys(pages).filter(key=>!key.includes('?'));
export const productCard=(product:CatalogProduct)=>cards[product.id]??'';

function read(file:string){
  let html=cache.get(file);
  if(html===undefined){html=readFileSync(new URL('pages/'+file,root),'utf8');cache.set(file,html);}
  return html;
}

/** Serve prepared FEM HTML. No template engine, remote content or DOM parsing. */
export function renderOwnedPage(url:URL,cookie=''):string|null{
  let key=url.pathname;
  const variant=url.searchParams.get('variant');
  if(variant&&/^\d+$/.test(variant)&&pages[key+'?variant='+variant])key+='?variant='+variant;
  else if(url.pathname==='/pages/contact'&&url.searchParams.get('sent')==='1')key+='?sent=1';
  const page=pages[key];if(!page)return null;
  const all=/(?:^|;\s*)fem_consent=all(?:;|$)/.test(cookie);
  let html=read(all?page.all:page.required).replaceAll('__FEM_ORIGIN__',()=>escape(url.origin));
  if(url.pathname==='/search'){
    const query=url.searchParams.get('q')?.trim()??'';
    const results=searchCatalog(query);
    html=html.replace('__FEM_EMPTY__',()=>query&&!results.length?'<p>No encontramos productos para «'+escape(query)+'».</p>':'')
      .replace('__FEM_RESULTS__',()=>results.map(productCard).join(''))
      .replace('value="__FEM_QUERY__"',()=> 'value="'+escape(query)+'"');
  }
  return html;
}

/** Reuse bytes so compression is also shared by repeat requests. Bounded to 16 MiB. */
export function renderOwnedBody(url:URL,cookie=''):Buffer|null{
  const html=renderOwnedPage(url,cookie);if(html===null)return null;
  const cached=buffers.get(html);
  if(cached){buffers.delete(html);buffers.set(html,cached);return cached;}
  const data=Buffer.from(html);
  if(data.length>16*1024*1024)return data;
  while(bufferedBytes+data.length>16*1024*1024){const oldest=buffers.keys().next().value!;bufferedBytes-=buffers.get(oldest)!.length;buffers.delete(oldest);}
  buffers.set(html,data);bufferedBytes+=data.length;return data;
}
