import test from 'node:test';import assert from 'node:assert/strict';
let api;try{api=await import('../unified/survey.mjs');}catch{api={};}
test('photo delete protects local task references inside the database transaction',async()=>{
 assert.equal(typeof api.createSurveyService,'function');const calls=[],c={async query(sql){calls.push(sql);return {rows:[{data:{deleted:true}}]};}};
 const service=api.createSurveyService({database:{async withIdentity(i,fn){calls.push('begin');return fn(c);}},files:{},taskReferences:{async assertPhotoMutable(client,i,id){assert.equal(client,c);assert.equal(id,12);calls.push('local-reference-check');throw Object.assign(Error('FORBIDDEN'),{code:'FORBIDDEN'});}}});
 await assert.rejects(service.execute({},'survey.deletePhoto',{photoId:12,requestId:'c0000000-0000-4000-8000-000000000001'}),{code:'FORBIDDEN'});assert.deepEqual(calls,['begin','local-reference-check']);
});
test('survey DTO matches actual confirmation lock and revision contract',async()=>{
 const {parseOperation}=await import('../unified/contracts.mjs');const context={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'A',layerKey:'building',objectCode:'B1',requestId:'c0000000-0000-4000-8000-000000000001'};
 assert.doesNotThrow(()=>parseOperation('survey.confirmGeometry',{...context,revision:0,lockToken:context.requestId}));assert.throws(()=>parseOperation('survey.confirmGeometry',{...context,revision:0,geometry:{}}),{code:'INVALID_INPUT'});
 assert.doesNotThrow(()=>parseOperation('survey.restoreVersion',{...context,versionId:context.requestId,revision:0}));
});
