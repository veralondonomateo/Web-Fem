import {createHash} from 'node:crypto';
import {readFile,readdir,stat,writeFile,mkdir,realpath,unlink,lstat} from 'node:fs/promises';
import {join,resolve,sep,basename} from 'node:path';

const root=await realpath(resolve('theme-source/assets'));
const groups=new Map<string,string[]>();
const generic=/^fem-(?:owned|media|product-photo)-/;
for(const file of await readdir(root,{withFileTypes:true})){
  if(!file.isFile()||!/\.(?:avif|gif|ico|jpe?g|png|svg|webp|mp4|webm|mp3|woff2?|ttf|otf)$/.test(file.name))continue;
  const hash=createHash('sha256').update(await readFile(join(root,file.name))).digest('hex');
  const group=groups.get(hash)??[];group.push(file.name);groups.set(hash,group);
}
const aliases:Record<string,string>={};
let saved=0;
for(const names of groups.values()){
  if(names.length<2)continue;
  names.sort((a,b)=>Number(generic.test(a))-Number(generic.test(b))||a.localeCompare(b));
  const canonical=names[0];
  for(const duplicate of names.slice(1)){
    // Keep named authoring assets. Only copied/imported duplicates are retired.
    if(!generic.test(duplicate))continue;
    aliases[duplicate]=canonical;saved+=(await stat(join(root,duplicate))).size;
  }
}
await mkdir('work',{recursive:true});
await writeFile('work/deduplicated-assets.json',JSON.stringify({aliases,bytes:saved},null,2));
if(process.argv.includes('--apply')){
  async function rewrite(folder:string){
    for(const entry of await readdir(folder,{withFileTypes:true})){
      if(['node_modules','.next','.git','public'].includes(entry.name))continue;
      const path=join(folder,entry.name);
      if(entry.isDirectory())await rewrite(path);
      else if(/\.(?:[cm]?tsx?|[cm]?js|css|json|html|liquid|md|svg)$/.test(entry.name)){
        const source=await readFile(path,'utf8');
        const updated=source.replace(/[\w@+.-]+\.(?:avif|gif|ico|jpe?g|png|svg|webp|mp4|webm|mp3|woff2?|ttf|otf)\b/g,name=>aliases[name]??name);
        if(updated!==source)await writeFile(path,updated);
      }
    }
  }
  for(const folder of ['content','server','src','theme-source','tests','apps/checkout','scripts','docs'])await rewrite(folder);
  for(const [name,canonical] of Object.entries(aliases)){
    const path=join(root,name),target=await realpath(path);
    if(basename(name)!==name||!target.startsWith(root+sep)||(await lstat(path)).isSymbolicLink())throw Error('Refusing to delete outside assets');
    if(!(await readFile(path)).equals(await readFile(join(root,canonical))))throw Error('Resource changed during deduplication');
    await unlink(path);
  }
}
console.log(JSON.stringify({duplicates:Object.keys(aliases).length,savedMB:Math.round(saved/1024/1024*100)/100,removed:process.argv.includes('--apply')}));
