import test from 'node:test';import assert from 'node:assert/strict';let api;try{api=await import('../unified/bridge.mjs');}catch{api={};}
const owner='10000000-0000-4000-8000-000000000001',requestId='20000000-0000-4000-8000-000000000002';
test('bridge uses only fixed private operations and injects its own instance namespace',async()=>{
 assert.equal(typeof api.createTaskBridge,'function');const calls=[];const bridge=api.createTaskBridge({instanceId:'aliyun-test',remote:{async call(name,payload){calls.push([name,payload]);return {instanceId:payload.p_instance_id,version:1,runId:requestId};}}});
 await bridge.applyContext({localKind:'profile',localId:owner,version:1,tombstone:false,payload:{active:true}});
 const job={ownerId:owner,requestId,contextId:'space-A',contextVersion:1,profileVersion:1,kind:'geo',input:{requestedSteps:['buildings'],aoi:{},parameters:{}}};await bridge.submit(job);await bridge.status({ownerId:owner,requestId});
 assert.deepEqual(calls.map(c=>c[0]),['bridge_v1_apply_context','bridge_v1_enqueue','bridge_v1_status']);assert.equal(calls[1][1].p_instance_id,'aliyun-test');
 await assert.rejects(bridge.submit({...job,instanceId:'supabase'}),{code:'INVALID_INPUT'});assert.throws(()=>api.createTaskBridge({instanceId:'supabase',remote:{}}));
});
test('old namespace responses and remote credential-bearing errors never reach the API',async()=>{
 const bridge=api.createTaskBridge({instanceId:'aliyun-test',remote:{async call(){return {instanceId:'supabase',runId:requestId};}}});await assert.rejects(bridge.status({ownerId:owner,requestId}),{code:'BRIDGE_UNAVAILABLE'});
 const failed=api.createTaskBridge({instanceId:'aliyun-test',remote:{async call(){throw Error('secret key and private SQL');}}});await assert.rejects(failed.status({ownerId:owner,requestId}),e=>e.code==='BRIDGE_UNAVAILABLE'&&!e.message.includes('secret'));
});

test('bridge rejects non-JSON values and preserves safe actionable HTTP errors',async()=>{
 let calls=0;const bridge=api.createTaskBridge({instanceId:'aliyun-test',remote:{async call(){calls++;return {instanceId:'aliyun-test'};}}});
 for(const payload of [{active:NaN},{active:Infinity},{active:undefined},{active:1n},new Date(),Object.assign(Object.create({inherited:true}),{active:true})])await assert.rejects(bridge.applyContext({localKind:'profile',localId:owner,version:1,tombstone:false,payload}),{code:'INVALID_INPUT'});
 assert.equal(calls,0);
 for(const [code,status] of [['NOT_FOUND',404],['TOO_MANY_ACTIVE_RUNS',429]]){const failed=api.createTaskBridge({instanceId:'aliyun-test',remote:{async call(){throw {code};}}});await assert.rejects(failed.status({ownerId:owner,requestId}),e=>e.code===code&&e.status===status);}
});
