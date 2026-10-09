import {enhanceNativeInteractions} from './native-interactions.ts';

type Autoplay=false|{delay?:number};
type GalleryOptions={breakpoints?:Record<string,{slidesPerView:number|'auto';spaceBetween:number;speed?:number;direction?:string;autoplay?:Autoplay}>;loop?:boolean;autoplay?:Autoplay};
const ready=new WeakSet<Element>();
const galleries=new WeakMap<Element,(index:number)=>void>();
const motion=()=>!matchMedia('(prefers-reduced-motion: reduce)').matches;
function find(root:ParentNode,selector:string):HTMLElement[]{
  const nodes=[...root.querySelectorAll<HTMLElement>(selector)];if(root instanceof HTMLElement && root.matches(selector))nodes.unshift(root);
  return nodes.filter(node=>{if(ready.has(node))return false;ready.add(node);return true;});
}
function gallery(viewport:HTMLElement):void {
  const track=viewport.querySelector<HTMLElement>(':scope > .fem-view-slider-wrapper');if(!track)return;
  const section=viewport.closest<HTMLElement>('[data-fem-id]')!;
  const id=viewport.dataset.femSliderId!;
  const configNode=section.querySelector(`script[id="fem-view-slider-${viewport.id}-params"]`);
  let config:GalleryOptions={};try{config=JSON.parse(configNode?.textContent??'{}');}catch{/* Default gallery. */}
  const slides=[...track.children] as HTMLElement[];
  const thumbnails=viewport.dataset.femType==='thumbnails';
  const controls=thumbnails?[]:[...section.querySelectorAll<HTMLElement>(`.fem-view-slider-${CSS.escape(id)}-button-prev,.fem-view-slider-${CSS.escape(id)}-button-next`)];
  const bullets=thumbnails?null:section.querySelector<HTMLElement>(`.fem-view-slider-${CSS.escape(id)}-pagination`);
  const productMedia=slides.some(slide=>slide.querySelector('img[data-fem-dynamic-content-source="REPEATER"]'));
  if(productMedia){
    const zoom=!!viewport.closest('[data-fem-type="overlay"]');
    viewport.dataset.femProductGallery=zoom?'zoom':thumbnails?'thumbnails':'main';
    if(!zoom&&!thumbnails){
      viewport.parentElement?.setAttribute('data-fem-product-gallery-container','');
      for(const control of controls)control.dataset.femGalleryControl=control.classList.contains(`fem-view-slider-${id}-button-prev`)?'prev':'next';
    }
  }
  let index=0,step=1,frame=0,vertical=false,speed=300;
  let autoplay:Autoplay=false;
  viewport.tabIndex=0;viewport.setAttribute('aria-roledescription',thumbnails?'Miniaturas':'Carrusel');
  const position=()=>vertical?viewport.scrollTop:viewport.scrollLeft;
  const limit=()=>vertical?viewport.scrollHeight-viewport.clientHeight:viewport.scrollWidth-viewport.clientWidth;
  const scroll=(value:number)=>{if(vertical)viewport.scrollTop=value;else viewport.scrollLeft=value;};
  const preload=(next:number)=>{
    if(thumbnails||viewport.closest('[data-fem-type="overlay"][data-state="closed"]'))return;
    for(const slide of slides.slice(Math.max(0,next-1),next+2))for(const image of slide.querySelectorAll<HTMLImageElement>('img')){
      if(image.closest('[data-fem-type="slider"],[data-fem-type="thumbnails"]')===viewport)image.loading='eager';
    }
  };
  const update=()=>{
    index=Math.max(0,Math.round(position()/step));
    preload(index);
    [...track.children].forEach((slide,n)=>{slide.classList.toggle('fem-view-slider-slide-active',n===index);slide.setAttribute('aria-label',`${n+1} de ${slides.length}`);});
    for(const control of controls){
      const previous=control.classList.contains(`fem-view-slider-${id}-button-prev`);
      const disabled=limit()<2||!config.loop&&(previous?position()<2:position()>=limit()-2);
      control.classList.toggle('fem-view-slider-button-disabled',disabled);control.setAttribute('aria-disabled',String(disabled));
      if(control instanceof HTMLButtonElement)control.disabled=disabled;
    }
    bullets?.querySelectorAll('button').forEach((button,n)=>{button.classList.toggle('fem-view-slider-pagination-bullet-active',n===index);button.setAttribute('aria-current',String(n===index));});
    if(!thumbnails)for(const thumbs of section.querySelectorAll<HTMLElement>(`[data-fem-type="thumbnails"][data-fem-slider-id="${id}"]`)){
      const items=thumbs.querySelectorAll<HTMLElement>(':scope > .fem-view-slider-wrapper > *');
      items.forEach((item,n)=>{item.classList.toggle('fem-view-slider-thumb-active',n===index);item.setAttribute('aria-current',String(n===index));});
      const active=items[index];
      if(active){
        const left=active.offsetLeft,right=left+active.offsetWidth;
        if(left<thumbs.scrollLeft)thumbs.scrollLeft=left;
        else if(right>thumbs.scrollLeft+thumbs.clientWidth)thumbs.scrollLeft=right-thumbs.clientWidth;
      }
    }
  };
  const go=(next:number)=>{
    preload(next);
    cancelAnimationFrame(frame);
    resize();
    if(config.loop && next>index && position()>=limit()-2 && limit()>2){
      track.append(track.firstElementChild!);scroll(Math.max(0,position()-step));next=Math.round(position()/step)+1;
    }else if(config.loop && next<0 && position()<2 && limit()>2){
      track.prepend(track.lastElementChild!);scroll(position()+step);next=0;
    }
    const target=Math.min(Math.max(0,next*step),Math.max(0,limit()));
    if(!motion()){scroll(target);update();return;}
    const start=performance.now(),from=position();viewport.style.scrollSnapType='none';
    const tick=(now:number)=>{const t=Math.min(1,(now-start)/speed);scroll(from+(target-from)*(1-(1-t)**3));if(t<1)frame=requestAnimationFrame(tick);else{viewport.style.scrollSnapType='';update();}};
    frame=requestAnimationFrame(tick);
  };
  galleries.set(viewport,go);
  const resize=()=>{
    const points=config.breakpoints??{'0':{slidesPerView:1,spaceBetween:0}};
    const widths=Object.keys(points).map(Number).sort((a,b)=>a-b);
    const point=points[String(widths.filter(width=>innerWidth>=width).pop()??widths[0])];
    vertical=point.direction==='vertical';speed=point.speed??300;
    autoplay=point.autoplay??config.autoplay??false;
    const view=Number(point.slidesPerView)||1,gap=Number(point.spaceBetween)||0;
    const available=vertical?viewport.clientHeight:viewport.clientWidth;if(!available)return;
    const size=(available-gap*(view-1))/view;step=size+gap;
    track.style.gap=`${gap}px`;track.style.flexDirection=vertical?'column':'row';
    viewport.dataset.femAxis=vertical?'vertical':'horizontal';
    for(const slide of slides){
      slide.style.margin='0';
      slide.style.flex=point.slidesPerView==='auto'?'0 0 auto':`0 0 ${size}px`;
      slide.style.width=point.slidesPerView==='auto'?'':vertical?'100%':`${size}px`;
      slide.style.height=vertical?`${size}px`:'';
    }
    if(point.slidesPerView==='auto')step=(slides[0]?.getBoundingClientRect().width||available)+gap;
    update();
  };
  controls.forEach(control=>control.addEventListener('click',()=>go(index+(control.classList.contains(`fem-view-slider-${id}-button-prev`)?-1:1))));
  if(bullets && !thumbnails){bullets.replaceChildren(...slides.map((_,n)=>{const button=document.createElement('button');button.type='button';button.className='fem-view-slider-pagination-bullet';button.setAttribute('aria-label',`Ver imagen ${n+1}`);button.addEventListener('click',()=>go(n));return button;}));}
  if(thumbnails)slides.forEach((slide,n)=>{
    slide.tabIndex=0;slide.setAttribute('role','button');
    const select=()=>{const main=section.querySelector<HTMLElement>(`[data-fem-type="slider"][data-fem-slider-id="${id}"]`);if(main)galleries.get(main)?.(n);};
    slide.addEventListener('click',select);slide.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}});
  });
  viewport.addEventListener('scroll',update,{passive:true});
  viewport.addEventListener('keydown',event=>{if(event.target!==viewport)return;if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(event.key)){event.preventDefault();go(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1));}});
  let dragging=false;
  viewport.addEventListener('pointerdown',event=>{
    const control=event.target instanceof Element?event.target.closest('button,video,input'):null;
    if(event.pointerType!=='mouse'||control&&!control.matches('button[data-fem-action-type="open-overlay"]'))return;
    const start=vertical?event.clientY:event.clientX,offset=position();dragging=false;
    const move=(e:PointerEvent)=>{const delta=start-(vertical?e.clientY:e.clientX);if(Math.abs(delta)>6)dragging=true;if(dragging){viewport.style.scrollSnapType='none';scroll(offset+delta);}};
    const up=()=>{window.removeEventListener('pointermove',move);viewport.style.scrollSnapType='';};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up,{once:true});
  });
  viewport.addEventListener('dragstart',event=>event.preventDefault());
  viewport.addEventListener('click',event=>{if(dragging){event.preventDefault();event.stopPropagation();dragging=false;}},true);
  new ResizeObserver(resize).observe(viewport);resize();
  if(config.autoplay||Object.values(config.breakpoints??{}).some(point=>point.autoplay)){
    let nextAt=Date.now();const timer=setInterval(()=>{
      if(!viewport.isConnected){clearInterval(timer);return;}
      const box=viewport.getBoundingClientRect();
      if(autoplay&&Date.now()>=nextAt){nextAt=Date.now()+(autoplay.delay??4000);if(motion()&&!document.hidden&&!viewport.matches(':hover,:focus-within')&&box.bottom>0&&box.top<innerHeight)go(index+1);}
    },250);
  }
}

