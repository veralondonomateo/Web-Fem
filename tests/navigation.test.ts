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
  const path=new URL(page.url).pathname;
  // The compact navigation audit omits product data needed to render the native home.
  const source=path==='/'?readFileSync('tests/fixtures/native-home.html','utf8'):page.html;
  const original=load(source);
  if(path==='/'&&!original('main').length)original('[data-instant-id="QpL8HGFa3rotk5kl"]').wrap('<main></main>');
  const transformed=load(transformStorefront(path==='/'?original.html():source,path));
  assert.equal(transformed('a[href="null"],a[href="undefined"],a[href=""]').length,0,page.url);
  const external=(html:typeof original)=>html('a[href^="https://checkoutfem.com"]').filter((_,el)=>!html(el).closest('[data-instant-layout="PRODUCT_TEMPLATE"],[data-fem-layout="PRODUCT_TEMPLATE"]').length).map((_,el)=>html(el).attr('href')).get();
  assert.deepEqual(external(transformed),external(original),page.url);
  assert.equal(transformed('[data-fem-layout="PRODUCT_TEMPLATE"] a[href^="https://checkoutfem.com"]').length,0,page.url);
  // Compare catalog values independently of whether a price is a heading or a paragraph.
  const catalog=(doc:typeof original,prefix:'instant'|'fem')=>doc(`[data-${prefix}-layout="COLLECTION_TEMPLATE"] form[data-${prefix}-form-product-url]`).map((_,element)=>{
   const card=doc(element),field=(name:string)=>card.find(`[data-${prefix}-dynamic-content-source="${name}"]`).first();
   const compare=field('COMPARE_AT');
   return {url:localHref(card.attr(`data-${prefix}-form-product-url`)!),title:field('TITLE').text().trim(),price:field('PRICE').text().trim(),compare: /display\s*:\s*none/.test(compare.attr('style')??'')?'':compare.text().trim()};
  }).get();
  assert.deepEqual(catalog(transformed,'fem'),catalog(original,'instant'),page.url);
  const headings=(doc:typeof original)=>{
   const main=doc('main').clone();
   // Rebuilt home, collection overview and plans have dedicated content/destination tests.
   if(path==='/')main.find('[data-instant-id="QpL8HGFa3rotk5kl"],.fem-home__root').remove();
   main.find('[data-instant-id="jk0iO6ALDrfmfm6c"],.fem-collections-page,.fem-collections-comparison,.fem-collections-faq,[data-instant-id="zX2zkAycloBh8C5v"],.fem-plans').remove();
   // Prices are body content now; the new filter legend is not an original page heading.
   main.find('[data-fem-catalog-filters],[data-instant-dynamic-content-source="PRICE"],[data-fem-dynamic-content-source="PRICE"]').remove();
   return main.find('h1,h2,h3').map((_,el)=>doc(el).text()).get();
  };
  assert.deepEqual(headings(transformed),headings(original),page.url);
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
