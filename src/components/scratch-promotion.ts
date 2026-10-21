import {ScratchCoverage,type ScratchPoint} from '../lib/scratch-coverage.ts';

const storageKey='fem:welcome-10:revealed';
const shownKey='fem:welcome-10:shown';
const photoId='7ccc4632-e3f5-4449-a58e-2025e6346375';
let revealed=false;
let initialized=false;
let deferNativeOpening:((form:HTMLElement)=>boolean)|undefined;
const isScratchPreview=()=>['localhost','127.0.0.1'].includes(location.hostname)&&new URLSearchParams(location.search).get('fem-scratch')==='1';

function initializeCard(card:HTMLElement):void {
  const canvas=card.querySelector('canvas')!;
  const status=card.querySelector<HTMLElement>('[role="status"]')!;
  const prize=card.querySelector<HTMLElement>('.fem-scratch__prize')!;
  const coverage=new ScratchCoverage();
  let context:CanvasRenderingContext2D|null=null;
  let pointer:number|undefined,last:ScratchPoint|undefined;
  let gesture:AbortController|undefined;
  let complete=false;
  const preview=isScratchPreview();
  if(!preview)try { revealed ||= window.sessionStorage.getItem(storageKey)==='1'; } catch {}
  const stop=()=>{
    const captured=pointer;
    pointer=undefined;last=undefined;gesture?.abort();gesture=undefined;
    card.classList.remove('fem-scratch--dragging');
    try { if(captured!==undefined&&canvas.hasPointerCapture(captured))canvas.releasePointerCapture(captured); } catch {}
  };
  const reveal=()=>{
    complete=true;stop();
    card.classList.add('fem-scratch--revealed');
    prize.removeAttribute('aria-hidden');
    status.textContent=status.dataset.revealed??'';
    if(!preview){revealed=true;try { window.sessionStorage.setItem(storageKey,'1'); } catch {}}
  };
  if(!preview&&revealed){reveal();return;}
  try { context=canvas.getContext('2d'); } catch {}
  if(!context){reveal();return;}
  const gradient=context.createLinearGradient(0,0,720,420);
  gradient.addColorStop(0,'#ffacac');gradient.addColorStop(.5,'#f5797e');gradient.addColorStop(1,'#f6a1a5');
  context.fillStyle=gradient;context.fillRect(0,0,720,420);
  context.fillStyle='rgba(255,247,247,.2)';
  for(let y=20;y<420;y+=36)for(let x=20;x<720;x+=36){context.beginPath();context.arc(x,y,1.5,0,Math.PI*2);context.fill();}
  context.globalCompositeOperation='destination-out';context.fillStyle='#000';context.strokeStyle='#000';context.lineWidth=68;context.lineCap='round';context.lineJoin='round';
  card.classList.add('fem-scratch--painted');
  const point=(event:PointerEvent):ScratchPoint=>{
    const bounds=canvas.getBoundingClientRect();
    return {x:(event.clientX-bounds.left)*720/(bounds.width||720),y:(event.clientY-bounds.top)*420/(bounds.height||420)};
  };
  const erase=(next:ScratchPoint)=>{
    if(!last||!context)return;
    context.beginPath();context.moveTo(last.x,last.y);context.lineTo(next.x,next.y);context.stroke();
    context.beginPath();context.arc(next.x,next.y,34,0,Math.PI*2);context.fill();
    const progress=coverage.erase(last,next);last=next;
    if(progress>=.42)reveal();
  };
  canvas.addEventListener('pointerdown',event=>{
    if(complete||pointer!==undefined||event.button!==0||event.isPrimary===false)return;
    event.preventDefault();
    pointer=event.pointerId;last=point(event);card.classList.add('fem-scratch--started','fem-scratch--dragging');
    gesture=new AbortController();
    window.addEventListener('pointerup',onPointerEnd,{signal:gesture.signal});
    window.addEventListener('pointercancel',onPointerEnd,{signal:gesture.signal});
    window.addEventListener('blur',stop,{signal:gesture.signal});
    try { canvas.setPointerCapture(event.pointerId); } catch {}
    erase(last);
  });
  canvas.addEventListener('pointermove',event=>{
    if(complete||pointer!==event.pointerId||!last)return;
    if(event.pointerType!=='touch'&&(event.buttons&1)===0){stop();return;}
    event.preventDefault();erase(point(event));
  });
  const onPointerEnd=(event:PointerEvent)=>{
    if(pointer===event.pointerId)stop();
  };
  canvas.addEventListener('pointerup',onPointerEnd);
  canvas.addEventListener('pointercancel',onPointerEnd);
  canvas.addEventListener('lostpointercapture',onPointerEnd);
  canvas.addEventListener('dragstart',event=>event.preventDefault());
}

