import {load} from 'cheerio';
import {repairNavigation,localHref,STORE_ORIGIN} from '../src/lib/navigation.ts';
import {productsFromStorefront,renderNativeSection,renderScratchCard} from './native-home.ts';
import {componentSelectors as selectors,deduplicateIcons} from '../src/lib/performance.ts';
import {nativeMarkup} from './legacy-preview.ts';
import {restoreProductGalleries} from './product-gallery.ts';
import {productCartControls} from '../src/lib/product-cart.ts';
import {presentProbioticos} from './product-probioticos.ts';
export function transformStorefront(html:string,pathname?:string):string {
  const fullDocument=/<(?:!doctype|html)\b/i.test(html);
  const $=load(repairNavigation(html),{},fullDocument);
  // The legacy Ecuador template embeds a second navigation and hides the theme header.
  const ecuador=$('[data-instant-id="bmPzy6K28rNrqB8Y"]');
  ecuador.find('#ikuG5rUTUFtiEv7Gd,#i5MX4XVtpzDy5o1qF').remove();
  ecuador.find('style').each((_,node)=>{
    const style=$(node);
    style.text(style.text().replace(/\/\* HEADER \*\/[\s\S]*?display:\s*none\s*!important;\s*}/,''));
  });
  const paymentImages=$('[data-instant-layout="CART"] img.instant-icon__payment-method').clone().removeAttr('class').attr('loading','lazy').map((_,node)=>$.html(node)).get().join('');
  $('#header-group img').each((_,node)=>{
    if(!/banner-aniv/i.test($(node).attr('src')??''))return;
    const parent=$(node).parent();
    if(parent.attr('data-instant-type')==='media')parent.remove();else $(node).remove();
  });
  $('[data-instant-action-type="trigger-instant-cart"]').attr({'data-fem-cart-open':'','aria-controls':'fem-cart-drawer','aria-expanded':'false','aria-haspopup':'dialog','aria-label':'Abrir carrito'}).find('[data-instant-dynamic-content-source="CART_COUNT"]').attr({'data-fem-cart-count':'','data-hide-empty':'','aria-live':'polite','aria-atomic':'true'});
  $('[data-instant-action-type="add-to-instant-cart"]').attr('data-fem-cart-add','');
  if (fullDocument) {
    const products=productsFromStorefront($);
    for(const [id,name] of [['Kikh7VzmQY85iams','header'],['QpL8HGFa3rotk5kl','home'],['9DvYKHtHU4LVuyNi','footer']] as const){
      if(name==='home' && pathname!=='/')continue;
      const root=$(`[data-instant-id="${id}"]`);
      const markup=renderNativeSection(name,products,pathname);
      if(name==='header'&&!root.length&&!$('.fem-header').length){
        const group=$('#header-group');
        if(group.length)group.html(markup);else $('body').prepend(markup);
      }else root.replaceWith(markup);
    }
    $('[data-instant-id="UmyA9YaWEvT6UV0u"]').remove();
    $('script').each((_,node)=>{
      const script=$(node);
      if(script.attr('type')==='application/json'&&/^instant-slider-.+-params$/.test(script.attr('id')??''))return;
      if(/instant(?:\.so|[-/\d])|window\.Instant/.test((script.attr('src')??'')+' '+script.text()))script.remove();
    });
    $('link[href*="instant-Kikh7VzmQY85iams"],link[href*="instant-9DvYKHtHU4LVuyNi"],style[data-instant]').remove();
    if(pathname==='/')$('link[href*="instant-QpL8HGFa3rotk5kl"]').remove();
    $('[id^="shopify-section-"][id*="__instant-"]').each((_,node)=>{$(node).attr('id',$(node).attr('id')!.replace(/__instant-.+$/,'__fem-native'));});
    if(pathname==='/')$('link[rel="stylesheet"][href*="fonts.googleapis.com/css2"]').remove();
  }
  if(fullDocument){
    $('[data-instant-layout="CART"]').remove();
    if(!$('#fem-cart-drawer').length)$('body').append(renderNativeSection('cart-drawer',{}));
    if(!$('#fem-scratch-template').length)$('body').append(renderScratchCard());
    if(paymentImages)$('[data-cart-payments]').html(paymentImages);
  }
  $('[data-instant-id="Kikh7VzmQY85iams"] .iNoR1guaGLSno7n9R img').attr({
    src:'/__theme/fem-logo-fem-web-a760cdd1.svg',
    alt:'Fem',width:'565',height:'177',loading:'eager',fetchpriority:'high'
  }).removeAttr('srcset').removeAttr('sizes');
  $('script').each((_,element)=>{
    const script=$(element);const src=script.attr('src');
    if (src) {
      const url=new URL(src,STORE_ORIGIN); const name=url.pathname.split('/').pop() ?? '';
      if (url.pathname.includes('/cdn/shop/t/9/assets/') && selectors[name]) {
        script.attr('type','application/json').attr('data-fem-module',selectors[name]).attr('data-src',src).removeAttr('src').removeAttr('defer').removeAttr('fetchpriority');
      }
    } else if (script.text().includes("'send_to': 'AW-16944860206/PSfGCKORlbwaEK6Y-I8_'")) script.remove();
  });
  $('a[href]').each((_,element)=>{
    const link=$(element);const href=link.attr('href') ?? '';
    link.attr('href',localHref(href));
    if (/^\/(checkouts|customer_authentication|account|discount|apps|challenge)(\/|$)/.test(href)) link.attr('href',STORE_ORIGIN+href);
  });
  // Serve theme assets locally; product media and commerce stay connected to Shopify.
  $('[src],[href]').each((_,element)=>{
    const el=$(element);
    for (const attribute of ['src','href','data-src']) {
      const value=el.attr(attribute);if(!value)continue;
      try {
        const url=new URL(value,STORE_ORIGIN);
        if(url.hostname==='femprobiotics.co'&&url.pathname.startsWith('/cdn/shop/t/9/assets/')) el.attr(attribute,'/__theme/'+url.pathname.split('/').pop());
      } catch { /* Liquid-free malformed URL is reported by link audit. */ }
    }
  });
  $('script[data-src]').each((_,element)=>{
    const el=$(element);const value=el.attr('data-src')!;const url=new URL(value,STORE_ORIGIN);
    if(url.hostname==='femprobiotics.co'&&url.pathname.startsWith('/cdn/shop/t/9/assets/')) el.attr('data-src','/__theme/'+url.pathname.split('/').pop());
  });
  $('form[action]').each((_,element)=>{
    const form=$(element);const action=form.attr('action')!;
    if (/^\/?contact(?:$|[?#])/.test(action)) form.attr('action',new URL(action,STORE_ORIGIN).href);
  });
  $('link[rel="modulepreload"][href^="/__theme/"]').remove();
  $('link[rel="preload"][href="/__theme/overflow-list.css"]').remove();
  if(fullDocument){
    const seen=new Set<string>();
    $('script[src^="/__theme/"],link[rel="preload"]').each((_,element)=>{
      const node=$(element),key=element.tagName+':'+(node.attr('src')??node.attr('href'));
      if(seen.has(key))node.remove();else seen.add(key);
    });
    $('[data-instant-id]').each((_,element)=>{
      const section=$(element),id=section.attr('data-instant-id');
      if(id==='Kikh7VzmQY85iams')return;
      const eagerCount=id==='9DvYKHtHU4LVuyNi'||id==='UmyA9YaWEvT6UV0u'?0:4;
      section.find('img').not('.instant-video__sizer,[src^="data:"]').slice(eagerCount).attr({loading:'lazy',decoding:'async',fetchpriority:'auto'});
    });
  }
  $('[data-instant-id]').each((_,element)=>{
    const section=$(element),id=section.attr('data-instant-id')!;
    if(/^[A-Za-z0-9]+$/.test(id))section.html(deduplicateIcons(section.html()??'',`fem-icon-${id}`));
  });
  $('meta[name="robots"]').remove();
  if(fullDocument){
    if($('.iyllIvKHIw2ISoa1k').length)$('body').append('<link rel="stylesheet" href="/__theme/fem-product-jabon-gallery.css">');
    $('head').append('<meta name="robots" content="noindex,nofollow"><link rel="stylesheet" href="/__theme/fem-tokens.css"><script type="module" src="/__theme/fem-runtime.js"></script>');
  }
  let result=$.html().replace(/(?:https?:)?\/\/femprobiotics\.co\/cdn\/shop\/t\/9\/assets\/([a-zA-Z0-9_.-]+)(?:\?v=\d+)?/g, '/__theme/$1');
  if(fullDocument && pathname==='/')result=result.replace(/<!--[\s\S]*?-->/g,comment=>/instant/i.test(comment)?'':comment);
  const native=nativeMarkup(result);
  if(!/data-fem-layout="PRODUCT_TEMPLATE"/.test(native))return restoreProductGalleries(native);
  const cartMarkup=load(native,{},fullDocument);
  cartMarkup('[data-fem-layout="PRODUCT_TEMPLATE"]').each((_,node)=>{
    const section=cartMarkup(node);
    section.html(productCartControls(section.html()??''));
    if(section.find('[data-fem-cart-add],[data-fem-action-type="add-to-cart"]').length)return;
    const handle=section.find('form[data-fem-form-product-url]').first().attr('data-fem-form-product-url')?.split('/').pop();
    if(!handle||!/^[-\w]+$/.test(handle))return;
    const control=`<button type="button" class="fem-product-cart-button" data-fem-cart-add data-fem-cart-fallback data-fem-cart-product-handle="${handle}">Agregar al carrito</button>`;
    const accordion=section.find('[data-fem-type="accordion-container"]').first();
    if(accordion.length)accordion.before(control);else section.find('form').first().append(control);
  });
  return presentProbioticos(restoreProductGalleries(cartMarkup.html()));
}
