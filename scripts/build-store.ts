import {mkdir,readFile,writeFile,copyFile,readdir,realpath,unlink} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,brotliCompressSync,constants} from 'node:zlib';
import {build,transform} from 'esbuild';
import {storefrontResources} from './resource-graph.ts';
import {buildPages} from './build-pages.ts';
import './sync-product-photos.ts';

const output=resolve('dist/assets');
await mkdir(output,{recursive:true});
if((await realpath(output)).toLowerCase()!==output.toLowerCase())throw Error('The build output must not be a symlink');
await build({
  plugins:process.platform==='win32'?[{name:'local-files',setup(builder){
    builder.onResolve({filter:/.*/},args=>({path:join(args.importer?join(args.importer,'..'):process.cwd(),args.path),namespace:'local'}));
    builder.onLoad({filter:/.*/,namespace:'local'},async args=>({contents:await readFile(args.path,'utf8'),loader:'ts'}));
  }}]:[],
  entryPoints:['src/components/runtime.ts'],outfile:join(output,'fem-runtime.js'),bundle:true,minify:true,format:'esm',target:'es2022',
});
await copyFile('src/styles/tokens.css',join(output,'fem-tokens.css'));
const resources=await storefrontResources();
const names=[...resources.used,'fem-runtime.js','fem-tokens.css'];
const hash=createHash('sha256');
for(const name of names)hash.update(name).update(await readFile(join(name==='fem-runtime.js'||name==='fem-tokens.css'?output:resources.assetRoot,name)));
const version=hash.digest('hex').slice(0,16);
const expected=new Set<string>();
const manifest:Record<string,{bytes:number;etag:string}>={};
let saved=0;
for(const name of names){
  const generated=['fem-runtime.js','fem-tokens.css'].includes(name);
  let data=await readFile(join(generated?output:resources.assetRoot,name));
  if(/\.(?:css|js)$/.test(name)){
    let source=data.toString();
    source=source.replace(/((?:from\s*|import\s*(?:\(\s*)?)["'])(\.\/[\w.-]+\.js)(["'])/g,(_,prefix,path,suffix)=>prefix+path+'?v='+version+suffix);
    source=source.replace(/url\(\s*(["']?)([\w.-]+)(\1)\s*\)/g,(_,quote,path)=>resources.used.includes(path)?'url('+quote+path+'?v='+version+quote+')':_);
    const result=await transform(source,{loader:name.endsWith('.css')?'css':'js',minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:name.endsWith('.css'),legalComments:'eof',logLevel:'silent'});
    data=Buffer.from(result.code);saved+=Buffer.byteLength(source)-data.length;
  }
  await writeFile(join(output,name),data);expected.add(name);
  manifest[name]={bytes:data.length,etag:createHash('sha256').update(data).digest('hex').slice(0,24)};
  if(data.length>=1024&&/\.(?:css|js|json|svg)$/.test(name)){
    const gzip=gzipSync(data);
    const br=brotliCompressSync(data,{params:{[constants.BROTLI_PARAM_QUALITY]:4}});
    for(const [ext,payload] of [['gz',gzip],['br',br]] as const){
      if(payload.length<data.length){await writeFile(join(output,name+'.'+ext),payload);expected.add(name+'.'+ext);}
    }
  }
}
await writeFile('dist/assets.json',JSON.stringify({version,files:manifest}));
await buildPages(version);
for(const name of await readdir(output)){
  if(expected.has(name))continue;
  const path=await realpath(join(output,name));
  if(!path.startsWith(output+sep))throw Error('Refusing to remove outside output');
  await unlink(path);
}
console.log(`Web independiente compilada: ${names.length} recursos, versión ${version}; ${saved} bytes de CSS/JS eliminados.`);
