import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {load} from 'cheerio';
import {transformStorefront} from '../server/transform.ts';

const titleSelector='form[data-fem-type="root"] [data-fem-dynamic-content-source="TITLE"]';

test('Every native product template has one H1 containing the product name',()=>{
  const files=readdirSync('theme-source/sections').filter(file=>/^fem-product-.*\.liquid$/.test(file));
  assert.equal(files.length,20);
  for(const file of files){
    const $=load(readFileSync('theme-source/sections/'+file,'utf8'));
    const title=$(titleSelector).first();
    assert.equal($('h1').length,1,file);
    assert.equal(title.prop('tagName'),'H1',file);
    assert.equal(title.text().trim(),'{{ product.title }}',file);
    assert.ok(title.attr('class'),file);
  }
});

test('Preview product titles preserve text and styling hooks with a single H1',()=>{
  const pages=JSON.parse(readFileSync('tests/fixtures/navigation.json','utf8')) as {url:string;html:string}[];
  const products=pages.filter(page=>new URL(page.url).pathname.startsWith('/products/')&&load(page.html)('[data-instant-layout="PRODUCT_TEMPLATE"]').length>0);
  assert.equal(products.length,18);
  for(const page of products){
    const before=load(page.html);
    const original=before('[data-instant-layout="PRODUCT_TEMPLATE"] form[data-instant-type="root"] [data-instant-dynamic-content-source="TITLE"]').first();
    const $=load(transformStorefront(page.html,new URL(page.url).pathname));
    const section=$('[data-fem-layout="PRODUCT_TEMPLATE"]');
    const title=section.find(titleSelector).first();
    assert.equal(section.find('h1').length,1,page.url);
    assert.equal(title.prop('tagName'),'H1',page.url);
    assert.equal(title.text(),original.text(),page.url);
    assert.equal(title.attr('class'),original.attr('class'),page.url);
    assert.equal(title.attr('data-fem-type'),'text',page.url);
  }
});

test('Section fragments keep a semantic title without promoting recommendation card titles',()=>{
  const html='<section data-fem-layout="PRODUCT_TEMPLATE"><form data-fem-type="root" data-fem-form-product-url="/products/test"><h3 class="original-title" data-fem-type="text" data-fem-dynamic-content-source="TITLE">Producto &amp; cuidado</h3><a href="/products/recommended"><h3 data-fem-dynamic-content-source="TITLE">Recomendado</h3></a></form></section>';
  const $=load(transformStorefront(html));
  assert.equal($('h1').length,1);
  assert.equal($('h1').text(),'Producto & cuidado');
  assert.equal($('h1').attr('class'),'original-title');
  assert.equal($('a h3').text(),'Recomendado');
});
