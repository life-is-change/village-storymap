import test from 'node:test';import assert from 'node:assert/strict';
import {createIdentityGateway,createIdentityService} from '../unified/identity.mjs';
const uid='10000000-0000-4000-8000-000000000001',sid='20000000-0000-4000-8000-000000000001';
const issuer='https://8.148.248.237/auth/v1';
const actor={userId:uid,issuer,sessionId:sid,expiry:2000000000};
const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const authorization='Bearer '+[encode({alg:'HS256'}),encode({sub:uid,iss:issuer,exp:2000000000,aud:'authenticated',role:'authenticated',session_id:sid}),'synthetic'].join('.');
const config={authMode:'local',authOrigin:'https://8.148.248.237',authInternalOrigin:'http://auth:9999',checkLocalSession:async()=>true};
test('local profile metadata comes from verified local Auth only and email binds the student identity',async()=>{
 const calls=[],user={id:uid,email:'sid-332@rzmbmwauomzwiyenafha.supabase.co',email_confirmed_at:'2026-01-01T00:00:00Z',user_metadata:{student_id:'332',display_name:'Admin',role:'admin',arbitrary:'hidden'}};
 const gateway=createIdentityGateway({...config,fetchImpl:async url=>{calls.push(url);return Response.json(user);}});
 const verified=await gateway.verifyIdentity(authorization);const profile=await gateway.sourceProfileReader(verified);
 assert.equal(profile.student_id,'332');assert.equal(profile.id,uid);assert.equal(profile.role,undefined);assert.equal(profile.arbitrary,undefined);assert.ok(calls.every(url=>url==='http://auth:9999/user'));
 user.user_metadata.student_id='another';await assert.rejects(gateway.sourceProfileReader(verified),{code:'PROFILE_NOT_SYNCED'});
 await assert.rejects(gateway.sourceProfileReader({...verified}),{code:'UNAUTHORIZED'});
});
test('local bootstrap uses real-account provisioner rather than the legacy Auth anchor function',async()=>{
 let called;const database={withMaintenance:async fn=>fn({query:async(sql,args)=>{called={sql,args};return {rows:[{data:{id:uid,role:'student'}}]};}})};
 const service=createIdentityService({database,authPolicy:config,sourceProfileReader:async()=>({id:uid,student_id:'332',display_name:'New',role:'admin'})});
 assert.equal((await service.ensureProfile(actor)).role,'student');assert.equal(called.sql,'SELECT api_private.ensure_local_profile($1,$2::jsonb) AS data');
 assert.equal(JSON.parse(called.args[1]).role,undefined);
 await assert.rejects(service.ensureProfile({...actor,issuer:'https://rzmbmwauomzwiyenafha.supabase.co/auth/v1'}),{code:'UNAUTHORIZED'});
});
