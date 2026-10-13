import {paymentPreference,paymentAttributes,satinRewardUnlocked,type PaymentPreference} from '../lib/cart-payment.ts';
import {CartClient,addItemFromFields,cartMoney,shippingProgress,visibleCartItems,visibleCartCount,type CartState,type CartProduct,type AddItem} from '../lib/cart.ts';
import {productPhotoUrl} from '../lib/product-photos.ts';

let initialized=false;
export function enhanceCartDrawer():void {
  const candidate=document.querySelector<HTMLDialogElement>('#fem-cart-drawer');
  if(!candidate||initialized)return;
  const dialog:HTMLDialogElement=candidate;
  initialized=true;
  const find=<T extends HTMLElement=HTMLElement>(selector:string)=>dialog.querySelector<T>(selector)!;
  const config=JSON.parse(find('[data-cart-config]').textContent??'{}') as {root:string;threshold:number;endsAt:string;labels:Record<string,string>};
  const api=new CartClient(config.root||'/');
  let cart:CartState|undefined,busy=false,returnFocus:HTMLElement|null=null,overflow='',suggestedFor=0,closing:ReturnType<typeof setTimeout>|undefined;
  let recommendations:CartProduct[]=[];
  const status=find('[data-cart-status]'),error=find('[data-cart-error]');
  const money=(value:number)=>cartMoney(value,cart?.currency||'COP');
  const checkout=find<HTMLAnchorElement>('[data-cart-checkout]');
  const secureText=find('[data-cart-promo]').textContent;
  const fail=(reason:unknown)=>{error.hidden=false;error.querySelector('span')!.textContent=reason instanceof Error?reason.message:'No pudimos actualizar tu carrito. Inténtalo de nuevo.';};
  const lock=(value:boolean)=>{
    busy=value;dialog.setAttribute('aria-busy',String(value));
    dialog.querySelectorAll<HTMLButtonElement|HTMLInputElement>('[data-cart-items] button,[data-cart-items] input,[data-cart-recommendations] button,[data-cart-payment]').forEach(control=>control.disabled=value);
    checkout.setAttribute('aria-disabled',String(value));
    status.textContent=value?config.labels.updating:'';
  };
  const show=()=>{
    if(closing){clearTimeout(closing);closing=undefined;}
    delete dialog.dataset.closing;
    if(!dialog.open){returnFocus=document.activeElement as HTMLElement;overflow=document.documentElement.style.overflow;document.documentElement.style.overflow='hidden';dialog.showModal();}
    document.querySelectorAll('[data-fem-cart-open]').forEach(button=>button.setAttribute('aria-expanded','true'));
    startCountdown();
  };
  const close=()=>{
    if(closing)return;
    dialog.dataset.closing='true';
    closing=setTimeout(()=>{dialog.close();delete dialog.dataset.closing;closing=undefined;},matchMedia('(prefers-reduced-motion: reduce)').matches?0:200);
  };
  dialog.addEventListener('close',()=>{document.documentElement.style.overflow=overflow;returnFocus?.focus();document.querySelectorAll('[data-fem-cart-open]').forEach(button=>button.setAttribute('aria-expanded','false'));});
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('click',event=>{if(event.target===dialog)close();});
  find('[data-cart-close]').addEventListener('click',close);
  function renderRecommendations():void {
    const list=find('[data-cart-recommendations]');list.replaceChildren();
    for(const product of recommendations){
      const variant=product.variants.find(variant=>variant.available);if(!variant)continue;
      const row=find<HTMLTemplateElement>('[data-cart-recommendation-template]').content.firstElementChild!.cloneNode(true) as HTMLElement;
      row.querySelectorAll<HTMLAnchorElement>('[data-product-url]').forEach(link=>link.href=product.url||`${config.root}products/${product.handle}`);
      row.querySelector('[data-product-title]')!.textContent=product.title;
      row.querySelector('[data-product-price]')!.textContent=money(variant.price);
      const image=row.querySelector<HTMLImageElement>('[data-product-image]')!;image.src=productPhotoUrl(product.handle,import.meta.url)||product.featured_image||product.images?.[0]||'';image.alt=product.title;
      const button=row.querySelector<HTMLButtonElement>('[data-cart-recommendation-add]')!;button.dataset.variantId=String(variant.id);button.setAttribute('aria-label',`${button.getAttribute('aria-label')}: ${product.title}`);button.disabled=busy;
      list.append(row);
    }
    find('[data-cart-suggestions]').hidden=!list.children.length||!cart?.item_count;
  }
  async function refreshRecommendations(productId:number):Promise<void>{
    if(productId===suggestedFor)return;
    suggestedFor=productId;
    try{const products=await api.recommendations(productId);if(productId===suggestedFor){recommendations=products;renderRecommendations();}}
    catch{if(productId===suggestedFor){suggestedFor=0;recommendations=[];renderRecommendations();}}
  }
  function renderPayment(state:CartState):void {
    const preference=paymentPreference(state),unlocked=satinRewardUnlocked(state);
    find('[data-cart-payment-section]').hidden=state.item_count===0;
    dialog.querySelectorAll<HTMLInputElement>('[data-cart-payment]').forEach(input=>input.checked=input.value===preference);
    const reward=find('[data-cart-satin]');reward.dataset.unlocked=String(unlocked);
    find('[data-cart-satin-state]').textContent=unlocked?config.labels.rewardUnlocked:config.labels.rewardLocked;
    find('[data-cart-satin-badge]').textContent=unlocked?config.labels.rewardFree:config.labels.rewardExclusive;
    find('[data-cart-payment-note]').textContent=unlocked?config.labels.prepaidNote:config.labels.codNote;
    checkout.textContent=unlocked?config.labels.prepaidCta:config.labels.codCta;
  }
  function render(state:CartState):void {
    cart=state;
    renderPayment(state);
    const items=visibleCartItems(state),count=visibleCartCount(state);
    const focused=document.activeElement as HTMLElement|null;
    const focusKey=focused?.closest<HTMLElement>('[data-item-key]')?.dataset.itemKey;
    const focusAction=focused?.matches('[data-cart-plus]')?'[data-cart-plus]':focused?.matches('[data-cart-minus]')?'[data-cart-minus]':focused?.matches('[data-cart-quantity]')?'[data-cart-quantity]':null;
    document.querySelectorAll<HTMLElement>('[data-fem-cart-count]').forEach(node=>{
      node.textContent=String(count);
      if(node.hasAttribute('data-hide-empty'))node.hidden=count===0;
      if(node.hasAttribute('data-fem-dynamic-content-source'))node.style.display=count?'':'none';
    });
    find('[data-cart-count-label]').hidden=count===0;
    find('[data-cart-empty]').hidden=state.item_count>0;
    find('[data-cart-footer]').hidden=state.item_count===0;
    find('[data-cart-total]').textContent=money(state.total_price);
    const saved=find('[data-cart-savings]');saved.hidden=!state.total_discount;saved.textContent=`${config.labels.saving} ${money(state.total_discount||0)}`;
    const percentage=shippingProgress(state,config.threshold),eligible=percentage===100;
    find('[data-cart-shipping]').hidden=!state.item_count||percentage===null;
    find('[data-cart-shipping-message]').textContent=eligible?config.labels.shippingReached:config.labels.shippingRemaining.replace('{amount}',money(Math.max(0,config.threshold-state.total_price)));
    find('[data-cart-progress]').style.width=`${percentage??0}%`;
    find('[role="progressbar"]').setAttribute('aria-valuenow',String(percentage??0));
    const gifts=dialog.querySelector<HTMLElement>('[data-cart-gifts]');if(gifts)gifts.hidden=!eligible||!count;
    const list=find('[data-cart-items]');list.replaceChildren();
    for(const item of items){
      const row=find<HTMLTemplateElement>('[data-cart-item-template]').content.firstElementChild!.cloneNode(true) as HTMLElement;row.dataset.itemKey=item.key;
      row.querySelectorAll<HTMLAnchorElement>('[data-item-url]').forEach(link=>link.href=item.url);
      row.querySelector('[data-item-title]')!.textContent=item.product_title||item.title;
      const image=row.querySelector<HTMLImageElement>('[data-item-image]')!,src=productPhotoUrl(item.url,import.meta.url)||item.featured_image?.url||item.image;if(src)image.src=src;else image.hidden=true;image.alt=item.product_title||item.title;
      const variant=row.querySelector<HTMLElement>('[data-item-variant]')!;
      variant.textContent=[item.variant_title==='Default Title'?'':item.variant_title,item.selling_plan_allocation?.selling_plan.name,...Object.entries(item.properties??{}).filter(([name,value])=>!name.startsWith('_')&&value).map(([name,value])=>`${name}: ${String(value)}`)].filter(Boolean).join(' · ');variant.hidden=!variant.textContent;
      row.querySelector('[data-item-price]')!.textContent=money(item.final_line_price);
      const original=row.querySelector<HTMLElement>('[data-item-original]')!;original.hidden=!(item.original_line_price&&item.original_line_price>item.final_line_price);original.textContent=money(item.original_line_price||0);
      row.querySelector<HTMLInputElement>('[data-cart-quantity]')!.value=String(item.quantity);
      list.append(row);
    }
    if(focusKey&&focusAction){const row=[...list.children].find(row=>(row as HTMLElement).dataset.itemKey===focusKey);(row?.querySelector(focusAction) as HTMLElement|null)?.focus();}
    if(items[0]&&dialog.open)void refreshRecommendations(items[0].product_id);
    if(!state.item_count){suggestedFor=0;recommendations=[];}
    renderRecommendations();
  }
  let refreshing:Promise<void>|undefined;
  function refresh():Promise<void>{
    if(refreshing)return refreshing;
    if(busy)return Promise.resolve();error.hidden=true;lock(true);
    refreshing=api.read().then(render).catch(fail).finally(()=>{lock(false);refreshing=undefined;});
    return refreshing;
  }
  async function mutate(action:()=>Promise<CartState>):Promise<void>{
    if(busy)return;
    const active=document.activeElement as HTMLElement|null;
    const key=active?.closest<HTMLElement>('[data-item-key]')?.dataset.itemKey;
    const actionName=['data-cart-plus','data-cart-minus','data-cart-quantity','data-cart-remove'].find(name=>active?.hasAttribute(name));
    error.hidden=true;lock(true);
    try{render(await action());}catch(reason){fail(reason);await api.read().then(render).catch(()=>undefined);}finally{
      lock(false);
      if(dialog.open&&key&&actionName){
        const row=[...find('[data-cart-items]').children].find(row=>(row as HTMLElement).dataset.itemKey===key);
        ((row?.querySelector(`[${actionName}]`) as HTMLElement|null)??find('[data-cart-close]')).focus();
      }
    }
  }
  async function add(item:AddItem):Promise<void>{show();await refreshing;await mutate(()=>api.add(item));}
  find('[data-cart-retry]').addEventListener('click',()=>void refresh());
  dialog.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;
    const recommendation=target?.closest<HTMLElement>('[data-cart-recommendation-add]');
    if(recommendation){void add({id:Number(recommendation.dataset.variantId),quantity:1});return;}
    const control=target?.closest('[data-cart-plus],[data-cart-minus],[data-cart-remove]');if(!control||!cart||busy)return;
    const key=control.closest<HTMLElement>('[data-item-key]')!.dataset.itemKey!;
    const item=cart.items.find(item=>item.key===key);if(!item)return;
    const quantity=control.hasAttribute('data-cart-remove')?0:item.quantity+(control.hasAttribute('data-cart-plus')?1:-1);
    void mutate(()=>api.change(key,quantity));
  });
  checkout.addEventListener('click',event=>{
    if(busy||!cart?.item_count)event.preventDefault();
  });
  dialog.addEventListener('change',event=>{
    if(event.target instanceof HTMLInputElement && event.target.matches('[data-cart-payment]')){
      if(busy||!cart)return;
      const choice=event.target.value as PaymentPreference;
      if(choice!=='cod'&&choice!=='prepaid')return;
      // Animate immediately; checkout stays locked until Shopify confirms the save.
      const confirmed=cart;
      renderPayment({...confirmed,attributes:{...confirmed.attributes,...paymentAttributes(choice)}});
      void mutate(async()=>{
        try{return await api.updateAttributes(paymentAttributes(choice));}
        catch(reason){renderPayment(confirmed);throw reason;}
      });
      return;
    }
    if(!(event.target instanceof HTMLInputElement)||!event.target.matches('[data-cart-quantity]')||busy)return;
    const quantity=Number(event.target.value),key=event.target.closest<HTMLElement>('[data-item-key]')!.dataset.itemKey!;
    if(!Number.isInteger(quantity)||quantity<0||quantity>999){if(cart)render(cart);return;}
    void mutate(()=>api.change(key,quantity));
  });
  const itemFrom=(control:HTMLElement):AddItem=>{
    const scope=control.closest<HTMLElement>('form,[data-fem-form-variant-id]');
    const fields=scope instanceof HTMLFormElement?new FormData(scope):new FormData();
    const id=Number(fields.get('id')||scope?.dataset.femFormVariantId||control.dataset.femActionVariantId||control.dataset.variantId);
    const quantity=Number(fields.get('quantity')||scope?.querySelector<HTMLInputElement>('input[name="quantity"]')?.value||1);
    return addItemFromFields(id,quantity,fields.entries());
  };
  const productForm=(handle:string,control:HTMLElement)=>{
    const forms=[...document.querySelectorAll<HTMLElement>('form[data-fem-form-product-url]')].filter(form=>new URL(form.dataset.femFormProductUrl!,location.href).pathname===`/products/${handle}`);
    const section=control.closest('[data-fem-layout="PRODUCT_TEMPLATE"]');
    const local=forms.filter(form=>section?.contains(form));
    const candidates=local.length?local:forms;
    return candidates.find(form=>form.dataset.femType==='root')??candidates[0];
  };
  async function addProduct(control:HTMLElement,handle:string,explicit?:string|null):Promise<void>{
    if(busy&&!refreshing||control.matches('[disabled],[aria-disabled="true"],[data-fem-disabled="true"]'))return;
    const own=control.closest<HTMLElement>('form[data-fem-form-product-url]');
    const form=own&&new URL(own.dataset.femFormProductUrl!,location.href).pathname===`/products/${handle}`?own:productForm(handle,control);
    if(form?.getAttribute('aria-busy')==='true')return;
    if(form){try{await add(itemFrom(form));}catch(reason){show();fail(reason);}return;}
    show();await refreshing;
    if(busy)return;
    error.hidden=true;lock(true);
    try{
      const product=await api.json<CartProduct>(`products/${encodeURIComponent(handle)}.js`);
      const variant=explicit?product.variants.find(v=>String(v.id)===explicit):product.variants.find(v=>v.available);
      if(!variant?.available)throw new Error('Esta opción no está disponible. Revisa el producto.');
      render(await api.add({id:variant.id,quantity:1}));
    }catch(reason){fail(reason);}finally{lock(false);}
  }
  window.addEventListener('click',event=>{
    const target=event.target instanceof Element?event.target:null;
    const opener=target?.closest<HTMLElement>('[data-fem-cart-open],[data-fem-action-type="open-cart"]');
    if(opener){event.preventDefault();event.stopImmediatePropagation();show();void refresh();return;}
    const external=target?.closest<HTMLAnchorElement>('a[href]');
    const destination=external?new URL(external.href,location.href):null;
    if(destination?.hostname==='checkoutfem.com' && destination.pathname==='/checkout' && destination.searchParams.get('product')){
      event.preventDefault();event.stopImmediatePropagation();
      void addProduct(external!,destination.searchParams.get('product')!,destination.searchParams.get('variant'));
      return;
    }
    const control=target?.closest<HTMLElement>('[data-fem-cart-add],[data-fem-action-type="add-to-cart"]');if(!control)return;
    event.preventDefault();event.stopImmediatePropagation();if(busy&&!refreshing||control.matches('[disabled],[aria-disabled="true"],[data-fem-disabled="true"]')||control.closest('form[aria-busy="true"]'))return;
    if(control.dataset.femCartProductHandle){void addProduct(control,control.dataset.femCartProductHandle,control.dataset.variantId);return;}
    try{void add(itemFrom(control));}catch(reason){show();fail(reason);}
  },true);
  window.addEventListener('submit',event=>{
    const form=event.target;if(!(form instanceof HTMLFormElement)||!new URL(form.action,location.href).pathname.match(/\/cart\/add(?:\.js)?$/))return;
    event.preventDefault();event.stopImmediatePropagation();if(busy&&!refreshing)return;
    try{void add(itemFrom(form));}catch(reason){show();fail(reason);}
  },true);
  document.addEventListener('cart:update',()=>{if(!busy)void refresh();});
  window.addEventListener('pageshow',event=>{if(event.persisted)void refresh();});
  let countdown:ReturnType<typeof setInterval>|undefined;
  function startCountdown():void {
    if(countdown)return;
    const end=Date.parse(config.endsAt),timer=find('[data-cart-countdown]'),promo=find('[data-cart-promo]');
    if(!Number.isFinite(end)||end<=Date.now())return;
    const tick=()=>{
      const seconds=Math.max(0,Math.ceil((end-Date.now())/1000));
      timer.hidden=!seconds;promo.textContent=seconds?config.labels.promotion:secureText;
      timer.textContent=`${Math.floor(seconds/3600).toString().padStart(2,'0')}:${Math.floor(seconds%3600/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
      if(!seconds){clearInterval(countdown);countdown=undefined;}
    };
    tick();countdown=setInterval(tick,1000);
  }
  dialog.addEventListener('close',()=>{clearInterval(countdown);countdown=undefined;});
  status.textContent='';void refresh();
}
