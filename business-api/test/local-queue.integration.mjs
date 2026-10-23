import {createServer} from 'node:http';import {listenLoopback} from './fixtures/http-listen.mjs';import {createLocalWorkerHandler} from '../local-tasks/http.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import {readFile} from 'node:fs/promises';
import {withUnifiedFixture,testIdentity,USERS} from './fixtures/unified.mjs';import {prepareFiles} from './fixtures/files.mjs';
import {createUnifiedDatabase} from '../unified/database.mjs';import {createTaskService} from '../unified/tasks.mjs';
import {createLocalQueueService} from '../local-tasks/service.mjs';import {createLocalTaskTransport} from '../local-tasks/transport.mjs';
const context={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'A',courseId:'course'};
const input=()=>({...context,requestId:randomUUID(),requestedSteps:['buildings'],aoi:{type:'Polygon',coordinates:[[[113,23],[113.0001,23],[113.0001,23.0001],[113,23]]]},parameters:{}});
async function fixture(fn){
 await withUnifiedFixture(async({setup,install,config})=>{
  await prepareFiles(setup);await install();for(const name of ['catalog','survey','planning','files','tasks'])await setup.query(await readFile(new URL('../../linux/sql/unified/'+name+'.sql',import.meta.url),'utf8'));
  await setup.query(await readFile(new URL('../../linux/sql/local-tasks.sql',import.meta.url),'utf8'));
  await setup.query('INSERT INTO api_private.task_worker_villages VALUES($1::uuid,$1::text)',[context.villageId]);
  const db=createUnifiedDatabase(config),queue=createLocalQueueService({database:db,instanceId:'aliyun-test'}),transport=createLocalTaskTransport({queue}),tasks=createTaskService({database:db,bridge:transport,files:{}});
  async function worker(kind='geo',label=randomUUID()){
   const id=randomUUID(),secret='A'.repeat(43),header='Bearer village_worker_'+id+'.'+secret;
   await setup.query('INSERT INTO api_private.local_gpu_workers(id,instance_id,name,kind,token_digest) VALUES($1,$2,$3,$4,$5)',[id,'aliyun-test',label,kind,createHash('sha256').update(secret).digest('hex')]);
   const actor=await queue.authenticate(header);await queue.workerCall(actor,'heartbeat',null,null,{state:'idle',protocol:kind+'-aliyun-local-v1'});return actor;
  }
  async function submit(p=input()){await tasks.execute(testIdentity(),'tasks.submitGeo',p);await tasks.tick();return p;}
  const claim=(actor,requestId=randomUUID())=>queue.workerCall(actor,'claim',null,null,{requestId});
  try{await fn({setup,db,queue,tasks,worker,submit,claim});}finally{await tasks.close();await db.close();}
 });
}

test('local queues start empty and atomically claim once per Worker request without consuming historical source jobs',async()=>{
 await fixture(async({setup,queue,tasks,worker,submit,claim})=>{
  const a=await worker(),b=await worker(),nonce=randomUUID();
  // A source-format historical queue is deliberately populated; its rows are
  // never executable by the new local queue's claimant.
  await setup.query("ALTER TABLE public.geoprocessing_runs ADD COLUMN status text;INSERT INTO public.geoprocessing_runs(id,status) VALUES(gen_random_uuid(),'queued')");
  assert.equal((await claim(a)).run,null);assert.equal((await setup.query('SELECT count(*) n FROM api_private.local_gpu_runs')).rows[0].n,'0');
  const first=await submit(),second=await submit();await assert.rejects(tasks.execute(testIdentity(),'tasks.submitGeo',input()),{code:'TOO_MANY_ACTIVE_RUNS'});
  const facade=await worker('facade');assert.equal((await claim(facade)).run,null,'facade credential cannot claim geo work');
  await assert.rejects(queue.workerCall(facade,'sources',null,null,{}),{code:'FORBIDDEN'});
  await assert.rejects(queue.authenticate('Bearer village_worker_'+a.workerId+'.'+'B'.repeat(43)),{code:'UNAUTHORIZED'});
  const [x,replay,y]=await Promise.all([claim(a,nonce),claim(a,nonce),claim(b)]);
  assert.equal(x.run.id,replay.run.id);assert.equal(x.leaseToken,replay.leaseToken);assert.notEqual(x.run.id,y.run.id);
  assert.equal((await claim(a)).run,null,'one active lease per Worker');
  await queue.workerCall(a,'renew',x.run.id,x.leaseToken,{});
  const c=await worker();await setup.query('UPDATE api_private.local_gpu_runs SET lease_until=now()-interval \'1 second\' WHERE id=$1',[x.run.id]);
  await claim(c);await setup.query("UPDATE api_private.local_gpu_runs SET next_at=now() WHERE status='queued'");const reclaimed=await claim(c);assert.equal(reclaimed.run.id,x.run.id);assert.notEqual(reclaimed.leaseToken,x.leaseToken);
  await assert.rejects(queue.workerCall(a,'renew',x.run.id,x.leaseToken,{}),{code:'LEASE_LOST'});
  await assert.rejects(queue.workerCall(a,'complete',x.run.id,x.leaseToken,{}),{code:'LEASE_LOST'});
  await assert.rejects(claim(a,nonce),{code:'STALE_CLAIM'});
  await setup.query('UPDATE api_private.local_gpu_workers SET revoked_at=now() WHERE id=$1',[c.workerId]);
  await assert.rejects(queue.workerCall(c,'renew',reclaimed.run.id,reclaimed.leaseToken,{}),{code:'UNAUTHORIZED'});
  assert.equal((await setup.query("SELECT count(*) n FROM public.geoprocessing_runs WHERE status='queued'")).rows[0].n,'1');
  assert.equal((await tasks.execute(testIdentity(),'tasks.get',{requestId:first.requestId})).kind,'geo');assert.notEqual(first.requestId,second.requestId);
 });
});

