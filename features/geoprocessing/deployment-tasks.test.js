const test=require('node:test'),assert=require('node:assert/strict');
test('all three task factories accept local services without touching source database, Storage or channels',()=>{
 const source=new Proxy({}, {get(){throw Error('SOURCE_ACCESS_FORBIDDEN');}}),services={tasks:{geoprocessing:{mode:'geo'},facade:{mode:'facade'},cloud:{mode:'cloud'}}};
 assert.equal(require('./geoprocessing-client.js').createGeoprocessingClient({supabaseClient:source,services}),services.tasks.geoprocessing);
 assert.equal(require('../../rural_house_generator/facade-queue-client.js').createFacadeQueueClient(source,{services}),services.tasks.facade);
 assert.equal(require('../../rural_house_generator/facade-cloud-client.js').createFacadeCloudClient(source,{services}),services.tasks.cloud);
});
test('local task facade uses local request IDs, waits for imports and resolves only authorized task artifact references',async()=>{
 const {createBusinessTaskClient}=require('../data/business-task-client.js'),calls=[],blobs=[];const context={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'A',personalSpaceId:'a0000000-0000-4000-8000-000000000001',courseId:'course',userId:'owner'},id='c0000000-0000-4000-8000-000000000001';
 const api={async execute(action,input){calls.push([action,input]);if(action.startsWith('tasks.submit'))return {requestId:id,state:'pending'};if(action==='tasks.get')return {requestId:id,state:'completed',status:'completed',context,importedBundle:'bundle'};if(action==='tasks.artifacts')return [{artifact_type:'buildings',sha256:'a'.repeat(64)}];if(action==='tasks.importResult')return {requestId:id,state:'pending'};},async readTaskArtifact(request,type){blobs.push([request,type]);return new Blob(['{}']);}};
 const tasks=createBusinessTaskClient({api,contextProvider:()=>context,createObjectURL:()=> 'blob:local',revokeObjectURL:()=>{},uuid:()=>id});
 assert.equal(await tasks.geoprocessing.submit({...context,requestedSteps:['buildings'],aoi:{},parameters:{}}),id);
 const artifacts=await tasks.geoprocessing.listArtifacts(id);assert.match(artifacts[0].storage_path,/^task:/);assert.equal((await tasks.geoprocessing.createArtifactUrl(artifacts[0].storage_path)).signedUrl,'blob:local');
 await assert.rejects(tasks.facade.createArtifactUrl('https://foreign.invalid/private'));
 assert.equal(await tasks.geoprocessing.importRun(id),'bundle');assert.equal(calls.find(([a])=>a==='tasks.importResult')[1].taskId,id);assert.deepEqual(blobs,[[id,'buildings']]);tasks.dispose();
});
