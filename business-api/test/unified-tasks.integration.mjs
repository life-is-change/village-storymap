import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
import {withUnifiedFixture,testIdentity,USERS} from './fixtures/unified.mjs';import {prepareFiles} from './fixtures/files.mjs';
import {createUnifiedDatabase} from '../unified/database.mjs';import {createTaskService} from '../unified/tasks.mjs';
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
   const first=await service.execute(testIdentity(),'tasks.submitGeo',input);assert.equal(first.state,'pending');await service.execute(testIdentity(),'tasks.submitGeo',input);
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
