import test from 'node:test';import assert from 'node:assert/strict';
import {AUTH_ORIGIN} from '../src/config.mjs';
let api;try{api=await import('../unified/identity.mjs');}catch{api={};}
const id='10000000-0000-4000-8000-000000000001';
const identity={userId:id,issuer:AUTH_ORIGIN+'/auth/v1',expiry:2000000000};
test('identity bootstrap never trusts a source role or caller user ID',async()=>{
 assert.equal(typeof api.createIdentityService,'function');let called;
 const database={withMaintenance:async fn=>fn({query:async(sql,args)=>{called={sql,args};return {rows:[{data:{id,role:'student'}}]};}})};
 const service=api.createIdentityService({database,sourceProfileReader:async()=>({id,student_id:'fresh',display_name:'Fresh',role:'admin'})});
 assert.equal((await service.ensureProfile(identity)).role,'student');assert.equal(called.args[0],id);assert.equal(Object.hasOwn(JSON.parse(called.args[1]),'role'),false);
 await assert.rejects(service.updateProfile(identity,{role:'admin'}),{code:'INVALID_INPUT'});
});
test('source identity gateway verifies every request online and never exposes its bearer',async()=>{
 assert.equal(typeof api.createIdentityGateway,'function');const calls=[];
 const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');const token=encode({alg:'HS256'})+'.'+encode({sub:id,iss:AUTH_ORIGIN+'/auth/v1',aud:'authenticated',role:'authenticated',exp:2000000000})+'.synthetic';
 const gateway=api.createIdentityGateway({authOrigin:AUTH_ORIGIN,publishableKey:'sb_publishable_test',now:()=>100000,fetchImpl:async(url,options)=>{calls.push([String(url),options]);return new Response(JSON.stringify(String(url).endsWith('/auth/v1/user')?{id}:[{id,student_id:'fresh',display_name:'Fresh',role:'admin'}]),{status:200});}});
 const first=await gateway.verifyIdentity('Bearer '+token);await gateway.verifyIdentity('Bearer '+token);
 assert.equal(calls.filter(([url])=>url.endsWith('/auth/v1/user')).length,2);
 assert.ok(!JSON.stringify(first).includes(token));assert.equal((await gateway.sourceProfileReader(first)).id,id);
 await assert.rejects(gateway.sourceProfileReader({...first}),{code:'UNAUTHORIZED'});
 assert.ok(calls.every(([,opts])=>opts.redirect==='error'));
});
test('identity gateway distinguishes unavailable Auth and missing source profile without leaking body',async()=>{
 assert.equal(typeof api.createIdentityGateway,'function');
 assert.throws(()=>api.createIdentityGateway({authOrigin:AUTH_ORIGIN,publishableKey:'sb_secret_private'}),/INVALID_CONFIGURATION/);
 const gateway=api.createIdentityGateway({authOrigin:AUTH_ORIGIN,publishableKey:'sb_publishable_test',fetchImpl:async()=>{throw Error('private network credentials');}});
 const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');const token=encode({alg:'HS256'})+'.'+encode({sub:id,iss:AUTH_ORIGIN+'/auth/v1',aud:'authenticated',role:'authenticated',exp:2000000000})+'.synthetic';
 await assert.rejects(gateway.verifyIdentity('Bearer '+token),e=>e.code==='AUTH_UNAVAILABLE'&&!e.message.includes('private'));
});
