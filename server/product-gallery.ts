import {readFileSync} from 'node:fs';
import {load} from 'cheerio';

interface ProductPhoto {asset:string;width:number;height:number;alt?:string}
function photoFor(source:string,photos:Record<string,ProductPhoto>):ProductPhoto|undefined {
  try{
    const url=new URL(source,'https://femprobiotics.co');
    if(!['femprobiotics.co','cdn.shopify.com'].includes(url.hostname))return;
    return photos[url.pathname.split('/').pop()+'?v='+(url.searchParams.get('v')??'')];
  }catch{return;}
}

export function restoreProductGalleries(html:string):string {
  if(!/data-fem-layout="PRODUCT_TEMPLATE"|<media-gallery\b/.test(html))return html;
  const photos:Record<string,ProductPhoto>=JSON.parse(readFileSync(new URL('./product-images.json',import.meta.url),'utf8'));
  const fullDocument=/<(?:!doctype|html)\b/i.test(html);
  const $=load(html,{},fullDocument);
  $('[data-fem-layout="PRODUCT_TEMPLATE"]').each((_,root)=>{
    const section=$(root),title=section.find('[data-fem-dynamic-content-source="TITLE"]').first().text().trim();
    const assignedFile=section.hasClass('iyllIvKHIw2ISoa1k')?'jabon-gallery.json':section.hasClass('iFziHfOxyaRbyU98Z')?'probioticos-gallery.json':undefined;
    const assignedPhotos:ProductPhoto[]=assignedFile?JSON.parse(readFileSync(new URL('./'+assignedFile,import.meta.url),'utf8')):[];
    const views=section.find('[data-fem-type="slider"],[data-fem-type="thumbnails"]');
    views.each((_,node)=>{
      const view=$(node);
      const ownImages=()=>view.find('img').filter((_,image)=>$(image).closest('[data-fem-type="slider"],[data-fem-type="thumbnails"]')[0]===node);
      if(!ownImages().filter('[data-fem-dynamic-content-source="REPEATER"]').length)return;
      if(assignedPhotos.length){
        const track=view.children('.fem-view-slider-wrapper').first();
        const existing=track.children();
        if(existing.length){
          existing.slice(assignedPhotos.length).remove();
          for(let index=existing.length;index<assignedPhotos.length;index++)track.append(existing.last().clone());
          track.children().each((index,slide)=>{
            $(slide).find('[data-fem-overlay-active-slide]').filter((_,button)=>$(button).closest('[data-fem-type="slider"],[data-fem-type="thumbnails"]')[0]===node).attr('data-fem-overlay-active-slide',String(index));
          });
        }
      }
      const images=ownImages();
      const configNode=section.find('script').filter((_,script)=>$(script).attr('id')===`fem-view-slider-${view.attr('id')}-params`).first();
      let config:{breakpoints?:Record<string,{slidesPerView?:number;spaceBetween?:number}>}={};
      try{config=JSON.parse(configNode.text());}catch{/* Keep the rendered gallery if its configuration is absent. */}
      const zoom=!!view.closest('[data-fem-type="overlay"]').length;
      const partners=views.filter((_,partner)=>!$(partner).closest('[data-fem-type="overlay"]').length&&$(partner).attr('data-fem-slider-id')===view.attr('data-fem-slider-id'));
      const unlabeledThumb=partners.length>1&&!partners.filter('[data-fem-type="thumbnails"]').length&&partners[0]===node;
      const thumbnails=!zoom&&(view.attr('data-fem-type')==='thumbnails'||unlabeledThumb||Object.values(config.breakpoints??{}).some(point=>(point.slidesPerView??1)>1));
      if(thumbnails)view.attr('data-fem-type','thumbnails').addClass('fem-view-slider-thumbs');
      view.attr('data-fem-product-gallery',zoom?'zoom':thumbnails?'thumbnails':'main');
      if(thumbnails&&assignedPhotos.length){
        config.breakpoints??={'0':{slidesPerView:assignedPhotos.length,spaceBetween:14}};
        for(const point of Object.values(config.breakpoints??{})){point.spaceBetween=14;point.slidesPerView=assignedPhotos.length;}
        if(configNode.length)configNode.text(JSON.stringify(config));
        else view.before($('<script type="application/json">').attr('id',`fem-view-slider-${view.attr('id')}-params`).text(JSON.stringify(config)));
      }
      images.each((index,image)=>{
        const img=$(image),source=img.attr('src')??'',photo=assignedPhotos.length?assignedPhotos[index]:photoFor(source,photos);
        if(assignedPhotos.length)img.attr('data-fem-repeater-index',String(index));
        if(photo){
          img.attr({src:'/__theme/'+photo.asset,width:String(photo.width),height:String(photo.height)}).removeAttr('srcset').removeAttr('sizes');
          if(photo.alt)img.attr('alt',photo.alt);
        }else if(source.startsWith('//')){
          img.attr('src','https:'+source);
          const srcset=img.attr('srcset');if(srcset)img.attr('srcset',srcset.replace(/(^|,\s*)\/\//g,'$1https://'));
        }
        if(!img.attr('alt'))img.attr('alt',title);
        img.attr({decoding:'async',loading:!zoom&&(thumbnails?index<(assignedPhotos.length||5):index===0)?'eager':'lazy',fetchpriority:!zoom&&!thumbnails&&index===0?'high':'auto'});
      });
    });
  });
  $('media-gallery img').each((_,image)=>{
    const img=$(image),photo=photoFor(img.attr('src')??'',photos);
    if(photo)img.attr({src:'/__theme/'+photo.asset,width:String(photo.width),height:String(photo.height)}).removeAttr('srcset').removeAttr('sizes');
  });
  return $.html();
}
