export function rangeFor(preset,now=new Date()){
 const today=new Date(now.getTime()-5*3600000).toISOString().slice(0,10);const start=new Date(today+'T00:00:00-05:00');
 if(preset==='7d')start.setUTCDate(start.getUTCDate()-6);
 if(preset==='30d')start.setUTCDate(start.getUTCDate()-29);
 if(preset==='month')start.setUTCDate(1);
 if(preset==='year'){start.setUTCMonth(0,1);}
 return {from:start.toISOString(),to:now.toISOString()};
}
export function summarize(orders,range){
 const selected=orders.filter(o=>Date.parse(o.created_at)>=Date.parse(range.from)&&Date.parse(o.created_at)<=Date.parse(range.to));
 const approved=selected.filter(o=>o.status==='approved');
 const revenue=approved.reduce((s,o)=>s+Number(o.total||0),0);
 const collected=approved.filter(o=>o.payment_method==='mercadopago').reduce((s,o)=>s+Number(o.total||0),0);
 const customers=new Map(),daily=new Map(),cities=new Map();
 for(const o of orders.filter(o=>o.status==='approved')){const key=o.email?.toLowerCase();if(!key)continue;const c=customers.get(key)||{email:key,name:[o.first_name,o.last_name].filter(Boolean).join(' '),orders:0,value:0,last:o.created_at};c.orders++;c.value+=Number(o.total||0);if(o.created_at>c.last)c.last=o.created_at;customers.set(key,c);}
 for(let t=Date.parse(range.from);t<=Date.parse(range.to);t+=86400000)daily.set(new Date(t-18000000).toISOString().slice(0,10),0);
 for(const o of approved){const day=new Date(Date.parse(o.created_at)-18000000).toISOString().slice(0,10);daily.set(day,(daily.get(day)||0)+Number(o.total||0));const city=o.city||'Sin ciudad';cities.set(city,(cities.get(city)||0)+1);}
 const list=[...customers.values()].sort((a,b)=>b.value-a.value);
 return {range,kpis:{orders:selected.length,approved:approved.length,revenue,collected,pending: selected.filter(o=>o.status==='pending').length,aov:approved.length?revenue/approved.length:null,ltv:list.length?list.reduce((s,c)=>s+c.value,0)/list.length:null,repeat:list.length?list.filter(c=>c.orders>1).length/list.length:null,customers:list.length,cod:approved.filter(o=>o.payment_method==='contraentrega').length},series:[...daily].sort().map(([day,value])=>({day,value})),cities:[...cities].sort((a,b)=>b[1]-a[1]).slice(0,8),orders:selected.sort((a,b)=>b.created_at.localeCompare(a.created_at)),customers:list};
}
export function economics({revenue,cogs,shipping,fees,ads,refunds}){const values=[revenue,cogs,shipping,fees,ads,refunds].map(Number);if(values.some(v=>!Number.isFinite(v)||v<0))throw Error('Costos inválidos');const [r,c,s,f,a,d]=values;return {contribution:r-c-s-f-a-d,margin:r?(r-c-s-f-a-d)/r:null,roas:a?r/a:null};}
