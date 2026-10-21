import {readFileSync} from 'node:fs';
export interface CatalogVariant {id:number;title:string;price:number;compare_at_price:number|null;available:boolean;options:string[];sku:string|null;stock:number|null;featured_image?:{src:string}|null;selling_plan_allocations?:{selling_plan_id:number;price:number;compare_at_price:number}[]}
export interface CatalogProduct {id:number;handle:string;aliases:string[];url:string;title:string;description:string;vendor:string;available:boolean;price:number;compare_at_price:number|null;featured_image:string;images:string[];variants:CatalogVariant[];options:{name:string;position:number;values:string[]}[];selling_plan_groups?:unknown[]}
export const catalog=JSON.parse(readFileSync(new URL('../content/catalog.json',import.meta.url),'utf8')) as CatalogProduct[];
export const productByHandle=(handle:string)=>catalog.find(p=>p.handle===handle||p.aliases.includes(handle));
export function variantById(id:number){for(const product of catalog){const variant=product.variants.find(v=>v.id===id);if(variant)return {product,variant};}return null;}
const normalized=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
export function searchCatalog(query:string){const terms=normalized(query).split(/\s+/).filter(Boolean);return terms.length?catalog.filter(p=>terms.every(t=>normalized(p.title+' '+p.description).includes(t))):[];}
