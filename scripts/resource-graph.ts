import {readFile, readdir, stat} from 'node:fs/promises';
import {basename, join, resolve} from 'node:path';

/** Follow resources from application sources, templates and their CSS/JS imports. */
export async function storefrontResources(root=process.cwd()) {
  const assetRoot=resolve(root,'theme-source/assets');
  const names=(await readdir(assetRoot,{withFileTypes:true})).filter(item=>item.isFile()).map(item=>item.name);
  const known=new Set(names), used=new Set<string>(), pending:string[]=[];
  const add=(name:string)=>{if(known.has(name)&&!used.has(name)){used.add(name);pending.push(name);}};
  const scan=(source:string)=>{
    for(const match of source.matchAll(/[\w@+.-]+\.(?:avif|gif|ico|jpe?g|png|svg|webp|mp4|webm|mp3|woff2?|ttf|otf|css|m?js|json)\b/gi))add(match[0]);
    for(const match of source.matchAll(/\/__theme\/([^\s"'<>?#)]+)/g)){
      try{add(basename(decodeURIComponent(match[1])));}catch{/* Invalid URL is checked by the route tests. */}
    }
  };
  async function walk(folder:string,filter:(name:string)=>boolean=()=>true){
    for(const item of await readdir(folder,{withFileTypes:true})){
      if(['node_modules','.next','public','.git','fixtures'].includes(item.name))continue;
      const path=join(folder,item.name);
      if(item.isDirectory())await walk(path,filter);
      else if(filter(item.name)&&/\.(?:[cm]?tsx?|[cm]?js|css|json|html|liquid)$/.test(item.name))scan(await readFile(path,'utf8'));
    }
  }
  for(const folder of ['content','server','src','tests','apps/checkout'])await walk(join(root,folder));
  scan(await readFile(join(root,'scripts/render-source.ts'),'utf8'));
  for(const folder of ['sections','snippets'])await walk(join(root,'theme-source',folder),name=>name.startsWith('fem-'));
  await walk(join(root,'theme-source/config'));
  for(const name of ['index.json','list-collections.json','page.planes-fem.json'])scan(await readFile(join(root,'theme-source/templates',name),'utf8'));
  // The local module map contains extensionless import aliases.
  for(const name of ['component.js','dialog.js','events.js','focus.js','morph.js','paginated-list.js','performance.js','product-form.js','recently-viewed-products.js','scrolling.js','section-renderer.js','utilities.js','variant-picker.js','media-gallery.js','quick-add.js','product-title-truncation.js'])add(name);
  for(const name of ['fem-owned.css','fem-search.css','fem-search-card.css','fem-theme-context.js','fem-quiz1.js','fem-quiz-soda.js']){
    if(!known.has(name))throw Error('Missing application script: '+name);add(name);
  }
  while(pending.length){const name=pending.pop()!;if(/\.(?:css|m?js|json)$/.test(name))scan(await readFile(join(assetRoot,name),'utf8'));}
  const unused=names.filter(name=>!used.has(name));
  const sizes=await Promise.all(unused.map(async name=>({name,bytes:(await stat(join(assetRoot,name))).size})));
  return {assetRoot,used:[...used].sort(),unused:sizes,files:names.length,unusedBytes:sizes.reduce((sum,item)=>sum+item.bytes,0)};
}
