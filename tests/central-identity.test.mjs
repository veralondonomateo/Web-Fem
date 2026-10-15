import test from 'node:test';import assert from 'node:assert/strict';
import {authenticateCentral,centralUser,centralEmail} from '../integrations/identity.mjs';
import {issue,session} from '../integrations/auth.mjs';
const env={SUPABASE_URL:'https://example.test',SUPABASE_SERVICE_ROLE_KEY:'test'};
test('Central rejects advisers and missing email before authentication',async()=>{for(const email of ['luciana@grupomsm.co','lina@grupomsm.co',undefined])assert.equal(await authenticateCentral(email,'test',env,()=>{throw Error('must not fetch')}),false);});
test('Central trusts active CRM role and linked Auth identity, never client metadata',async()=>{for(const [role,active,id,expected] of [['ADMIN',true,'one',true],['AGENT',true,'one',false],['ADMIN',false,'one',false],['ADMIN',true,'other',false]]){const request=async url=>Response.json(String(url).includes('/token')?{user:{id,email:centralEmail,user_metadata:{role:'ADMIN'}}}:[{auth_user_id:'one',role,is_active:active,email:centralEmail}]);assert.equal(await authenticateCentral(centralEmail,'test',env,request),expected);}});
test('Bad credentials and unavailable role lookup fail closed',async()=>{assert.equal(await authenticateCentral(centralEmail,'bad',env,async()=>new Response('',{status:400})),false);await assert.rejects(centralUser(env,async()=>new Response('',{status:503})));});
test('Old shared-password cookie cannot authenticate',()=>{const id=issue();assert.equal(session({headers:{cookie:`fem_admin=${id}`}}),null);assert.ok(session({headers:{cookie:`fem_admin_v2=${id}`}}));});
