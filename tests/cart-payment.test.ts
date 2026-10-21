import test from 'node:test';
import assert from 'node:assert/strict';
import {CartClient,type CartState} from '../src/lib/cart.ts';
import {paymentAttributes,paymentPreference,satinRewardUnlocked} from '../src/lib/cart-payment.ts';
const state:CartState={items:[],item_count:1,total_price:100,currency:'COP',total_discount:0};
test('Reward applies to any nonempty order with prepaid preference, never COD or an empty cart',()=>{
 for(const total of [100,4690000,19990000]){
  assert.equal(satinRewardUnlocked({...state,total_price:total}),false);
  assert.equal(satinRewardUnlocked({...state,total_price:total,attributes:paymentAttributes('prepaid')}),true);
 }
 assert.equal(satinRewardUnlocked({...state,item_count:0,attributes:paymentAttributes('prepaid')}),false);
 assert.equal(paymentPreference({...state,attributes:{fem_payment_preference:'invalid'}}),'cod');
 assert.equal(paymentAttributes('cod').fem_satin_reward,'');
 assert.equal(paymentAttributes('prepaid').fem_satin_reward,'pending_payment_confirmation');
});
test('Preference is saved on Shopify and cleared on switching back without altering items or prices',async()=>{
 const requests:any[]=[];
 const api=new CartClient('/',(async(url,init)=>{requests.push({url,body:JSON.parse(String(init?.body))});return new Response(JSON.stringify(state));}) as typeof fetch);
 await api.updateAttributes(paymentAttributes('prepaid'));await api.updateAttributes(paymentAttributes('cod'));
 assert.equal(requests[0].url,'/cart/update.js');
 assert.deepEqual(requests[1].body,{attributes:{fem_payment_preference:'cod',fem_satin_reward:''}});
});
