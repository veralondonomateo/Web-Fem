import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {root} from './config.mjs';
const directory=process.env.VERCEL?'/tmp/fem-milestone':join(root,'.local');await mkdir(directory,{recursive:true});
const file=join(directory,'milestone.json');let state;
try{state=JSON.parse(await readFile(file,'utf8'));if(!Number.isFinite(state.startedAt))throw Error('Estado inválido');}
catch{state={startedAt:Number(process.env.FEM_MILESTONE_STARTED_AT)||Date.now()};await writeFile(file,JSON.stringify(state),{mode:0o600});}
export function milestone(now=Date.now()){return {base:204994,goal:1000000,interval:45000,startedAt:state.startedAt,now,simulated:true};}
