import {cp,readFile,writeFile,mkdir,readdir,realpath,unlink} from 'node:fs/promises';
import {join,relative,resolve,sep} from 'node:path';
import {build,transform} from 'esbuild';
import {improveThemeMarkup} from '../src/lib/theme-quality.ts';
import {repairNavigation} from '../src/lib/navigation.ts';
import {componentSelectors,deferComponentScripts,lazySectionImages,deduplicateIcons} from '../src/lib/performance.ts';
import './sync-product-photos.ts';
const outputRoot=resolve('theme-dev');
await mkdir(outputRoot,{recursive:true});
if((await realpath(outputRoot)).toLowerCase()!==outputRoot.toLowerCase())throw new Error('theme-dev must be a local generated directory, not a symlink');
const changed:string[]=[];
const staticImages=JSON.parse(await readFile('audit/image-dimensions.json','utf8'));
async function walk(directory:string):Promise<string[]> {
  const items=await readdir(directory,{withFileTypes:true});
  const paths=await Promise.all(items.map(d=>d.isDirectory()?walk(join(directory,d.name)):Promise.resolve([join(directory,d.name)])));
  return paths.flat();
}
const expectedFiles=new Set((await walk('theme-source')).map(path=>resolve(outputRoot,relative('theme-source',path))));
expectedFiles.add(join(outputRoot,'assets/fem-runtime.js'));
expectedFiles.add(join(outputRoot,'assets/fem-tokens.css'));
await cp('theme-source',outputRoot,{recursive:true});
for (const path of expectedFiles) {
  if (!path.endsWith('.liquid')) continue;
  const original=await readFile(path,'utf8');
  let next=deferComponentScripts(improveThemeMarkup(repairNavigation(original,true).replaceAll('\u0000',''),staticImages));
  if(/sections[\\/]fem-/.test(path) && next.includes('class="fem-view ')){
    next=lazySectionImages(next,4);
    next=deduplicateIcons(next,'fem-icon-{{ section.id }}');
  }
  if (next!==original) {await writeFile(path,next);changed.push(relative('theme-dev',path));}
}
const scriptPath='theme-dev/snippets/scripts.liquid';
let scripts=await readFile(scriptPath,'utf8');
scripts+='\n<script type="module" src="{{ \'fem-runtime.js\' | asset_url }}"></script>\n';
await writeFile(scriptPath,scripts);changed.push('snippets/scripts.liquid');
const layoutPath='theme-dev/layout/theme.liquid';
let layout=await readFile(layoutPath,'utf8');
layout=layout.replace(/\s*<!-- Event snippet for Google Shopping App Purchase conversion page -->[\s\S]*?<\/script>/,'');
layout=layout.replace('<meta name="viewport" content="width=device-width, initial-scale=1">','');
layout=layout.replace("{%- render 'stylesheets' -%}","{%- render 'stylesheets' -%}\n    {{ 'fem-tokens.css' | asset_url | stylesheet_tag }}");
await writeFile(layoutPath,layout);changed.push('layout/theme.liquid');
await build({
  // Read through Node on Windows, where esbuild's native file access may be sandboxed.
  plugins:process.platform==='win32'?[{name:'local-files',setup(builder){
    builder.onResolve({filter:/.*/},args=>({path:join(args.importer?join(args.importer,'..'):process.cwd(),args.path),namespace:'local'}));
    builder.onLoad({filter:/.*/,namespace:'local'},async args=>({contents:await readFile(args.path,'utf8'),loader:'ts'}));
  }}]:[],
  entryPoints:['src/components/runtime.ts'],outfile:'theme-dev/assets/fem-runtime.js',bundle:true,minify:true,format:'esm',target:'es2022'
});
await cp('src/styles/tokens.css','theme-dev/assets/fem-tokens.css');
let saved=0,jsSaved=0,jsFiles=0;
for (const path of expectedFiles) {
  if(!path.startsWith(join(outputRoot,'assets')+sep))continue;
  if (!/\.(css|js)$/.test(path)) continue;
  const original=await readFile(path,'utf8');
  const css=path.endsWith('.css');
  const result=await transform(original,{loader:css?'css':'js',minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:css?true:false,legalComments:'eof',logLevel:'silent'});
  if(css)saved+=Buffer.byteLength(original)-Buffer.byteLength(result.code);
  else {jsSaved+=Buffer.byteLength(original)-Buffer.byteLength(result.code);jsFiles++;}
  await writeFile(path,result.code);
}
const removed:string[]=[];
for(const path of await walk(outputRoot)){
  if(expectedFiles.has(path))continue;
  const local=relative(outputRoot,path);
  if(local.startsWith('..'+sep)||resolve(outputRoot,local)!==path)throw new Error('Refusing to remove a file outside theme-dev');
  await unlink(path);
  removed.push(local);
}
await writeFile('audit/build.json',JSON.stringify({builtAt:new Date().toISOString(),changed,removed,cssBytesSaved:saved,jsBytesSaved:jsSaved,jsFiles},null,2));
await writeFile('audit/component-selectors.json',JSON.stringify(componentSelectors,null,2));
console.log(`Tema compilado. ${changed.length} archivos Liquid optimizados; CSS: ${saved} bytes menos; JavaScript: ${jsSaved} bytes menos (${jsFiles} archivos).`);