function overlay(panel:HTMLElement):void {
  let opener:HTMLElement|null=null,overflow='';
  panel.inert=panel.dataset.state!=='open';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.tabIndex=-1;
  const section=panel.closest<HTMLElement>('[data-fem-id]')!;
  const triggers=[...section.querySelectorAll<HTMLElement>('[data-fem-action-type="open-overlay"]')].filter(button=>'i'+button.dataset.femActionId===panel.id||button.dataset.femActionId===panel.id);
  const close=()=>{panel.dataset.state='closed';panel.inert=true;document.documentElement.style.overflow=overflow;opener?.focus();triggers.forEach(button=>button.setAttribute('aria-expanded','false'));};
  for(const button of triggers){
    button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-expanded','false');
    button.addEventListener('click',event=>{
      event.preventDefault();if(panel.contains(button)){close();return;}
      opener=button;overflow=document.documentElement.style.overflow;panel.dataset.state='open';panel.inert=false;document.documentElement.style.overflow='hidden';
      triggers.forEach(button=>button.setAttribute('aria-expanded','true'));
      const view=panel.querySelector<HTMLElement>('[data-fem-type="slider"]');if(view)galleries.get(view)?.(Number(button.dataset.femOverlayActiveSlide)||0);
      (panel.querySelector<HTMLElement>('button,a[href],[tabindex="0"]')??panel).focus();
    });
  }
  panel.querySelectorAll('.fem-view-overlay--lightbox__button-close').forEach(button=>button.addEventListener('click',close));
  panel.addEventListener('click',event=>{if(event.target===panel)close();});
  panel.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.stopPropagation();close();}
    if(event.key==='Tab'){
      const controls=[...panel.querySelectorAll<HTMLElement>('a[href],button,input,[tabindex="0"]')].filter(node=>node.getClientRects().length&&!node.closest('[inert]'));
      const first=controls[0],last=controls.at(-1);
      if(!controls.length){event.preventDefault();panel.focus();}
      else if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel)){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
}

