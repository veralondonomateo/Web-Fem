import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'cheerio';
import {transformStorefront} from '../server/transform.ts';
import {presentProbioticos} from '../server/product-probioticos.ts';
import {renderProbioticosSummary} from '../server/native-home.ts';
import {renderOwnedPage as renderSource} from '../scripts/render-source.ts';

const {variants}=JSON.parse(readFileSync('tests/fixtures/purchase-options.json','utf8'));
const variant=variants.find((v:{id:number})=>v.id===43659069325400);
const makeSection=(selected=variant)=>`<div class="iFziHfOxyaRbyU98Z" data-instant-id="FziHfOxyaRbyU98Z" data-instant-layout="PRODUCT_TEMPLATE" data-section-id="template--123__instant-FziHfOxyaRbyU98Z"><form data-instant-form-product-url="/products/probiotico-vaginal-en-capsulas-x100-unidades" data-instant-form-variant-id="${selected.id}"><div class="iJjyeqLikBIYPlUO3"></div><div class="idcYjy9VppnFOePFZ">Alimento con probióticos</div><div class="icqUWFhkU7uj7KztV">Registro invima: NSA-3204-2026</div><div class="iDRuhtPkGFL1tKaw0">Envío gratis</div><script type="application/json" id="variants__FPPD6ofDcp7nB7cj--template--123__instant-FziHfOxyaRbyU98Z">${JSON.stringify(variants)}</script><script type="application/json" id="options__FPPD6ofDcp7nB7cj--template--123__instant-FziHfOxyaRbyU98Z">[]</script></form></div>`;

test('The probiotic Why section retains its reference columns, heading, benefits and purchase control',()=>{
  const pages=JSON.parse(readFileSync('tests/fixtures/navigation.json','utf8')) as {html:string;url:string}[];
  const reference=load(pages.find(page=>page.url.endsWith('/products/probiotico-vaginal-en-capsulas-x100-unidades'))!.html);
  const referenceLayout=reference('.i7HxVhIhI7u6u2VJb');
  const referenceBenefits=reference('.ircWFotN5iXZdZlMG [data-instant-type="text"]').map((_,node)=>reference(node).text()).get();
  for(const path of [
    '/products/probiotico-vaginal-en-capsulas-x60-unidades',
    '/products/probiotico-vaginal-en-capsulas-x100-unidades',
    '/products/probiotico-vaginal-en-capsulas-x60-unidades?variant=44093805690968',
  ]){
    const $=load(renderSource(new URL(path,'https://fem.test'))!);
    const root=$('[data-fem-layout="PRODUCT_TEMPLATE"]'),form=root.find('form[data-fem-type="root"]').first();
    const layout=root.find('.i7HxVhIhI7u6u2VJb'),content=layout.children('.iwZb3LGCQ8UQoIK3w');
    assert.deepEqual(layout.children().map((_,node)=>$(node).attr('class')).get(),referenceLayout.children().map((_,node)=>reference(node).attr('class')).get(),path);
    assert.equal(layout.children('[data-fem-product-cutout]').length,1,path);
    assert.equal(content.find('h2').text(),reference('.iHbmfjCr23KprMX3f').text(),path);
    assert.deepEqual(content.find('.ircWFotN5iXZdZlMG [data-fem-type="text"]').map((_,node)=>$(node).text()).get(),referenceBenefits,path);
    assert.equal(content.children('button[data-fem-cart-add]').length,1,path);
    assert.equal(layout.closest('form')[0],form[0],path);
    assert.equal(root.find('.iVbjIwbpYtgLZzZ9N').closest('form')[0],form[0],path+' keeps later sections inside the product form');
  }
});

test('Full page and variant section keep matching JSON identifiers for selection updates',()=>{
  const fragment=load(transformStorefront(makeSection()));
  const page=load(transformStorefront('<!doctype html><html><head></head><body><main>'+makeSection()+'</main></body></html>'));
  for(const type of ['variants__','options__']){
    assert.equal(page(`script[id^="${type}"]`).attr('id'),fragment(`script[id^="${type}"]`).attr('id'));
  }
  assert.equal(page('.fem-probioticos-price-current').text(),fragment('.fem-probioticos-price-current').text());
});

test('Probiotic summary follows the selected quantity and purchase price and hides absent discounts',()=>{
  for(const selected of variants){
    const $=load(transformStorefront(makeSection(selected)));
    assert.equal($('.fem-probioticos-price-current').text(),'$'+new Intl.NumberFormat('es-CO',{minimumFractionDigits:2}).format(selected.price/100));
    assert.equal($('.iJjyeqLikBIYPlUO3 .icqUWFhkU7uj7KztV').length,1);
    assert.equal($('.fem-probioticos-delivery').length,1);
    const repeated=load(presentProbioticos($.html()));
    for(const selector of ['.fem-probioticos-price','.fem-probioticos-delivery','.icqUWFhkU7uj7KztV'])assert.equal(repeated(selector).length,1,'Presentation is not duplicated during repeated transformations');
  }
  const $=load(renderProbioticosSummary({price:11000000,compare_at_price:null}));
  assert.match($('.fem-probioticos-price-compare').attr('style')??'',/display:none/);
  assert.match($('.fem-probioticos-savings').attr('style')??'',/display:none/);
  const discounted=load(renderProbioticosSummary({price:11000000,compare_at_price:14990000}));
  assert.equal(discounted('.fem-probioticos-savings-value').text(),'26%');
});
