import {mkdir,writeFile,readFile,readdir,realpath,stat,unlink} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {catalog} from '../server/catalog.ts';
import {ownedPaths,renderOwnedPage,productCard} from './render-source.ts';

export async function buildPages(version:string){
  await mkdir('dist/pages',{recursive:true});
  const pages:Record<string,{required:string;all:string}>={};
  const assets=JSON.parse(await readFile('dist/assets.json','utf8')).files;
  const routes=new Set(ownedPaths());
  for(const path of [...routes]){
    const product=catalog.find(p=>p.url===path||p.aliases.some(alias=>path==='/products/'+alias));
    for(const variant of product?.variants??[])routes.add(path+'?variant='+variant.id);
  }
  routes.add('/pages/contact?sent=1');
  const resourceURL=(source:string)=>source.replace(/\/__theme\/[\w.-]+(?:\?[^\s"'<>`)]*)?/g,url=>{
    const parsed=new URL(url.replaceAll('&amp;','&'),'https://fem.invalid');
    parsed.searchParams.set('v',version);return parsed.pathname+parsed.search;
  });
  const written=new Set<string>();
  for(const path of routes){
    const entry={required:'',all:''};
    for(const consent of ['required','all'] as const){
      let html=renderOwnedPage(new URL(path,'https://fem.invalid'),consent==='all'?'fem_consent=all':'');
      if(!html)throw Error('Missing owned route: '+path);
      if(path==='/search'){
        const $=load(html);$('input[name="q"]').attr('value','__FEM_QUERY__');
        $('[data-fem-catalog-list]').html('__FEM_RESULTS__').after('__FEM_EMPTY__');html=$.html();
      }
      html=resourceURL(html.replaceAll('https://fem.invalid','__FEM_ORIGIN__'));
      for(const match of html.matchAll(/\/__theme\/([\w.-]+)/g))if(!assets[match[1]])throw Error('Missing compiled resource for '+path+': '+match[1]);
      const file=createHash('sha256').update(html).digest('hex').slice(0,24)+'.html';
      if(!written.has(file)){await writeFile('dist/pages/'+file,html);written.add(file);}
      entry[consent]=file;
    }
    pages[path]=entry;
  }
  await writeFile('dist/cards.json',JSON.stringify(Object.fromEntries(catalog.map(p=>[p.id,resourceURL(productCard(p))]))));
  await writeFile('dist/pages.json',JSON.stringify(pages));
  const output=resolve('dist/pages');
  if((await realpath(output)).toLowerCase()!==output.toLowerCase())throw Error('Pages output must not be a symlink');
  for(const name of await readdir(output)){
    if(written.has(name)||!/^\w+\.html$/.test(name))continue;
    const path=await realpath(join(output,name));
    if(!path.startsWith(output+sep))throw Error('Refusing to remove outside prepared pages');
    // Keep a short overlap while the development server reloads its manifest.
    const generated=createHash('sha256').update(await readFile(path)).digest('hex').slice(0,24)+'.html'===name;
    if(generated&&Date.now()-(await stat(path)).mtimeMs>60000)await unlink(path);
  }
  console.log(`Páginas FEM: ${routes.size} rutas y variantes preparadas (${written.size} documentos).`);
}
