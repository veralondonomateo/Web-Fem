import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {load} from 'cheerio';
import {Window} from 'happy-dom';
import {enhancePurchaseSelection} from '../src/components/purchase-selection.ts';
import {catalog,searchCatalog} from '../server/catalog.ts';
import {renderOwnedPage,ownedPaths} from '../server/owned-renderer.ts';
import {readCartCookie,cartCookie,mutateCart,cartState} from '../server/local-cart.ts';

test('Every owned route renders with the network disabled and all visible media stored locally',()=>{
 const previous=globalThis.fetch;globalThis.fetch=(()=>{throw Error('Unexpected network request');}) as typeof fetch;
 try{
  for(const path of ownedPaths()){
   const html=renderOwnedPage(new URL(path,'https://fem.test'));assert.ok(html,path);
   const $=load(html!);assert.ok($('main').length,path);assert.ok(!/\$NaN|window\.Shopify|ShopifyAnalytics/.test(html!),path+' contains an invalid price or remote runtime');
   const imports=JSON.parse($('script[type="importmap"]').text()).imports as Record<string,string>;
   assert.ok(Object.keys(imports).length>0,path+' needs local component imports');
   for(const src of Object.values(imports))assert.ok(src.startsWith('/__theme/')&&existsSync('theme-source/assets/'+src.split('/').pop()!.split('?')[0]),path+': '+src);
   $('[src],[srcset],[data-src],link[rel="stylesheet"]').each((_,node)=>{
    const el=$(node);for(const attr of ['src','srcset','data-src',...(node.tagName==='link'?['href']:[])]){
     const value=el.attr(attr)??'';assert.doesNotMatch(value,/(?:shopify|instant)\.(?:com|so)|\/cdn\/shop\//i,path+': '+value);
     for(const match of value.matchAll(/\/__theme\/([a-zA-Z0-9_.-]+)/g))assert.ok(existsSync('theme-source/assets/'+match[1])||['fem-runtime.js','fem-tokens.css'].includes(match[1]),path+': '+match[1]);
    }
   });
   assert.equal($('form[action*="femprobiotics.co"],a[href*="myshopify.com"]').length,0,path);
  }
 }finally{globalThis.fetch=previous;}
});
test('The second bestseller and all product variants resolve from the owned catalog',()=>{
 const home=load(renderOwnedPage(new URL('https://fem.test/'))!);
 const second=home('.fem-bestsellers__slider-slide-2');
 assert.match(second.text(),/probióticos y prebióticos/);assert.match(second.text(),/110\.000/);assert.ok(second.find('img[src^="/__theme/"]').length);
 for(const p of catalog){
  for(const v of p.variants){const $=load(renderOwnedPage(new URL(p.url+'?variant='+v.id,'https://fem.test'))!);const form=$('form[data-fem-form-product-id="'+p.id+'"]').first();assert.equal(form.attr('data-fem-form-variant-id'),String(v.id),p.handle);assert.equal(JSON.parse(form.find('script[id^="variants__"]').text()).length,p.variants.length);}
 }
});
test('Local cart keeps variants, quantities, preferences and authoritative prices through cookie round trips',()=>{
 const p=catalog.find(p=>p.handle==='jabon-intimo-ph-neutro')!,v=p.variants[0];
 let cart=mutateCart(readCartCookie(),'add',{items:[{id:v.id,quantity:2,price:1}]});
 cart=mutateCart(cart,'update',{attributes:{fem_payment_preference:'prepaid'}});
 const cookie=cartCookie(cart,true);assert.match(cookie,/HttpOnly; SameSite=Lax/);assert.match(cookie,/Secure$/);
 let restored=readCartCookie(cookie);const state=cartState(restored);assert.equal(state.item_count,2);assert.equal(state.total_price,v.price*2);assert.equal(state.attributes.fem_payment_preference,'prepaid');
 restored=mutateCart(restored,'change',{id:state.items[0].key,quantity:1});assert.equal(cartState(restored).total_price,v.price);
 assert.equal(cartState(readCartCookie(cookie.replace('fem_cart=','fem_cart=x'))).item_count,0);
 assert.throws(()=>mutateCart(restored,'add',{id:-1,quantity:1}));assert.throws(()=>mutateCart(restored,'change',{id:state.items[0].key,quantity:-1}));
 assert.equal(cartState(mutateCart(restored,'clear',{})).item_count,0);
});
test('Search accepts accents, returns owned destinations and does not depend on remote search sections',()=>{
 assert.ok(searchCatalog('jabon').some(p=>p.handle==='jabon-intimo-ph-neutro'));
 const $=load(renderOwnedPage(new URL('https://fem.test/search?q=jab%C3%B3n'))!);
 assert.ok($('.fem-search-card').length);assert.equal($('input[name="q"]').attr('value'),'jabón');
 assert.ok($('.fem-search-card[href="/products/jabon-intimo-ph-neutro"]').length);
 assert.equal(searchCatalog('nonexistentxyz').length,0);
});
test('The request handler no longer imports a remote storefront provider',()=>{
 const source=readFileSync('server/handler.ts','utf8');assert.doesNotMatch(source,/fetch\(STORE_ORIGIN|transformStorefront|restoreSearchResults|checkoutPermalink/);
 const provider=readFileSync('apps/checkout/lib/commerce.ts','utf8');assert.doesNotMatch(provider,/myshopify|admin\/api|\/oauth\/|fetch\(/);
 const renderer=readFileSync('server/owned-renderer.ts','utf8');assert.doesNotMatch(renderer,/liquidjs|cheerio|render-source|native-home|transformStorefront/);
});

test('Changing the probiotic pack refreshes its native markup from the local renderer',async t=>{
 const url='https://fem.test/products/probiotico-vaginal-en-capsulas-x60-unidades';
 const window=new Window({url,settings:{enableJavaScriptEvaluation:false,disableJavaScriptFileLoading:true,disableCSSFileLoading:true,enableImageFileLoading:false,disableIframePageLoading:true}});
 t.after(()=>window.happyDOM.close());
 for(const key of ['document','location','history','HTMLElement','HTMLFormElement','HTMLInputElement','HTMLSelectElement','HTMLImageElement','HTMLButtonElement','Element','DOMParser','Event','FormData'])Object.defineProperty(globalThis,key,{value:(window as any)[key],configurable:true,writable:true});
 Object.assign(globalThis,{window});window.document.body.innerHTML=renderOwnedPage(new URL(url))!;
 const previous=globalThis.fetch;let requests=0;
 globalThis.fetch=(async input=>{requests++;const target=new URL(String(input));assert.equal(target.hostname,'fem.test');return new Response(renderOwnedPage(target));}) as typeof fetch;
 t.after(()=>{globalThis.fetch=previous;});
 enhancePurchaseSelection(window.document as unknown as Document);
 const form=(window.document as unknown as Document).querySelector<HTMLFormElement>('form[data-fem-form-product-id="8114545754200"]')!;
 const pick=form.querySelector<HTMLInputElement>('input[type="radio"][value="2 unidades"]');assert.ok(pick);pick.checked=true;pick.dispatchEvent(new Event('change',{bubbles:true}));
 for(let i=0;i<100&&form.hasAttribute('aria-busy');i++)await new Promise(resolve=>setTimeout(resolve,10));
 assert.equal(form.dataset.femFormVariantId,'44093805690968');assert.equal(form.hasAttribute('aria-busy'),false);assert.ok(requests>=1);
 assert.match(form.querySelector('[data-fem-option-value="Compra Única 2"]')!.textContent!,/199\.900/);
 assert.equal(form.querySelector<HTMLParagraphElement>('.fem-product-error')?.hidden,true);
});
