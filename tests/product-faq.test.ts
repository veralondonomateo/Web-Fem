import test from 'node:test';
import assert from 'node:assert/strict';
import {load} from 'cheerio';
import {Window} from 'happy-dom';
import {ownedPaths,renderOwnedPage} from '../scripts/render-source.ts';
import {enhanceNativeInteractions} from '../src/components/native-interactions.ts';

test('Every product route has five FAQs after its family section with accessible controls and support links',()=>{
  const paths=ownedPaths().filter(path=>path.startsWith('/products/'));
  assert.ok(paths.length>=20);
  for(const path of paths){
    const $=load(renderOwnedPage(new URL(path,'https://fem.test'))!);
    const faq=$('.fem-product-faq');
    assert.equal(faq.length,1,path);
    assert.equal(faq.find('[data-fem-accordion-item]').length,5,path);
    assert.equal(faq.find('[data-state="open"]').length,1,path);
    const family=$('h2,h3').filter((_,node)=>$(node).text().trim()==='Haz parte de la familia Fem');
    if(family.length)assert.equal(faq.prev().find('h2,h3').filter((_,node)=>$(node).text().trim()==='Haz parte de la familia Fem').length,1,path);
    faq.find('button').each((_,node)=>{
      assert.equal($(node).attr('type'),'button',path+' must not submit the product form');
      const answer=$('#'+$(node).attr('aria-controls'));
      assert.equal(answer.length,1,path);
      assert.equal(answer.attr('aria-labelledby'),$(node).attr('id'),path);
    });
    assert.equal(faq.find('a[href="/pages/contact"]').length,1,path);
    assert.equal(faq.find('a[href="https://wa.me/+573215014154"]').length,1,path);
    assert.equal($('link[href="/__theme/fem-product-faq.css"]').length,1,path);
    if(path==='/products/jabon-intimo-ph-neutro'){
      assert.match(faq.find('[data-fem-accordion-content]').first().text(),/zona externa/);
      assert.doesNotMatch(faq.find('[data-fem-accordion-content]').first().text(),/tabletas|unidades al día/);
    }
  }
  assert.equal(load(renderOwnedPage(new URL('/','https://fem.test'))!)('.fem-product-faq').length,0);
});

test('Product FAQs open, close and collapse the previous answer with the existing storefront interaction',async t=>{
  const $=load(renderOwnedPage(new URL('/products/probiotico-vaginal-en-capsulas-x100-unidades','https://fem.test'))!);
  const win=new Window({url:'https://fem.test',settings:{enableJavaScriptEvaluation:false,disableJavaScriptFileLoading:true,disableCSSFileLoading:true,enableImageFileLoading:false,disableIframePageLoading:true}});
  t.after(()=>win.happyDOM.close());
  for(const key of ['document','HTMLElement','ResizeObserver'] as const){
    const previous=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{value:win[key],configurable:true,writable:true});
    t.after(()=>{if(previous)Object.defineProperty(globalThis,key,previous);else Reflect.deleteProperty(globalThis,key);});
  }
  win.document.body.innerHTML=$('.fem-product-faq').toString();
  const document=win.document as unknown as Document;
  enhanceNativeInteractions(document);
  const triggers=[...document.querySelectorAll<HTMLButtonElement>('[data-fem-accordion-trigger]')];
  const answers=[...document.querySelectorAll<HTMLElement>('[data-fem-accordion-content]')];
  assert.equal(triggers[0].getAttribute('aria-expanded'),'true');
  assert.equal(answers[0].inert,false);
  triggers[1].click();
  assert.equal(triggers[0].getAttribute('aria-expanded'),'false');
  assert.equal(answers[0].inert,true);
  assert.equal(triggers[1].getAttribute('aria-expanded'),'true');
  assert.equal(answers[1].inert,false);
  triggers[1].click();
  assert.equal(triggers[1].getAttribute('aria-expanded'),'false');
  assert.equal(answers[1].inert,true);
  enhanceNativeInteractions(document);
  triggers[4].click();
  assert.equal(triggers[4].getAttribute('aria-expanded'),'true','Reinitializing must not add duplicate click handlers');
  assert.equal(win.document.querySelectorAll('[data-state="open"]').length,1);
});