test('local completion requires verified output metadata, rejects canceled/stale work and preserves terminal state on late cancel',async()=>{
 await fixture(async({setup,queue,tasks,worker,submit,claim})=>{
  const actor=await worker(),p=await submit(),job=await claim(actor);
  await queue.workerCall(actor,'progress',job.run.id,job.leaseToken,{state:'running',stage:'buildings',progress:10});
  await assert.rejects(queue.workerCall(actor,'complete',job.run.id,job.leaseToken,{}),{code:'FILES_NOT_READY'});
  // Control-plane fixture only. Physical bytes/upload commit are separately
  // exercised by Task 6, not claimed by this synthetic metadata receipt.
  await setup.query("INSERT INTO api_private.local_gpu_outputs(run_id,phase,revision,artifact_type,file_id,sha256,size,mime,extension,state,lease_token) VALUES($1,'geo',0,'buildings',gen_random_uuid(),repeat('a',64),1,'application/geo+json','geojson','ready',$2)",[job.run.id,job.leaseToken]);
  assert.equal((await queue.workerCall(actor,'complete',job.run.id,job.leaseToken,{})).status,'completed');await queue.workerCall(actor,'complete',job.run.id,job.leaseToken,{});
  await tasks.execute(testIdentity(),'tasks.cancel',{taskId:p.requestId,requestId:randomUUID()});await tasks.tick();
  const terminal=await tasks.execute(testIdentity(),'tasks.get',{requestId:p.requestId});assert.equal(terminal.state,'completed');assert.equal(terminal.status,'completed');
  const next=await submit(),cancelJob=await claim(actor);await tasks.execute(testIdentity(),'tasks.cancel',{taskId:next.requestId,requestId:randomUUID()});await tasks.tick();
  assert.equal((await queue.workerCall(actor,'cancel-status',cancelJob.run.id,cancelJob.leaseToken,{})).cancelRequested,true);
  await assert.rejects(queue.workerCall(actor,'complete',cancelJob.run.id,cancelJob.leaseToken,{}),{code:'LEASE_LOST'});
  await queue.workerCall(actor,'cancel',cancelJob.run.id,cancelJob.leaseToken,{});assert.equal((await tasks.execute(testIdentity(),'tasks.get',{requestId:next.requestId})).state,'canceled');
 });
});

test('transient failures back off and exhaust five leases; revoked local membership cannot publish progress',async()=>{
 await fixture(async({setup,queue,tasks,worker,submit,claim})=>{
  const actor=await worker(),p=await submit();let job;
  for(let attempt=1;attempt<=5;attempt++){
   job=await claim(actor);assert.ok(job.run);const failed=await queue.workerCall(actor,'retry-failure',job.run.id,job.leaseToken,{errorCode:'SYNTHETIC_TRANSIENT'});
   assert.equal(failed.status,attempt===5?'failed':'queued');await queue.workerCall(actor,'retry-failure',job.run.id,job.leaseToken,{errorCode:'SYNTHETIC_TRANSIENT'});
   if(attempt<5){assert.equal((await claim(actor)).run,null);await setup.query('UPDATE api_private.local_gpu_runs SET next_at=now() WHERE id=$1',[job.run.id]);}
  }
  assert.equal((await setup.query('SELECT attempts FROM api_private.local_gpu_runs')).rows[0].attempts,5);assert.equal((await claim(actor)).run,null);
  const other=await submit(),active=await claim(actor);await setup.query("DELETE FROM group_memberships WHERE student_key='a::A'");
  await assert.rejects(queue.workerCall(actor,'progress',active.run.id,active.leaseToken,{state:'running',stage:'starting',progress:1}),{code:'LEASE_LOST'});
  await assert.rejects(tasks.execute(testIdentity(),'tasks.get',{requestId:other.requestId}),{code:'FORBIDDEN'});assert.notEqual(p.requestId,other.requestId);
 });
});


