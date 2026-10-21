import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {preferredEncoding,sendBody} from '../server/response.ts';
import {renderOwnedBody} from '../server/owned-renderer.ts';

test('The public server loads without third-party template engines or Shopify packages',async()=>{
  const hook=registerHooks({resolve(specifier,context,next){
    const result=next(specifier,context);
    assert.doesNotMatch(result.url,/\/node_modules\//,'A public request must not need a compiler dependency');
    return result;
  }});
  try{assert.equal(typeof (await import('../server/handler.ts')).default,'function');}finally{hook.deregister();}
});
test('Repeated pages reuse bytes without mixing consent, product variants or search queries',()=>{
  const base=new URL('https://fem.test/');
  assert.equal(renderOwnedBody(base),renderOwnedBody(base));
  const search=(q:string)=>renderOwnedBody(new URL('/search?q='+q,base))!;
  assert.notEqual(search('jabon'),search('ovulos'));
  assert.notEqual(renderOwnedBody(new URL('/products/probiotico-vaginal-en-capsulas-x60-unidades?variant=43659069325400',base)),renderOwnedBody(new URL('/products/probiotico-vaginal-en-capsulas-x60-unidades?variant=44093805690968',base)));
});
test('Compression honors client preferences and preserves the exact response bytes',async()=>{
  assert.equal(preferredEncoding('br,gzip'),'br');
  assert.equal(preferredEncoding('br;q=0,gzip;q=1'),'gzip');
  assert.equal(preferredEncoding('br;q=0,gzip;q=0'),null);
  assert.equal(preferredEncoding('gzip;q=0,*;q=.5'),'br');
  const body=Buffer.from('<main>FEM ♥</main>'.repeat(1000));
  for(const accepted of ['br,gzip','gzip','br;q=0,gzip;q=0']){
    const headers=new Map<string,unknown>([['Content-Type','text/html; charset=utf-8']]);let sent:Buffer|undefined;
    const req={method:'GET',headers:{'accept-encoding':accepted}} as IncomingMessage;
    const res={getHeader:(name:string)=>headers.get(name),setHeader:(name:string,value:unknown)=>headers.set(name,value),end:(value:Buffer)=>{sent=value;}} as unknown as ServerResponse;
    await sendBody(req,res,body);
    const restored=headers.get('Content-Encoding')==='br'?brotliDecompressSync(sent!):headers.get('Content-Encoding')==='gzip'?gunzipSync(sent!):sent;
    assert.deepEqual(restored,body);assert.equal(headers.get('Content-Length'),sent!.length);
    assert.equal(headers.get('Vary'),'Accept-Encoding');
  }
});
