import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {load} from 'cheerio';
import {renderCatalogFilters} from '../server/native-home.ts';
import {restoreCatalogFilters} from '../server/catalog-filters.ts';
import {enhanceCatalogFilters,productCategory} from '../src/components/catalog-filters.ts';

function environment(url='http://localhost:3000/search?q=Fem&type=product'){
  const window=new Window({url,settings:{enableJavaScriptEvaluation:false,disableCSSFileLoading:true,disableJavaScriptFileLoading:true}});
  for(const key of ['document','location','HTMLElement','Element'])Object.defineProperty(globalThis,key,{value:(window as any)[key],writable:true,configurable:true});
  Object.assign(globalThis,{window});
  const card=(handle:string,title:string,price:number,available:boolean)=>`<a href="/products/${handle}?variant=42" data-fem-catalog-item data-product-handle="${handle}" data-product-title="${title}" data-product-price="${price}" data-product-available="${available}">${title}</a>`;
  window.document.body.innerHTML=`<main data-fem-catalog>${renderCatalogFilters()}<div data-grid>${card('probiotico','Alimento con probióticos',11000000,true)}${card('jabon','Jabón íntimo',4690000,false)}${card('duo-perfecto','Combo Probiótico + Jabón',12990000,true)}${card('fem-mom','Fem Mom',11000000,true)}</div></main><aside><a>Otra tarjeta</a></aside>`;
  const doc=window.document,scope=doc.querySelector('main')!,form=scope.querySelector('form')!;
  const change=(name:string,value:string)=>{const input=form.elements.namedItem(name) as any;input.value=value;input.dispatchEvent(new window.Event('input',{bubbles:true}));};
  const visible=()=>[...scope.querySelectorAll('[data-fem-catalog-item]')].filter(card=>!(card as any).hidden);
  enhanceCatalogFilters(doc as unknown as Document);
  return {window,doc,scope,form,change,visible};
}

test('Category and COP price combine without changing product links; reset restores all cards',async t=>{
  const {window,doc,form,change,visible}=environment();t.after(()=>window.happyDOM.close());
  const links=visible().map(card=>card.getAttribute('href'));
  assert.equal(form.hidden,false);assert.equal(visible().length,4);
  change('fem_category','combos');assert.equal(visible().length,1);
  assert.equal(doc.querySelector('[data-fem-filter-count]')!.textContent,'1 de 4 productos');
  change('fem_max','120000');assert.equal(visible().length,0);
  assert.equal((doc.querySelector('[data-fem-filter-empty]') as any).hidden,false);
  form.dispatchEvent(new window.Event('reset',{cancelable:true}));assert.equal(visible().length,4);
  change('fem_category','soap');assert.equal(visible().length,1);
  assert.match(visible()[0].textContent!,/Jabón/);
  change('fem_min','50000');assert.equal(visible().length,0);
  form.dispatchEvent(new window.Event('reset',{cancelable:true}));
  assert.deepEqual(visible().map(card=>card.getAttribute('href')),links);
  assert.equal(new URL(window.location.href).search,'?q=Fem&type=product');
  assert.equal((doc.querySelector('aside a') as any).hidden,false);
});

test('Invalid prices leave the list usable and URL filters survive reload and clear independently of search',async t=>{
  const {window,doc,form,change,visible}=environment('http://localhost:3000/search?q=Fem&type=product&fem_category=soap&fem_max=50000');t.after(()=>window.happyDOM.close());
  assert.equal(visible().length,1);
  change('fem_min','60000');assert.equal((doc.querySelector('[data-fem-filter-error]') as any).hidden,false);
  assert.equal(visible().length,1);assert.equal((doc.querySelector('[data-fem-filter-reset]') as any).hidden,false);
  form.dispatchEvent(new window.Event('reset',{cancelable:true}));assert.equal(visible().length,4);
  assert.equal(window.location.search,'?q=Fem&type=product');
});

test('Removed availability filters in old links are cleared without hiding products or fetching inventory',t=>{
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
  let calls=0;globalThis.fetch=(async()=>{calls++;return new Response('',{status:503});}) as typeof fetch;
  const {window,doc,scope,change,visible}=environment('http://localhost:3000/search?q=Fem&type=product&fem_available=true&fem_max=120000');t.after(()=>window.happyDOM.close());
  assert.equal(doc.querySelector('[name=fem_available]'),null);
  assert.equal(visible().length,3);
  assert.equal(window.location.search,'?q=Fem&type=product&fem_max=120000');
  scope.querySelector('[data-product-handle="probiotico"]')!.removeAttribute('data-product-available');
  change('fem_min','50000');
  assert.equal(visible().length,2);
  assert.equal(calls,0);
  assert.equal((doc.querySelector('[data-fem-filter-error]') as any).hidden,true);
});

test('Product families distinguish combinations and empty categories are unavailable; pagination counts are explicit',t=>{
  const {window,doc,scope}=environment();t.after(()=>window.happyDOM.close());
  assert.equal(productCategory('Alimento con probióticos + Jabón íntimo + Óvulos'),'combos');
  assert.equal(productCategory('Gomitas con fenogreco'),'gummies');
  assert.equal(productCategory('Óvulos Fem'),'ovules');
  assert.equal(productCategory('Soda prebiótica'),'soda');
  assert.equal((doc.querySelector('option[value=ovules]') as any).disabled,true);
  scope.querySelector('[data-grid]')!.setAttribute('data-last-page','2');
  enhanceCatalogFilters(scope as unknown as HTMLElement);
  assert.match(doc.querySelector('[data-fem-filter-count]')!.textContent!,/en esta página/);
});

test('Preview shares the translated controls, annotates prices once and excludes home and product galleries',()=>{
  const source='<main><div data-fem-layout="COLLECTION_TEMPLATE"><div><form data-fem-form-product-url="/products/duo-perfecto"><h3 data-fem-dynamic-content-source="TITLE">Combo Fem</h3><p data-fem-dynamic-content-source="PRICE">$129.900,00</p></form></div></div><aside data-fem-layout="PRODUCT_TEMPLATE"><form data-fem-form-product-url="/products/jabon">Producto</form></aside></main>';
  const html=restoreCatalogFilters(restoreCatalogFilters(source)),$=load(html);
  assert.equal($('[data-fem-catalog-filters]').length,1);
  assert.equal($('[data-fem-catalog-item]').attr('data-product-price'),'12990000');
  assert.equal($('[data-fem-catalog-item]').attr('data-product-handle'),'duo-perfecto');
  assert.equal($('[data-fem-catalog-item]').attr('data-product-available'),undefined);
  assert.equal($('aside [data-fem-catalog-item]').length,0);
  assert.doesNotMatch(html,/fem_catalog\./);
});
