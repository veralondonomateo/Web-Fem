import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'cheerio';
import {renderRefundPolicy} from '../server/native-home.ts';
import {transformStorefront} from '../server/transform.ts';
import {localHref} from '../src/lib/navigation.ts';

const pages=JSON.parse(readFileSync(new URL('./fixtures/navigation.json',import.meta.url),'utf8')) as {url:string;html:string}[];
const refund=pages.find(page=>new URL(page.url).pathname==='/policies/refund-policy')!;
const normalize=(text:string)=>text.replace(/\s+/g,' ').trim();

test('Refund redesign preserves the published policy text, lists and destinations',()=>{
  const original=load(refund.html),rendered=load(transformStorefront(refund.html,'/policies/refund-policy'));
  const before=original('.shopify-policy__body .rte'),after=rendered('.fem-refund-policy__content');
  assert.equal(normalize(after.text()),normalize(before.text()));
  for(const tag of ['p','li','strong','ul','ol'])assert.equal(after.find(tag).length,before.find(tag).length,tag);
  assert.deepEqual(after.find('a').map((_,a)=>rendered(a).attr('href')).get(),before.find('a').map((_,a)=>localHref(original(a).attr('href')!)).get());
  assert.equal(rendered('main h1').length,1);
  assert.equal(rendered('main h1').text(),original('.shopify-policy__title h1').text());
  assert.equal(rendered('.fem-refund-policy__breadcrumb a').attr('href'),'/');
  assert.equal(rendered('link[href="/__theme/fem-refund-policy.css"]').length,1);
});

test('The shared policy renderer escapes the title and retains merchant HTML as content',()=>{
  const $=load(renderRefundPolicy({title:'Reembolsos <ejemplo>',body:'<p><strong>Contenido vigente</strong> &amp; condiciones.</p><a href="mailto:example@example.com">Contacto</a>'}));
  assert.equal($('h1').text(),'Reembolsos <ejemplo>');
  assert.equal($('ejemplo').length,0);
  assert.equal($('.fem-refund-policy__content strong').text(),'Contenido vigente');
  assert.equal($('.fem-refund-policy__content a').attr('href'),'mailto:example@example.com');
});

test('Refund presentation is route-scoped, works from the canonical URL and does not duplicate on repeat transforms',()=>{
  const once=transformStorefront(refund.html),twice=load(transformStorefront(once,'/policies/refund-policy'));
  assert.equal(twice('.fem-refund-policy').length,1);
  assert.equal(twice('link[href="/__theme/fem-refund-policy.css"]').length,1);
  const privacy=pages.find(page=>new URL(page.url).pathname==='/policies/privacy-policy')!;
  const rendered=load(transformStorefront(privacy.html,'/policies/privacy-policy'));
  assert.equal(rendered('.fem-refund-policy').length,0);
  assert.equal(rendered('.shopify-policy__container').length,1);
});
