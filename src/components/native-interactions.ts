type Breakpoint = {view:number;gap:number};
type CarouselOptions = {breakpoints:Record<string,Breakpoint>;loop?:boolean;speed?:number};
const ready = new WeakSet<Element>();
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function elements(root:ParentNode,selector:string):HTMLElement[] {
  const matches=[...root.querySelectorAll<HTMLElement>(selector)];
  if(root instanceof HTMLElement && root.matches(selector))matches.unshift(root);
  return matches.filter(element=>{if(ready.has(element))return false;ready.add(element);return true;});
}

function carousel(element:HTMLElement):void {
  const viewport=element.querySelector<HTMLElement>('[data-fem-carousel-viewport]');
  const track=element.querySelector<HTMLElement>('[data-fem-carousel-track]');
  if(!viewport || !track)return;
  const options=JSON.parse(element.dataset.femCarousel??'{}') as CarouselOptions;
  const slides=[...track.children] as HTMLElement[];
  const previous=element.querySelector<HTMLButtonElement>('[data-fem-carousel-prev]');
  const next=element.querySelector<HTMLButtonElement>('[data-fem-carousel-next]');
  let step=0,frame=0,dragStart=0,scrollStart=0,dragged=false;
  const update=()=>{
    const end=viewport.scrollWidth-viewport.clientWidth;
    if(previous)previous.disabled=end<2 || !options.loop && viewport.scrollLeft<2;
    if(next)next.disabled=end<2 || !options.loop && viewport.scrollLeft>=end-2;
  };
  const resize=()=>{
    const keys=Object.keys(options.breakpoints).map(Number).sort((a,b)=>a-b);
    const point=options.breakpoints[String(keys.filter(width=>innerWidth>=width).pop()??keys[0])];
    const width=(viewport.clientWidth-point.gap*(point.view-1))/point.view;
    step=width+point.gap;
    track.style.gap=`${point.gap}px`;
    for(const slide of slides){slide.style.width=`${width}px`;slide.style.flex=`0 0 ${width}px`;}
    update();
  };
  const move=(direction:number)=>{
    cancelAnimationFrame(frame);
    viewport.style.scrollSnapType='none';
    // Reorder only offscreen slides so looping keeps the same direction and video state.
    if(options.loop && direction>0 && viewport.scrollLeft>=viewport.scrollWidth-viewport.clientWidth-2){
      track.append(track.firstElementChild!);viewport.scrollLeft=Math.max(0,viewport.scrollLeft-step);
    } else if(options.loop && direction<0 && viewport.scrollLeft<2){
      track.prepend(track.lastElementChild!);viewport.scrollLeft+=step;
    }
    const from=viewport.scrollLeft;
    const end=viewport.scrollWidth-viewport.clientWidth;
    let target=Math.max(0,Math.min(end,from+direction*step));
    if(reducedMotion()){viewport.scrollLeft=target;viewport.style.scrollSnapType='';update();return;}
    const start=performance.now(),duration=options.speed??500;
    viewport.style.scrollSnapType='none';
    const tick=(now:number)=>{
      const t=Math.min(1,(now-start)/duration);
      const eased=1-Math.pow(1-t,3);
      viewport.scrollLeft=from+(target-from)*eased;
      if(t<1)frame=requestAnimationFrame(tick);
      else {viewport.style.scrollSnapType='';update();}
    };
    frame=requestAnimationFrame(tick);
  };
  previous?.addEventListener('click',()=>move(-1));
  next?.addEventListener('click',()=>move(1));
  viewport.addEventListener('scroll',update,{passive:true});
  viewport.addEventListener('keydown',event=>{
    if(event.target!==viewport)return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();move(event.key==='ArrowLeft'?-1:1);}
  });
  viewport.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='mouse' || (event.target as Element).closest('video,button'))return;
    dragStart=event.clientX;scrollStart=viewport.scrollLeft;dragged=false;
    const drag=(moveEvent:PointerEvent)=>{
      if(Math.abs(moveEvent.clientX-dragStart)>5)dragged=true;
      if(dragged){viewport.style.scrollSnapType='none';viewport.scrollLeft=scrollStart+dragStart-moveEvent.clientX;}
    };
    const stop=()=>{viewport.style.scrollSnapType='';window.removeEventListener('pointermove',drag);};
    window.addEventListener('pointermove',drag);
    window.addEventListener('pointerup',stop,{once:true});
  });
  viewport.addEventListener('click',event=>{if(dragged){event.preventDefault();event.stopPropagation();dragged=false;}},true);
  viewport.addEventListener('dragstart',event=>event.preventDefault());
  new ResizeObserver(resize).observe(viewport);
  resize();
}

