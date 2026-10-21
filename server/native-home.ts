import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Liquid,defaultOperators,type Context} from 'liquidjs';
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
interface SectionDefinition {
  type:string;settings:Record<string,unknown>;
  blocks?:Record<string,{type:string;settings:Record<string,unknown>}>;
  block_order?:string[];
}
const engine=new Liquid({root:fileURLToPath(new URL('../theme-source/snippets',import.meta.url)),extname:'.liquid',operators:{...defaultOperators,
  '==':(left:unknown,right:unknown,context:Context)=>defaultOperators['=='](left??null,right??null,context),
  '!=':(left:unknown,right:unknown,context:Context)=>defaultOperators['!='](left??null,right??null,context)
}});
for(const tag of ['schema','doc'])engine.registerTag(tag,{
  parse(_token,tokens){this.liquid.parser.parseStream(tokens).on(`tag:end${tag}`,function(){this.stop();}).start();},
  render(){return '';}
});
engine.registerFilter('asset_url',(name:string)=>'/__theme/'+encodeURIComponent(name));
engine.registerFilter('stylesheet_tag',(url:string)=>`<link rel="stylesheet" href="${url}">`);
engine.registerFilter('money',(value:number)=>'$'+new Intl.NumberFormat('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100));
const translations=JSON.parse(readFileSync(new URL('../theme-source/locales/es.json',import.meta.url),'utf8').replace(/^\/\*[\s\S]*?\*\/\s*/,''));
export function translateStorefront(key:string):string {
  return key.split('.').reduce((value,part)=>value?.[part],translations)??key;
}
engine.registerFilter('t',translateStorefront);
engine.registerFilter('json',(value:unknown)=>JSON.stringify(value));
engine.registerFilter('url_param_escape',(value:string)=>encodeURIComponent(value));
engine.registerFilter('image_url',(image:ProductImage,...args:unknown[])=>{
  if(!image?.src)return '';
  const url=new URL(image.src,'https://femprobiotics.co');
  const width=(args.find(arg=>Array.isArray(arg)&&arg[0]==='width') as [string,number]|undefined)?.[1];
  if(width)url.searchParams.set('width',String(width));
  return image.src.startsWith('/')&&!image.src.startsWith('//')?url.pathname+url.search:url.href;
});

export function renderSearchCard(card_product:SearchCardProduct):string {
  return engine.renderFileSync('fem-search-card',{card_product});
}

/** Render an existing product design using a FEM-owned catalog object. */
export function renderOwnedProductSection(name:string,product:Record<string,unknown>,all_products:Record<string,unknown>,id:string):string {
  if(!/^fem-product-[a-z-]+$/.test(name))throw Error('Invalid product template');
  let source=readFileSync(new URL(`../theme-source/sections/${name}.liquid`,import.meta.url),'utf8');
  const schema=JSON.parse(source.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/)?.[1]??'{}');
  const settings=Object.fromEntries((schema.settings??[]).filter((s:{id?:string})=>s.id).map((s:{id:string;default?:unknown})=>[s.id,s.default??'']));
  source=source.replace(/{%-?\s*style\s*-?%}/g,'<style>').replace(/{%-?\s*endstyle\s*-?%}/g,'</style>');
  const context={product,all_products,section:{id,settings,blocks:[],location:'template',index:1},shop:{money_format:'${{amount}}',enabled_payment_types:[]},routes:{root_url:'/',cart_url:'/cart',search_url:'/search'},request:{page_type:'product'}};
  return engine.parseAndRenderSync(source,context,{globals:context});
}

export function renderScratchCard():string {
  return engine.renderFileSync('fem-scratch-card');
}

export function renderRefundPolicy(policy:{title:string;body:string}):string {
  return engine.renderFileSync('fem-refund-policy',{policy,routes:{root_url:'/'}});
}

export function renderCatalogFilters():string {
  return engine.renderFileSync('fem-catalog-filters');
}

export function renderCollectionCardDetails(card_product:{url:string;title:string;available:boolean;selected_or_first_available_variant:{price:number;compare_at_price:number|null;selected_selling_plan_allocation?:{price:number;compare_at_price:number|null}}}):string {
  return engine.renderFileSync('fem-collection-card-details',{card_product});
}

/** Render the same editable sections used by Shopify, without reading legacy page markup. */
function renderPageTemplate(name:string,embedded=false):string {
  const template=JSON.parse(readFileSync(new URL(`../theme-source/templates/${name}.json`,import.meta.url),'utf8')) as {sections:Record<string,SectionDefinition>;order:string[]};
  return (embedded?['main']:template.order).map(id=>{
    const definition=template.sections[id];
    const source=readFileSync(new URL(`../theme-source/sections/${definition.type}.liquid`,import.meta.url),'utf8');
    const schema=JSON.parse(source.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/)?.[1]??'{}');
    const defaults=Object.fromEntries((schema.settings??[]).filter((setting:{id?:string})=>setting.id).map((setting:{id:string;default?:unknown})=>[setting.id,setting.default??'']));
    const blocks=(definition.block_order??[]).map(blockId=>{
      const block=definition.blocks![blockId],settings={...block.settings};
      // Shopify resolves collection-picker settings to Collection objects automatically.
      if(typeof settings.collection==='string'&&settings.collection)settings.collection={url:'/collections/'+settings.collection,title:settings.title};
      return {id:blockId,type:block.type,settings,shopify_attributes:''};
    });
    const settings={...defaults,...definition.settings,...(embedded?{embedded:true,heading:'Explora nuestras colecciones',description:''}:{})};
    const context={section:{id:`${name==='list-collections'?'collections':'plans'}-${id}`,settings,blocks},routes:{root_url:'/',all_products_collection_url:'/collections/all'}};
    return engine.parseAndRenderSync(source,context,{globals:context});
  }).join('\n');
}

export function renderCollectionsPage(embedded=false):string {
  return renderPageTemplate('list-collections',embedded);
}

export function renderPlansPage():string {
  return renderPageTemplate('page.planes-fem');
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
    if(!title||!Number.isFinite(price)||price<=0)return;
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
  const homeTemplate=name==='home'?JSON.parse(readFileSync(new URL('../theme-source/templates/index.json',import.meta.url),'utf8')) as {sections:Record<string,SectionDefinition>}:null;
  const homeDefinition=homeTemplate?Object.values(homeTemplate.sections).find(definition=>definition.type==='fem-home'):undefined;
  const blocks=(homeDefinition?.block_order??[]).flatMap(id=>{
    const block=homeDefinition?.blocks?.[id];
    return block?[{id,...block,shopify_attributes:''}]:[];
  });
  const context={
    product:{handle:pathname.match(/^\/products\/([^/?#]+)/)?.[1]??''},
    section:{id:`fem-${name}`,settings:{...defaults,...homeDefinition?.settings,...saved},blocks,location:name==='home'?'template':name,index:1},
    all_products:products,collections:{'todos-los-productos':{url:'/collections/todos-los-productos'}},
    routes:{root_url:'/',collections_url:'/collections',all_products_collection_url:'/collections/all',account_url:'/account',cart_url:'/cart',search_url:'/search'},
    shop:{money_format:'${{amount}}',enabled_payment_types:[]}
  };
  return engine.parseAndRenderSync(source,context,{globals:context});
}
