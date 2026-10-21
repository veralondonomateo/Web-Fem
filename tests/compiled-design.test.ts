import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {renderOwnedPage} from '../server/owned-renderer.ts';
import {renderOwnedPage as renderSource} from '../scripts/render-source.ts';

const resources=(value:string)=>value.replace(/\/__theme\/[\w.-]+(?:\?[^\s"'<>`)]*)?/g,url=>url.split('?')[0]);
function signature(html:string){
  const $=load(html),main=$('main').clone();
  const text=main.clone();text.find('style,script').remove();
  return {
    text:resources(text.text()).replace(/\s+/g,' ').trim(),
    elements:main.find('*').map((_,node)=>({tag:node.tagName,attrs:Object.fromEntries(Object.entries(node.attribs).map(([key,value])=>[key,resources(value)]))})).get(),
    styles:$('style').map((_,node)=>resources($(node).text())).get(),
  };
}
test('Prepared pages preserve FEM content, layout attributes, images, controls and CSS',()=>{
  for(const path of ['/','/collections','/collections/todos-los-productos','/collections/combo-fem','/products/probiotico-vaginal-en-capsulas-x60-unidades','/products/probiotico-vaginal-en-capsulas-x60-unidades?variant=44093805690968','/pages/contact','/search?q=jabon']){
    const url=new URL(path,'https://fem.test');
    assert.deepEqual(signature(renderOwnedPage(url)!),signature(renderSource(url)!),path);
  }
});
