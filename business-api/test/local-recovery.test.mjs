import test from 'node:test';import assert from 'node:assert/strict';
import {jwtVerify} from 'jose';
import {Readable} from 'node:stream';
import * as cli from '../auth/recovery-cli.mjs';
let api;try{api=await import('../auth/recovery.mjs');}catch{api={};}
const actorId='40000000-0000-4000-8000-000000000004',targetId='50000000-0000-4000-8000-000000000005';
const requestId='60000000-0000-4000-8000-000000000006',finishToken='70000000-0000-4000-8000-000000000007';
const input={adminStudentId:'332',adminPassword:'current-hidden-password',targetStudentId:'fresh',newPassword:'changed-hidden-password',requestId};
function fixture({fresh=true,state='pending',authFailure=false,denied=false,reconciles=true}={}){
 const effects=[];const actor={userId:actorId};
 const auth={login:async()=>actor,fingerprint:()=> 'a'.repeat(64),async changePassword(id){effects.push(['password',id]);if(authFailure)throw Error('private provider response with credentials');},async checkNewPassword(){return reconciles;}};
 const database={async withIdentity(id,fn){if(denied)throw Object.assign(Error('FORBIDDEN'),{code:'FORBIDDEN'});assert.equal(id,actor);return fn({query:async()=>({rows:[{data:{fresh,state,targetId,finishToken}}]})});},async withMaintenance(fn){return fn({query:async(sql,args)=>{effects.push(['finish',args.at(-1)]);return {rows:[{data:{state:args.at(-1)}}]};}});}};
 return {auth,database,effects};
}
test('password recovery reauthenticates the admin and completes one bounded action',async()=>{
 assert.equal(typeof api.createRecoveryService,'function');const f=fixture();let reauthenticated=false;
 f.auth.login=async(student,password)=>{assert.equal(student,'332');assert.equal(password,input.adminPassword);reauthenticated=true;return {userId:actorId};};
 // Database identity proof is independent of this test's object reference.
 f.database.withIdentity=async(actor,fn)=>{assert.ok(reauthenticated);assert.equal(actor.userId,actorId);return fn({query:async()=>({rows:[{data:{fresh:true,state:'pending',targetId,finishToken}}]})});};
 const service=api.createRecoveryService(f);const result=await service.reset(input);
 assert.deepEqual(result,{status:'local_password_reset_completed',accounts:1});assert.deepEqual(f.effects,[['password',targetId],['finish','completed']]);
 assert.ok(!JSON.stringify(result).includes('hidden'));
});
test('nonadmin denial and malformed input never reach the privileged Auth operation',async()=>{
 assert.equal(typeof api.createRecoveryService,'function');const f=fixture({denied:true});
 await assert.rejects(api.createRecoveryService(f).reset(input),{code:'FORBIDDEN'});assert.deepEqual(f.effects,[]);
 for(const patch of [{targetStudentId:'../admin'},{newPassword:'short'},{requestId:'invalid'},{newPassword:'汉'.repeat(30)}])await assert.rejects(api.createRecoveryService(f).reset({...input,...patch}),{code:'INVALID_INPUT'});
});
test('lost provider response is retained as unknown and never blindly resubmitted',async()=>{
 assert.equal(typeof api.createRecoveryService,'function');const f=fixture({authFailure:true});
 await assert.rejects(api.createRecoveryService(f).reset(input),e=>e.code==='RECOVERY_UNKNOWN'&&!String(e).includes('private'));
 assert.deepEqual(f.effects,[['password',targetId],['finish','unknown']]);
 const replay=fixture({fresh:false,state:'unknown'});
 await assert.rejects(api.createRecoveryService(replay).reset(input),{code:'RECOVERY_UNKNOWN'});assert.deepEqual(replay.effects,[]);
 await api.createRecoveryService(replay).reset({...input,reconcile:true});assert.deepEqual(replay.effects,[['finish','completed']]);
});
test('completed receipt replays without repeating a password change and failed reconciliation stays unresolved',async()=>{
 assert.equal(typeof api.createRecoveryService,'function');const f=fixture({fresh:false,state:'completed'});
 assert.equal((await api.createRecoveryService(f).reset(input)).accounts,1);assert.deepEqual(f.effects,[]);
 const unknown=fixture({fresh:false,state:'unknown',reconciles:false});await assert.rejects(api.createRecoveryService(unknown).reset({...input,reconcile:true}),{code:'RECOVERY_UNKNOWN'});assert.deepEqual(unknown.effects,[]);
});
test('privileged reset uses a short-lived mature JWT only with the fixed internal Auth admin endpoint',async()=>{
 assert.equal(typeof api.createRecoveryAuth,'function');const key='s'.repeat(64);let received;
 const auth=api.createRecoveryAuth({jwtSecret:key,checkLocalSession:async()=>true,fetchImpl:async(url,options)=>{received={url,options};return Response.json({id:targetId});}});
 await auth.changePassword(targetId,input.newPassword);assert.equal(received.url,'http://auth:9999/admin/users/'+targetId);
 assert.equal(received.options.redirect,'error');assert.equal(JSON.parse(received.options.body).password,input.newPassword);
 const {payload}=await jwtVerify(received.options.headers.Authorization.slice(7),new TextEncoder().encode(key),{issuer:'https://8.148.248.237/auth/v1',audience:'authenticated',algorithms:['HS256']});
 assert.equal(payload.role,'service_role');assert.ok(payload.exp-payload.iat<=30);assert.equal(payload.sub,undefined);
 assert.throws(()=>api.createRecoveryAuth({jwtSecret:'short',checkLocalSession:async()=>true}),/INVALID_CONFIGURATION/);
});
test('private operator stdin protocol bounds credential bytes and rejects malformed UTF8',async()=>{
 assert.equal(typeof cli.readRecoveryInput,'function');
 assert.deepEqual(await cli.readRecoveryInput(Readable.from([Buffer.from(JSON.stringify(input))])),input);
 for(const bytes of [Buffer.alloc(16385,32),Buffer.from([0xff]),Buffer.from('{bad json')])await assert.rejects(cli.readRecoveryInput(Readable.from([bytes])),/INVALID_INPUT/);
});