test('real Worker identity proves both credential kinds read-only and rejects revocation',async()=>{
 await fixture(async({setup,queue,worker})=>{
  const server=createServer(createLocalWorkerHandler({queue}));await listenLoopback(server);
  try{for(const kind of ['geo','facade']){
   const actor=await worker(kind),header='Bearer village_worker_'+actor.workerId+'.'+'A'.repeat(43);
   const before=(await setup.query('SELECT row_to_json(w) v FROM api_private.local_gpu_workers w WHERE id=$1',[actor.workerId])).rows[0].v;
   const probe=()=>fetch('http://127.0.0.1:'+server.address().port+'/api/worker/v1/identity',{headers:{Authorization:header}});
   const response=await probe();assert.equal(response.status,200);assert.deepEqual((await response.json()).data,{workerId:actor.workerId,kind,instanceId:'aliyun-test'});
   assert.deepEqual((await setup.query('SELECT row_to_json(w) v FROM api_private.local_gpu_workers w WHERE id=$1',[actor.workerId])).rows[0].v,before);
   await setup.query('UPDATE api_private.local_gpu_workers SET revoked_at=now() WHERE id=$1',[actor.workerId]);assert.equal((await probe()).status,401);
  }}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 });
});

test('status polling and Worker progress serialize on the parent task without deadlocking',async()=>{
 await fixture(async({setup,queue,tasks,worker,submit,claim})=>{
  const actor=await worker(),p=await submit(),job=await claim(actor);
  let progressValue=0;
  async function overlap(){
   await setup.query("SET deadlock_timeout='100ms';BEGIN");
   await setup.query('SELECT id FROM api_private.task_requests WHERE id=$1 FOR UPDATE',[job.run.id]);
   const progress=queue.workerCall(actor,'progress',job.run.id,job.leaseToken,{state:'running',stage:'starting',progress:++progressValue}).then(value=>({value}),error=>({error:error.code}));
   let statusError;
   try{
    let blocked=false;
    for(let n=0;n<150;n++){
     blocked=(await setup.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND usename='village_unified_login' AND wait_event_type='Lock' AND pg_backend_pid()=ANY(pg_blocking_pids(pid))) AS blocked")).rows[0].blocked;
     if(blocked)break;await new Promise(r=>setTimeout(r,10));
    }
    assert.equal(blocked,true,'Worker must actually overlap the held parent lock');
    try{await setup.query("SELECT api_private.local_task_control('status','aliyun-test',$1::jsonb)",[JSON.stringify({ownerId:USERS.student,requestId:p.requestId})]);}
    catch(error){statusError=error.code;}
   }finally{await setup.query('ROLLBACK');}
   return {statusError,progressError:(await progress).error};
  }
  const good=await overlap();assert.deepEqual(good,{statusError:undefined,progressError:undefined});
  // A deterministic RED replay of the original function in this disposable
  // cluster proves the overlap test really detects the reported lock cycle.
  const {spawnSync}=await import('node:child_process');
  const child=spawnSync('python3',['-B','-c',"import sys,json;from pathlib import Path;sys.path.insert(0,'linux/scripts');from task_lock_order import body_pair;print(json.dumps(body_pair(Path('linux/sql/local-tasks.sql').read_text(),'local_worker_call')))"],{encoding:'utf8',timeout:10000});
  assert.equal(child.status,0);const [before,after]=JSON.parse(child.stdout);
  const definition=(await setup.query("SELECT pg_get_functiondef('api_private.local_worker_call(uuid,text,text,text,uuid,uuid,jsonb)'::regprocedure) AS body")).rows[0].body;
  assert.ok(definition.includes(after));await setup.query(definition.replace(after,before));
  let legacy;
  try{legacy=await overlap();}finally{await setup.query(definition);}
  assert.ok(legacy.statusError==='40P01'||legacy.progressError==='DB_UNAVAILABLE','legacy lock inversion must actually reproduce a deadlock');
  assert.deepEqual(await overlap(),{statusError:undefined,progressError:undefined});
  assert.equal((await tasks.execute(testIdentity(),'tasks.get',{requestId:p.requestId})).state,'running');
 });
});

test('claim skips a locked parent task instead of holding its child while waiting',async()=>{
 await fixture(async({setup,worker,submit,claim})=>{
  const actor=await worker(),first=await submit(),second=await submit();
  await setup.query('BEGIN');await setup.query('SELECT id FROM api_private.task_requests WHERE request_id=$1 FOR UPDATE',[first.requestId]);
  const pending=claim(actor).then(value=>({value}),error=>({error}));let result;
  try{result=await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve({blocked:true}),700))]);}
  finally{await setup.query('ROLLBACK');await pending;}
  assert.notEqual(result.blocked,true,'claim must finish before the parent lock is released');assert.equal(result.error,undefined);
  assert.equal((await setup.query('SELECT request_id FROM api_private.task_requests WHERE id=$1',[result.value.run.id])).rows[0].request_id,second.requestId);
 });
});
