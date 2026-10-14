import test from 'node:test';
import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';
import{load}from'cheerio';
import{CartClient,addItemFromFields,shippingProgress,visibleCartCount,type CartState}from'../src/lib/cart.ts';
import{renderNativeSection}from'../server/native-home.ts';
import{transformStorefront}from'../server/transform.ts';

const state:CartState={items:[{key:'123:custom',variant_id:123,product_id:1,quantity:2,title:'Fem',final_line_price:10000000,url:'/products/fem'},{key:'gift',variant_id:9,product_id:2,quantity:1,title:'Regalo oculto',final_line_price:0,url:'/products/gift',properties:{'_instant-hidden':'true'}}],item_count:3,total_price:10000000,total_discount:0,currency:'COP'};
test('Cart count hides internal gifts and shipping uses the real currency and discounted total',()=>{
  assert.equal(visibleCartCount(state),2);assert.equal(shippingProgress(state,10000000),100);
  assert.equal(shippingProgress({...state,total_price:4000000},10000000),40);
  assert.equal(shippingProgress({...state,currency:'USD'},10000000),null);
  assert.equal(shippingProgress(state,0),null);
});
test('Adding preserves selected quantity, selling plan and custom properties',()=>{
  const fields=new FormData();fields.set('selling_plan','45');fields.set('properties[Nombre]','Ana');fields.set('properties[_bundle]','fem');fields.set('sections','old-cart');
  assert.deepEqual(addItemFromFields(123,2,fields),{id:123,quantity:2,selling_plan:45,properties:{Nombre:'Ana',_bundle:'fem'}});
  assert.throws(()=>addItemFromFields(0,2,fields));assert.throws(()=>addItemFromFields(123,-1,fields));
});
test('Cart mutations use line keys, locale URLs and server totals, and reject inventory errors',async()=>{
  const calls:{url:string;init:RequestInit}[]=[];
  const mock=(async(url,init)=>{calls.push({url:String(url),init:init!});return new Response(JSON.stringify(String(url).endsWith('add.js')?{items:[]}:state),{status:200});}) as typeof fetch;
  const client=new CartClient('/es/',mock);
  assert.deepEqual(await client.add({id:123,quantity:2}),state);
  assert.equal(calls[0].url,'/es/cart/add.js');assert.equal(calls[1].url,'/es/cart.js');assert.equal(calls[0].init.credentials,'same-origin');
  assert.deepEqual(await client.change('123:custom',0),state);
  assert.deepEqual(JSON.parse(calls[2].init.body as string),{id:'123:custom',quantity:0});
  const unavailable=new CartClient('/',(async()=>new Response(JSON.stringify({description:'Producto agotado'}),{status:422})) as typeof fetch);
  await assert.rejects(unavailable.add({id:123,quantity:1}),/Producto agotado/);
});
test('Cart requests preserve the browser fetch receiver for every operation',async(t)=>{
  const paths:string[]=[];
  t.mock.method(globalThis,'fetch',async function(this:unknown,url:RequestInfo|URL){
    if(this!==globalThis)throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
    paths.push(String(url));
    return new Response(JSON.stringify(String(url).includes('recommendations/')?{products:[]}:state),{status:200});
  });
  const client=new CartClient('/');
  assert.deepEqual(await client.read(),state);
  assert.deepEqual(await client.add({id:123,quantity:1}),state);
  assert.deepEqual(await client.change('123:custom',2),state);
  assert.deepEqual(await client.recommendations(1),[]);
  assert.deepEqual(paths,['/cart.js','/cart/add.js','/cart/change.js','/recommendations/products.json?product_id=1&limit=6&intent=related']);
});
test('Native drawer renders accessible controls, translated copy and no invented promotion deadline',()=>{
  const $=load(renderNativeSection('cart-drawer',{}));
  assert.equal($('dialog#fem-cart-drawer').attr('aria-labelledby'),'fem-cart-title');
  assert.match($('#fem-cart-title').text(),/Carrito de compras/);
  assert.equal($('[data-cart-checkout]').attr('href'),'/checkout');
  const config=JSON.parse($('[data-cart-config]').text());assert.equal(config.threshold,10000000);assert.equal(config.endsAt,'');
  assert.equal($('[data-cart-gifts] img').length,2);assert.equal($('[data-cart-plus]').length,1);
});
test('All pages remove the anniversary header strip and install the shared header and one native cart',()=>{
  const fixtures=JSON.parse(readFileSync('tests/fixtures/navigation.json','utf8')) as {html:string;url:string}[];
  for(const fixture of fixtures){
    const html=fixture.html.replace('<body','<body').replace('</body>','<div id="header-group"><div data-instant-type="media"><img src="/Banner-aniv-web.webp"></div><a href="/"><img src="/logo.svg"></a></div></body>');
    const $=load(transformStorefront(html));
    assert.equal($('#header-group img[src*="Banner-aniv"]').length,0,fixture.url);
    assert.equal($('.fem-header img[alt="Fem"]').length,1,fixture.url);
    assert.equal($('#fem-cart-drawer').length,1,fixture.url);
    assert.equal($('[data-instant-layout="CART"]').length,0,fixture.url);
  }
});

test('Full server cart from add skips the second browser request',async()=>{let calls=0;const client=new CartClient('/',(async(_url,init)=>{calls++;assert.equal(new Headers(init?.headers).get('X-Fem-Cart-State'),'1');return Response.json(state);}) as typeof fetch);assert.deepEqual(await client.add({id:123,quantity:1}),state);assert.equal(calls,1);});
