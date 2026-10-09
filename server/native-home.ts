import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Liquid} from 'liquidjs';
import {load,type CheerioAPI} from 'cheerio';

export interface ProductImage {src:string;width:number;height:number;alt:string}
export interface HomeProduct {
  url:string;title:string;vendor:string;featured_image:ProductImage;
  selected_or_first_available_variant:{price:number;compare_at_price:number|null;featured_image:ProductImage};
}
export interface SearchCardProduct {
  url:string;title:string;featured_image:ProductImage|null;images:ProductImage[];
  selected_or_first_available_variant:{price:number;compare_at_price:number|null;featured_image:ProductImage|null;available:boolean};
}
const engine=new Liquid({root:fileURLToPath(new URL('../theme-source/snippets',import.meta.url)),extname:'.liquid'});
for(const tag of ['schema','doc'])engine.registerTag(tag,{
  parse(_token,tokens){this.liquid.parser.parseStream(tokens).on(`tag:end${tag}`,function(){this.stop();}).start();},
  render(){return '';}
});
engine.registerFilter('asset_url',(name:string)=>'/__theme/'+encodeURIComponent(name));
engine.registerFilter('stylesheet_tag',(url:string)=>`<link rel="stylesheet" href="${url}">`);
engine.registerFilter('money',(value:number)=>'$'+new Intl.NumberFormat('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100));
const translations=JSON.parse(readFileSync(new URL('../theme-source/locales/es.json',import.meta.url),'utf8').replace(/^\/\*[\s\S]*?\*\/\s*/,''));
engine.registerFilter('t',(key:string)=>key.split('.').reduce((value,part)=>value?.[part],translations)??key);
engine.registerFilter('image_url',(image:ProductImage,...args:unknown[])=>{
  if(!image?.src)return '';
  const url=new URL(image.src,'https://femprobiotics.co');
  const width=(args.find(arg=>Array.isArray(arg)&&arg[0]==='width') as [string,number]|undefined)?.[1];
  if(width)url.searchParams.set('width',String(width));
  return url.href;
});

export function renderSearchCard(card_product:SearchCardProduct):string {
  return engine.renderFileSync('fem-search-card',{card_product});
}

export function renderScratchCard():string {
  return engine.renderFileSync('fem-scratch-card');
}

export function renderProbioticosSummary(variant:{price:number;compare_at_price?:number|null}):string {
  return engine.renderFileSync('fem-probioticos-price',{variant});
}

export function renderProbioticosDelivery():string {
  return engine.renderFileSync('fem-probioticos-delivery');
}

/** Preview-only adapter. Shopify renders all_products directly in the real theme. */
export function productsFromStorefront(html:string|CheerioAPI):Record<string,HomeProduct> {
  const $=typeof html==='string'?load(html):html;
  const products:Record<string,HomeProduct>={};
  const money=(text:string)=>Math.round(Number(text.replace(/[^\d,]/g,'').replace(',','.'))*100);
  $('[data-instant-type="slider-slide"][data-instant-form-product-url]').each((_,element)=>{
    const card=$(element),url=card.attr('data-instant-form-product-url')!;
    const handle=url.split('/products/')[1]?.split(/[?#]/)[0];
    if(!handle)return;
    const title=card.find('[data-instant-dynamic-content-source="TITLE"]').first().text().trim();
    const price=money(card.find('[data-instant-dynamic-content-source="PRICE"]').first().text());
    if(!title||!price)return;
    const image=card.find('img').first();
    const featured_image={src:image.attr('src')??'',width:Number(image.attr('width'))||1280,height:Number(image.attr('height'))||1280,alt:image.attr('alt')??title};
    const compare=money(card.find('[data-instant-dynamic-content-source="COMPARE_AT"]').first().text());
    products[handle]={url:'/products/'+handle,title,vendor:card.find('[data-instant-dynamic-content-source="VENDOR"]').first().text().trim()||'Fem Probiotics',featured_image,selected_or_first_available_variant:{price,compare_at_price:compare||null,featured_image}};
  });
  return products;
}

export function renderNativeSection(name:'home'|'header'|'footer'|'cart-drawer',products:Record<string,HomeProduct>,pathname='/'):string {
  const source=readFileSync(new URL(`../theme-source/sections/fem-${name}.liquid`,import.meta.url),'utf8');
  const schema=JSON.parse(source.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/)?.[1]??'{}');
  const defaults=Object.fromEntries((schema.settings??[]).filter((setting:{id?:string})=>setting.id).map((setting:{id:string;default?:unknown})=>[setting.id,setting.default??'']));
  const saved=JSON.parse(readFileSync(new URL('../theme-source/config/settings_data.json',import.meta.url),'utf8').replace(/^\/\*[\s\S]*?\*\/\s*/,'')).current?.sections?.[`fem-${name}`]?.settings??{};
  const context={
    product:{handle:pathname.match(/^\/products\/([^/?#]+)/)?.[1]??''},
    section:{id:`fem-${name}`,settings:{...defaults,...saved},location:name==='home'?'template':name,index:1},
    all_products:products,collections:{'todos-los-productos':{url:'/collections/todos-los-productos'}},
    routes:{root_url:'/',collections_url:'/collections',all_products_collection_url:'/collections/all',account_url:'/account',cart_url:'/cart',search_url:'/search'},
    shop:{money_format:'${{amount}}',enabled_payment_types:[]}
  };
  return engine.parseAndRenderSync(source,context,{globals:context});
}