function accordion(group:HTMLElement):void {
  const items=[...group.querySelectorAll<HTMLElement>('[data-fem-accordion-item]')].filter(item=>item.closest('[data-fem-accordion]')===group);
  const setOpen=(item:HTMLElement,open:boolean)=>{
    const trigger=item.querySelector<HTMLButtonElement>('[data-fem-accordion-trigger]');
    const content=item.querySelector<HTMLElement>('[data-fem-accordion-content]');
    if(!trigger || !content)return;
    item.dataset.state=open?'open':'closed';
    trigger.setAttribute('aria-expanded',String(open));
    content.inert=!open;
    content.style.setProperty('--fem-accordion-content-height',`${content.scrollHeight}px`);
  };
  items.forEach((item,index)=>{
    const trigger=item.querySelector<HTMLButtonElement>('[data-fem-accordion-trigger]');
    const content=item.querySelector<HTMLElement>('[data-fem-accordion-content]');
    if(!trigger || !content)return;
    content.id ||= `${group.id}-answer-${index}`;
    trigger.setAttribute('aria-controls',content.id);
    setOpen(item,item.dataset.state==='open');
    if(content.firstElementChild)new ResizeObserver(()=>{
      content.style.setProperty('--fem-accordion-content-height',`${content.firstElementChild!.getBoundingClientRect().height}px`);
    }).observe(content.firstElementChild);
    trigger.addEventListener('click',()=>{
      const open=item.dataset.state!=='open';
      if(group.dataset.femMultiple!=='true')items.forEach(other=>{if(other!==item)setOpen(other,false);});
      setOpen(item,open);
    });
  });
}

function menu(trigger:HTMLElement):void {
  const panel=document.getElementById(trigger.dataset.femToggle??'');
  if(!panel)return;
  const overlay=panel.hasAttribute('data-fem-overlay');
  let opened=false;
  const setOpen=(value:boolean)=>{
    opened=value;panel.dataset.state=value?'open':'closed';panel.inert=!value;
    for(const control of document.querySelectorAll<HTMLElement>(`[data-fem-toggle="${panel.id}"]`)){
      control.dataset.state=value?'active':'inactive';control.setAttribute('aria-expanded',String(value));control.setAttribute('aria-controls',panel.id);
      if(control.hasAttribute('data-fem-action-type'))control.dataset.femState=value?'active':'inactive';
    }
    if(overlay){
      document.documentElement.style.overflow=value?'hidden':'';
      if(value)panel.querySelector<HTMLElement>('button,a[href]')?.focus();
    } else {
      const box=trigger.getBoundingClientRect();
      panel.style.left=`${box.left+box.width/2}px`;panel.style.top=`${box.bottom+28}px`;
    }
  };
  setOpen(false);
  if(overlay && panel.id==='fem-mobile-menu'){
    matchMedia('(max-width: 749px)').addEventListener('change',event=>{
      if(!event.matches && opened)setOpen(false);
    });
  }
  trigger.addEventListener('click',event=>setOpen(trigger.hasAttribute('data-fem-hover') && matchMedia('(hover: hover)').matches && event.detail>0 ? true : !opened));
  panel.querySelectorAll<HTMLElement>('[data-fem-close]').forEach(button=>button.addEventListener('click',()=>{setOpen(false);trigger.focus();}));
  document.addEventListener('pointerdown',event=>{if(opened && !panel.contains(event.target as Node) && !trigger.contains(event.target as Node))setOpen(false);});
  document.addEventListener('keydown',event=>{
    if(!opened)return;
    if(event.key==='Escape'){setOpen(false);trigger.focus();}
    if(overlay && event.key==='Tab'){
      const controls=[...panel.querySelectorAll<HTMLElement>('button,a[href],input')].filter(node=>node.getClientRects().length && !node.closest('[inert]'));
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  if(trigger.hasAttribute('data-fem-hover')){
    let timer:ReturnType<typeof setTimeout>;
    const open=()=>{clearTimeout(timer);if(matchMedia('(hover: hover)').matches)setOpen(true);};
    const close=()=>{timer=setTimeout(()=>setOpen(false),120);};
    trigger.addEventListener('mouseenter',open);trigger.addEventListener('mouseleave',close);
    panel.addEventListener('mouseenter',open);panel.addEventListener('mouseleave',close);
  }
}

function marquee(element:HTMLElement):void {
  const tracks=element.querySelectorAll<HTMLElement>('[data-fem-marquee-track]');
  const content=tracks[0]?.firstElementChild as HTMLElement|undefined;
  if(!content || !tracks[1])return;
  tracks[1].replaceChildren(content.cloneNode(true));tracks[1].setAttribute('aria-hidden','true');tracks[1].inert=true;
  const resize=()=>{
    const distance=content.getBoundingClientRect().width+(parseFloat(getComputedStyle(element).columnGap)||0);
    element.style.setProperty('--fem-marquee-distance',`-${distance}px`);
    element.style.setProperty('--fem-marquee-duration',`${distance/(Number(element.dataset.femMarquee)||64)}s`);
  };
  new ResizeObserver(resize).observe(content);resize();
}

export function enhanceNativeInteractions(root:ParentNode=document):void {
  elements(root,'[data-fem-carousel]').forEach(carousel);
  elements(root,'[data-fem-accordion]').forEach(accordion);
  elements(root,'[data-fem-toggle]:not([data-fem-close])').forEach(menu);
  elements(root,'[data-fem-marquee]').forEach(marquee);
  for(const element of elements(root,'[data-fem-reveal]')){
    if(reducedMotion()){element.classList.remove('fem-reveal--hidden');continue;}
    const offset=Number(element.dataset.femReveal)||0;
    const update=()=>element.classList.toggle('fem-reveal--hidden',scrollY<offset);
    window.addEventListener('scroll',update,{passive:true});
    update();
  }
}
