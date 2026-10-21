import {createHmac,timingSafeEqual,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {variantById} from './catalog.ts';
type Line={id:number;quantity:number;properties:Record<string,string>;selling_plan?:number};
type Session={lines:Line[];attributes:Record<string,string>};
let devSecret:string|undefined;
function secret(){
 if(process.env.FEM_CART_SECRET)return process.env.FEM_CART_SECRET;
 if(process.env.NODE_ENV==='production'||process.env.VERCEL)throw Error('Configura FEM_CART_SECRET para el carrito persistente.');
 if(!devSecret){try{devSecret=readFileSync('.local/cart-secret','utf8');}catch{mkdirSync('.local',{recursive:true});devSecret=randomBytes(32).toString('hex');writeFileSync('.local/cart-secret',devSecret,{mode:0o600});}}
 return devSecret;
}
const sign=(value:string)=>createHmac('sha256',secret()).update(value).digest('base64url');
export function readCartCookie(cookie=''):Session{
 const raw=cookie.match(/(?:^|;\s*)fem_cart=([^;]+)/)?.[1];
 if(raw){try{const [value,mac]=raw.split('.');const expected=Buffer.from(sign(value)),provided=Buffer.from(mac??'');if(expected.length===provided.length&&timingSafeEqual(expected,provided)){const parsed=JSON.parse(Buffer.from(value,'base64url').toString());if(Array.isArray(parsed.lines)&&parsed.lines.length<=15&&parsed.attributes)return parsed;}}catch{}}
 return {lines:[],attributes:{}};
}
export function cartCookie(cart:Session,secure=false){const value=Buffer.from(JSON.stringify(cart)).toString('base64url');if(value.length>3500)throw Object.assign(Error('El carrito tiene demasiada información.'),{status:422});return `fem_cart=${value}.${sign(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure?'; Secure':''}`;}
const key=(line:Line)=>line.id+':'+createHmac('sha256','fem-line').update(JSON.stringify([line.selling_plan??null,line.properties])).digest('hex').slice(0,16);
export function cartState(cart:Session){
 const items=cart.lines.flatMap(line=>{
  const found=variantById(line.id);if(!found)return [];
  const {variant:v,product:p}=found;
  const allocation=line.selling_plan?v.selling_plan_allocations?.find(a=>a.selling_plan_id===line.selling_plan):undefined;
  const price=allocation?.price??v.price;
  return [{key:key(line),id:v.id,variant_id:v.id,product_id:p.id,title:p.title,product_title:p.title,variant_title:v.title==='Default Title'?'':v.title,quantity:line.quantity,price,final_price:price,original_price:price,final_line_price:price*line.quantity,original_line_price:price*line.quantity,url:p.url+'?variant='+v.id,image:p.featured_image,featured_image:{url:p.featured_image,alt:p.title},properties:line.properties,...(allocation?{selling_plan_allocation:{price,selling_plan:{id:line.selling_plan,name:'Suscripción FEM'}}}:{})}];
 });
 const total=items.reduce((n,i)=>n+i.final_line_price,0);
 return {token:'fem',items,item_count:items.reduce((n,i)=>n+i.quantity,0),total_price:total,original_total_price:total,total_discount:0,currency:'COP',attributes:cart.attributes,requires_shipping:items.length>0};
}
function quantity(value:unknown,allowZero=false){const n=Number(value);if(!Number.isInteger(n)||n<(allowZero?0:1)||n>99)throw Object.assign(Error('Selecciona una cantidad válida.'),{status:422});return n;}
function properties(value:unknown){if(!value||typeof value!=='object')return {};const entries=Object.entries(value).slice(0,8).map(([k,v])=>[k.slice(0,50),String(v).slice(0,100)]);return Object.fromEntries(entries);}
function validate(line:Line){const found=variantById(line.id);if(!found||!found.product.available||!found.variant.available)throw Object.assign(Error('Este producto no está disponible.'),{status:422});if(line.selling_plan&&!found.variant.selling_plan_allocations?.some(a=>a.selling_plan_id===line.selling_plan))throw Object.assign(Error('El plan seleccionado no está disponible.'),{status:422});}
export function mutateCart(cart:Session,action:string,body:any):Session{
 const next=structuredClone(cart);
 if(action==='clear')return {lines:[],attributes:next.attributes};
 if(action==='add'){
  const additions=Array.isArray(body.items)?body.items:[body];if(additions.length>15)throw Object.assign(Error('Demasiados productos.'),{status:422});
  for(const item of additions){const line:Line={id:Number(item.id),quantity:quantity(item.quantity??1),properties:properties(item.properties),...(item.selling_plan?{selling_plan:Number(item.selling_plan)}:{})};validate(line);const existing=next.lines.find(l=>key(l)===key(line));if(existing)existing.quantity=quantity(existing.quantity+line.quantity);else next.lines.push(line);}
 }else if(action==='change'){
  const line=body.line?next.lines[Number(body.line)-1]:next.lines.find(l=>key(l)===String(body.id)||String(l.id)===String(body.id));if(!line)throw Object.assign(Error('Producto no encontrado en el carrito.'),{status:422});line.quantity=quantity(body.quantity,true);if(body.properties)line.properties=properties(body.properties);
 }else if(action==='update'){
  if(body.attributes)next.attributes={...next.attributes,...properties(body.attributes)};
  if(body.updates)for(const [id,q]of Object.entries(body.updates)){const line=next.lines.find(l=>key(l)===id||String(l.id)===id);if(line)line.quantity=quantity(q,true);}
 }
 next.lines=next.lines.filter(l=>l.quantity>0);if(next.lines.length>15)throw Object.assign(Error('Máximo 15 productos distintos por carrito.'),{status:422});next.lines.forEach(validate);return next;
}
