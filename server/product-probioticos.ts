import {load} from 'cheerio';
import {renderProbioticosSummary,renderProbioticosDelivery} from './native-home.ts';

/** Apply the native product presentation to the legacy HTML used by the local preview. */
export function presentProbioticos(html:string):string {
  if(!html.includes('iFziHfOxyaRbyU98Z'))return html;
  const fullDocument=/<(?:!doctype|html)\b/i.test(html);
  const $=load(html,{},fullDocument);
  const section=$('.iFziHfOxyaRbyU98Z'),form=section.find('form[data-fem-form-product-url]').first();
  type Variant={id:number;price:number;compare_at_price?:number|null;options:string[]};
  let variants:Variant[]=[];
  try{variants=JSON.parse(form.find('script[id^="variants__"]').first().text());}catch{return html;}
  const selected=variants.find(v=>String(v.id)===form.attr('data-fem-form-variant-id'))??variants[0];
  if(!selected)return html;
  if(!section.find('.fem-probioticos-price').length)section.find('.idcYjy9VppnFOePFZ').after(renderProbioticosSummary(selected));
  section.find('.iDRuhtPkGFL1tKaw0').replaceWith(renderProbioticosDelivery());
  section.find('.iJjyeqLikBIYPlUO3').append(section.find('.icqUWFhkU7uj7KztV'));
  const money=(price:number)=>'$'+new Intl.NumberFormat('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2}).format(price/100);
  section.find('.ixt8nsHlohLHkgkhW > [data-fem-option-value]').each((_,element)=>{
    const card=$(element),purchase=card.attr('data-fem-option-value')?.trim();
    const variant=variants.find(v=>v.options[0]===purchase&&v.options[1]===selected.options[1]);
    if(!variant)return;
    const price=card.children().last();
    price.attr('data-fem-dynamic-content-source','PRICE');
    if(price.is('p'))price.text(money(variant.price));else price.find('p').text(money(variant.price));
  });
  for(const name of ['iJW7SodsOxFjQkERo','iIAyfdbdfcCYtGKA9','ihkQgTyJYb8ah8zdM','irMgdBwgOrnDPwegE']){
    section.find('.'+name).attr('data-fem-dynamic-content-source','PRICE').find('p').text(money(selected.price));
  }
  if(fullDocument&&!$('link[href="/__theme/fem-product-probioticos-design.css"]').length)$('body').append('<link rel="stylesheet" href="/__theme/fem-product-probioticos-design.css">');
  return $.html();
}
