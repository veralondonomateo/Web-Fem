import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'cheerio';
import {renderCollectionCardDetails} from '../server/native-home.ts';
import {restoreCollectionCards} from '../server/collection-cards.ts';
import {transformStorefront} from '../server/transform.ts';

const fixtures=JSON.parse(readFileSync('tests/fixtures/navigation.json','utf8')) as {url:string;html:string}[];
const handles=['todos-los-productos','frontpage','combo-fem','mas-vendidos'];

test('All four collections keep every product, price and destination with the shared card content',()=>{
  for(const handle of handles){
    const fixture=fixtures.find(page=>new URL(page.url).pathname==='/collections/'+handle)!;
    assert.ok(fixture,handle);
    const original=load(fixture.html);
    const originals=original('[data-instant-layout="COLLECTION_TEMPLATE"] form[data-instant-form-product-url]');
    const html=transformStorefront(fixture.html,'/collections/'+handle),$=load(html);
    const cards=$('[data-fem-layout="COLLECTION_TEMPLATE"] .fem-collection-product-card');
    assert.ok(cards.length>0,handle);
    assert.equal(cards.length,originals.length,handle);
    cards.each((index,node)=>{
      const card=$(node),old=originals.eq(index),url=old.attr('data-instant-form-product-url');
      assert.equal(card.attr('data-product-url'),url);
      assert.equal(card.find('.fem-collection-product-card__cta').attr('href'),url);
      assert.equal(card.find('[data-fem-dynamic-content-source="TITLE"]').text(),old.find('[data-instant-dynamic-content-source="TITLE"]').text().trim());
      assert.equal(card.find('[data-fem-dynamic-content-source="PRICE"]').text(),old.find('[data-instant-dynamic-content-source="PRICE"]').text().trim());
      const previousCompare=old.find('[data-instant-dynamic-content-source="COMPARE_AT"]');
      if(!/display\s*:\s*none/.test(previousCompare.attr('style')??'')&&previousCompare.text().trim())
        assert.equal(card.find('[data-fem-dynamic-content-source="COMPARE_AT"]').text(),previousCompare.text().trim());
      assert.ok(card.find('[data-fem-dynamic-content-source="FEATURED_IMAGE"]').attr('src'));
      assert.equal(card.find('[data-fem-dynamic-content-source="QUANTITY_AVAILABLE"],.ivloSY9jUGMVmm9vN,.iff5HNbQDjlDIevHh').length,0);
      const soldOut=old.find('.iMidEZvz2oLuj6AEt');
      if(soldOut.length&&!/display\s*:\s*none/.test(soldOut.attr('style')??''))
        assert.equal(card.find('.fem-collection-product-card__badge--sold-out').text(),'Agotado');
    });
    assert.equal($('[data-fem-catalog-filters]').length,1);
    assert.equal(load(restoreCollectionCards(html))('.fem-collection-product-card__cta').length,cards.length);
  }
});

test('Native cards show true discounts and selling plan prices; sold-out products remain accessible',()=>{
  const card={title:'Probiótico <Fem>',url:'/products/probiotico?variant=42&plan=5',available:true,selected_or_first_available_variant:{price:11000000,compare_at_price:14990000}};
  let $=load(renderCollectionCardDetails(card));
  assert.equal($('.fem-collection-product-card__badge').text(),'26% OFF');
  assert.equal($('h3').text(),card.title);
  assert.equal($('h3 fem').length,0);
  assert.equal($('a').attr('href'),card.url);
  assert.equal($('a').attr('aria-label'),'Ver producto: '+card.title);
  $=load(renderCollectionCardDetails({...card,available:false}));
  assert.equal($('.fem-collection-product-card__badge').text(),'Agotado');
  assert.equal($('a[aria-disabled],a[disabled]').length,0);
  $=load(renderCollectionCardDetails({...card,selected_or_first_available_variant:{...card.selected_or_first_available_variant,selected_selling_plan_allocation:{price:8990000,compare_at_price:11000000}}}));
  assert.equal($('[data-fem-dynamic-content-source="PRICE"]').text(),'$89.900,00');
  assert.equal($('[data-fem-dynamic-content-source="COMPARE_AT"]').text(),'$110.000,00');
  assert.equal($('.fem-collection-product-card__badge').text(),'18% OFF');
  for(const compare_at_price of [null,0,11000000,10000000]){
    $=load(renderCollectionCardDetails({...card,selected_or_first_available_variant:{price:11000000,compare_at_price}}));
    assert.equal($('.fem-collection-product-card__badge,[data-fem-dynamic-content-source="COMPARE_AT"]').length,0);
  }
});

test('Preview card changes stay inside collection product cards',()=>{
  const html='<main data-fem-layout="PRODUCT_TEMPLATE"><form data-fem-form-product-url="/products/fem"><div class="iDO0fZ54uk6uke5VL"><img src="/product.webp"></div><p>Product details</p></form></main><article class="fem-search-card">Search result</article>';
  const $=load(restoreCollectionCards(html));
  assert.equal($('.fem-collection-product-card__cta').length,0);
  assert.equal($('p').text(),'Product details');
  assert.equal($('.fem-search-card').text(),'Search result');
});
