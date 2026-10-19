import {load} from 'cheerio';
import {renderCollectionCardDetails} from './native-home.ts';

/** Use the native collection card content in the legacy storefront preview. */
export function restoreCollectionCards(html:string):string {
  const fullDocument=/<(?:!doctype|html)\b/i.test(html),$=load(html,{},fullDocument);
  $('[data-fem-layout="COLLECTION_TEMPLATE"] form[data-fem-form-product-url]').each((_,node)=>{
    const card=$(node);
    if(card.find('.fem-collection-product-card__cta').length)return;
    const image=card.children('.iDO0fZ54uk6uke5VL');
    if(!image.length)return;
    const money=(text:string)=>Math.round(Number(text.replace(/[^\d,]/g,'').replace(',','.'))*100);
    const price=money(card.find('[data-fem-dynamic-content-source="PRICE"]').first().text());
    if(!Number.isFinite(price))return;
    const compare=card.find('[data-fem-dynamic-content-source="COMPARE_AT"]').first();
    const compare_at_price=/display\s*:\s*none/i.test(compare.attr('style')??'')?null:money(compare.text());
    const soldOut=card.children('.iMidEZvz2oLuj6AEt');
    const availability=card.attr('data-product-available');
    const available=availability==='true'||(availability!=='false'&&(!soldOut.length||/display\s*:\s*none/i.test(soldOut.attr('style')??'')));
    const details=renderCollectionCardDetails({
      title:card.find('[data-fem-dynamic-content-source="TITLE"]').first().text().trim(),
      url:card.attr('data-fem-form-product-url')??'',available,
      selected_or_first_available_variant:{price,compare_at_price}
    });
    card.addClass('fem-collection-product-card');
    card.children('.ixLXGfiktdwt3LXw9,.iMidEZvz2oLuj6AEt,.iff5HNbQDjlDIevHh').remove();
    card.append(details);
  });
  // Keep the published collection banner in sync with its native Liquid title.
  $('[data-fem-layout="COLLECTION_TEMPLATE"] .iJszcoozRHmwYL55H').each((_,node)=>{
    const title=$(node);
    if(!title.find('em').length&&title.text().trim()==='FEM PROBIOTICS')title.html('<p>FEM <em>PROBIOTICS</em></p>');
  });
  return $.html();
}
