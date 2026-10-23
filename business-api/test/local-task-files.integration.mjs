import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import {readFile,mkdtemp,mkdir,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {Readable} from 'node:stream';
import {withUnifiedFixture,testIdentity,USERS} from './fixtures/unified.mjs';import {prepareFiles} from './fixtures/files.mjs';import {png,glb} from './fixtures/scene-files.mjs';
import {createUnifiedDatabase} from '../unified/database.mjs';import {createTaskService} from '../unified/tasks.mjs';import {createTaskFiles} from '../unified/task-files.mjs';import {createBusinessFileStore} from '../unified/file-store.mjs';import {createBusinessFilesService} from '../unified/files.mjs';import {createFileBudget} from '../unified/budgets.mjs';
import {createLocalQueueService} from '../local-tasks/service.mjs';import {createLocalTaskTransport} from '../local-tasks/transport.mjs';import {createTaskChunkStore} from '../local-tasks/chunks.mjs';import {createLocalTaskFiles} from '../local-tasks/files.mjs';
import {createCloudRepository} from '../local-tasks/cloud-repository.mjs';import {createLocalCloudFacade} from '../local-tasks/cloud.mjs';import {createCloudFiles} from '../local-tasks/cloud-files.mjs';
const context={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'A',courseId:'course'},hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(fn,provider={available:false}){await withUnifiedFixture(async({setup,install,config})=>{
 await prepareFiles(setup);await install();for(const name of ['catalog','survey','planning','files','tasks'])await setup.query(await readFile(new URL('../../linux/sql/unified/'+name+'.sql',import.meta.url),'utf8'));
 for(const name of ['local-tasks','local-task-files','local-cloud'])await setup.query(await readFile(new URL('../../linux/sql/'+name+'.sql',import.meta.url),'utf8'));
 await setup.query('INSERT INTO api_private.task_worker_villages VALUES($1::uuid,$1::text)',[context.villageId]);
 const root=await mkdtemp(join(tmpdir(),'local-files-native-')),db=createUnifiedDatabase(config),budget=createFileBudget();let tasks;
 try{for(const d of ['files','chunks'])await mkdir(join(root,d),{mode:0o700});const store=budget.wrap(await createBusinessFileStore({root:join(root,'files'),instanceId:'aliyun-test'})),chunks=await createTaskChunkStore({root:join(root,'chunks'),instanceId:'aliyun-test'}),queue=createLocalQueueService({database:db,instanceId:'aliyun-test'}),taskFiles=createTaskFiles({database:db,store,instanceId:'aliyun-test'}),create=()=>createLocalTaskFiles({queue,store,chunks,budget,taskFiles}),files=create(),repository=createCloudRepository({database:db,instanceId:'aliyun-test'}),cloud=createLocalCloudFacade({repository,provider,files:createCloudFiles({store,taskFiles,instanceId:'aliyun-test'})}),bridge=createLocalTaskTransport({queue,cloud,artifactReader:(input,type)=>files.readArtifact(input,type)});
  tasks=createTaskService({database:db,bridge,files:taskFiles});await queue.verifyFilesInstallation();
  async function worker(kind='geo'){const workerId=randomUUID(),secret='A'.repeat(43);await setup.query('INSERT INTO api_private.local_gpu_workers(id,instance_id,name,kind,token_digest) VALUES($1::uuid,$2,$1::uuid::text,$3,$4)',[workerId,'aliyun-test',kind,hash(secret)]);const actor=await queue.authenticate('Bearer village_worker_'+workerId+'.'+secret);await queue.workerCall(actor,'heartbeat',null,null,{state:'idle',protocol:kind+'-aliyun-local-v1'});return actor;}
  const claim=a=>queue.workerCall(a,'claim',null,null,{requestId:randomUUID()});
  async function upload(actor,job,type,bytes,mime='image/png',extension='png'){const input={requestId:randomUUID(),artifactType:type,size:bytes.length,sha256:hash(bytes),mime,extension},u=await files.begin(actor,job.run.id,job.leaseToken,input);await files.put(actor,job.run.id,job.leaseToken,{uploadId:u.uploadId,index:0,size:bytes.length,sha256:hash(bytes)},Readable.from([bytes]));return files.commit(actor,job.run.id,job.leaseToken,{uploadId:u.uploadId});}
  await fn({setup,db,budget,store,queue,taskFiles,files,create,tasks,worker,claim,upload,repository,cloud});assert.deepEqual(budget.diagnostics(),{read:0,write:0});
 }finally{await tasks?.close();await db.close();await rm(root,{recursive:true,force:true});}
});}

test('native resumable Geo result above 50MiB is immutable, lease-gated and imports exactly once into the authorized space',async()=>{
 await fixture(async({setup,db,queue,tasks,worker,claim,files,create,taskFiles})=>{
  const actor=await worker(),input={...context,requestId:randomUUID(),requestedSteps:['buildings'],aoi:{type:'Polygon',coordinates:[[[113,23],[113.0001,23],[113.0001,23.0001],[113,23]]]},parameters:{}};
  await tasks.execute(testIdentity(),'tasks.submitGeo',input);await tasks.tick();const job=await claim(actor);
  const head=Buffer.from(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:input.aoi}]})),size=51*1024**2+head.length,pad=Buffer.alloc(65536,32),digest=createHash('sha256').update(head);for(let i=0;i<51*16;i++)digest.update(pad);const sha256=digest.digest('hex'),spec={requestId:randomUUID(),artifactType:'buildings',size,sha256,mime:'application/geo+json',extension:'geojson'};
  const u=await files.begin(actor,job.run.id,job.leaseToken,spec);assert.equal((await files.begin(actor,job.run.id,job.leaseToken,spec)).uploadId,u.uploadId);
  const otherWorker=await worker();await assert.rejects(files.status(otherWorker,job.run.id,job.leaseToken,{uploadId:u.uploadId}),{code:'LEASE_LOST'});
  await assert.rejects(files.begin(actor,job.run.id,job.leaseToken,{...spec,sha256:'b'.repeat(64)}),{code:'UPLOAD_CONFLICT'});
  await assert.rejects(files.commit(actor,job.run.id,job.leaseToken,{uploadId:u.uploadId}),{code:'FILES_NOT_READY'});
  const wrong=await files.begin(actor,job.run.id,job.leaseToken,{...spec,requestId:randomUUID(),size:head.length,sha256:'c'.repeat(64)});
  await files.put(actor,job.run.id,job.leaseToken,{uploadId:wrong.uploadId,index:0,size:head.length,sha256:hash(head)},Readable.from([head]));
  await assert.rejects(files.commit(actor,job.run.id,job.leaseToken,{uploadId:wrong.uploadId}),{code:'INVALID_FILE'});await files.abort(actor,job.run.id,job.leaseToken,{uploadId:wrong.uploadId});
  const part=Buffer.alloc(8*1024**2,32);head.copy(part);const first={uploadId:u.uploadId,index:0,size:part.length,sha256:hash(part)};
  await assert.rejects(files.put(actor,job.run.id,job.leaseToken,{...first,sha256:'a'.repeat(64)},Readable.from([part])),{code:'INVALID_FILE'});
  await assert.rejects(files.put(actor,job.run.id,job.leaseToken,first,(async function*(){yield part.subarray(0,17);throw Error('disconnected');})()));
  await files.put(actor,job.run.id,job.leaseToken,first,Readable.from([part]));const restarted=create();await restarted.put(actor,job.run.id,job.leaseToken,first,Readable.from([part]));
  for(let index=1,offset=part.length;offset<size;index++){const b=Buffer.alloc(Math.min(8*1024**2,size-offset),32);await restarted.put(actor,job.run.id,job.leaseToken,{uploadId:u.uploadId,index,size:b.length,sha256:hash(b)},Readable.from([b]));offset+=b.length;}
  await setup.query("UPDATE api_private.local_gpu_runs SET lease_until=now()-interval '1 second' WHERE id=$1",[job.run.id]);
  await assert.rejects(restarted.commit(actor,job.run.id,job.leaseToken,{uploadId:u.uploadId}),{code:'LEASE_LOST'});assert.equal((await setup.query('SELECT count(*) n FROM api_private.local_gpu_outputs')).rows[0].n,'0');
  // The owner fixture advances the same lease only to continue this isolated
  // expiration test; production renew cannot revive an expired lease.
  await setup.query("UPDATE api_private.local_gpu_runs SET lease_until=now()+interval '120 seconds' WHERE id=$1",[job.run.id]);
  await restarted.commit(actor,job.run.id,job.leaseToken,{uploadId:u.uploadId});await restarted.commit(actor,job.run.id,job.leaseToken,{uploadId:u.uploadId});
  await queue.workerCall(actor,'complete',job.run.id,job.leaseToken,{});await setup.query("UPDATE api_private.task_outbox SET next_at=now() WHERE operation='poll'");await tasks.tick();
  assert.equal((await tasks.execute(testIdentity(),'tasks.get',{requestId:input.requestId})).state,'completed');
  for(let n=0;n<2;n++){await tasks.execute(testIdentity(),'tasks.importResult',{taskId:input.requestId,spaceId:context.teachingProjectId,requestId:randomUUID()});await tasks.tick();}
  assert.equal((await setup.query('SELECT count(*) n FROM personal_result_bundles WHERE local_task_id IS NOT NULL')).rows[0].n,'1');
  assert.equal((await setup.query('SELECT feature_count FROM personal_layer_versions WHERE local_task_id IS NOT NULL')).rows[0].feature_count,1);
  await assert.rejects(taskFiles.readTaskArtifact(testIdentity(USERS.other),input.requestId,'buildings'),{code:'NOT_FOUND'});
  const h=await taskFiles.readTaskArtifact(testIdentity(),input.requestId,'buildings');assert.equal(h.size,size);await h.close();
  await assert.rejects(db.withIdentity(testIdentity(USERS.other),c=>c.query('SELECT * FROM api_private.local_gpu_uploads')),e=>e.code==='DB_UNAVAILABLE'||e.code==='FORBIDDEN');
 });
});

