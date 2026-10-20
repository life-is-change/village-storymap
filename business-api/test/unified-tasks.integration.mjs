import test from 'node:test';import assert from 'node:assert/strict';import {readFile,mkdtemp,rm} from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';import {Readable} from 'node:stream';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {withUnifiedFixture,testIdentity,USERS} from './fixtures/unified.mjs';import {prepareFiles} from './fixtures/files.mjs';
import {createUnifiedDatabase} from '../unified/database.mjs';import {createTaskService} from '../unified/tasks.mjs';
import {createTaskFiles} from '../unified/task-files.mjs';import {createBusinessFileStore} from '../unified/file-store.mjs';import {createBusinessFilesService} from '../unified/files.mjs';import {png} from './fixtures/scene-files.mjs';
const context={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'A',courseId:'course'};
test('native task outbox rolls back, replays a lost response and rejects stale local membership without a duplicate remote job',async()=>{
 await withUnifiedFixture(async({setup,install,config})=>{
  await prepareFiles(setup);await install();for(const name of ['catalog','survey','planning','files','tasks'])await setup.query(await readFile(new URL('../../linux/sql/unified/'+name+'.sql',import.meta.url),'utf8'));
  await setup.query('INSERT INTO api_private.task_worker_villages VALUES($1::uuid,$1::text)',[context.villageId]);const db=createUnifiedDatabase(config);let service;
  try{
   const receipt=new Map(),snapshots=[],remoteId=randomUUID();let requests=0,lose=true;
   const bridge={instanceId:'aliyun-test',async applyContext(s){snapshots.push(s);},async submit(input){requests++;if(!receipt.has(input.requestId))receipt.set(input.requestId,remoteId);if(lose){lose=false;throw {code:'BRIDGE_UNAVAILABLE'};}return {instanceId:'aliyun-test',runId:receipt.get(input.requestId)};},async status(){return {instanceId:'aliyun-test',runId:remoteId,run:{status:'completed',progress:100}};}};
   service=createTaskService({database:db,bridge,files:{}});const input={...context,requestId:randomUUID(),requestedSteps:['buildings'],aoi:{type:'Polygon',coordinates:[[[113,23],[113.0001,23],[113.0001,23.0001],[113,23]]]},parameters:{}};
   await assert.rejects(db.withIdentity(testIdentity(),async c=>{await c.query('SELECT api_private.task_execute($1,$2::jsonb,$3)',['tasks.submitGeo',JSON.stringify(input),'aliyun-test']);throw {code:'INVALID_INPUT'};}),{code:'INVALID_INPUT'});
   assert.equal((await setup.query('SELECT count(*) n FROM api_private.task_outbox')).rows[0].n,'0');
   const first=await service.execute(testIdentity(),'tasks.submitGeo',input);assert.equal(first.state,'pending');assert.deepEqual(await service.execute(testIdentity(),'tasks.submitGeo',input),first);
   assert.equal((await setup.query('SELECT count(*) n FROM api_private.task_outbox')).rows[0].n,'1');assert.equal(requests,0);
   await service.tick();assert.equal(receipt.size,1);await setup.query("UPDATE api_private.task_outbox SET next_at=now()");await service.close();service=createTaskService({database:db,bridge,files:{}});await service.tick();
   assert.equal(receipt.size,1);assert.equal(requests,2);assert.equal((await service.execute(testIdentity(),'tasks.get',{requestId:input.requestId})).sourceRunId,remoteId);
   await assert.rejects(service.execute(testIdentity(USERS.other),'tasks.get',{requestId:input.requestId}),{code:'NOT_FOUND'});
   await setup.query("DELETE FROM group_memberships WHERE student_key='a::A'");
   await assert.rejects(service.execute(testIdentity(),'tasks.get',{requestId:input.requestId}),{code:'FORBIDDEN'});
   await assert.rejects(service.execute(testIdentity(),'tasks.cancel',{taskId:input.requestId,requestId:randomUUID()}),{code:'FORBIDDEN'});
   await setup.query('UPDATE api_private.task_outbox SET next_at=now()');await service.tick();assert.ok(snapshots.some(s=>s.localKind==='space'&&s.tombstone));assert.equal((await setup.query('SELECT state FROM api_private.task_requests')).rows[0].state,'revoked');
  }finally{await service?.close();await db.close();}
 });
});

