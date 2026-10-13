import test from 'node:test';import assert from 'node:assert/strict';
import {rangeFor,summarize,economics} from '../integrations/metrics.mjs';
import {equal,issue,session,sessions} from '../integrations/auth.mjs';
test('Revenue distinguishes approved COD from actual online collection and computes historical LTV',()=>{const orders=[{created_at:'2026-10-13T12:00:00Z',email:'a@b.co',total:100,status:'approved',payment_method:'contraentrega'},{created_at:'2026-10-13T13:00:00Z',email:'a@b.co',total:200,status:'approved',payment_method:'mercadopago'},{created_at:'2026-10-13T14:00:00Z',email:'c@b.co',total:800,status:'pending',payment_method:'mercadopago'}];const s=summarize(orders,{from:'2026-10-13',to:'2026-10-14'});assert.equal(s.kpis.revenue,300);assert.equal(s.kpis.collected,200);assert.equal(s.kpis.aov,150);assert.equal(s.kpis.ltv,300);assert.equal(s.kpis.pending,1);assert.equal(s.kpis.repeat,1);});
test('Bogota day boundaries, month and year ranges',()=>{const now=new Date('2026-10-13T03:00:00Z');assert.equal(rangeFor('today',now).from,'2026-10-12T05:00:00.000Z');assert.equal(rangeFor('year',now).from,'2026-01-01T05:00:00.000Z');assert.equal(rangeFor('month',now).from,'2026-10-01T05:00:00.000Z');});
test('No invented ratios on empty data and invalid financial input rejected',()=>{const s=summarize([],{from:'2026',to:'2027'});assert.equal(s.kpis.aov,null);assert.equal(s.kpis.ltv,null);assert.throws(()=>economics({revenue:10,cogs:-1,shipping:0,fees:0,ads:0,refunds:0}));assert.equal(economics({revenue:100,cogs:20,shipping:10,fees:5,ads:15,refunds:10}).contribution,40);});
test('Admin sessions expire and malformed cookie never authenticates',()=>{assert.equal(equal('a','a'),true);assert.equal(equal('a','b'),false);const id=issue();assert.ok(session({headers:{cookie:`fem_admin=${id}`}}));sessions.set(id,{until:0});assert.equal(session({headers:{cookie:`fem_admin=${id}`}}),null);assert.equal(session({headers:{cookie:'fem_admin=forged'}}),null);});

test('Unified cart keeps all variants, quantities and authoritative discounted prices',async()=>{
 const {cartPayload}=await import('../integrations/cart.mjs');
 const c={currency:'COP',total_price:22000000,attributes:{fem_payment_preference:'prepaid'},items:[{key:'a',variant_id:101,quantity:2,final_line_price:20000000,product_title:'FEM'},{key:'b',variant_id:102,quantity:1,final_line_price:2000000,product_title:'Jabón'}]};
 const d=cartPayload(c);assert.equal(d.items.length,2);assert.equal(d.items[0].quantity,2);assert.equal(d.items[0].price,100000);assert.equal(d.total,220000);assert.equal(d.payment,'mercadopago');
 assert.equal(cartPayload({...c,attributes:{}}).payment,'contraentrega');
 assert.throws(()=>cartPayload({...c,currency:'USD'}));
 assert.throws(()=>cartPayload({...c,items:[{...c.items[0],selling_plan_allocation:{id:1}}]}));
 assert.throws(()=>cartPayload({...c,items:[{...c.items[0],quantity:-1}]}));
 assert.equal(cartPayload({...c,items:[]}),null);
});

test('Counter uses a shared persistent base and does not create real orders',async()=>{
 const {milestone}=await import('../integrations/milestone.mjs');const a=milestone();const b=milestone(a.now+45000);
 const value=d=>Math.min(d.goal,d.base+Math.floor((d.now-d.startedAt)/d.interval));
 assert.equal(a.base,204994);assert.equal(a.simulated,true);assert.equal(value(b)-value(a),1);assert.equal(a.startedAt,b.startedAt);
});

test('Prepaid checkout cannot downgrade to COD and shared payments require Mercado Pago',async()=>{
 const {paymentError}=await import('../integrations/cart.mjs');
 assert.equal(paymentError({payment:'mercadopago'},{paymentMethod:'contraentrega'}).codigo,'pago_anticipado_requerido');
 assert.equal(paymentError({payment:'mercadopago'},{paymentMethod:'mercadopago',thirdPartyPay:true}),null);
 assert.equal(paymentError({payment:'contraentrega'},{paymentMethod:'contraentrega',thirdPartyPay:true}).codigo,'pago_compartido_invalido');
 assert.equal(paymentError({payment:'contraentrega'},{paymentMethod:'contraentrega'}),null);
 assert.equal(paymentError({payment:'contraentrega'},{paymentMethod:'other'}).codigo,'pago_invalido');
});
