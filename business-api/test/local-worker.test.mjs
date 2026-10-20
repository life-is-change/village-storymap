import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
let authAPI,serviceAPI;try{authAPI=await import('../local-tasks/worker-auth.mjs');serviceAPI=await import('../local-tasks/service.mjs');}catch{authAPI={};serviceAPI={};}
const workerId='10000000-0000-4000-8000-000000000001',runId='20000000-0000-4000-8000-000000000002',lease='30000000-0000-4000-8000-000000000003',requestId='40000000-0000-4000-8000-000000000004';
const secret='A'.repeat(43),header='Bearer village_worker_'+workerId+'.'+secret;
test('browser JWTs and malformed Worker keys are rejected before any database call',async()=>{
 assert.equal(typeof authAPI.parseWorkerAuthorization,'function');
 for(const value of ['',undefined,'Bearer a.b.c',header+' trailing',header.replace(workerId,'another'),'Bearer village_worker_'+workerId+'.short'])assert.throws(()=>authAPI.parseWorkerAuthorization(value),e=>e.code==='UNAUTHORIZED');
 assert.deepEqual(authAPI.parseWorkerAuthorization(header),{workerId,tokenDigest:createHash('sha256').update(secret).digest('hex')});
});
test('Worker authentication resolves kind from database and never exposes the raw credential',async()=>{
 assert.equal(typeof serviceAPI.createLocalQueueService,'function');let lookedUp;
 const db={withMaintenance:async fn=>fn({query:async(sql,args)=>{lookedUp={sql,args};return {rows:[{data:{workerId,kind:'geo'}}]};}})};
 const service=serviceAPI.createLocalQueueService({database:db,instanceId:'aliyun-test'});
 const actor=await service.authenticate(header);assert.equal(actor.kind,'geo');assert.equal(actor.workerId,workerId);assert.equal(JSON.stringify(actor).includes(secret),false);
 assert.equal(lookedUp.args[1],createHash('sha256').update(secret).digest('hex'));
 assert.equal(Object.isFrozen(actor),true);
});
test('Worker command contracts reject caller-selected kind, arbitrary URLs and stale database errors safely',async()=>{
 assert.equal(typeof serviceAPI.createLocalQueueService,'function');let calls=0;
 const db={withMaintenance:async fn=>fn({query:async(sql)=>{calls++;return {rows:[{data:sql.includes('local_worker_auth')?{workerId,kind:'geo'}:{error:'LEASE_LOST',private:'not disclosed'}}]};}})};
 const queue=serviceAPI.createLocalQueueService({database:db,instanceId:'aliyun-test'}),actor=await queue.authenticate(header);
 for(const [action,payload] of [['claim',{requestId,kind:'facade'}],['progress',{url:'https://evil.test',progress:1}],['heartbeat',{protocol:'old-bridge-v1',state:'idle'}],['progress',{state:'running',progress:101}]])await assert.rejects(queue.workerCall(actor,action,runId,lease,payload),{code:'INVALID_INPUT'});
 assert.equal(calls,1);
 await assert.rejects(queue.workerCall(actor,'renew',runId,lease,{}),e=>e.code==='LEASE_LOST'&&e.status===409&&!e.message.includes('private'));
 await assert.rejects(queue.workerCall({...actor},'renew',runId,lease,{}),{code:'UNAUTHORIZED'});
});
test('file RPCs retain the opaque Worker proof and use only fixed file functions',async()=>{
 let last;const database={withMaintenance:async fn=>fn({query:async(sql,args)=>{last={sql,args};return {rows:[{data:sql.includes('local_worker_auth')?{workerId,kind:'geo'}:{state:'pending'}}]};}})};
 const queue=serviceAPI.createLocalQueueService({database,instanceId:'aliyun-test'}),actor=await queue.authenticate(header);
 assert.equal(typeof queue.fileCall,'function');await assert.rejects(queue.fileCall({...actor},'context',runId,lease,{}),{code:'UNAUTHORIZED'});
 await assert.rejects(queue.fileCall(actor,'DROP TABLE',runId,lease,{}),{code:'INVALID_INPUT'});
 await queue.fileCall(actor,'context',runId,lease,{});assert.match(last.sql,/SELECT api_private.local_worker_file\(/);assert.equal(last.args[1],createHash('sha256').update(secret).digest('hex'));assert.equal(last.args[5],lease);
});