function prepareRedemption(details:HTMLElement,template:HTMLTemplateElement):void {
  details.setAttribute('data-fem-scratch-details','');
  for(const row of details.querySelectorAll<HTMLElement>('[data-testid="form-row"]')){
    const text=(row.textContent??'').replace(/\s+/g,' ').trim();
    if(!row.querySelector('input,button')&&(/10\s*%\s*de\s*descuento/i.test(text)||/^en tu primera compra$/i.test(text)))row.setAttribute('data-fem-scratch-old-heading','');
    if(/política de privacidad/i.test(text))row.setAttribute('data-fem-scratch-consent','');
    for(const button of row.querySelectorAll<HTMLButtonElement>('button[data-action-id]')){
      if(/lo quiero/i.test(button.textContent??''))button.setAttribute('data-fem-scratch-submit','');
      if(button.hasAttribute('data-fem-scratch-dismiss')||/no quiero ahorrar|seguir explorando/i.test(button.textContent??'')){
        button.setAttribute('data-fem-scratch-dismiss','');
        const label=template.dataset.dismissLabel??'Seguir explorando';
        if(button.textContent!==label)button.textContent=label;
        if(button.hasAttribute('aria-label'))button.setAttribute('aria-label',label);
      }
    }
  }
  if(details.querySelector('.fem-scratch-redemption'))return;
  const intro=document.createElement('div');intro.className='fem-scratch-redemption';
  const title=document.createElement('h2');title.textContent=template.dataset.redemptionTitle??'';
  const copy=document.createElement('p');copy.textContent=template.dataset.redemptionCopy??'';
  intro.append(title,copy);details.insertBefore(intro,details.firstChild);
}

export function enhanceScratchPromotion(root:ParentNode=document):void {
  const template=document.querySelector<HTMLTemplateElement>('#fem-scratch-template');
  if(!template)return;
  const formId=template.dataset.formId;
  if(!formId||!/^[a-zA-Z0-9]+$/.test(formId))return;
  const selector=`form[data-testid="klaviyo-form-${formId}"]`;
  const forms=new Set(root.querySelectorAll<HTMLElement>(selector));
  if(root instanceof Element){const parent=root.closest<HTMLElement>(selector);if(parent)forms.add(parent);}
  for(const form of forms){
    if(deferNativeOpening?.(form))continue;
    const email=form.querySelector<HTMLInputElement>('input[type="email"]');
    if(!email)continue;
    const photo=[...form.querySelectorAll<HTMLImageElement>('img')].find(image=>image.src.includes(photoId));
    const photoColumn=photo?.parentElement?.parentElement;
    if(photoColumn&&!photoColumn.querySelector('input,[data-testid="form-row"]'))photoColumn.setAttribute('data-fem-scratch-photo','');
    const row=email.closest<HTMLElement>('[data-testid="form-row"]');
    const details=row?.parentElement;
    const layout=details?.parentElement;
    if(!details||!layout||!form.contains(layout))continue;
    form.setAttribute('data-fem-scratch-form','');
    form.closest('[data-testid="POPUP"]')?.parentElement?.setAttribute('data-fem-scratch-frame','');
    layout.setAttribute('data-fem-scratch-layout','');
    prepareRedemption(details,template);
    if(form.querySelector('.fem-scratch'))continue;
    const card=template.content.firstElementChild?.cloneNode(true) as HTMLElement|undefined;
    if(!card)continue;
    layout.insertBefore(card,layout.firstChild);
    initializeCard(card);
  }
}

