import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'cheerio';
import {restoreSearchResults} from '../server/search.ts';

const page='<!doctype html><html><head></head><body><main><section id="shopify-section-search" class="shopify-section"><div class="search-page__header"><h3>Buscar</h3><form action="/search" method="get" class="search-page-input__parent"><span class="search__icon">Icono</span><input name="q" value="jabón"><input type="hidden" name="type" value="product"></form></div></section><section id="collections">Colecciones</section></main></body></html>';
const section='<section id="shopify-section-search-results"><results-list section-id="search-results"><product-card><a class="product-card__link" href="/products/jabon?variant=42"><span class="visually-hidden">Jabón Fem</span></a><div class="product-card__content"></div></product-card></results-list></section>';
const product={title:'Jabón Fem',featured_image:'https://cdn.shopify.com/soap.png',price:10000,variants:[{id:41,price:10000,compare_at_price:null},{id:42,price:15000,compare_at_price:20000}]};

test('Search uses the shared collection-style card while retaining filters, pagination and the submit button',()=>{
  const template=JSON.parse(readFileSync('theme-source/templates/search.json','utf8').replace(/^\/\*[\s\S]*?\*\/\s*/,''));
  const results=template.sections.main;
  assert.notEqual(results.disabled,true);
  assert.equal(results.type,'search-results');
  assert.ok(template.order.includes('main'));
  assert.equal(results.blocks.filters.settings.enable_filtering,true);
  assert.equal(results.blocks.filters.settings.enable_sorting,true);
  const sectionSource=readFileSync('theme-source/sections/search-results.liquid','utf8');
  assert.match(sectionSource,/render 'fem-search-card', card_product: product/);
  assert.match(sectionSource,/paginate search.results by 24/);
  assert.match(sectionSource,/ref="cards\[\]"/);
  const form=load(readFileSync('theme-source/blocks/_search-input.liquid','utf8').replace(/\{\{[\s\S]*?\}\}/g,''));
  assert.equal(form('button.search__icon[type=submit]').length,1);
  assert.equal(form('input[name=q][type=search]').length,1);
});

test('Local search restores matching products, selected variant price, images and all search parameters',async()=>{
  const calls:URL[]=[];
  const request:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));calls.push(url);
    assert.equal(new Headers(init?.headers).get('Accept-Language'),'es-CO');
    return url.pathname==='/search'?new Response(section):Response.json(product);
  };
  const url=new URL('http://localhost:3000/search?q=jab%C3%B3n&type=product&sort_by=price-ascending&page=2&filter.v.availability=1');
  const $=load(await restoreSearchResults(page,url,{'Accept-Language':'es-CO'},request));
  assert.equal($('results-list').length,1);
  assert.equal($('button.search__icon[type=submit]').length,1);
  assert.equal($('h1.fem-search-heading').text(),'Buscar');
  assert.equal($('link[href="/__theme/fem-search.css"]').length,1);
  assert.equal($('#shopify-section-search').next().attr('id'),'shopify-section-search-results');
  assert.equal($('#collections').text(),'Colecciones');
  assert.equal($('.fem-search-card img').attr('src'),'https://cdn.shopify.com/soap.png?width=640');
  assert.equal($('.fem-search-card').attr('href'),'/products/jabon?variant=42');
  assert.match($('.fem-search-card__price').text(),/150,00/);
  assert.match($('.fem-search-card__compare').text(),/200,00/);
  assert.equal($('link[href="/__theme/fem-search-card.css"]').length,1);
  assert.equal(calls[0].origin,'https://femprobiotics.co');
  for(const [key,value] of url.searchParams)assert.equal(calls[0].searchParams.get(key),value);
  assert.equal(calls[0].searchParams.get('section_id'),'search-results');
  assert.equal(calls[1].pathname,'/products/jabon.js');
});

test('Empty searches, no-match messages and existing results do not trigger fallback requests',async()=>{
  const unexpected:typeof fetch=async()=>{assert.fail('Unexpected Shopify request');};
  for(const [html,url] of [
    [page,'/search'],
    [page.replace('</form>','<p class="search-results__no-results">No hay resultados</p></form>'),'/search?q=nomatch'],
    [page.replace('</main>','<results-list><a class="fem-search-card" href="/products/jabon">Existing card</a></results-list></main>'),'/search?q=fem'],
    [page,'/products/jabon']
  ]){
    const result=await restoreSearchResults(html,new URL(url,'http://localhost:3000'),{},unexpected);
    if(url.includes('nomatch'))assert.match(result,/No hay resultados/);
    if(url.startsWith('/products/'))assert.equal(result,html);
  }
});

test('Suggested products shown before searching use the same cards without requesting a search section',async()=>{
  const calls:URL[]=[];
  const request:typeof fetch=async input=>{
    const url=new URL(String(input));calls.push(url);
    assert.equal(url.pathname,'/products/jabon.js');
    return Response.json(product);
  };
  const $=load(await restoreSearchResults(page.replace('</main>',section+'</main>'),new URL('http://localhost:3000/search'),{},request));
  assert.equal(calls.length,1);
  assert.equal($('product-card').length,0);
  assert.equal($('.fem-search-card').length,1);
  assert.equal($('.fem-search-card').attr('href'),'/products/jabon?variant=42');
  assert.match($('.fem-search-card__price').text(),/150,00/);
  assert.equal($('.fem-search-card__stars svg').length,5);
  assert.equal($('.fem-search-card__arrow svg').length,1);
  assert.equal($('h1.fem-search-heading').text(),'Buscar');
});

test('Collection-style cards use real secondary images, sale prices and selected-variant availability',async()=>{
  const request:typeof fetch=async()=>Response.json({...product,available:true,images:['https://cdn.shopify.com/soap.png','https://cdn.shopify.com/soap-back.png'],media:[{preview_image:{src:'https://cdn.shopify.com/soap-back.png',width:900,height:900}}],variants:[{id:42,price:15000,compare_at_price:15000,available:false}]});
  const $=load(await restoreSearchResults(section,new URL('http://localhost:3000/search?q=jabon&section_id=search-results'),{},request));
  assert.equal($('.fem-search-card--two-images').length,1);
  assert.equal($('.fem-search-card__image--hover').attr('src'),'https://cdn.shopify.com/soap-back.png?width=640');
  assert.equal($('.fem-search-card__image--hover').attr('width'),'900');
  assert.equal($('.fem-search-card__compare').length,0);
  assert.equal($('.fem-search-card__sold-out').text(),'Agotado');
  assert.equal($('.fem-search-card__arrow svg').length,1);
});

test('Pagination fragments retain fragment structure and product labels remain visible if data fails',async()=>{
  let calls=0;
  const request:typeof fetch=async input=>{calls++;assert.equal(new URL(String(input)).pathname,'/products/jabon.js');return new Response('Unavailable',{status:503});};
  const result=await restoreSearchResults(section,new URL('http://localhost:3000/search?q=fem&page=2&section_id=search-results'),{},request);
  assert.doesNotMatch(result,/<html/);
  assert.equal(load(result)('.product-card__content').text(),'Jabón Fem');
  assert.equal(calls,1);
});

test('A failed search request shows a recoverable message instead of an empty result area',async()=>{
  const request:typeof fetch=async()=>new Response('',{status:503});
  const $=load(await restoreSearchResults(page,new URL('http://localhost:3000/search?q=fem'),{},request));
  assert.match($('[role=alert]').text(),/Vuelve a buscar/);
  assert.equal($('form[action="/search"] button[type=submit]').length,1);
  assert.equal($('#collections').text(),'Colecciones');
});
