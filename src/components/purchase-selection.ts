import {resolvePurchaseSelection,type PurchaseOption,type PurchaseVariant} from '../lib/purchase-selection.ts';
import {patchProductMarkup} from '../lib/product-markup.ts';
const ready=new WeakSet<HTMLFormElement>();
const scopeSelector='[data-fem-form-product-url]';
const pickerSelector='[data-fem-action-type="select-variant-option"]';
/** Native selection; the server resolves prices, availability and conditions. */
export function enhancePurchaseSelection(root:ParentNode=document):void {
  const forms=[...root.querySelectorAll<HTMLFormElement>(`form${scopeSelector}`)];
  if(root instanceof HTMLFormElement && root.matches(scopeSelector))forms.unshift(root);
  for(const form of forms){
    if(ready.has(form))continue;
    const variantsScript=form.querySelector<HTMLScriptElement>('script[id^="variants__"]');
    const optionsScript=form.querySelector<HTMLScriptElement>('script[id^="options__"]');
    if(!variantsScript || !optionsScript)continue;
    let variants:PurchaseVariant[],options:PurchaseOption[];
    try{variants=JSON.parse(variantsScript.textContent??'[]');options=JSON.parse(optionsScript.textContent??'[]');}catch{continue;}
    if(!Array.isArray(variants)||!variants.length||!Array.isArray(options))continue;
    const section=form.closest<HTMLElement>('[data-section-id]');if(!section)continue;
    ready.add(form);
    const scopeId=variantsScript.id.slice('variants__'.length).split('--')[0];
    const own=(node:Element)=>node.closest(scopeSelector)===form;
    const cards=()=>[...form.querySelectorAll<HTMLElement>(pickerSelector)].filter(own);
    const selectedVariant=()=>variants.find(variant=>String(variant.id)===form.dataset.femFormVariantId)??variants[0];
    let selected=[...selectedVariant().options],request:AbortController|undefined,revision=0;
    let committed=selectedVariant();
    const addControls=()=>[...form.querySelectorAll<HTMLElement>('[data-fem-action-type^="add-to-"],[data-fem-cart-add]')].filter(own);
    const updateFields=(variant:PurchaseVariant)=>{
      selected=[...variant.options];form.dataset.femFormVariantId=String(variant.id);
      let id=form.querySelector<HTMLInputElement>('input[name="id"]');
      if(!id){id=document.createElement('input');id.type='hidden';id.name='id';form.append(id);}id.value=String(variant.id);
      for(const option of options){
        const value=selected[option.position-1];
        let hidden=form.querySelector<HTMLInputElement>(`input[type="hidden"][name="${scopeId}__${encodeURIComponent(option.name)}"]`);
        if(!hidden){hidden=document.createElement('input');hidden.type='hidden';hidden.name=`${scopeId}__${encodeURIComponent(option.name)}`;form.append(hidden);}
        hidden.value=value;
        for(const input of form.querySelectorAll<HTMLInputElement|HTMLSelectElement>('input,select')){
          if(!own(input)||decodeURIComponent(input.name.split('__')[1]??'')!==option.name)continue;
          if(input instanceof HTMLInputElement && ['radio','checkbox'].includes(input.type))input.checked=input.value===value;else input.value=value;
        }
      }
      const quantityOption=options.find(option=>option.name==='Cantidad');
      const quantity=quantityOption?selected[quantityOption.position-1].match(/\d+/)?.[0]:undefined;
      for(const card of cards()){
        const name=decodeURIComponent(card.dataset.femOptionName??''),value=card.dataset.femOptionValue?.trim();
        const option=options.find(option=>option.name===name);if(!option)continue;
        const active=value===selected[option.position-1];
        card.dataset.femState=active?'active':'inactive';card.setAttribute('aria-checked',String(active));card.setAttribute('role','radio');card.tabIndex=0;
        if(name==='Tipo de compra' && quantity && / \d+$/.test(value??''))card.style.display=value?.endsWith(' '+quantity)?'':'none';
      }
    };
    const error=document.createElement('p');error.className='fem-product-error';error.setAttribute('role','alert');error.hidden=true;form.append(error);
    const change=async()=>{
      const resolved=resolvePurchaseSelection(variants,options,selected);
      const variant=resolved?.variant??variants.find(variant=>variant.options.every((value,index)=>value===selected[index]));if(!variant)return;
      request?.abort();const controller=new AbortController();request=controller;const current=++revision;
      updateFields(variant);error.hidden=true;form.setAttribute('aria-busy','true');
      for(const control of addControls())control.setAttribute('aria-disabled','true');
      const url=new URL(form.dataset.femFormProductUrl!,location.origin);
      url.searchParams.set('variant',String(variant.id));url.searchParams.set('section_id',section.dataset.sectionId!);
      try{
        const response=await fetch(url,{signal:controller.signal,credentials:'same-origin'});if(!response.ok)throw Error('HTTP '+response.status);
        const document=new DOMParser().parseFromString(await response.text(),'text/html');if(current!==revision)return;
        const fresh=[...document.querySelectorAll<HTMLFormElement>(`form${scopeSelector}`)].find(node=>node.querySelector(`script[id="${variantsScript.id}"]`));
        if(!fresh || fresh.dataset.femFormVariantId!==String(variant.id))throw Error('Respuesta de otra variante');
        patchProductMarkup(form,fresh);committed=variant;updateFields(variant);
        if(form.dataset.femType==='root' && section.dataset.femLayout==='PRODUCT_TEMPLATE'){
          const currentUrl=new URL(location.href);currentUrl.searchParams.set('variant',String(variant.id));history.replaceState(history.state,'',currentUrl);
        }
      }catch{
        if(current!==revision||controller.signal.aborted)return;
        updateFields(committed);error.textContent='No pudimos actualizar esta opción. Intenta seleccionarla de nuevo.';error.hidden=false;
      }finally{
        if(current===revision){form.removeAttribute('aria-busy');for(const control of addControls())control.setAttribute('aria-disabled',String(control.dataset.femDisabled==='true'));}
      }
    };
    form.addEventListener('click',event=>{
      const card=event.target instanceof Element?event.target.closest<HTMLElement>(pickerSelector):null;if(!card||!own(card))return;
      event.preventDefault();const option=options.find(option=>option.name===decodeURIComponent(card.dataset.femOptionName??''));
      if(option){selected[option.position-1]=card.dataset.femOptionValue!.trim();void change();}
    });
    form.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ') && event.target instanceof HTMLElement && event.target.matches(pickerSelector)){event.preventDefault();event.target.click();}});
    form.addEventListener('change',event=>{
      const input=event.target;if(!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)||!own(input))return;
      const option=options.find(option=>option.name===decodeURIComponent(input.name.split('__')[1]??''));if(option){selected[option.position-1]=input.value;void change();}
    });
    const resolved=resolvePurchaseSelection(variants,options,selected);
    if(resolved && String(resolved.variant.id)!==form.dataset.femFormVariantId)void change();else updateFields(selectedVariant());
  }
}
