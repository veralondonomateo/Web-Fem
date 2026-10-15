import {readFileSync} from 'node:fs';
import {load} from 'cheerio';

interface StickyFrame {media:string;width:number;height:number;className:string;viewBox:string}
interface ProductCutout {section:string;root:string;media:string;asset:string;width:number;height:number;stickyMedia:string[];stickyFrames:StickyFrame[];stickyPriceClass?:string}
const cutouts:ProductCutout[]=JSON.parse(readFileSync(new URL('./product-cutouts.json',import.meta.url),'utf8'));
interface CutoutVariant {asset:string;width:number;height:number;bytes:number}
const variants:Record<string,{variants:CutoutVariant[]}>=JSON.parse(readFileSync(new URL('./product-cutout-variants.json',import.meta.url),'utf8')).images;

/** Match native Why-section cutouts in the legacy storefront used by local review. */
export function restoreProductCutouts(html:string):string {
  if(!html.includes('data-fem-layout="PRODUCT_TEMPLATE"'))return html;
  const fullDocument=/<(?:!doctype|html)\b/i.test(html),$=load(html,{},fullDocument);
  let applied=false;
  for(const photo of cutouts){
    const section=$(`[data-fem-layout="PRODUCT_TEMPLATE"].${photo.root}`);
    const media=section.find('.'+photo.media);
    if(!media.length)continue;
    const title=section.find('[data-fem-dynamic-content-source="TITLE"]').first().text().trim()||'Producto Fem';
    const image=$('<img>').attr({src:'/__theme/'+photo.asset,alt:title+' — sin fondo',width:String(photo.width),height:String(photo.height),decoding:'async',loading:'lazy','data-fem-preserve-photo':'',class:'fem-view-media fem-view-image fem-view-image__main'});
    const mobile=variants[photo.asset]?.variants??[];
    const picture=$('<picture class="fem-product-cutout-picture"></picture>');
    if(mobile.length)picture.append($('<source>').attr({type:'image/webp',media:'(max-width: 767px)',sizes:'(max-width: 575px) calc(100vw - 40px), 50vw',srcset:mobile.map(variant=>`/__theme/${variant.asset} ${variant.width}w`).join(', ')}));
    picture.append(image);
    media.attr('data-fem-product-cutout','').empty().append(picture);
    if(photo.stickyPriceClass)section.find('.'+photo.stickyPriceClass).attr('data-fem-sticky-prices','');
    for(const className of photo.stickyMedia){
      section.find('.'+className+' img').each((_,node)=>{
        const original=$(node),width=Number(original.attr('width')),height=Number(original.attr('height'));
        const dimensions=photo.stickyFrames.find(frame=>frame.media===className&&frame.width===width&&frame.height===height&&frame.className===original.attr('class'));
        if(!dimensions)return;
        const frame=$('<svg xmlns="http://www.w3.org/2000/svg"><image /></svg>').attr({width:String(width),height:String(height),viewBox:dimensions.viewBox,preserveAspectRatio:'xMidYMid meet',role:'img','aria-label':title,class:original.attr('class')??'fem-view-media',style:`width:100%;height:auto;aspect-ratio:${width}/${height};filter:saturate(.85)`,'data-fem-sticky-product-photo':''});
        frame.find('image').attr({href:'/__theme/'+(mobile[0]?.asset??photo.asset),width:String(photo.width),height:String(photo.height)});
        original.replaceWith(frame);
      });
    }
    applied=true;
  }
  if(fullDocument&&applied&&!$('link[href="/__theme/fem-product-cutouts.css"]').length)$('body').append('<link rel="stylesheet" href="/__theme/fem-product-cutouts.css">');
  return $.html();
}
