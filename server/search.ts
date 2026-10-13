import {load} from 'cheerio';
import {STORE_ORIGIN} from '../src/lib/navigation.ts';
import {renderSearchCard,translateStorefront,type ProductImage} from './native-home.ts';

interface SearchProduct {
  title:string;featured_image:string|null;price:number;available?:boolean;images?:string[];
  media?:{preview_image?:{src:string;width:number;height:number}}[];
  variants:{id:number;price:number;compare_at_price:number|null;available?:boolean;featured_image?:{src:string}|null}[];
}

/** The published theme hides its results section; preview it locally without publishing changes. */
export async function restoreSearchResults(html:string,url:URL,headers:HeadersInit={},request:typeof fetch=fetch):Promise<string> {
  if(url.pathname!=='/search')return html;
  const fullDocument=/<(?:!doctype|html)\b/i.test(html);
  const $=load(html,{},fullDocument);
  const form=$('form.search-page-input__parent');
  form.find('input[name="q"]').attr('placeholder',translateStorefront('fem_search.input_placeholder'));
  const heading=$('.search-page__header :is(h1,h2,h3)').first();
  if(heading.length)heading.replaceWith($('<h1 class="fem-search-heading"></h1>').text(heading.text()));
  for(const asset of ['fem-fonts.css','fem-search.css']){
    if(form.length&&!$(`link[href*="${asset}"]`).length)form.closest('.shopify-section').before(`<link rel="stylesheet" href="/__theme/${asset}">`);
  }
  const icon=form.find('span.search__icon');
  if(icon.length)icon.replaceWith($('<button type="submit" aria-label="Buscar"></button>').attr('class','button-unstyled '+icon.attr('class')).append(icon.contents()));
  const query=url.searchParams.get('q')?.trim();
  if(query && !form.find('.search-results__no-results').length && fullDocument && !$('results-list').length){
    const endpoint=new URL(url.pathname+url.search,STORE_ORIGIN);
    endpoint.searchParams.delete('sections');
    endpoint.searchParams.set('section_id','search-results');
    try{
      const response=await request(endpoint,{headers,signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error(`Search section: HTTP ${response.status}`);
      const section=await response.text();
      if(!load(section)('results-list').length)throw new Error('Search section missing');
      form.closest('.shopify-section').after(section);
    }catch{
      form.append($('<p role="alert"></p>').text('No pudimos cargar los resultados. Vuelve a buscar para intentarlo de nuevo.'));
      return $.html();
    }
  }

  $('results-list .main-collection-grid__title').remove();
  for(const asset of ['fem-fonts.css','fem-search-card.css']){
    if(!$(`link[href*="${asset}"]`).length)$('results-list').first().before(`<link rel="stylesheet" href="/__theme/${asset}">`);
  }
  // Use the same Liquid card in Shopify and the preview, preserving result order,
  // selected variants, pagination wrappers and search-tracking URLs.
  const pending=$('results-list product-card').toArray();
  const products=new Map<string,Promise<SearchProduct|null>>();
  async function worker():Promise<void>{
    while(pending.length){
      const card=$(pending.shift()!),content=card.find('.product-card__content'),link=card.find('a.product-card__link').first();
      const title=link.text().trim();
      if(!content.children().length)content.append($('<p class="product-card-title"></p>').text(title));
      const target=new URL(link.attr('href')??'',STORE_ORIGIN);
      if(target.origin!==STORE_ORIGIN || !/^\/products\/[^/]+$/.test(target.pathname))continue;
      const endpoint=target.origin+target.pathname+'.js';
      if(!products.has(endpoint))products.set(endpoint,request(endpoint,{headers,signal:AbortSignal.timeout(10000)}).then(async response=>response.ok?await response.json() as SearchProduct:null).catch(()=>null));
      const product=await products.get(endpoint);
      if(!product)continue;
      const variant=product.variants.find(item=>String(item.id)===target.searchParams.get('variant'))??product.variants.find(item=>item.available)??product.variants[0];
      const image=(src:string):ProductImage=>{
        const absolute=new URL(src,STORE_ORIGIN).href;
        const preview=product.media?.find(item=>item.preview_image && new URL(item.preview_image.src,STORE_ORIGIN).href===absolute)?.preview_image;
        return {src:absolute,alt:product.title,width:preview?.width??640,height:preview?.height??640};
      };
      const featured=variant?.featured_image?.src||product.featured_image;
      card.replaceWith(renderSearchCard({
        url:target.pathname+target.search+target.hash,title:product.title,
        featured_image:featured?image(featured):null,
        images:(product.images??[]).slice(0,2).map(image),
        selected_or_first_available_variant:{price:variant?.price??product.price,compare_at_price:variant?.compare_at_price??null,featured_image:featured?image(featured):null,available:variant?.available??product.available??true}
      }));
    }
  }
  await Promise.all(Array.from({length:Math.min(4,pending.length)},worker));
  return $.html();
}
