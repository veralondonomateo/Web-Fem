import test from 'node:test';
import assert from 'node:assert/strict';
import {Window,type HTMLElement} from 'happy-dom';
import {renderNativeSection} from '../server/native-home.ts';
import {enhanceNativeInteractions} from '../src/components/native-interactions.ts';

function environment(){
  const window=new Window({url:'https://fem.test/',settings:{enableJavaScriptEvaluation:false,disableJavaScriptFileLoading:true,disableCSSFileLoading:true,enableImageFileLoading:false,disableIframePageLoading:true}});
  window.happyDOM.setViewport({width:390,height:844});
  for(const key of ['document','HTMLElement','Element','ResizeObserver'])Object.defineProperty(globalThis,key,{value:(window as any)[key],configurable:true,writable:true});
  Object.assign(globalThis,{window,scrollY:0,matchMedia:window.matchMedia.bind(window)});
  window.document.body.innerHTML=renderNativeSection('header',{});
  enhanceNativeInteractions(window.document as unknown as Document);
  return window;
}

test('Mobile categories toggle exclusively, expose product links and close with Escape',t=>{
  const window=environment(),document=window.document;
  t.after(()=>window.happyDOM.close());
  const opener=document.querySelector<HTMLElement>('[data-fem-toggle="fem-mobile-menu"]')!;
  const panel=document.getElementById('fem-mobile-menu')! as HTMLElement;
  const triggers=[...panel.querySelectorAll<HTMLElement>('[data-fem-accordion-trigger]')];
  const contents=triggers.map(trigger=>document.getElementById(trigger.getAttribute('aria-controls')!)! as HTMLElement);
  opener.click();
  assert.equal(opener.getAttribute('aria-expanded'),'true');
  assert.equal(document.documentElement.style.overflow,'hidden');
  for(let index=0;index<triggers.length;index++){
    triggers[index].click();
    assert.deepEqual(triggers.map(trigger=>trigger.getAttribute('aria-expanded')),triggers.map((_,other)=>String(index===other)));
    assert.deepEqual(contents.map(content=>content.inert),contents.map((_,other)=>index!==other));
    assert.equal(contents[index].querySelectorAll('a[href]').length,[5,2,5][index]);
  }
  assert.equal(contents[2].querySelector('a')?.getAttribute('href'),'/products/duo-perfecto');
  triggers[2].click();
  assert.ok(contents.every(content=>content.inert));
  document.dispatchEvent(new window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
  assert.equal(opener.getAttribute('aria-expanded'),'false');
  assert.equal(panel.inert,true);
  assert.equal(document.documentElement.style.overflow,'');
  assert.equal(document.activeElement,opener);
});

test('Switching to desktop closes the mobile menu and restores page scrolling',t=>{
  const window=environment(),document=window.document;
  t.after(()=>window.happyDOM.close());
  const opener=document.querySelector<HTMLElement>('[data-fem-toggle="fem-mobile-menu"]')!;
  opener.click();
  // Happy DOM initializes media-query change tracking on its first resize.
  window.happyDOM.setViewport({width:400,height:844});
  window.happyDOM.setViewport({width:1280,height:844});
  assert.equal(opener.getAttribute('aria-expanded'),'false');
  assert.equal((document.getElementById('fem-mobile-menu')! as HTMLElement).inert,true);
  assert.equal(document.documentElement.style.overflow,'');
});