export function enhanceCatalogInteractions(root:ParentNode=document):void {
  find(root,'[data-fem-type="slider"],[data-fem-type="thumbnails"]').forEach(gallery);
  find(root,'[data-fem-type="overlay"]').forEach(overlay);
  for(const group of find(root,'[data-fem-type="accordion-container"]')){
    group.id ||= `fem-accordion-${crypto.randomUUID()}`;
    group.setAttribute('data-fem-accordion','');group.dataset.femMultiple=group.dataset.isMultiOpenEnabled;
    for(const item of group.querySelectorAll<HTMLElement>('[data-fem-type="accordion-item"]'))item.setAttribute('data-fem-accordion-item','');
    for(const trigger of group.querySelectorAll<HTMLElement>('[data-fem-type="accordion-header"]'))trigger.setAttribute('data-fem-accordion-trigger','');
    for(const content of group.querySelectorAll<HTMLElement>('[data-fem-type="accordion-content"]'))content.setAttribute('data-fem-accordion-content','');
  }
  for(const ticker of find(root,'[data-fem-type="ticker"]')){
    const track=ticker.querySelector<HTMLElement>(':scope > .fem-view-ticker');if(!track)continue;
    let second=ticker.querySelector<HTMLElement>(':scope > .fem-view-ticker:nth-child(2)');if(!second){second=track.cloneNode(true) as HTMLElement;ticker.append(second);}
    second.setAttribute('aria-hidden','true');second.inert=true;
    const resize=()=>{
      const gap=parseFloat(getComputedStyle(ticker).columnGap)||0;
      const distance=track.getBoundingClientRect().width+gap;
      ticker.style.setProperty('--gap',`${gap}px`);
      ticker.style.setProperty('--duration',`${distance/(Number(ticker.dataset.femTickerSpeed)||64)}s`);
      ticker.style.setProperty('--direction',ticker.dataset.femTickerIsReversed==='true'?'reverse':'normal');
      ticker.style.setProperty('--play',motion()?'running':'paused');ticker.style.setProperty('--pause-on-hover',ticker.dataset.femTickerPause==='true'?'paused':'running');ticker.style.setProperty('--pause-on-click','paused');
    };new ResizeObserver(resize).observe(track);resize();
  }
  for(const trigger of find(root,'[data-fem-action-type="open-dropdown"]')){
    const section=trigger.closest('[data-fem-id]');
    const content=section?.querySelector<HTMLElement>(`.i${CSS.escape(trigger.dataset.femActionId??'')}`);
    const panel=content?.closest<HTMLElement>('.fem-view-dropdown--wrapper');if(!panel)continue;
    panel.id ||= `fem-dropdown-${trigger.dataset.femActionId}`;
    panel.style.translate='-50% 0';trigger.dataset.femToggle=panel.id;
    if(trigger.hasAttribute('data-fem-action-on-hover'))trigger.setAttribute('data-fem-hover','');
  }
  for(const card of find(root,'[data-fem-action-type="open-page"]')){
    const href=card.dataset.femHref;if(!href)continue;
    if(card.tagName==='A'){card.setAttribute('href',href);continue;}
    card.setAttribute('role','link');card.tabIndex=0;
    card.addEventListener('click',event=>{if(event.target instanceof Element&&event.target.closest('a,button,input,select'))return;location.assign(href);});
    card.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target===card)location.assign(href);});
  }
  for(const element of find(root,'[data-fem-scroll-into-view-offset]')){
    const offset=Number(element.dataset.femScrollIntoViewOffset)||0;let shown=false;
    const update=()=>{if(!element.isConnected){window.removeEventListener('scroll',update);return;}const visible=!motion()||scrollY>=offset;if(visible)shown=true;element.classList.toggle('fem-view-scroll-trigger--hidden',!visible&&(!shown||element.dataset.femScrollIntoViewReplay==='true'));};
    window.addEventListener('scroll',update,{passive:true});update();
  }
  for(const control of find(root,'[data-fem-action-type="quantity-increment"],[data-fem-action-type="quantity-decrement"]'))control.addEventListener('click',()=>{
    const scope=control.closest('form,[data-fem-form-product-url]');const input=scope?.querySelector<HTMLInputElement>('input[name="quantity"],[data-fem-dynamic-content-source="QUANTITY_SELECT"]');if(!input)return;
    const step=Number(input.step)||1,min=Number(input.min)||1,max=Number(input.max)||Infinity;
    input.value=String(Math.max(min,Math.min(max,Number(input.value)+(control.dataset.femActionType==='quantity-increment'?step:-step))));input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  for(const wrapper of find(root,'.fem-view-video__wrapper[data-src]'))wrapper.addEventListener('click',()=>{
    if(wrapper.querySelector('video'))return;const url=wrapper.dataset.src;if(!url)return;
    if(/\.mp4(?:[?#]|$)/i.test(url)){const video=document.createElement('video');video.src=url;video.controls=true;video.playsInline=true;video.style.cssText='width:100%;height:100%;object-fit:contain';wrapper.replaceChildren(video);void video.play().catch(()=>{});}
  });
  enhanceNativeInteractions(root);
}
