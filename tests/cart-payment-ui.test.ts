import test from 'node:test';
import assert from 'node:assert/strict';
import {Window, type HTMLInputElement, type HTMLElement, type HTMLAnchorElement} from 'happy-dom';
import {renderNativeSection} from '../server/native-home.ts';
import type {CartState} from '../src/lib/cart.ts';

test('Drawer persists/relocks the reward, handles update failures, and opens for external product buttons',async t=>{
 const window=new Window({url:'http://localhost:3000/',settings:{enableJavaScriptEvaluation:false,disableJavaScriptFileLoading:true,disableCSSFileLoading:true,enableImageFileLoading:false}});
 t.after(()=>window.happyDOM.close());
 for(const key of ['document','location','HTMLElement','Element','HTMLInputElement','HTMLFormElement','HTMLSelectElement','FormData'])Object.defineProperty(globalThis,key,{value:(window as any)[key],configurable:true,writable:true});
 Object.assign(globalThis,{window,matchMedia:()=>({matches:true})});
 const doc=window.document;
 doc.body.innerHTML='<button data-fem-cart-open>Cart</button><a href="https://checkoutfem.com/checkout?product=jabon">Buy soap</a>'+renderNativeSection('cart-drawer',{});
 let state:CartState={items:[{key:'one',variant_id:123,product_id:1,quantity:1,title:'FEM',url:'/products/combo-gomas-jabon',image:'https://store.test/old-product.png',final_line_price:11000000}],item_count:1,total_price:11000000,total_discount:0,currency:'COP',attributes:{}};
 let reject=false;const calls:string[]=[];
 t.mock.method(globalThis,'fetch',async(url: string | URL | Request,init?: RequestInit)=>{
  const path=String(url);calls.push(path);
  if(path.includes('recommendations'))return Response.json({products:[]});
  if(path.includes('/products/jabon.js'))return Response.json({variants:[{id:42,available:true,price:4690000}]});
  if(path.endsWith('/cart/update.js')){
   if(reject)return Response.json({description:'No se guardó'}, {status:422});
   state={...state,attributes:JSON.parse(String(init?.body)).attributes};
  }
  if(path.endsWith('/cart/add.js')){assert.equal(JSON.parse(String(init?.body)).items[0].id,42);return Response.json({items:[]});}
  return Response.json(state);
 });
 const {enhanceCartDrawer}=await import('../src/components/cart-drawer.ts');enhanceCartDrawer();
 const settle=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setTimeout(resolve,0));};
 await settle();
 assert.match(doc.querySelector('[data-item-image]')!.getAttribute('src')??'',/fem-gomas-jab-gallery-1\.webp$/);
 const prepaid=doc.querySelector<HTMLInputElement>('[data-cart-payment][value="prepaid"]')!;
 const cod=doc.querySelector<HTMLInputElement>('[data-cart-payment][value="cod"]')!;
 const reward=doc.querySelector<HTMLElement>('[data-cart-satin]')!;
 assert.equal(reward.dataset.unlocked,'false');
 prepaid.checked=true;prepaid.dispatchEvent(new window.Event('change',{bubbles:true}));
 assert.equal(reward.dataset.unlocked,'true','Reward animates synchronously before network response');
 assert.equal(doc.querySelector('[data-cart-checkout]')!.getAttribute('aria-disabled'),'true');
 await settle();
 assert.equal(reward.dataset.unlocked,'true');assert.equal(state.attributes?.fem_satin_reward,'pending_payment_confirmation');
 doc.dispatchEvent(new window.Event('cart:update'));await settle();assert.equal(prepaid.checked,true);
 cod.checked=true;cod.dispatchEvent(new window.Event('change',{bubbles:true}));await settle();
 assert.equal(reward.dataset.unlocked,'false');assert.equal(state.attributes?.fem_satin_reward,'');
 reject=true;prepaid.checked=true;prepaid.dispatchEvent(new window.Event('change',{bubbles:true}));await settle();
 assert.equal(reward.dataset.unlocked,'false');assert.equal(cod.checked,true);assert.equal(doc.querySelector<HTMLElement>('[data-cart-error]')!.hidden,false);
 const dialog=doc.querySelector('dialog')!;dialog.showModal=()=>{dialog.setAttribute('open','');};
 doc.querySelector<HTMLAnchorElement>('a[href*="checkoutfem"]')!.click();await settle();
 assert.ok(dialog.hasAttribute('open'));assert.ok(calls.includes('/cart/add.js'));
});
