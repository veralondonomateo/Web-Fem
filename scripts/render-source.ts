import {readFileSync} from 'node:fs';
import {load} from 'cheerio';
import {catalog,productByHandle,searchCatalog,type CatalogProduct} from '../server/catalog.ts';
import {renderSearchCard,renderCatalogFilters,renderOwnedProductSection} from '../server/native-home.ts';
import {sectionNames} from '../server/legacy-preview.ts';
import {transformStorefront} from '../server/transform.ts';
import {cookiePolicy,privacyMarkup} from '../server/privacy.ts';
import {addProductFaq} from '../server/product-faq.ts';
const routes=JSON.parse(readFileSync(new URL('../content/routes.json',import.meta.url),'utf8')) as Record<string,string>;
const media=JSON.parse(readFileSync(new URL('../content/media.json',import.meta.url),'utf8')) as Record<string,string>;
const cache=new Map<string,string>();
import {themeImports} from '../src/lib/theme-modules.ts';
const money=(n:number)=>'$'+new Intl.NumberFormat('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100);
export const ownedPaths=()=>Object.keys(routes);
function source(path:string){const file=routes[path];if(!file)return null;let html=cache.get(file);if(!html){html=readFileSync(new URL('../content/pages/'+file,import.meta.url),'utf8');cache.set(file,html);}return html;}
export function localMedia(html:string){for(const [remote,local]of Object.entries(media))html=html.replaceAll(remote,local);return html;}
export function productCard(p:CatalogProduct){const v=p.variants.find(v=>v.available)??p.variants[0];const image=(src:string)=>({src,width:1280,height:1280,alt:p.title});return renderSearchCard({...p,featured_image:image(p.featured_image),images:p.images.map(image),selected_or_first_available_variant:{...v,featured_image:image(v.featured_image?.src||p.featured_image)}});}
export function renderOwnedPage(url:URL,cookie=''):string|null{
 if(url.pathname==='/pages/politica-de-cookies')return cookiePolicy;
 let html=source(url.pathname);if(!html)return null;
 const $=load(html);
 const product=productByHandle(url.pathname.split('/products/')[1]??'');
 if(product){
  const root=$('[data-fem-layout="PRODUCT_TEMPLATE"]').first(),type=sectionNames[root.attr('data-fem-id')??''];
  if(type){
   const asTemplate=(p:CatalogProduct,selected?:string|null)=>{const image=(src:string)=>({src,width:1280,height:1280,alt:p.title});const v=p.variants.find(v=>String(v.id)===selected)??p.variants.find(v=>v.available)??p.variants[0];return {...p,featured_image:image(p.featured_image),images:p.images.map(image),options_with_values:p.options,selected_or_first_available_variant:{...v,featured_image:image(v.featured_image?.src||p.featured_image)}};};
   const products=Object.fromEntries(catalog.flatMap(p=>[p.handle,...p.aliases].map(h=>[h,asTemplate(p)])));
   root.replaceWith(transformStorefront(renderOwnedProductSection(type,asTemplate(product,url.searchParams.get('variant')),products,root.attr('data-section-id')??'fem-product')));
  }
 }
 if(product)$('form[action="/cart/add"]').attr({'data-fem-form-product-url':product.url,'data-fem-form-product-id':String(product.id)}).find('button[type="submit"]').attr({'type':'button','data-fem-cart-add':'','data-fem-cart-product-handle':product.handle});
 if(product){
  const v=product.variants.find(v=>String(v.id)===url.searchParams.get('variant'))??product.variants.find(v=>v.available)??product.variants[0];
  $('product-price[data-product-id="'+product.id+'"]').each((_,node)=>{
   const price=$(node);price.find('.price').text(money(v.price));
   price.find('.compare-at-price').text(v.compare_at_price?money(v.compare_at_price):'').parent().toggleClass('hidden',!v.compare_at_price||v.compare_at_price<=v.price);
  });
 }
 // Keep the existing markup and CSS. Resolve catalog fields against our own data.
 $('form[data-fem-form-product-url]').each((_,node)=>{
  const form=$(node),handle=form.attr('data-fem-form-product-url')?.split('/products/')[1]?.split('?')[0];
  const p=productByHandle(handle??'');if(!p)return;
  const main=!!product&&product.id===p.id;
  const v=(main?p.variants.find(v=>String(v.id)===url.searchParams.get('variant')):null)??p.variants.find(v=>v.available)??p.variants[0];
  form.attr({'data-fem-form-product-url':p.url,'data-fem-form-variant-id':String(v.id),'data-fem-form-product-id':String(p.id)});
  form.find('[data-fem-dynamic-content-source]').each((_,field)=>{
   const target=$(field);if(target.closest('form[data-fem-form-product-url]')[0]!==node)return;
   if(main&&form.closest('[data-fem-layout="PRODUCT_TEMPLATE"]').length)return;
   const type=target.attr('data-fem-dynamic-content-source');
   if(type==='PRICE')target.text(money(v.price));
   if(type==='COMPARE_AT')target.text(v.compare_at_price?money(v.compare_at_price):'').css('display',v.compare_at_price&&v.compare_at_price>v.price?'':'none');
   if(type==='SAVED_PERCENTAGE'&&v.compare_at_price)target.text(Math.round(100-v.price/v.compare_at_price*100)+'%');
  });
  const script=(prefix:string,value:unknown)=>{const target=form.find('script[id^="'+prefix+'__"]');if(target.length)target.text(JSON.stringify(value));else form.append($('<script type="application/json"></script>').attr('id',prefix+'__'+p.id+'--'+(form.attr('class')??'product').split(' ')[0]).text(JSON.stringify(value)));};
  script('variants',p.variants);script('options',p.options);
  if(!form.find('input[name="id"]').length)form.append('<input type="hidden" name="id">');
  form.find('input[name="id"]').attr('value',String(v.id));
  form.find('[data-fem-cart-add],[data-fem-action-type="add-to-cart"]').attr('data-fem-disabled',String(!v.available));
  form.find('[data-fem-action-variant-id]').attr('data-fem-action-variant-id',String(v.id));
 });
 if(product)addProductFaq($,product);
 if(url.pathname==='/search'){
  const q=url.searchParams.get('q')?.trim()??'';
  const form=$('form.search-page-input__parent');
  if(!form.find('input[name="q"]').length)form.find('search-page-input-component').prepend('<input id="fem-search-input" class="search-page-input" name="q" type="search" autocomplete="off" aria-label="Buscar productos">');
  form.find('label').attr('for','fem-search-input');
  form.find('input[name="q"]').attr({value:q,placeholder:'Busca tu producto'});
  const icon=form.find('span.search__icon');if(icon.length){icon.replaceWith($('<button type="submit" class="button-unstyled svg-wrapper search__icon" aria-label="Buscar"></button>').append(icon.contents()));}
  form.find('.search-results__no-results,[role="alert"]').remove();
  $('.search-page__header :is(h1,h2,h3)').first().replaceWith('<h1 class="fem-search-heading">Resultados de búsqueda</h1>');
  const matches=searchCatalog(q);
  const results=$('<results-list data-fem-catalog></results-list>');
  results.append(renderCatalogFilters());
  const grid=$('<div class="fem-owned-search-grid" data-fem-catalog-list></div>');
  for(const p of matches)grid.append(productCard(p));
  results.append(grid);
  if(q&&!matches.length)results.append($('<p></p>').text('No encontramos productos para «'+q+'».'));
  if($('results-list').length)$('results-list').replaceWith(results);else form.closest('.shopify-section').after(results);
  $('head').append('<link rel="stylesheet" href="/__theme/fem-search.css"><link rel="stylesheet" href="/__theme/fem-search-card.css"><link rel="stylesheet" href="/__theme/fem-owned.css">');
 }
 $('a[href],form[action]').each((_,node)=>{
  const el=$(node),attr=node.tagName==='form'?'action':'href',value=el.attr(attr)??'';
  try{const target=new URL(value,url);if(['femprobiotics.co','www.femprobiotics.co','fd668e-73.myshopify.com','checkoutfem.com'].includes(target.hostname)){el.attr(attr,target.hostname==='checkoutfem.com'?'/checkout'+target.search:target.pathname+target.search+target.hash);}}catch{}
 });
 $('link[href*="fonts.googleapis.com"]').remove();
 // Captures intentionally omit input values. Restore controls from the owned forms.
 $('.contact-form__form label[for]').each((_,node)=>{
  const label=$(node),id=label.attr('for')!;if($('#'+id).length)return;
  const suffix=id.split('-').pop(),type=suffix==='email'?'email':suffix==='phone'?'tel':'text';
  const field=$('<input class="contact-form__input">').attr({id,type,name:'contact['+suffix+']',placeholder:label.text().replace('*','').trim()});if(type==='email')field.attr('required','');
  label.removeClass('visually-hidden').addClass('contact-form__label').wrap('<div class="contact-form__field"></div>').after(field);
 });
 if(url.searchParams.get('sent')==='1')$('.contact-form__form').prepend('<p role="status">Gracias. Recibimos tu mensaje.</p>');
 $('link[rel="canonical"]').remove();$('head').append($('<link rel="canonical">').attr('href',url.origin+url.pathname));
 $('html').attr('data-fem-independent','');
 if(url.pathname==='/cart')$('body').attr('data-fem-open-cart-on-load','');
 if(!$('link[href="/__theme/fem-owned.css"]').length)$('head').append('<link rel="stylesheet" href="/__theme/fem-owned.css">');
 // External app snippets and analytics are never part of the independent renderer.
 $('script').each((_,node)=>{const e=$(node);if(e.attr('type')!=='application/json'&&!['/__theme/fem-runtime.js'].includes(e.attr('src')??''))e.remove();});
 $('html').attr('data-fem-template',product?'product':url.pathname==='/search'?'search':url.pathname.startsWith('/collections')?'collection':'page');
 $('head').prepend('<script src="/__theme/fem-theme-context.js"></script><script type="importmap">'+JSON.stringify({imports:themeImports})+'</script>');
 $('body').append('<script type="module" src="/__theme/dialog.js"></script>');
 const quiz=url.pathname==='/pages/quiz1'?'fem-quiz1':url.pathname==='/pages/quiz-soda'?'fem-quiz-soda':null;
 if(quiz)$('body').append(`<script src="/__theme/${quiz}.js"></script>`);
 return localMedia(privacyMarkup($.html(),cookie));
}
