import {load} from 'cheerio';
import {productPhoto} from '../src/lib/product-photos.ts';

/** Keep legacy preview cards aligned with the photos rendered by native Liquid. */
export function restoreProductCardPhotos(html:string):string {
  const fullDocument=/<(?:!doctype|html)\b/i.test(html),$=load(html,{},fullDocument);
  const blockPhotos=new Map<unknown,string>();
  $('[data-fem-form-product-url]').each((_,node)=>{
    const image=$(node).find('img.fem-view-media').filter((_,image)=>$(image).closest('[data-fem-form-product-url]')[0]===node&&!$(image).parentsUntil(node).filter('[data-fem-type="slider"],[data-fem-type="thumbnails"]').length&&Number($(image).attr('width'))>=150&&Number($(image).attr('height'))>=150).first();
    if(image.attr('src'))blockPhotos.set(node,image.attr('src')!);
  });
  $('img').each((_,node)=>{
    const image=$(node);
    if(image.closest('[data-fem-product-gallery]').length||image.attr('data-fem-dynamic-content-source')==='REPEATER')return;
    const direct=image.closest('a[href*="/products/"]');
    const card=image.closest('[data-fem-form-product-url],.fem-search-card,.fem-carousel__slide,product-card,.resource-card');
    const target=card.attr('data-fem-form-product-url')??direct.attr('href')??card.attr('href')??card.find('a[href*="/products/"]').first().attr('href');
    if(!target)return;
    const secondary=image.attr('data-trigger')==='hover'||image.attr('data-fem-dynamic-content-source')==='IMAGE_AT_INDEX'||/(?:--hover|--secondary)/.test(image.attr('class')??'');
    const photo=productPhoto(target,secondary?1:0);if(!photo)return;
    // Only card photographs change; ratings, payment icons and promotional art retain their assets.
    const source=image.attr('data-fem-dynamic-content-source');
    const nestedProductPhoto=card.attr('data-fem-form-product-url')&&card.attr('data-fem-type')!=='root'&&image.is('.fem-view-media')&&image.attr('src')===blockPhotos.get(card[0]);
    if(!direct.length&&!nestedProductPhoto&&!['FEATURED_IMAGE','IMAGE_AT_INDEX'].includes(source??'')&&!image.is('.fem-search-card__image,.resource-card__image,.fem-media,.product-media__image'))return;
    if(image.closest('[data-fem-type="icon"]').length||/\.svg(?:[?#]|$)/.test(image.attr('src')??''))return;
    image.attr({src:'/__theme/'+photo.asset,width:String(photo.width),height:String(photo.height)}).removeAttr('srcset').removeAttr('sizes');
    if(nestedProductPhoto)image.css('object-fit','contain');
    if(!secondary)image.attr('alt',card.find('[data-fem-dynamic-content-source="TITLE"],h3,.product-card-title').first().text().trim()||image.attr('alt')||'Fem');
  });
  return $.html();
}
