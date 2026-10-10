import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {Window} from 'happy-dom';
import {load} from 'cheerio';
import {transformStorefront} from '../server/transform.ts';
import {enhancePurchaseSelection} from '../src/components/purchase-selection.ts';
import {enhanceCatalogInteractions} from '../src/components/catalog-interactions.ts';

const pages=JSON.parse(readFileSync('tests/fixtures/navigation.json','utf8')) as {url:string;html:string}[];
const delay=()=>new Promise(resolve=>setTimeout(resolve,10));
function environment(html:string){
  // A DOM unit-test environment with all remote loading/evaluation disabled, not a browser preview.
  const window=new Window({url:'https://fem.test/products/test',settings:{enableJavaScriptEvaluation:false,disableJavaScriptFileLoading:true,disableCSSFileLoading:true,enableImageFileLoading:false,disableIframePageLoading:true}});
  for(const key of ['document','location','history','HTMLElement','HTMLFormElement','HTMLInputElement','HTMLSelectElement','HTMLImageElement','HTMLButtonElement','Element','DOMParser','Event','FormData','ResizeObserver','CSS'])Object.defineProperty(globalThis,key,{value:(window as any)[key],configurable:true,writable:true});
  Object.assign(globalThis,{window,innerWidth:1280,scrollY:0,matchMedia:()=>({matches:true}),getComputedStyle:window.getComputedStyle.bind(window),requestAnimationFrame:window.requestAnimationFrame.bind(window),cancelAnimationFrame:window.cancelAnimationFrame.bind(window)});
  window.document.body.innerHTML=html;
  return window;
}

test('All migrated pages remove the runtime and keep their section-rendering identity',()=>{
  for(const page of pages){
    const source=load(page.html),result=load(transformStorefront(page.html,new URL(page.url).pathname));
    assert.equal(result('script[src*="instant.so"],link[href*="instant.so"],[data-instant-id]').length,0,page.url);
    assert.doesNotMatch(result('body').html()??'',/window\.Instant|client\.instant\.so/);
    for(const match of result.html().matchAll(/\/__theme\/([a-zA-Z0-9_.-]+)/g))assert.ok(existsSync('theme-source/assets/'+match[1])||['fem-runtime.js','fem-tokens.css'].includes(match[1]),page.url+': '+match[1]);
    source('main [data-instant-id]').each((_,node)=>{
      const id=source(node).attr('data-instant-id')!;if(id==='QpL8HGFa3rotk5kl'||id==='jk0iO6ALDrfmfm6c'||id==='zX2zkAycloBh8C5v')return;
      assert.equal(result(`[data-fem-id="${id}"]`).attr('data-section-id'),source(node).attr('data-section-id'),page.url);
    });
  }
});