test('native private photo references and streamed results survive retries and import one local version without source queue FKs',async()=>{
 await withUnifiedFixture(async({setup,install,config})=>{
  await prepareFiles(setup);await install();for(const name of ['catalog','survey','planning','files','tasks'])await setup.query(await readFile(new URL('../../linux/sql/unified/'+name+'.sql',import.meta.url),'utf8'));
  await setup.query('INSERT INTO api_private.task_worker_villages VALUES($1::uuid,$1::text)',[context.villageId]);
  const root=await mkdtemp(join(tmpdir(),'unified-task-native-')),db=createUnifiedDatabase(config);let service;
  try{
   const store=await createBusinessFileStore({root,instanceId:'aliyun-test'}),taskFiles=createTaskFiles({database:db,store,instanceId:'aliyun-test'}),files=createBusinessFilesService({database:db,store,spaceAvailable:async()=>10*1024**3});
   const c={teachingProjectId:context.teachingProjectId,villageId:context.villageId,spaceId:'A'},session=await files.begin(testIdentity(),{purpose:'photo',requestId:randomUUID(),context:c,files:[{role:'photo',size:png.length,mime:'image/png',extension:'png'}]});await files.put(testIdentity(),session.id,'photo',Readable.from([png]));const photo=await files.commit(testIdentity(),session.id,{objectCode:'B1',objectType:'building'});
   const sourceId=randomUUID(),feature={type:'Feature',id:'new-building',properties:{name:'Local import'},geometry:{type:'Polygon',coordinates:[[[113,23],[113.0001,23],[113.0001,23.0001],[113,23]]]}},bytes=Buffer.from(JSON.stringify({type:'FeatureCollection',features:[feature]})),sha256=createHash('sha256').update(bytes).digest('hex');let downloads=0;
   const bridge={instanceId:'aliyun-test',async applyContext(){},async submit(){return {instanceId:'aliyun-test',runId:sourceId};},async status(){return {instanceId:'aliyun-test',runId:sourceId,kind:'geo',run:{status:'completed',progress:100}};},async artifacts(){return {artifacts:[{artifact_type:'buildings',sha256}]};},async downloadArtifact(){downloads++;return {sha256,size:bytes.length,mime:'application/geo+json',stream:Readable.from([bytes])};}};
   service=createTaskService({database:db,bridge,files:taskFiles});
   const photoTask=await service.execute(testIdentity(),'tasks.submitFacade',{...context,kind:'facade',photoId:Number(photo.id),objectCode:'B1',requestId:randomUUID()});
   const inputPhoto=await taskFiles.readTaskInput({requestId:photoTask.requestId,ownerId:USERS.student});assert.equal(inputPhoto.sha256,createHash('sha256').update(png).digest('hex'));assert.equal(inputPhoto.size,png.length);await inputPhoto.close();
   await assert.rejects(db.withIdentity(testIdentity(),c=>service.assertPhotoMutable(c,testIdentity(),photo.id)),{code:'FILE_IN_USE'});
   const input={...context,requestId:randomUUID(),requestedSteps:['buildings'],aoi:feature.geometry,parameters:{}};await service.execute(testIdentity(),'tasks.submitGeo',input);
   // The photo outbox is intentionally held: no fake GPU/private input submit.
   await setup.query('UPDATE api_private.task_outbox SET next_at=now()+interval \'1 day\' WHERE task_id=(SELECT id FROM api_private.task_requests WHERE request_id=$1)',[photoTask.requestId]);
   await service.tick();await setup.query("UPDATE api_private.task_outbox SET next_at=now() WHERE operation='poll'");await service.tick();assert.equal((await service.execute(testIdentity(),'tasks.get',{requestId:input.requestId})).state,'completed');
   const target='a0000000-0000-4000-8000-000000000001';
   for(let i=0;i<2;i++){await service.execute(testIdentity(),'tasks.importResult',{taskId:input.requestId,spaceId:target,requestId:randomUUID()});await service.tick();}
   assert.equal(downloads,1);assert.equal((await setup.query('SELECT count(*) n FROM personal_result_bundles WHERE local_task_id IS NOT NULL')).rows[0].n,'1');
   const imported=(await setup.query('SELECT * FROM personal_layer_versions WHERE local_task_id IS NOT NULL')).rows;assert.equal(imported.length,1);assert.equal(imported[0].source_run_id,null);assert.equal(imported[0].feature_count,1);
   assert.equal((await setup.query('SELECT geom FROM personal_layer_features WHERE layer_version_id=$1',[imported[0].id])).rows[0].geom.type,'Polygon');
   await assert.rejects(taskFiles.readTaskArtifact(testIdentity(USERS.other),input.requestId,'buildings'),{code:'NOT_FOUND'});
   const h=await taskFiles.readTaskArtifact(testIdentity(),input.requestId,'buildings');assert.equal(h.size,bytes.length);await h.close();
  }finally{await service?.close();await db.close();await rm(root,{recursive:true,force:true});}
 });
});


