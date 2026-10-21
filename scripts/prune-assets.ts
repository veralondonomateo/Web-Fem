import {mkdir,writeFile,unlink,realpath,lstat} from 'node:fs/promises';
import {join,sep,basename} from 'node:path';
import {storefrontResources} from './resource-graph.ts';

const report=await storefrontResources();
await mkdir('work',{recursive:true});
await writeFile('work/unused-assets.json',JSON.stringify(report,null,2));
if(process.argv.includes('--apply')){
  const root=await realpath(report.assetRoot);
  for(const {name} of report.unused){
    const path=join(root,name),target=await realpath(path);
    if(basename(name)!==name||!target.startsWith(root+sep)||(await lstat(path)).isSymbolicLink())throw Error('Refusing to delete outside the asset directory');
    await unlink(path);
  }
}
console.log(JSON.stringify({files:report.files,used:report.used.length,unused:report.unused.length,unusedMB:Math.round(report.unusedBytes/1024/1024*100)/100,removed:process.argv.includes('--apply')}));
