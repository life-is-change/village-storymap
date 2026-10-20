import test from 'node:test';import assert from 'node:assert/strict';
import {createTaskService} from '../unified/tasks.mjs';
let api;try{api=await import('../local-tasks/transport.mjs');}catch{api={};}
const id='10000000-0000-4000-8000-000000000001',fileId='20000000-0000-4000-8000-000000000002';
test('local outbox submission keeps the same immutable photo ID/hash without upload or source context replication',async()=>{
 assert.equal(typeof api.createLocalTaskTransport,'function');const calls=[];let closed=0,finished;
 const queue={instanceId:'aliyun-test',async control(action,p){calls.push([action,p]);return {instanceId:'aliyun-test',runId:id};}};
 const transport=api.createLocalTaskTransport({queue});
 const job={id,lease:id,operation:'submit',ownerId:id,requestId:id,snapshots:[{localKind:'profile'}],photo:{fileId},bridgeInput:{ownerId:id,requestId:id,kind:'facade'}};
 const database={withMaintenance:async fn=>fn({query:async(sql,args)=>({rows:[{data:sql.includes('task_next')?job:sql.includes('task_finish')?(finished=JSON.parse(args[2])):{allowed:true}}]})})};
 const files={async readTaskInput(){return {size:8,mime:'image/png',sha256:'a'.repeat(64),stream(){throw Error('local photo must not be copied');},async close(){closed++;}};}};
 const service=createTaskService({database,bridge:transport,files});await service.tick();await service.close();
 assert.equal(closed,1);assert.deepEqual(calls,[['enqueue',{ownerId:id,requestId:id,photo:{fileId,size:8,mime:'image/png',sha256:'a'.repeat(64)}}]]);assert.equal(finished.runId,id);
});
test('local artifact download has no network fallback and preserves fixed task ownership',async()=>{
 assert.equal(typeof api.createLocalTaskTransport,'function');const queue={instanceId:'aliyun-test',control:async()=>({data:{available:false}})};
 const transport=api.createLocalTaskTransport({queue});assert.equal((await transport.availability({kind:'geoprocessing'})).data.available,false);
 await assert.rejects(transport.downloadArtifact({ownerId:id,requestId:id},'buildings'),{code:'FILE_UNAVAILABLE'});
});