test('failed facade retry reconciles a lost source response, resumes polling and exposes completed artifacts',async()=>{
 await withUnifiedFixture(async({setup,install,config})=>{
  await prepareFiles(setup);await install();for(const name of ['catalog','survey','planning','files','tasks'])await setup.query(await readFile(new URL('../../linux/sql/unified/'+name+'.sql',import.meta.url),'utf8'));
  const db=createUnifiedDatabase(config),root=await mkdtemp(join(tmpdir(),'retry-native-'));let service;
  try{
   const store=await createBusinessFileStore({root,instanceId:'aliyun-test'}),files=createBusinessFilesService({database:db,store,spaceAvailable:async()=>10*1024**3});
   const session=await files.begin(testIdentity(),{purpose:'photo',requestId:randomUUID(),context:{teachingProjectId:context.teachingProjectId,villageId:context.villageId,spaceId:context.spaceId},files:[{role:'photo',size:png.length,mime:'image/png',extension:'png'}]});await files.put(testIdentity(),session.id,'photo',Readable.from([png]));const photo=await files.commit(testIdentity(),session.id,{objectCode:'B1',objectType:'building'});
   const remote=randomUUID();let status='failed',prepared=0;
   const bridge={instanceId:'aliyun-test',async applyContext(){},async retry(){status='queued_generation';throw {code:'BRIDGE_UNAVAILABLE'};},async status(){return {instanceId:'aliyun-test',runId:remote,run:{status,progress:status==='completed'?100:0}};},async artifacts(){return {artifacts:[{artifact_type:'building_glb',sha256:'a'.repeat(64)}]};}};
   service=createTaskService({database:db,bridge,files:{async prepareTaskArtifacts(){prepared++;}}});
   const task=await service.execute(testIdentity(),'tasks.submitFacade',{...context,kind:'facade',photoId:Number(photo.id),objectCode:'B1',requestId:randomUUID()});
   await setup.query("UPDATE api_private.task_requests SET state='failed',source_run_id=$1 WHERE request_id=$2",[remote,task.requestId]);await setup.query("UPDATE api_private.task_outbox SET done=true");
   const command={taskId:task.requestId,requestId:randomUUID()},first=await service.execute(testIdentity(),'tasks.retry',command);
   // The source can commit its retry while its response is lost.
   await service.tick();assert.equal((await service.execute(testIdentity(),'tasks.get',{requestId:task.requestId})).state,'running');
   assert.deepEqual(await service.execute(testIdentity(),'tasks.retry',command),first);
   assert.equal((await setup.query("SELECT done FROM api_private.task_outbox WHERE operation='poll'")).rows[0].done,false);
   status='completed';await setup.query("UPDATE api_private.task_outbox SET next_at=now() WHERE operation='poll'");await service.tick();assert.equal((await service.execute(testIdentity(),'tasks.get',{requestId:task.requestId})).state,'completed');assert.equal(prepared,1);
  }finally{await service?.close();await db.close();await rm(root,{recursive:true,force:true});}
 });
});
