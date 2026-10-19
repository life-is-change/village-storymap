import test from 'node:test';import assert from 'node:assert/strict';
let api;try{api=await import('../unified/planning.mjs');}catch{api={};}
const c={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'A'};
test('planning refuses editing contours and validates actual editing revision/version shape',async()=>{
 const {parseOperation}=await import('../unified/contracts.mjs');const change={layerKey:'building',action:'update',objectCode:'B1',objectName:'Building',afterGeom:{type:'Polygon',coordinates:[[[113,23],[113.001,23],[113.001,23.001],[113,23]]]},afterProps:{name:'test'},expectedGeometryRevision:1,lockToken:c.villageId,layerVersionId:c.teachingProjectId};
 assert.doesNotThrow(()=>parseOperation('planning.saveBatch',{...c,changes:[change],requestId:c.teachingProjectId}));assert.throws(()=>parseOperation('planning.saveBatch',{...c,changes:[{...change,layerKey:'contours'}],requestId:c.teachingProjectId}),{code:'INVALID_INPUT'});
 assert.doesNotThrow(()=>parseOperation('planning.acquireLock',{...c,layerKey:'cropland',objectCode:'C1'}));
});
test('planning actions borrow the same identity pool and never accept a remote RPC',async()=>{
 assert.equal(typeof api.createPlanningService,'function');const calls=[];const service=api.createPlanningService({database:{async withIdentity(identity,fn,o){calls.push(o);return fn({async query(sql,args){calls.push([sql,args]);return {rows:[{data:{success:false}}]};}});}}});
 assert.equal((await service.execute({},'planning.acquireLock',{...c,layerKey:'building',objectCode:'B1'})).success,false);assert.match(calls[1][0],/api_private.planning_write/);
 await assert.rejects(service.execute({},'catalog.createGroup',{}),{code:'NOT_FOUND'});
});

test('baseline conflict DTO uses the actual reviewed source resolution names',async()=>{
 const {parseOperation}=await import('../unified/contracts.mjs');
 for(const resolution of ['keep_group','use_new_baseline','manual_merge'])assert.doesNotThrow(()=>parseOperation('planning.resolveConflict',{conflictId:c.teachingProjectId,resolution,payload:{},requestId:c.villageId}));
});
