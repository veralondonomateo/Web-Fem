import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'cheerio';
import {nativeMarkup} from '../server/legacy-preview.ts';
import {accentProductAccordionTitles} from '../server/product-accordions.ts';

test('Product accordion accents preserve catalog text, answer markup, controls and icons',()=>{
  const pages=JSON.parse(readFileSync('tests/fixtures/navigation.json','utf8')) as {url:string;html:string}[];
  let products=0,labels=0;
  for(const page of pages){
    if(!new URL(page.url).pathname.startsWith('/products/'))continue;
    const html=nativeMarkup(page.html),before=load(html),after=load(html);
    const headers=before('[data-fem-layout="PRODUCT_TEMPLATE"] [data-fem-type="accordion-header"] [data-fem-type="text"]');
    if(!headers.length)continue;
    accentProductAccordionTitles(after);
    assert.equal(after('.fem-product-accordion__accent').length,headers.length,page.url);
    const once=after.html();accentProductAccordionTitles(after);
    assert.equal(after.html(),once,page.url);
    after('.fem-product-accordion__accent').each((_,node)=>{after(node).replaceWith(after(node).contents());});
    assert.equal(after.html(),before.html(),page.url);
    products++;labels+=headers.length;
  }
  assert.equal(products,18);
  assert.ok(labels>=70);
});

test('Accents retain nested emphasis and escaped text and stay inside product accordion titles',()=>{
  const html='<section data-fem-layout="PRODUCT_TEMPLATE"><h1>Producto</h1><div data-fem-type="accordion-container"><button data-fem-type="accordion-header"><div data-fem-type="text"><h3><strong>Ingredientes A &amp; B?</strong> </h3></div><svg><path d="M0 0"></path></svg></button><div data-fem-type="accordion-content"><p>Respuesta &amp; condiciones.</p></div></div></section><section><button data-fem-type="accordion-header"><div data-fem-type="text"><p>Otra sección</p></div></button></section>';
  const before=load(html),$=load(html);accentProductAccordionTitles($);
  assert.equal($('.fem-product-accordion__accent').length,1);
  assert.equal($('strong em').text(),'B?');
  assert.equal($('[data-fem-layout] [data-fem-type="accordion-header"]').text(),before('[data-fem-layout] [data-fem-type="accordion-header"]').text());
  assert.equal($('[data-fem-type="accordion-content"]').html(),before('[data-fem-type="accordion-content"]').html());
  assert.equal($('section').last().html(),before('section').last().html());
});
