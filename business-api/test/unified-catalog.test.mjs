import test from 'node:test';import assert from 'node:assert/strict';
let api;try{api=await import('../unified/catalog.mjs');}catch{api={};}
const identity={userId:'10000000-0000-4000-8000-000000000001'};
test('catalog uses a single bounded identity transaction and fixed functions only',async()=>{
 assert.equal(typeof api.createCatalogService,'function');const calls=[];
 const database={async withIdentity(i,fn,o){assert.equal(i,identity);calls.push(o);return fn({async query(sql,args){calls.push([sql,args]);return {rows:[{data:[]} ]};}});}};
 const service=api.createCatalogService({database});assert.deepEqual(await service.execute(identity,'catalog.listCourses',{}),[]);
 assert.equal(calls[0].readOnly,true);assert.match(calls[1][0],/api_private.catalog_read/);
 await assert.rejects(service.execute(identity,'catalog.joinGroup',{courseId:'course',code:'CODE',student_key:'forged'}),{code:'INVALID_INPUT'});
 await assert.rejects(service.execute(identity,'survey.getAttributes',{}),{code:'NOT_FOUND'});
});
test('catalog bootstrap aggregates authorized state in one read transaction',async()=>{
 assert.equal(typeof api.createCatalogService,'function');let count=0;const service=api.createCatalogService({database:{async withIdentity(i,fn,o){count++;assert.equal(o.readOnly,true);return fn({async query(sql){assert.match(sql,/api_private.catalog_bootstrap/);return {rows:[{data:{profile:{id:identity.userId},courses:[],spaces:[]}}]};}});}}});
 assert.equal((await service.bootstrap(identity)).profile.id,identity.userId);assert.equal(count,1);
});

test('activity accepts real action/context DTO and rejects caller actor fields',async()=>{
 const {parseOperation}=await import('../unified/contracts.mjs');const input={courseId:'course',teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'A',action:'survey_photo_uploaded',metadata:{count:1},requestId:'c0000000-0000-4000-8000-000000000001'};
 assert.equal(parseOperation('catalog.recordActivity',input).input.action,input.action);assert.throws(()=>parseOperation('catalog.recordActivity',{...input,studentKey:'forged'}),{code:'INVALID_INPUT'});
 assert.equal(parseOperation('catalog.getCourseContext',{courseId:'course'}).readOnly,true);
});

test('village lifecycle DTOs match actual ready statuses and source constraints',async()=>{
 const {parseOperation,exampleInput}=await import('../unified/contracts.mjs');const dataset={...exampleInput('admin.saveDataset'),sourceKind:'uploaded_bundle',status:'ready'};
 assert.doesNotThrow(()=>parseOperation('admin.saveDataset',dataset));assert.throws(()=>parseOperation('admin.saveDataset',{...dataset,sourceKind:'manual'}),{code:'INVALID_INPUT'});
 assert.doesNotThrow(()=>parseOperation('admin.saveRealityModel',{...exampleInput('admin.saveRealityModel'),status:'ready'}));assert.throws(()=>parseOperation('admin.saveRealityModel',{...exampleInput('admin.saveRealityModel'),heightOffset:1001}),{code:'INVALID_INPUT'});
});
