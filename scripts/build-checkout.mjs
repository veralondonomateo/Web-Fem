import {spawnSync} from 'node:child_process';
import {checkoutEnv,preview,publicOrigin,root} from '../integrations/config.mjs';
const r=spawnSync('npm',['run','build'],{cwd:root+'/apps/checkout',env:{...process.env,...checkoutEnv,NEXT_PUBLIC_APP_URL:publicOrigin,NEXT_PUBLIC_FEM_PREVIEW:String(preview)},stdio:'inherit'});process.exit(r.status??1);
