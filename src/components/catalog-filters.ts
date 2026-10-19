const controllers=new WeakMap<HTMLElement,()=>void>();
const keys=['fem_category','fem_min','fem_max'] as const;

export function productCategory(title:string,handle=''):string {
  const text=(title+' '+handle).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if(/combo|\bduo\b|\btrio\b|\+/.test(text))return 'combos';
  if(/mom|mama|materna/.test(text))return 'mom';
  if(/soda/.test(text))return 'soda';
  if(/gomita|gomas/.test(text))return 'gummies';
  if(/ovulo/.test(text))return 'ovules';
  if(/jabon/.test(text))return 'soap';
  if(/probiotico|probiotic/.test(text))return 'probiotics';
  return 'other';
}

function initialize(scope:HTMLElement):()=>void {
  const form=scope.querySelector<HTMLFormElement>('[data-fem-catalog-filters]')!;
  const category=form.elements.namedItem('fem_category') as HTMLSelectElement;
  const minimum=form.elements.namedItem('fem_min') as HTMLInputElement;
  const maximum=form.elements.namedItem('fem_max') as HTMLInputElement;
  const count=form.querySelector<HTMLElement>('[data-fem-filter-count]')!;
  const error=form.querySelector<HTMLElement>('[data-fem-filter-error]')!;
  const empty=form.querySelector<HTMLElement>('[data-fem-filter-empty]')!;
  const reset=form.querySelector<HTMLButtonElement>('[data-fem-filter-reset]')!;
  const readURL=()=>{
    const params=new URL(location.href).searchParams;
    for(const name of keys){const control=form.elements.namedItem(name) as HTMLInputElement;control.value=params.get(name)??'';}
  };
  const writeURL=()=>{
    const url=new URL(location.href);
    url.searchParams.delete('fem_available');
    for(const name of keys){const value=(form.elements.namedItem(name) as HTMLInputElement).value;if(value)url.searchParams.set(name,value);else url.searchParams.delete(name);}
    if(url.href!==location.href)window.history.replaceState(window.history.state,'',url);
  };
  const update=()=>{
    const cards=[...scope.querySelectorAll<HTMLElement>('[data-fem-catalog-item]')];
    const categories=new Set(cards.map(card=>productCategory(card.dataset.productTitle??'',card.dataset.productHandle)));
    for(const option of category.options)if(option.value){option.hidden=!categories.has(option.value);option.disabled=option.hidden;}
    if(category.value&&!categories.has(category.value))category.value='';
    error.hidden=true;error.textContent='';
    form.removeAttribute('aria-busy');
    reset.hidden=!keys.some(name=>(form.elements.namedItem(name) as HTMLInputElement).value);
    const min=minimum.value===''?0:Number(minimum.value),max=maximum.value===''?Infinity:Number(maximum.value);
    if(!minimum.validity.valid||!maximum.validity.valid||min<0||max<0||min>max){
      error.hidden=false;error.textContent=form.dataset.priceError??'';return;
    }
    let shown=0;
    for(const card of cards){
      const price=Number(card.dataset.productPrice)/100;
      const matches=(!category.value||productCategory(card.dataset.productTitle??'',card.dataset.productHandle)===category.value)&&price>=min&&price<=max;
      card.hidden=!matches;
      const item=card.closest<HTMLElement>('.product-grid__item');if(item)item.toggleAttribute('data-fem-filter-hidden',!matches);
      if(matches)shown++;
    }
    const template=shown===cards.length?(shown===1?form.dataset.countOne:form.dataset.countAll):form.dataset.countFiltered;
    count.textContent=(template??'').replace('[count]',String(shown)).replace('[total]',String(cards.length));
    if(scope.querySelector('[data-last-page]:not([data-last-page="1"]),[data-fem-catalog-pagination] a'))count.textContent+=' '+(form.dataset.pageSuffix??'');
    empty.hidden=shown!==0;reset.hidden=!keys.some(name=>(form.elements.namedItem(name) as HTMLInputElement).value);
    form.removeAttribute('aria-busy');writeURL();
  };
  form.addEventListener('submit',event=>{event.preventDefault();void update();});
  form.addEventListener('input',()=>void update());
  form.addEventListener('change',()=>void update());
  form.addEventListener('reset',event=>{event.preventDefault();for(const name of keys)(form.elements.namedItem(name) as HTMLInputElement).value='';void update();});
  window.addEventListener('popstate',()=>{readURL();void update();});
  readURL();form.hidden=false;void update();
  return ()=>void update();
}

export function enhanceCatalogFilters(root:ParentNode=document):void {
  const scopes=new Set(root.querySelectorAll<HTMLElement>('[data-fem-catalog]'));
  if(root instanceof HTMLElement){
    if(root.matches('[data-fem-catalog]'))scopes.add(root);
    if(root.matches('[data-fem-catalog-item]')||root.querySelector('[data-fem-catalog-item]')){
      const scope=root.closest<HTMLElement>('[data-fem-catalog]');if(scope)scopes.add(scope);
    }
  }
  for(const scope of scopes){
    if(!scope.querySelector('[data-fem-catalog-filters]'))continue;
    const refresh=controllers.get(scope);
    if(refresh)refresh();else controllers.set(scope,initialize(scope));
  }
}
