import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),assets={};
for(const dir of ['admin','milestone'])for(const name of readdirSync(resolve(root,dir))){if(name.endsWith('.jpg'))continue;const data=readFileSync(resolve(root,dir,name));assets[dir+'/'+name]=data.toString('base64');}
writeFileSync(resolve(root,'integrations/assets.mjs'),'export default '+JSON.stringify(assets)+';\n');