export function initializeScratchPromotion():void {
  if(initialized){enhanceScratchPromotion();return;}
  const formId=document.querySelector<HTMLElement>('#fem-scratch-template')?.dataset.formId;
  if(!formId||!/^[a-zA-Z0-9]+$/.test(formId))return;
  initialized=true;
  let handled=false,ready=false,explored=false,timer:number|undefined;
  let allowed=isScratchPreview(),nativeRequested=false,deferredClosing=false;
  if(allowed)document.documentElement.setAttribute('data-fem-welcome-allowed','');
  const deferredForms=new WeakSet<HTMLElement>();
  const exploration=new AbortController();
  const remember=()=>{
    handled=true;
    if(timer!==undefined)window.clearTimeout(timer);
    exploration.abort();
    try { window.sessionStorage.setItem(shownKey,'1'); } catch {}
  };
  const wasShown=()=>{
    try { return window.sessionStorage.getItem(shownKey)==='1'; } catch { return false; }
  };
  const open=()=>{
    if(document.documentElement.hasAttribute('data-fem-independent')){window.dispatchEvent(new CustomEvent('fem:welcome-open'));return;}
    const client=window as Window & {_klOnsite?:unknown[][]};
    (client._klOnsite??=[]).push(['openForm',formId]);
  };
  const maybeOpen=()=>{
    if(handled||wasShown()||!ready||!explored||deferredClosing||document.visibilityState==='hidden')return;
    if(!document.querySelector('.fem-home')&&!nativeRequested)return;
    const form=document.querySelector(`form[data-testid="klaviyo-form-${formId}"]`);
    const bounds=form?.getBoundingClientRect();
    if(bounds&&bounds.width>0&&bounds.height>0&&!form?.closest('[data-fem-welcome-deferred]')){remember();return;}
    if(document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')||document.querySelector('dialog[open],#fem-consent-panel'))return;
    allowed=true;
    document.documentElement.setAttribute('data-fem-welcome-allowed','');
    remember();
    open();
  };
  deferNativeOpening=form=>{
    if(allowed){form.closest('[data-fem-welcome-deferred]')?.removeAttribute('data-fem-welcome-deferred');return false;}
    nativeRequested=true;
    // Let Klaviyo release its focus trap and scroll lock through its own close control.
    const dialog=form.closest<HTMLElement>('[role="dialog"]');
    const close=dialog?.querySelector<HTMLButtonElement>('button.klaviyo-close-form');
    if(!dialog||!close)return false;
    dialog.setAttribute('data-fem-welcome-deferred','');
    if(!deferredForms.has(form)){
      deferredForms.add(form);deferredClosing=true;
      window.setTimeout(()=>{
        if(close.isConnected)close.click();
        else {deferredClosing=false;maybeOpen();}
      },400);
    }
    return true;
  };
  window.addEventListener('klaviyoForms',event=>{
    const detail=(event as CustomEvent<{formId?:string;type?:string}>).detail;
    if(detail?.formId===formId){
      if(detail.type==='open'&&!allowed)nativeRequested=true;
      else if(detail.type==='close'&&deferredClosing){deferredClosing=false;maybeOpen();}
      else if(allowed&&['open','close','submit'].includes(detail.type??''))remember();
    }
    enhanceScratchPromotion();
  });
  enhanceScratchPromotion();
  if(allowed){open();return;}
  if(wasShown())return;
  window.addEventListener('scroll',()=>{
    if(window.scrollY>=Math.max(300,window.innerHeight*.75))explored=true;
    maybeOpen();
  },{passive:true,signal:exploration.signal});
  document.addEventListener('visibilitychange',maybeOpen,{signal:exploration.signal});
  timer=window.setTimeout(()=>{ready=true;maybeOpen();},15000);
}
