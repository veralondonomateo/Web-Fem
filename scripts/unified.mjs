import './build-gateway.mjs';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {root,config,checkoutEnv,crmEnv,preview,publicOrigin,adminPassword,adminPasswordHash} from '../integrations/config.mjs';
if(!adminPasswordHash)throw Error('Configura FEM_ADMIN_PASSWORD o el archivo de acceso existente.');
const secret=randomBytes(32).toString('hex');const children=[];
function start(cmd,args,cwd,env={}){const c=spawn(cmd,args,{cwd,env:{...process.env,...env},stdio:'inherit',detached:true});children.push(c);c.on('exit',code=>{if(code)console.error(`Un módulo terminó (${code}). Revisa su log.`);});return c;}
start('node',['--watch','server/index.ts'],root,{PORT:'3001'});
// The original CRM preview script uses only a local database; production keys are never loaded into it.
if(preview)start('npm',['run','preview'],root+'/apps/crm');
else start('npm',['run','start','--','-p','3111','-H','127.0.0.1'],root+'/apps/crm',{...crmEnv,NEXT_PUBLIC_APP_URL:publicOrigin+'/admin/crm'});
start('npm',['run',config.FEM_PRODUCTION==='true'?'start':'dev','--','-p','3002','-H','127.0.0.1'],root+'/apps/checkout',{...checkoutEnv,FEM_INTERNAL_SECRET:secret,ADMIN_PASSWORD:secret,NEXT_PUBLIC_APP_URL:publicOrigin,NEXT_PUBLIC_FEM_PREVIEW:String(preview)});
start('node',['--watch','integrations/gateway.mjs'],root,{FEM_INTERNAL_SECRET:secret});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const c of children){try{process.kill(-c.pid,signal);}catch(error){if(error.code!=='ESRCH')console.error(error.message);}}setTimeout(()=>process.exit(),500);});
