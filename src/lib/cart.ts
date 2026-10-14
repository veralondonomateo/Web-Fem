export interface CartItem {
  key:string;variant_id:number;product_id:number;quantity:number;product_title?:string;title:string;
  variant_title?:string;final_line_price:number;original_line_price?:number;url:string;image?:string;
  featured_image?:{url:string;alt?:string};properties?:Record<string,unknown>;
  selling_plan_allocation?:{selling_plan:{name:string}};
}
export interface CartState {attributes?:Record<string,string>;items:CartItem[];item_count:number;total_price:number;total_discount:number;currency:string}
export interface AddItem {id:number;quantity:number;selling_plan?:number;properties?:Record<string,string>}
export interface CartProduct {id:number;title:string;handle:string;url?:string;available:boolean;price:number;featured_image?:string;images?:string[];variants:{id:number;available:boolean;price:number}[]}

export const visibleCartItems=(cart:CartState)=>cart.items.filter(item=>item.properties?.['_instant-hidden']!=='true');
export const visibleCartCount=(cart:CartState)=>visibleCartItems(cart).reduce((sum,item)=>sum+item.quantity,0);
export const shippingProgress=(cart:CartState,threshold:number)=>cart.currency==='COP'&&threshold>0?Math.max(0,Math.min(100,Math.floor(cart.total_price/threshold*100))):null;
export const cartMoney=(value:number,currency='COP')=>new Intl.NumberFormat('es-CO',{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(value/100);
export function addItemFromFields(id:number,quantity:number,fields:Iterable<[string,FormDataEntryValue]>):AddItem {
  if(!Number.isSafeInteger(id)||id<=0||!Number.isInteger(quantity)||quantity<1)throw new Error('Selecciona una cantidad y una variante válidas.');
  const item:AddItem={id,quantity};
  for(const [name,value] of fields){
    if(typeof value!=='string')continue;
    if(name==='selling_plan'&&Number(value)>0)item.selling_plan=Number(value);
    const property=name.match(/^properties\[(.+)\]$/)?.[1];
    if(property&&value)(item.properties??={})[property]=value;
  }
  return item;
}

export class CartClient {
  private root:string;
  private request:typeof fetch;
  constructor(root='/',request:typeof fetch=fetch){
    this.root=root.endsWith('/')?root:root+'/';
    this.request=request.bind(globalThis);
  }
  async json<T>(path:string,body?:unknown):Promise<T>{
    const response=await this.request(this.root+path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(path==='cart/add.js'?{'X-Fem-Cart-State':'1'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
    const data=await response.json().catch(()=>null);
    if(!response.ok)throw new Error(typeof data?.description==='string'?data.description:'No pudimos actualizar tu carrito. Inténtalo de nuevo.');
    if(!data)throw new Error('No pudimos cargar tu carrito. Inténtalo de nuevo.');
    return data as T;
  }
  updateAttributes(attributes:Record<string,string>){return this.json<CartState>('cart/update.js',{attributes});}
  read(){return this.json<CartState>('cart.js');}
  async add(item:AddItem){const result=await this.json<Partial<CartState>>('cart/add.js',{items:[item]});return Array.isArray(result.items)&&typeof result.total_price==='number'&&typeof result.item_count==='number'?result as CartState:this.read();}
  change(key:string,quantity:number){return this.json<CartState>('cart/change.js',{id:key,quantity});}
  async recommendations(productId:number){
    const data=await this.json<{products:CartProduct[]}>(`recommendations/products.json?product_id=${productId}&limit=6&intent=related`);
    return data.products.filter(product=>product.available&&product.variants.some(variant=>variant.available)).slice(0,2);
  }
}