test('Theme sections have no builder runtime, remote assets or missing section references',()=>{
  assert.equal(readdirSync('theme-source/sections').filter(name=>name.startsWith('instant-')).length,0);
  for(const folder of ['sections','assets','templates','config'])for(const name of readdirSync('theme-source/'+folder)){
    if(!/\.(css|liquid|json)$/.test(name))continue;
    const source=readFileSync('theme-source/'+folder+'/'+name,'utf8');assert.doesNotMatch(source,/https?:\/\/[^\s'"<>]*instant\.so|window\.Instant|data-instant-(?:id|action-type)|instant-section-page-builder/,name);
    if(name.endsWith('.json') && folder!=='assets'){
      const data=JSON.parse(source.replace(/^\/\*[\s\S]*?\*\/\s*/,''));
      for(const section of Object.values(data.sections??{}) as {type:string}[])if(!section.type.startsWith('shopify:'))assert.ok(existsSync('theme-source/sections/'+section.type+'.liquid'),name+': '+section.type);
    }
    for(const match of source.matchAll(/fem-media-[a-f0-9]+\.[a-z0-9]+/g))assert.ok(existsSync('theme-source/assets/'+match[0]),name+': '+match[0]);
  }
});

test('Native quantity changes keep subscription, ignore stale responses and restore a failed selection',async t=>{
  const source=pages.find(page=>page.url.endsWith('/products/duo-perfecto'))!;
  const $=load(transformStorefront(source.html));
  // The navigation audit omits JSON and inputs; restore public catalog data for this interaction test.
  const product=JSON.parse(readFileSync('tests/fixtures/subscription-products.json','utf8')).find((p:any)=>p.handle==='duo-perfecto');
  const root=$('form[data-fem-type="root"]');const scope=root.attr('class')!.slice(1);
  root.append(`<script type="application/json" id="variants__${scope}--test">${JSON.stringify(product.variants)}</script><script type="application/json" id="options__${scope}--test">${JSON.stringify(product.options)}</script><input type="radio" name="${scope}_quantity__Cantidad" value="1 Unidad"><input type="radio" name="${scope}_quantity__Cantidad" value="2 Unidades">`);
  const markup=$('[data-fem-layout="PRODUCT_TEMPLATE"]').first().toString();
  const window=environment(markup),document=window.document;
  t.after(()=>window.happyDOM.close());
  const form=document.querySelector('form[data-fem-type="root"]')! as any;
  const variants=JSON.parse(form.querySelector('script[id^="variants__"]').textContent);
  const options=JSON.parse(form.querySelector('script[id^="options__"]').textContent);
  const purchaseIndex=options.find((o:any)=>o.name==='Tipo de compra').position-1;
  const quantityIndex=options.find((o:any)=>o.name==='Cantidad').position-1;
  const pending:{url:URL;resolve:(response:Response)=>void}[]=[];
  t.mock.method(globalThis,'fetch',async(url:any)=>new Promise<Response>(resolve=>pending.push({url:new URL(String(url)),resolve})));
  enhancePurchaseSelection(document as unknown as Document);
  const card=[...form.querySelectorAll('[data-fem-action-type="select-variant-option"]')].find((node:any)=>node.dataset.femOptionValue.trim()==='Suscripción 1') as any;
  card.click();assert.equal(pending.length,1);
  const quantity=(value:string)=>{const input=[...form.querySelectorAll('input[type="radio"]')].find((node:any)=>node.value===value) as any;assert.ok(input);input.checked=true;input.dispatchEvent(new window.Event('change',{bubbles:true}));};
  quantity('2 Unidades');assert.equal(pending.length,2);
  const latest=variants.find((v:any)=>String(v.id)===pending[1].url.searchParams.get('variant'));
  assert.equal(latest.options[purchaseIndex],'Suscripción 2');assert.equal(latest.options[quantityIndex],'2 Unidades');
  assert.match(pending[1].url.searchParams.get('section_id')!,/__instant-Rdgsyfq2bLxX865f$/);
  const responseFor=(variant:any)=>{const doc=new window.DOMParser().parseFromString(markup,'text/html');const fresh=doc.querySelector('form[data-fem-type="root"]')!;fresh.setAttribute('data-fem-form-variant-id',String(variant.id));fresh.querySelectorAll('[data-fem-dynamic-content-source="PRICE"]').forEach(node=>node.textContent=`price:${variant.price}`);return new Response(doc.body.innerHTML);};
  pending[1].resolve(responseFor(latest));await delay();
  assert.equal(form.getAttribute('aria-busy'),null);assert.equal(form.querySelector('.fem-product-error').hidden,true);assert.equal(form.querySelector('input[name="id"]').value,String(latest.id));assert.ok(form.textContent.includes('price:'+latest.price));
  pending[0].resolve(responseFor(variants.find((v:any)=>String(v.id)===pending[0].url.searchParams.get('variant'))));await delay();
  assert.equal(form.querySelector('input[name="id"]').value,String(latest.id));
  quantity('1 Unidad');pending[2].resolve(new Response('Unavailable',{status:503}));await delay();
  assert.equal(form.querySelector('input[name="id"]').value,String(latest.id));assert.equal(form.querySelector('.fem-product-error').hidden,false);
  assert.equal(form.querySelector('[data-fem-option-value="Suscripción 2"]').getAttribute('aria-checked'),'true');
});

test('Gallery thumbnails, arrows, overlays and accordion controls work without an external library',async t=>{
  const window=environment(`<section data-fem-id="test"><script type="application/json" id="fem-view-slider-igallery-params">{"breakpoints":{"0":{"slidesPerView":1,"spaceBetween":0}}}</script><div class="fem-view-slider" id="igallery" data-fem-type="slider" data-fem-slider-id="gallery"><div class="fem-view-slider-wrapper"><div>1</div><div>2</div></div></div><button class="fem-view-slider-gallery-button-next">Next</button><div class="fem-view-slider" data-fem-type="thumbnails" data-fem-slider-id="gallery"><div class="fem-view-slider-wrapper"><div>1</div><div>2</div></div></div><button data-fem-action-type="open-overlay" data-fem-action-id="panel">Open</button><div id="ipanel" data-fem-type="overlay" data-state="closed"><button class="fem-view-overlay--lightbox__button-close">Close</button></div><div data-fem-type="accordion-container"><div data-fem-type="accordion-item" data-state="closed"><button data-fem-type="accordion-header">FAQ</button><div data-fem-type="accordion-content"><p>Answer</p></div></div></div></section>`);
  t.after(()=>window.happyDOM.close());const doc=window.document;
  const gallery=doc.getElementById('igallery')!;
  Object.defineProperties(gallery,{clientWidth:{value:400},scrollWidth:{value:800}});
  enhanceCatalogInteractions(doc as unknown as Document);
  (doc.querySelector('.fem-view-slider-gallery-button-next') as any).click();assert.equal(gallery.scrollLeft,400);
  (doc.querySelector('[data-fem-type="thumbnails"] .fem-view-slider-wrapper > div') as any).click();assert.equal(gallery.scrollLeft,0);
  (doc.querySelector('[data-fem-action-type="open-overlay"]') as any).click();assert.equal(doc.getElementById('ipanel')!.getAttribute('data-state'),'open');
  (doc.querySelector('.fem-view-overlay--lightbox__button-close') as any).click();assert.equal(doc.getElementById('ipanel')!.getAttribute('data-state'),'closed');
  (doc.querySelector('[data-fem-type="accordion-header"]') as any).click();assert.equal(doc.querySelector('[data-fem-type="accordion-header"]')!.getAttribute('aria-expanded'),'true');
});

test('Looping carousels continue at both ends without recreating slide content',t=>{
  const window=environment(`<section data-fem-id="loop"><script type="application/json" id="fem-view-slider-iloop-params">{"loop":true,"breakpoints":{"0":{"slidesPerView":1,"spaceBetween":0}}}</script><div id="iloop" data-fem-type="slider" data-fem-slider-id="loop"><div class="fem-view-slider-wrapper"><div id="slide-1">1</div><div id="slide-2">2</div><div>3</div><div>4</div></div></div><button class="fem-view-slider-loop-button-next">Next</button><button class="fem-view-slider-loop-button-prev">Previous</button></section>`);
  t.after(()=>window.happyDOM.close());const doc=window.document,viewport=doc.getElementById('iloop')!,track=viewport.firstElementChild!;
  Object.defineProperties(viewport,{clientWidth:{value:400},scrollWidth:{value:1600}});
  const first=doc.getElementById('slide-1'),second=doc.getElementById('slide-2');
  enhanceCatalogInteractions(doc as unknown as Document);
  const next=doc.querySelector('.fem-view-slider-loop-button-next') as any,previous=doc.querySelector('.fem-view-slider-loop-button-prev') as any;
  for(let i=0;i<4;i++)next.click();assert.equal(track.firstElementChild,second);assert.equal(track.lastElementChild,first);assert.equal(viewport.scrollLeft,1200);
  for(let i=0;i<4;i++)previous.click();assert.equal(track.firstElementChild,first);assert.equal(viewport.scrollLeft,0);
});

test('Thumbnail sizing never disables the main arrows, and images can be dragged without opening the lightbox',t=>{
  const window=environment(`<section data-fem-id="photos"><script type="application/json" id="fem-view-slider-imain-params">{"breakpoints":{"0":{"slidesPerView":1,"spaceBetween":0}}}</script><div id="imain" data-fem-type="slider" data-fem-slider-id="photos"><div class="fem-view-slider-wrapper"><div><button data-fem-action-type="open-overlay" data-fem-action-id="zoom"><img src="one.webp"></button></div><div><img src="two.webp"></div><div><img src="three.webp"></div></div></div><button class="fem-view-slider-photos-button-next">Next</button><button class="fem-view-slider-photos-button-prev">Previous</button><script type="application/json" id="fem-view-slider-ithumbs-params">{"breakpoints":{"0":{"slidesPerView":5,"spaceBetween":14}}}</script><div id="ithumbs" data-fem-type="thumbnails" data-fem-slider-id="photos"><div class="fem-view-slider-wrapper"><div>1</div><div>2</div><div>3</div></div></div><div id="izoom" data-fem-type="overlay" data-state="closed"><button class="fem-view-overlay--lightbox__button-close">Close</button></div></section>`);
  t.after(()=>window.happyDOM.close());
  const document=window.document,main=document.getElementById('imain')!,thumbs=document.getElementById('ithumbs')!;
  Object.defineProperties(main,{clientWidth:{value:400},scrollWidth:{value:1200}});
  Object.defineProperties(thumbs,{clientWidth:{value:400},scrollWidth:{value:400}});
  enhanceCatalogInteractions(document as unknown as Document);
  const next=document.querySelector('.fem-view-slider-photos-button-next') as unknown as HTMLButtonElement,previous=document.querySelector('.fem-view-slider-photos-button-prev') as unknown as HTMLButtonElement;
  assert.equal(next.disabled,false);
  next.click();assert.equal(main.scrollLeft,400);
  (thumbs.firstElementChild!.lastElementChild as any).click();assert.equal(main.scrollLeft,800);assert.equal(next.disabled,true);assert.equal(previous.disabled,false);
  (thumbs.firstElementChild!.firstElementChild as any).click();assert.equal(main.scrollLeft,0);
  const image=main.querySelector('img')!;
  image.dispatchEvent(new window.PointerEvent('pointerdown',{bubbles:true,pointerType:'mouse',clientX:300}));
  window.dispatchEvent(new window.PointerEvent('pointermove',{pointerType:'mouse',clientX:100}));
  window.dispatchEvent(new window.PointerEvent('pointerup',{pointerType:'mouse'}));
  assert.equal(main.scrollLeft,200);
  image.dispatchEvent(new window.MouseEvent('click',{bubbles:true,cancelable:true}));
  assert.equal(document.getElementById('izoom')!.getAttribute('data-state'),'closed');
});
