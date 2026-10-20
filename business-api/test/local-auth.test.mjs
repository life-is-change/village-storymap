import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentityVerifier} from '../src/auth.mjs';
import {createUnifiedDatabase} from '../unified/database.mjs';
import {loadUnifiedConfig} from '../unified/config.mjs';
let policyModule;try{policyModule=await import('../auth/policy.mjs');}catch{policyModule={};}
const source='https://rzmbmwauomzwiyenafha.supabase.co';
const origin='https://8.148.248.237';
const uid='10000000-0000-4000-8000-000000000001';
const sid='20000000-0000-4000-8000-000000000001';
const now=()=>1000000;
function token(changes={},header={alg:'HS256'}){
 const claims={sub:uid,iss:origin+'/auth/v1',aud:'authenticated',role:'authenticated',exp:2000,session_id:sid,...changes};
 return [header,claims,'synthetic'].map(v=>typeof v==='object'?Buffer.from(JSON.stringify(v)).toString('base64url'):v).join('.');
}
const local={authMode:'local',authOrigin:origin,authInternalOrigin:'http://auth:9999'};
function make(fetchImpl,checkLocalSession=async()=>true){return createIdentityVerifier({...local,fetchImpl,checkLocalSession,now});}

test('local Auth rejects source issuer and missing session before fetching',async()=>{
 let calls=0;const verify=make(async()=>{calls++;return Response.json({id:uid});});
 for(const changes of [{iss:source+'/auth/v1'},{session_id:undefined},{session_id:'forged'},{role:'service_role'},{aud:'anon'}])await assert.rejects(verify('Bearer '+token(changes)),{code:'UNAUTHORIZED'});
 assert.equal(calls,0);
});
test('local Auth proves signature with internal GoTrue and exposes no token or metadata',async()=>{
 const calls=[];let sessionChecked;
 const verify=make(async(url,options)=>{calls.push({url,options});return Response.json({id:uid,user_metadata:{role:'admin',private:'hidden'}});},async actor=>{sessionChecked=actor;return true;});
 const actor=await verify('Bearer '+token());
 assert.deepEqual(actor,{userId:uid,issuer:origin+'/auth/v1',audience:'authenticated',role:'authenticated',expiry:2000,sessionId:sid});
 assert.equal(calls[0].url,'http://auth:9999/user');assert.equal(calls[0].options.redirect,'error');
 assert.equal(calls[0].options.headers.Authorization,'Bearer '+token());assert.equal(calls[0].options.headers.apikey,undefined);
 assert.equal(sessionChecked.sessionId,sid);assert.equal(Object.isFrozen(actor),true);
 assert.ok(!JSON.stringify(actor).includes('hidden'));
});
test('revoked local session and failed local proof cannot authorize or fall back',async()=>{
 for(const check of [async()=>false,async()=>{throw Error('private database details');}])await assert.rejects(make(async()=>Response.json({id:uid}),check)('Bearer '+token()),e=>['UNAUTHORIZED','AUTH_UNAVAILABLE'].includes(e.code)&&!e.message.includes('private'));
 await assert.rejects(make(async()=>new Response('private',{status:401}))('Bearer '+token()),{code:'UNAUTHORIZED'});
 assert.throws(()=>createIdentityVerifier({...local}),/INVALID_CONFIGURATION/);
});
test('policy refuses caller-selected public or internal credential destinations',()=>{
 assert.equal(typeof policyModule.resolveAuthPolicy,'function');
 for(const patch of [{authOrigin:source},{authInternalOrigin:'http://evil:9999'},{authInternalOrigin:'https://8.148.248.237'},{authMode:'unknown'},{authOrigin:origin+'/'},{authOrigin:'http://8.148.248.237'}])assert.throws(()=>policyModule.resolveAuthPolicy({...local,...patch}),/INVALID_CONFIGURATION/);
 assert.equal(policyModule.resolveAuthPolicy(local).issuer,origin+'/auth/v1');
 assert.equal(policyModule.resolveAuthPolicy({authOrigin:source}).issuer,source+'/auth/v1');
});
test('database rejects cross-site identity before borrowing a connection',async()=>{
 const calls=[];const client={query:async(sql)=>{calls.push(sql);return {rows:[{status:'active',active:true}]};},release(){}};
 const pool={options:{max:4},on(){},connect:async()=>client,end:async()=>{}};
 const db=createUnifiedDatabase({pool,now},{authPolicy:local});
 await assert.rejects(db.withIdentity({userId:uid,issuer:source+'/auth/v1',expiry:2000},async()=>1),{code:'UNAUTHORIZED'});
 assert.equal(calls.length,0);
 assert.equal(await db.withIdentity({userId:uid,issuer:origin+'/auth/v1',expiry:2000,sessionId:sid},async()=>7),7);
 await db.close();
});
test('local configuration cannot retain bridge or source credential settings',()=>{
 const env={AUTH_MODE:'local',AUTH_PUBLIC_ORIGIN:origin,AUTH_INTERNAL_ORIGIN:'http://auth:9999',PGHOST:'postgres',PGDATABASE:'village_unified_candidate',PGUSER:'village_unified_login',PGPASSWORD_FILE:'/run/secrets/db',UNIFIED_INSTANCE_ID:'aliyun-test',UNIFIED_FILES_ROOT:'/data/business',UNIFIED_SCENE_ROOT:'/data/scene',UNIFIED_LEGACY_ROOT:'/legacy',UNIFIED_LEGACY_INDEX:'/legacy/index.json',UNIFIED_RELEASE_FILE:'/app/release.json'};
 const readSecret=()=> 'x'.repeat(40);
 const config=loadUnifiedConfig(env,{readSecret});assert.equal(config.authMode,'local');assert.equal(config.authOrigin,origin);assert.equal(config.bridge.enabled,false);
 for(const patch of [{BRIDGE_ENABLED:'true',BRIDGE_TOKEN_FILE:'/run/secrets/bridge'},{SUPABASE_AUTH_ORIGIN:source},{SUPABASE_PUBLISHABLE_KEY:'sb_publishable_old'},{AUTH_INTERNAL_ORIGIN:'http://evil'},{AUTH_PUBLIC_ORIGIN:source},{GOTRUE_JWT_SECRET:'private'}])assert.throws(()=>loadUnifiedConfig({...env,...patch},{readSecret}),/INVALID_CONFIGURATION/);
});
