import {load} from 'cheerio';
import {renderCatalogFilters} from './native-home.ts';

/** Add the shared native controls and card metadata to legacy preview collections. */
export function restoreCatalogFilters(html:string):string {
  const fullDocument=/<(?:!doctype|html)\b/i.test(html),$=load(html,{},fullDocument);
  $('[data-fem-layout="COLLECTION_TEMPLATE"],results-list:has(.fem-search-card)').each((_,node)=>{
    const scope=$(node).attr('data-fem-catalog','');
    const cards=scope.is('results-list')?scope.find('.fem-search-card'):scope.find('form[data-fem-form-product-url]');
    if(!cards.length)return;
    if(!scope.is('results-list'))cards.first().parent().parent().attr('data-fem-catalog-list','');
    cards.each((_,element)=>{
      const card=$(element),url=card.attr('href')??card.attr('data-fem-form-product-url')??'';
      card.attr('data-fem-catalog-item','');
      if(!card.attr('data-product-title'))card.attr('data-product-title',card.find('[data-fem-dynamic-content-source="TITLE"],.fem-search-card__title').first().text().trim());
      if(!card.attr('data-product-handle'))card.attr('data-product-handle',url.split('/products/')[1]?.split(/[?#]/)[0]??'');
      card.attr('data-product-url',url);
      if(!card.attr('data-product-price')){
        const text=card.find('[data-fem-dynamic-content-source="PRICE"],.fem-search-card__price').first().text();
        const cents=Math.round(Number(text.replace(/[^\d,]/g,'').replace(',','.'))*100);
        if(Number.isFinite(cents))card.attr('data-product-price',String(cents));
      }
    });
    if(!scope.find('[data-fem-catalog-filters]').length){
      if(scope.is('results-list'))scope.prepend(renderCatalogFilters());
      else cards.first().parent().before(renderCatalogFilters());
    }
  });
  return $.html();
}
