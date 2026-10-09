import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'cheerio';
import {localHref,repairNavigation} from '../src/lib/navigation.ts';
import {checkoutPermalink} from '../src/lib/checkout.ts';
import {transformStorefront} from '../server/transform.ts';
test('Internal URLs retain query and anchors, external payment paths stay external',()=>{
 assert.equal(localHref('https://femprobiotics.co/products/a?variant=123#details'),'/products/a?variant=123#details');
 for(const url of ['https://checkoutfem.com/checkout?variant=123','https://femprobiotics.co/account','mailto:pqrs@grupomsm.co'])assert.equal(localHref(url),url);
});
test('Audited documents keep product content and other payment links while product CTAs open the cart',()=>{
 const inventory=JSON.parse(readFileSync('tests/fixtures/navigation.json','utf8')) as {html:string;url:string}[];
 for(const page of inventory){
  const source=page.html;const original=load(source);const transformed=load(transformStorefront(source));
  assert.equal(transformed('a[href="null"],a[href="undefined"],a[href=""]').length,0,page.url);
  const external=(html:typeof original)=>html('a[href^="https://checkoutfem.com"]').filter((_,el)=>!html(el).closest('[data-instant-layout="PRODUCT_TEMPLATE"],[data-fem-layout="PRODUCT_TEMPLATE"]').length).map((_,el)=>html(el).attr('href')).get();
  assert.deepEqual(external(transformed),external(original),page.url);
  assert.equal(transformed('[data-fem-layout="PRODUCT_TEMPLATE"] a[href^="https://checkoutfem.com"]').length,0,page.url);
  assert.deepEqual(transformed('main h1,main h2,main h3').map((_,el)=>transformed(el).text()).get(),original('main h1,main h2,main h3').map((_,el)=>original(el).text()).get(),page.url);
 }
});
test('Legal wrapper is noninteractive and keeps its mailto link',()=>{
 const source=readFileSync('theme-source/sections/fem-subscription-terms.liquid','utf8');
 const repaired=repairNavigation(source,true);
 assert.match(repaired,/<div as="p"|<div data-fem-type="text" class="ipWMBvNfOCI940U8M"/);
 assert.ok(repaired.includes('href="mailto:pqrs@grupomsm.co"'));
 assert.ok(!repaired.includes('href=""'));
});
test('Checkout transfer preserves quantities and rejects unsupported subscription carts',()=>{
 assert.equal(checkoutPermalink([{variant_id:123,quantity:2},{variant_id:456,quantity:1}]),'https://femprobiotics.co/cart/123:2,456:1');
 assert.equal(checkoutPermalink([{variant_id:123,quantity:1,selling_plan_allocation:{id:1}}]),null);
 assert.equal(checkoutPermalink([]),null);
 assert.throws(()=>checkoutPermalink([{variant_id:123,quantity:-1}]));
});
test('Section rendering stays a fragment and never reboots global scripts',()=>{
 const result=transformStorefront('<section id="shopify-section-test"><a href="https://femprobiotics.co/pages/quiz1">Test</a></section>');
 assert.ok(!result.includes('<html'));assert.ok(!result.includes('fem-runtime'));assert.ok(result.includes('href="/pages/quiz1"'));
});
