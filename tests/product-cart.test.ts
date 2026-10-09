import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {load} from 'cheerio';
import {Window} from 'happy-dom';
import {productCartControls} from '../src/lib/product-cart.ts';
import {transformStorefront} from '../server/transform.ts';
import {renderNativeSection} from '../server/native-home.ts';
import type {CartState} from '../src/lib/cart.ts';

test('Every product template uses cart controls and published checkout links are migrated',()=>{
  const pages=JSON.parse(readFileSync('tests/fixtures/navigation.json','utf8')) as {html:string;url:string}[];
  let checked=0;
  for(const page of pages){
    const $=load(transformStorefront(page.html,new URL(page.url).pathname));
    const product=$('[data-fem-layout="PRODUCT_TEMPLATE"]');if(!product.length)continue;
    assert.equal(product.find('a[href*="checkoutfem.com"],a[href*="checkout.treli.co"],a[href^="/cart/"]').length,0,page.url);
    assert.ok(product.find('[data-fem-cart-add],[data-fem-action-type="add-to-cart"]').length,page.url);
    product.find('[data-fem-cart-product-handle]').each((_,control)=>{
      assert.equal(control.tagName,'button');assert.equal($(control).attr('type'),'button');
      assert.equal($(control).attr('aria-label')??$(control).text(),'Agregar al carrito');
    });
    checked++;
  }
  assert.ok(checked>=17);
  for(const name of readdirSync('theme-source/sections').filter(name=>/^fem-product.*\.liquid$/.test(name))){
    const section=readFileSync('theme-source/sections/'+name,'utf8');
    assert.doesNotMatch(section,/href="https:\/\/checkoutfem\.com/,name);
    assert.match(section,/data-fem-cart-add|data-fem-action-type="add-to-cart"|render 'fem-product-cart-button'/,name);
  }
  const original='<a class="buy" href="https://checkoutfem.com/checkout?product=combo-dia-de-la-mujer}"><span>Comprar</span></a>';
  const migrated=productCartControls(original);
  assert.match(migrated,/data-fem-cart-product-handle="combo-dia-de-la-mujer"/);
  assert.equal(productCartControls(migrated),migrated);
});

test('Product CTA adds the selected variant, quantity and plan, then shows the cart on the same page',async t=>{
  const window=new Window({url:'http://localhost:3000/products/jabon',settings:{enableJavaScriptEvaluation:false,disableJavaScriptFileLoading:true,disableCSSFileLoading:true,enableImageFileLoading:false}});
  t.after(()=>window.happyDOM.close());
  for(const key of ['document','location','HTMLElement','Element','HTMLInputElement','HTMLFormElement','HTMLSelectElement','FormData'])Object.defineProperty(globalThis,key,{value:(window as any)[key],configurable:true,writable:true});
  Object.assign(globalThis,{window,matchMedia:()=>({matches:true})});
  const doc=window.document;
  doc.body.innerHTML='<form data-fem-form-product-url="/products/jabon" data-fem-form-variant-id="999"><input name="id" value="999"></form><form data-fem-form-product-url="/products/jabon" data-fem-form-variant-id="123"><input name="id" value="123"><input name="quantity" value="2"><input name="selling_plan" value="45"><input name="properties[Nombre]" value="Ana">'+productCartControls('<a href="https://checkoutfem.com/checkout?product=jabon&amp;variant=42">Añadir</a>')+'</form>'+renderNativeSection('cart-drawer',{});
  const dialog=doc.querySelector('dialog')!;dialog.showModal=()=>dialog.setAttribute('open','');
  let state:CartState={items:[],item_count:0,total_price:0,total_discount:0,currency:'COP'};
  const additions:unknown[]=[];
  t.mock.method(globalThis,'fetch',async(url:string|URL|Request,init?:RequestInit)=>{
    const path=String(url);
    if(path.includes('recommendations'))return Response.json({products:[]});
    if(path.endsWith('/cart/add.js')){
      const item=JSON.parse(String(init?.body)).items[0];additions.push(item);
      state={...state,items:[{key:'soap',variant_id:item.id,product_id:1,quantity:item.quantity,title:'Jabón íntimo',url:'/products/jabon',final_line_price:9380000}],item_count:2,total_price:9380000};
      return Response.json({items:state.items});
    }
    assert.equal(path,'/cart.js');return Response.json(state);
  });
  const {enhanceCartDrawer}=await import('../src/components/cart-drawer.ts');enhanceCartDrawer();
  // Click during the initial cart read as well as when the drawer is already ready.
  (doc.querySelector('[data-fem-cart-add]') as any).click();
  for(let i=0;i<20;i++)await new Promise(resolve=>setTimeout(resolve,0));
  assert.deepEqual(additions,[{id:123,quantity:2,selling_plan:45,properties:{Nombre:'Ana'}}]);
  assert.ok(dialog.hasAttribute('open'));assert.match(doc.querySelector('[data-cart-items]')!.textContent,/Jabón íntimo/);
  assert.equal(window.location.pathname,'/products/jabon');
  assert.equal(doc.querySelector('[data-cart-error]')!.hasAttribute('hidden'),true);
});
