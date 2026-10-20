import test from 'node:test';import assert from 'node:assert/strict';
let api;try{api=await import('../unified/tasks.mjs');}catch{api={};}
const identity={userId:'10000000-0000-4000-8000-000000000001'},requestId='20000000-0000-4000-8000-000000000002';
test('task submission only commits an outbox request and never contacts the source inside a transaction',async()=>{
 assert.equal(typeof api.createTaskService,'function');let inside=false,remoteCalls=0;
 const database={async withIdentity(_identity,fn){inside=true;try{return await fn({async query(sql,args){assert.match(sql,/api_private.task_execute/);assert.equal(args[0],'tasks.submitGeo');return {rows:[{data:{requestId,state:'pending'}}]};}});}finally{inside=false;}},withMaintenance(){throw Error('not expected');}};
 const bridge={instanceId:'aliyun-test',async submit(){assert.equal(inside,false);remoteCalls++;}};
 const s=api.createTaskService({database,bridge,files:{}});const result=await s.execute(identity,'tasks.submitGeo',{requestId,teachingProjectId:requestId,villageId:requestId,spaceId:'A',courseId:'course',requestedSteps:['buildings'],aoi:{type:'Polygon',coordinates:[]},parameters:{}});
 assert.deepEqual(result,{requestId,state:'pending'});assert.equal(remoteCalls,0);await s.close();
});
test('outbox delivery is single flight, reuses the original request ID and retries with bounded backoff',async()=>{
 assert.equal(typeof api.createTaskService,'function');let ack=0,attempts=0,release,now=0;const calls=[];
 const job={id:requestId,operation:'submit',ownerId:identity.userId,requestId,bridgeInput:{ownerId:identity.userId,requestId,kind:'geo',contextId:'capsule',contextVersion:1,profileVersion:1,input:{}},snapshots:[]};
 const database={async withMaintenance(fn){return fn({async query(sql,args){calls.push([sql,args]);if(sql.includes('task_next'))return {rows:[{data:ack?null:job}]};if(sql.includes('task_before_submit'))return {rows:[{data:{allowed:true}}]};if(sql.includes('task_finish')){ack++;return {rows:[{data:{}}]};}if(sql.includes('task_fail')){attempts++;return {rows:[{data:{}}]};}throw Error(sql);}});}};
 const bridge={instanceId:'aliyun-test',async submit(input){assert.equal(input.requestId,requestId);await new Promise(r=>release=r);throw Object.assign(Error(),{code:'BRIDGE_UNAVAILABLE'});}};
 const s=api.createTaskService({database,bridge,files:{},now:()=>now});const first=s.tick();await new Promise(r=>setImmediate(r));assert.equal(await s.tick(),false);release();assert.equal(await first,true);assert.equal(attempts,1);assert.equal(ack,0);assert.ok(calls.some(([sql,args])=>sql.includes('task_fail')&&args[2]===1000));await s.close();assert.equal(await s.tick(),false);
});

test('retry with a lost source response acknowledges its authorized current status rather than abandoning polling',async()=>{
 let acknowledged,failed=0;const job={id:requestId,lease:requestId,sourceRunId:requestId,operation:'retry',ownerId:identity.userId,requestId,snapshots:[]};
 const database={async withMaintenance(fn){return fn({async query(sql,args){if(sql.includes('task_next'))return {rows:[{data:job}]};if(sql.includes('task_finish')){acknowledged=JSON.parse(args[2]);return {rows:[{data:{}}]};}if(sql.includes('task_fail')){failed++;return {rows:[{data:{}}]};}throw Error(sql);}});}};
 const bridge={instanceId:'aliyun-test',async retry(){throw {code:'BRIDGE_UNAVAILABLE'};},async status(){return {instanceId:'aliyun-test',runId:requestId,run:{status:'queued_generation'}};}};
 const service=api.createTaskService({database,bridge,files:{}});await service.tick();await service.close();assert.equal(failed,0);assert.equal(acknowledged.run.status,'queued_generation');
});
