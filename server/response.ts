import {gzip as compress,brotliCompress,constants} from 'node:zlib';
import {promisify} from 'node:util';
import type {IncomingMessage,ServerResponse} from 'node:http';

const gzip=promisify(compress);
const brotli=promisify(brotliCompress);
const compressedAssets=new WeakMap<Buffer,Map<string,Promise<Buffer>>>();
function qualities(header:string){
  const accepted=new Map(header.toLowerCase().split(',').map(value=>{
    const [name,...parameters]=value.trim().split(';');
    const quality=parameters.find(p=>p.trim().startsWith('q='));
    const weight=quality?Number(quality.trim().slice(2)):1;
    return [name,Number.isFinite(weight)&&weight>=0&&weight<=1?weight:0] as const;
  }));
  return accepted;
}
export function acceptsGzip(header:string):boolean {
  const accepted=qualities(header);return (accepted.get('gzip')??accepted.get('*')??0)>0;
}
export function preferredEncoding(header:string):'br'|'gzip'|null{
  const accepted=qualities(header),br=accepted.get('br')??accepted.get('*')??0,gz=accepted.get('gzip')??accepted.get('*')??0;
  return br>0&&br>=gz?'br':gz>0?'gzip':null;
}

export async function sendBody(req:IncomingMessage,res:ServerResponse,value:string|Buffer):Promise<void> {
  const data=typeof value==='string'?Buffer.from(value):value;
  const contentType=String(res.getHeader('Content-Type')??'');
  const compressible=/^(text\/|application\/(?:json|javascript)|image\/svg\+xml)/.test(contentType);
  if(compressible)res.setHeader('Vary','Accept-Encoding');
  const encoding=compressible&&data.length>=1024?preferredEncoding(req.headers['accept-encoding']??''):null;
  let payload=data;
  if(encoding){
    const entries=compressedAssets.get(data)??new Map<string,Promise<Buffer>>();
    let pending=entries.get(encoding);
    if(!pending){
      pending=(encoding==='br'?brotli(data,{params:{[constants.BROTLI_PARAM_QUALITY]:4}}):gzip(data)).catch(error=>{entries.delete(encoding);throw error;});
      if(Buffer.isBuffer(value)){entries.set(encoding,pending);compressedAssets.set(data,entries);}
    }
    payload=await pending;
  }
  if(encoding)res.setHeader('Content-Encoding',encoding);
  res.setHeader('Content-Length',payload.length);
  res.end(req.method==='HEAD'?undefined:payload);
}
