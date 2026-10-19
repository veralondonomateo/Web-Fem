import type {CheerioAPI} from 'cheerio';
import {Text} from 'domhandler';
import {append} from 'domutils';

/** Match the native product accordion typography in the legacy local preview. */
export function accentProductAccordionTitles($:CheerioAPI):void {
  $('[data-fem-layout="PRODUCT_TEMPLATE"] [data-fem-type="accordion-header"] [data-fem-type="text"]').each((_,element)=>{
    const label=$(element);
    if(label.find('.fem-product-accordion__accent').length)return;
    const text=label.find('*').addBack().contents().toArray()
      .filter((node):node is Text=>node.type==='text'&&/\S/.test(node.data)).at(-1);
    const match=text?.data.match(/^(.*?)(\S+)(\s*)$/s);
    if(!text||!match)return;
    const accent=$('<em class="fem-product-accordion__accent"></em>').text(match[2]);
    text.data=match[1];
    append(text,accent[0]);
    if(match[3])append(accent[0],new Text(match[3]));
  });
}
