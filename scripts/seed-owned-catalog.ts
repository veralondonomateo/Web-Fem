/** Seed the private checkout catalog without overwriting operational stock. */
import {readFile} from 'node:fs/promises';
const origin=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!origin||!key)throw Error('Load the private checkout environment first.');
const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
const endpoint=new URL('/rest/v1/fem_catalog_variants',origin);
const existing=await fetch(endpoint+'?select=variant_id',{headers});if(!existing.ok)throw Error('Apply docs/independent-commerce.sql before seeding.');
const ids=new Set((await existing.json() as {variant_id:number}[]).map(v=>Number(v.variant_id)));
const products=JSON.parse(await readFile('content/catalog.json','utf8'));
let count=0;
for(const p of products)for(const v of p.variants){
 const data={price_cents:v.price,available:p.available&&v.available};
 const response=await fetch(endpoint+(ids.has(v.id)?'?variant_id=eq.'+v.id:''),{method:ids.has(v.id)?'PATCH':'POST',headers,body:JSON.stringify(ids.has(v.id)?data:{variant_id:v.id,...data,stock:null})});
 if(!response.ok)throw Error('Catalog update failed for variant '+v.id);count++;
}
console.log(`Owned checkout catalog ready: ${count} variants. Existing stock was preserved.`);
