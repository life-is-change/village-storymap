import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import pg from 'pg';import {randomUUID} from 'node:crypto';
import {withUnifiedFixture,USERS} from './fixtures/unified.mjs';import {prepareBridge} from './fixtures/bridge.mjs';
test('native source keeps its contracts while isolating all Aliyun jobs, files, tombstones and Worker claims',async()=>{
 await withUnifiedFixture(async({setup,url})=>{
  const target=new URL(url);target.pathname='/village_unified_candidate';let bridgeRole=false,serviceRole=false;
  async function queryAs(role,user,sql,args=[]){assert.ok(['authenticated','anon','village_aliyun_bridge','service_role'].includes(role));const c=new pg.Client({connectionString:target.href});await c.connect();try{await c.query('BEGIN');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[user,role]);await c.query('SET LOCAL ROLE '+role);const r=await c.query(sql,args);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{await c.end();}}
  const invoke=async(name,p,instance='aliyun-test')=>(await queryAs('village_aliyun_bridge',USERS.student,'SELECT aliyun_bridge.'+name+'($1,$2::jsonb) AS data',[instance,JSON.stringify(p)])).rows[0].data;
  try{
   await prepareBridge(setup);serviceRole=true;await setup.query(await readFile(new URL('../../supabase_SQL/Aliyun Task Bridge.sql',import.meta.url),'utf8'));bridgeRole=true;
   const ready=await invoke('bridge_v1_availability',{kind:'geoprocessing'});assert.equal(ready.bridge_protocol,1);assert.equal(ready.data.compatible,true);assert.equal(ready.workers.facade.version,'facade-aliyun-bridge-v1');
   await setup.query("INSERT INTO worker_heartbeats(worker_id,state,version) VALUES('old-unpatched','available','0.1.0')");
   assert.equal((await invoke('bridge_v1_availability',{kind:'geoprocessing'})).data.compatible,false,'any active incompatible claimant blocks new private jobs');
   assert.equal((await invoke('bridge_v1_availability',{kind:'facade'})).data.compatible,true);await setup.query("DELETE FROM worker_heartbeats WHERE worker_id='old-unpatched'");
   const before=(await setup.query('SELECT (SELECT count(*) FROM profiles) profiles,(SELECT count(*) FROM teaching_projects) projects,(SELECT count(*) FROM group_memberships) members,(SELECT count(*) FROM object_photos) photos')).rows[0];
   await assert.rejects(queryAs('authenticated',USERS.admin,"SELECT aliyun_bridge.bridge_v1_status('aliyun-test','{}')"),e=>e.code==='42501');
   const photoId='1',sha='a'.repeat(64),contextId='same-local-space';
   async function contexts(instance='aliyun-test'){
    await invoke('bridge_v1_apply_context',{localKind:'profile',localId:USERS.student,version:1,tombstone:false,payload:{active:true}},instance);
    await invoke('bridge_v1_apply_context',{localKind:'space',localId:contextId,version:1,tombstone:false,payload:{members:[USERS.student],courseId:'local-course',workerVillageId:'b0000000-0000-4000-8000-000000000001'}},instance);
    await invoke('bridge_v1_apply_context',{localKind:'photo',localId:photoId,version:1,tombstone:false,payload:{contextId,path:instance+'/photos/10000000-0000-4000-8000-000000000001/'+sha+'.jpg',sha256:sha,size:123,mime:'image/jpeg'}},instance);
   }
   await contexts();await contexts('aliyun-other');
   const deletedOwner=randomUUID(),deletedRequest=randomUUID();await setup.query('INSERT INTO auth.users(id) VALUES($1)',[deletedOwner]);
   await invoke('bridge_v1_apply_context',{localKind:'profile',localId:deletedOwner,version:1,tombstone:false,payload:{active:true}});
   await invoke('bridge_v1_apply_context',{localKind:'space',localId:'deleted-owner',version:1,tombstone:false,payload:{members:[deletedOwner],courseId:'local-course'}});
   await invoke('bridge_v1_apply_context',{localKind:'photo',localId:'deleted-photo',version:1,tombstone:false,payload:{contextId:'deleted-owner',path:'aliyun-test/photos/10000000-0000-4000-8000-000000000001/'+sha+'.jpg',sha256:sha,size:123,mime:'image/jpeg'}});
   await invoke('bridge_v1_enqueue',{ownerId:deletedOwner,requestId:deletedRequest,kind:'facade',contextId:'deleted-owner',contextVersion:1,profileVersion:1,photoId:'deleted-photo',photoVersion:1,input:{objectCode:'B1'}});
   await setup.query('DELETE FROM auth.users WHERE id=$1',[deletedOwner]);
   await assert.rejects(invoke('bridge_v1_status',{ownerId:deletedOwner,requestId:deletedRequest}),e=>e.message==='FORBIDDEN');
   const canceledRequest=randomUUID();assert.equal((await invoke('bridge_v1_cancel',{ownerId:USERS.student,requestId:canceledRequest})).canceled,true);
   await assert.rejects(invoke('bridge_v1_enqueue',{ownerId:USERS.student,requestId:canceledRequest,kind:'geo',contextId,contextVersion:1,profileVersion:1,input:{requestedSteps:['buildings'],aoi:{},parameters:{}}}),e=>e.message==='FORBIDDEN');
   await invoke('bridge_v1_apply_context',{localKind:'photo',localId:'invalid',version:1,tombstone:false,payload:{contextId}});
   await assert.rejects(invoke('bridge_v1_enqueue',{ownerId:USERS.student,requestId:randomUUID(),kind:'facade',contextId,contextVersion:1,profileVersion:1,photoId:'invalid',photoVersion:1,input:{objectCode:'B1'}}),e=>e.message==='INVALID_INPUT');
   const requestId=randomUUID(),input={ownerId:USERS.student,requestId,kind:'facade',contextId,contextVersion:1,profileVersion:1,photoId,photoVersion:1,input:{objectCode:'B1'}};
   const run=await invoke('bridge_v1_enqueue',input),replay=await invoke('bridge_v1_enqueue',input);assert.equal(run.runId,replay.runId);
   const other=await invoke('bridge_v1_enqueue',input,'aliyun-other');assert.notEqual(run.runId,other.runId);
   const cloudRequest=randomUUID(),cloud=await invoke('bridge_v1_enqueue',{...input,requestId:cloudRequest,kind:'cloud-facade'});
   assert.equal((await setup.query('SELECT photo_id FROM cloud_facade_runs WHERE id=$1',[cloud.runId])).rows[0].photo_id,null);
   assert.equal((await queryAs('authenticated',USERS.student,'SELECT * FROM cloud_facade_runs WHERE id=$1',[cloud.runId])).rowCount,0);
   const cloudInput={ownerId:USERS.student,requestId:cloudRequest},claim=await invoke('bridge_v1_cloud_claim',cloudInput);
   assert.equal(claim.operation,'submit');assert.equal(claim.photo.path.startsWith('aliyun-test/photos/'),true);
   assert.equal((await invoke('bridge_v1_cloud_claim',cloudInput)).operation,'wait');
   await invoke('bridge_v1_cloud_record',{...cloudInput,lease:claim.lease,status:'queued',jobId:'synthetic-provider'});
   await setup.query("UPDATE aliyun_bridge.cloud_jobs SET claimed_at=now()-interval '10 seconds' WHERE run_id=$1",[cloud.runId]);
   const poll=await invoke('bridge_v1_cloud_claim',cloudInput);assert.equal(poll.operation,'poll');assert.equal(poll.jobId,'synthetic-provider');
   await invoke('bridge_v1_cloud_record',{...cloudInput,lease:poll.lease,status:'succeeded',artifact:{sha256:sha,size:123,mime:'image/png',path:USERS.student+'/cloud/'+cloud.runId+'/'+sha+'.png'}});
   assert.equal((await invoke('bridge_v1_cloud_claim',cloudInput)).operation,'complete');
   assert.equal((await queryAs('authenticated',USERS.student,'SELECT * FROM facade_generation_runs WHERE id=$1',[run.runId])).rowCount,0);
   assert.equal((await queryAs('authenticated',USERS.admin,'SELECT * FROM facade_generation_runs WHERE id=$1',[run.runId])).rowCount,0,'source admin cannot cross origin');
   for(const user of [USERS.student,USERS.admin])await assert.rejects(queryAs('authenticated',user,'SELECT public.request_facade_cancel($1)',[run.runId]),e=>e.code==='P0001'&&e.message==='FORBIDDEN');
   await setup.query("UPDATE facade_generation_runs SET status='awaiting_crop' WHERE id=$1",[run.runId]);await assert.rejects(queryAs('authenticated',USERS.student,"SELECT public.confirm_facade_crop($1,0.1,'flat',10,8)",[run.runId]),e=>e.message==='FORBIDDEN');
   assert.equal((await invoke('bridge_v1_confirm_crop',{ownerId:USERS.student,requestId,cropTop:0.1,roofType:'gable',buildingWidth:10,buildingDepth:8})).confirmed,true);
   const privatePath=USERS.student+'/'+run.runId+'/generation-r1/standard.png';await setup.query("INSERT INTO storage.objects(bucket_id,name) VALUES('facade-generation',$1),('aliyun-task-inputs',$2)",[privatePath,'aliyun-test/photos/private.jpg']);
   assert.equal((await queryAs('authenticated',USERS.student,'SELECT * FROM storage.objects')).rowCount,0,'a permissive old policy cannot expose bridge bytes');
   const source=await setup.query("INSERT INTO facade_generation_runs(owner_id,course_id,space_id,object_code,photo_id) VALUES($1,'course','A','B1',NULL) RETURNING id,origin_instance_id",[USERS.student]);assert.equal(source.rows[0].origin_instance_id,'supabase');
   assert.equal((await queryAs('authenticated',USERS.student,'SELECT * FROM facade_generation_runs WHERE id=$1',[source.rows[0].id])).rowCount,1);assert.equal((await queryAs('authenticated',USERS.student,'SELECT public.request_facade_cancel($1) AS ok',[source.rows[0].id])).rows[0].ok,true);
   const aoi={type:'Polygon',coordinates:[[[113,23],[113.0001,23],[113.0001,23.0001],[113,23]]]};
   const sourceFacade=(await queryAs('authenticated',USERS.student,"SELECT public.submit_facade_run('course','A','B1',1) AS id")).rows[0].id;
   assert.equal((await queryAs('authenticated',USERS.student,'SELECT * FROM facade_generation_runs WHERE id=$1',[sourceFacade])).rows[0].origin_instance_id,'supabase');
   const geo=await invoke('bridge_v1_enqueue',{...input,requestId:randomUUID(),kind:'geo',input:{requestedSteps:['buildings'],aoi,parameters:{}}});
   const row=(await setup.query('SELECT * FROM geoprocessing_runs WHERE id=$1',[geo.runId])).rows[0];assert.equal(row.teaching_project_id,null);assert.equal(row.dataset_id,null);assert.equal(row.origin_instance_id,'aliyun-test');
   await assert.rejects(queryAs('authenticated',USERS.student,"SELECT public.import_geoprocessing_result($1,'{}')",[geo.runId]),e=>e.message==='FORBIDDEN');
   await assert.rejects(queryAs('authenticated',USERS.admin,'SELECT public.teacher_cancel_geoprocessing_run($1)',[geo.runId]),e=>e.message==='FORBIDDEN');
   const claimed=await queryAs('service_role',USERS.admin,"SELECT * FROM public.claim_next_geoprocessing_run('worker')");assert.equal(claimed.rows[0].origin_instance_id,'aliyun-test');assert.equal(claimed.rows[0].id,geo.runId);
   await invoke('bridge_v1_apply_context',{localKind:'profile',localId:USERS.student,version:2,tombstone:true,payload:{active:false}});
   assert.equal((await setup.query('SELECT status FROM geoprocessing_runs WHERE id=$1',[geo.runId])).rows[0].status,'cancel_requested');
   await assert.rejects(invoke('bridge_v1_status',{ownerId:USERS.student,requestId}),e=>e.message==='FORBIDDEN');
   await assert.rejects(invoke('bridge_v1_apply_context',{localKind:'profile',localId:USERS.student,version:1,tombstone:false,payload:{active:true}}),e=>e.message==='REVISION_CONFLICT');
   await assert.rejects(invoke('bridge_v1_apply_context',{localKind:'profile',localId:USERS.student,version:3,tombstone:false,payload:{active:true}}),e=>e.message==='REVISION_CONFLICT');
   assert.equal((await invoke('bridge_v1_status',{ownerId:USERS.student,requestId},'aliyun-other')).run.origin_instance_id,'aliyun-other');
   await invoke('bridge_v1_apply_context',{localKind:'photo',localId:photoId,version:2,tombstone:true,payload:{}},'aliyun-other');
   await assert.rejects(invoke('bridge_v1_retry',{ownerId:USERS.student,requestId},'aliyun-other'),e=>e.message==='FORBIDDEN');
   assert.deepEqual((await setup.query('SELECT (SELECT count(*) FROM profiles) profiles,(SELECT count(*) FROM teaching_projects) projects,(SELECT count(*) FROM group_memberships) members,(SELECT count(*) FROM object_photos) photos')).rows[0],before);
  }finally{
   await setup.query('ROLLBACK');
   if(!serviceRole)serviceRole=Boolean((await setup.query("SELECT 1 FROM pg_roles WHERE rolname='service_role'")).rowCount);
   if(!bridgeRole)bridgeRole=Boolean((await setup.query("SELECT 1 FROM pg_roles WHERE rolname='village_aliyun_bridge'")).rowCount);
   if(bridgeRole)await setup.query('DROP OWNED BY village_aliyun_bridge;DROP ROLE village_aliyun_bridge');
   if(serviceRole)await setup.query('DROP OWNED BY service_role;DROP ROLE service_role');
  }
 });
});