test('native default Geo steps authorize all five outputs, require the full set and import four layers',async()=>{
 await fixture(async({setup,queue,tasks,worker,claim,upload})=>{
  const actor=await worker(),input={...context,requestId:randomUUID(),requestedSteps:['buildings','roads_water','contours'],aoi:{type:'Polygon',coordinates:[[[113,23],[113.0001,23],[113.0001,23.0001],[113,23]]]},parameters:{}};
  await tasks.execute(testIdentity(),'tasks.submitGeo',input);await tasks.tick();const job=await claim(actor);
  const result=type=>Buffer.from(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',properties:{},geometry:['roads','waterways','contours'].includes(type)?{type:'LineString',coordinates:[[113,23],[113.0001,23.0001]]}:input.aoi}]}));
  for(const type of ['buildings','roads','waterways','water_areas'])await upload(actor,job,type,result(type),'application/geo+json','geojson');
  await assert.rejects(queue.workerCall(actor,'complete',job.run.id,job.leaseToken,{}),{code:'FILES_NOT_READY'});
  await upload(actor,job,'contours',result('contours'),'application/geo+json','geojson');
  await queue.workerCall(actor,'complete',job.run.id,job.leaseToken,{});
  await setup.query("UPDATE api_private.task_outbox SET next_at=now() WHERE operation='poll'");await tasks.tick();
  assert.equal((await tasks.execute(testIdentity(),'tasks.get',{requestId:input.requestId})).state,'completed');
  await tasks.execute(testIdentity(),'tasks.importResult',{taskId:input.requestId,spaceId:context.teachingProjectId,requestId:randomUUID()});await tasks.tick();
  assert.deepEqual((await setup.query('SELECT layer_key,sum(feature_count)::int AS n FROM personal_layer_versions WHERE local_task_id IS NOT NULL GROUP BY layer_key ORDER BY layer_key')).rows,
   [{layer_key:'building',n:1},{layer_key:'contours',n:1},{layer_key:'road',n:1},{layer_key:'water',n:2}]);
  // A task requesting only buildings cannot upload roads or water outputs.
  await tasks.execute(testIdentity(),'tasks.submitGeo',{...input,requestId:randomUUID(),requestedSteps:['buildings']});await tasks.tick();const buildingOnly=await claim(actor);
  for(const type of ['roads','waterways','water_areas'])await assert.rejects(upload(actor,buildingOnly,type,result(type),'application/geo+json','geojson'),{code:'FORBIDDEN'});
 });
});

test('native facade retains original photo identity and approved rectification across generation; old leases cannot upload',async()=>{
 await fixture(async({setup,db,store,queue,tasks,files,taskFiles,worker,claim,upload})=>{
  const userFiles=createBusinessFilesService({database:db,store,spaceAvailable:async()=>10*1024**3}),session=await userFiles.begin(testIdentity(),{purpose:'photo',requestId:randomUUID(),context:{teachingProjectId:context.teachingProjectId,villageId:context.villageId,spaceId:'A'},files:[{role:'photo',size:png.length,mime:'image/png',extension:'png'}]});await userFiles.put(testIdentity(),session.id,'photo',Readable.from([png]));const photo=await userFiles.commit(testIdentity(),session.id,{objectCode:'B1',objectType:'building'});
  const input={...context,kind:'facade',photoId:Number(photo.id),objectCode:'B1',requestId:randomUUID()},actor=await worker('facade');await tasks.execute(testIdentity(),'tasks.submitFacade',input);await tasks.tick();const job=await claim(actor);
  assert.equal(job.run.photo.fileId,session.files[0].id);const opened=await files.openInput(actor,job.run.id,job.leaseToken);try{assert.equal(opened.sha256,hash(png));const b=[];for await(const x of opened.stream())b.push(x);assert.deepEqual(Buffer.concat(b),png);}finally{await opened.close();}
  await assert.rejects(db.withIdentity(testIdentity(),c=>tasks.assertPhotoMutable(c,testIdentity(),photo.id)),{code:'FILE_IN_USE'});
  await upload(actor,job,'rectified_preview',png);await upload(actor,job,'rectified_source',png);await assert.rejects(queue.workerCall(actor,'publish-rectification',job.run.id,job.leaseToken,{}),{code:'FILES_NOT_READY'});await upload(actor,job,'building_mask',png);await upload(actor,job,'diagnostics',Buffer.from('{"valid":true}'),'application/json','json');await queue.workerCall(actor,'publish-rectification',job.run.id,job.leaseToken,{});
  await tasks.execute(testIdentity(),'tasks.confirmCrop',{taskId:input.requestId,requestId:randomUUID(),cropTop:0.1,roofType:'flat',buildingWidth:10,buildingDepth:10});await tasks.tick();const gen=await claim(actor);assert.equal(gen.phase,'generation');
  const rect=await files.openArtifact(actor,gen.run.id,gen.leaseToken,{artifactType:'rectified_source'});await rect.close();
  await assert.rejects(files.begin(actor,job.run.id,job.leaseToken,{requestId:randomUUID(),artifactType:'building_glb',size:glb().length,sha256:hash(glb()),mime:'model/gltf-binary',extension:'glb'}),{code:'LEASE_LOST'});
  await upload(actor,gen,'building_glb',glb(),'model/gltf-binary','glb');await queue.workerCall(actor,'complete',gen.run.id,gen.leaseToken,{});
  await setup.query("UPDATE api_private.task_outbox SET next_at=now() WHERE operation='poll'");await tasks.tick();const h=await taskFiles.readTaskArtifact(testIdentity(),input.requestId,'building_glb');assert.equal(h.size,glb().length);await h.close();
  assert.equal((await setup.query('SELECT count(*) n FROM api_private.local_gpu_outputs WHERE state=\'ready\'')).rows[0].n,'5');
 });
});

async function cloudRequest({db,store,tasks}){
 const files=createBusinessFilesService({database:db,store,spaceAvailable:async()=>10*1024**3}),session=await files.begin(testIdentity(),{purpose:'photo',requestId:randomUUID(),context:{teachingProjectId:context.teachingProjectId,villageId:context.villageId,spaceId:'A'},files:[{role:'photo',size:png.length,mime:'image/png',extension:'png'}]});await files.put(testIdentity(),session.id,'photo',Readable.from([png]));const photo=await files.commit(testIdentity(),session.id,{objectCode:'B1',objectType:'building'}),input={...context,kind:'cloud-facade',photoId:Number(photo.id),objectCode:'B1',requestId:randomUUID()};await tasks.execute(testIdentity(),'tasks.submitFacade',input);await tasks.tick();return {ownerId:USERS.student,requestId:input.requestId};
}
const pollNow=setup=>setup.query("UPDATE api_private.task_outbox SET next_at=now() WHERE operation='poll';UPDATE api_private.local_cloud_jobs SET next_at=now()");

test('native optional provider persists an immutable local output once and isolates source history',async()=>{
 let submissions=0;const provider={available:true,submit:async({image})=>{submissions++;assert.equal(image.sha256,hash(png));return {jobId:'fixture-job'};},poll:async()=>({status:'succeeded',output:'fixture-only'}),openOutput:async()=>({size:png.length,mime:'image/png',stream:Readable.from([png])})};
 await fixture(async({setup,db,store,tasks,taskFiles,repository})=>{
  await repository.verifyInstallation();const input=await cloudRequest({db,store,tasks});await pollNow(setup);await tasks.tick();assert.equal(submissions,1);
  assert.equal((await setup.query('SELECT state FROM api_private.local_cloud_jobs')).rows[0].state,'accepted');
  await pollNow(setup);await tasks.tick();assert.equal((await tasks.execute(testIdentity(),'tasks.get',{requestId:input.requestId})).state,'completed');
  const opened=await taskFiles.readTaskArtifact(testIdentity(),input.requestId,'standard_facade');assert.equal(opened.sha256,hash(png));await opened.close();
  await assert.rejects(taskFiles.readTaskArtifact(testIdentity(USERS.other),input.requestId,'standard_facade'),{code:'NOT_FOUND'});
  assert.equal((await setup.query('SELECT count(*) n FROM api_private.local_gpu_outputs')).rows[0].n,'1');
  assert.equal((await repository.claim(input)).operation,'complete');assert.equal(submissions,1);
 },provider);
});

test('native paid intent survives a crash, rejects automatic retry and permits only owner reconciliation',async()=>{
 const provider={available:true,submit:async()=>{throw Error('must not call paid provider in this intent fixture');}};
 await fixture(async({setup,db,store,tasks,repository})=>{
  const input=await cloudRequest({db,store,tasks}),claim=await repository.claim(input);await repository.intent(input,claim);
  assert.equal((await repository.claim(input)).operation,'wait');
  await setup.query("UPDATE api_private.local_cloud_jobs SET lease_until=now()-interval '1 second'");assert.equal((await repository.claim(input)).operation,'unknown');assert.equal((await repository.claim(input)).operation,'unknown');
  const unknown=await tasks.execute(testIdentity(),'tasks.get',{requestId:input.requestId});assert.equal(unknown.state,'failed');assert.equal(unknown.errorCode,'PROVIDER_SUBMISSION_UNKNOWN');
  await pollNow(setup);await tasks.tick();assert.equal((await setup.query("SELECT done FROM api_private.task_outbox WHERE operation='poll'")).rows[0].done,true);
  const args=[input.ownerId,input.requestId,'aliyun-test','reconcile',JSON.stringify({jobId:'fixture-reconciled-job'})];
  const rejected=await db.withMaintenance(async c=>(await c.query('SELECT api_private.local_cloud_call($1,$2,$3,$4,$5::jsonb) AS data',args)).rows[0].data);assert.equal(rejected.error,'FORBIDDEN');
  assert.equal((await setup.query('SELECT api_private.local_cloud_call($1,$2,$3,$4,$5::jsonb) AS data',args)).rows[0].data.ok,true);
  assert.equal((await setup.query("SELECT done FROM api_private.task_outbox WHERE operation='poll'")).rows[0].done,false);
  const resumed=await repository.claim(input);assert.equal(resumed.operation,'poll');assert.equal(resumed.jobId,'fixture-reconciled-job');
  await assert.rejects(repository.intent(input,claim),{code:'LEASE_LOST'});assert.equal((await setup.query("SELECT count(*) n FROM api_private.local_cloud_audit WHERE action='billable_submit_intent'")).rows[0].n,'1');
 },provider);
});

test('native cancellation after provider acceptance cannot publish a late image or consume a GPU lease',async()=>{
 let submissions=0;const provider={available:true,submit:async()=>{submissions++;return {jobId:'fixture-job'};},poll:async()=>({status:'succeeded',output:'fixture-only'}),openOutput:async()=>({size:png.length,mime:'image/png',stream:Readable.from([png])})};
 await fixture(async({setup,db,store,tasks,repository,cloud,worker,claim})=>{
  const input=await cloudRequest({db,store,tasks});await pollNow(setup);await tasks.tick();assert.equal(submissions,1);
  const active=await worker('geo');assert.equal((await claim(active)).run,null);const facade=await worker('facade');assert.equal((await claim(facade)).run,null);
  await tasks.execute(testIdentity(),'tasks.cancel',{taskId:input.requestId,requestId:randomUUID()});await tasks.tick();await cloud.drive(input);
  assert.equal((await repository.claim(input)).operation,'canceled');assert.equal((await setup.query('SELECT count(*) n FROM api_private.local_gpu_outputs')).rows[0].n,'0');assert.equal(submissions,1);
 },provider);
});
