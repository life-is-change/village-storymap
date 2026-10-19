import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {withUnifiedFixture,testIdentity,USERS} from './fixtures/unified.mjs';import {preparePlanning} from './fixtures/planning.mjs';import {createUnifiedDatabase} from '../unified/database.mjs';
test('committed invalidations are context authorized; rollback and old cursors cannot leak rows',async()=>{
 await withUnifiedFixture(async({setup,install,config})=>{
  await preparePlanning(setup);await install();for(const f of ['catalog','survey','planning','events'])await setup.query(await readFile(new URL('../../linux/sql/unified/'+f+'.sql',import.meta.url),'utf8'));
  const db=createUnifiedDatabase(config),c={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'A'};
  const read=(cursor=null)=>db.withIdentity(testIdentity(),async q=>(await q.query('SELECT api_private.event_read($1::jsonb,$2) data',[JSON.stringify([c]),cursor])).rows[0].data,{readOnly:true});
  try{
   const start=await read();assert.equal(start.refresh,true);
   await setup.query('BEGIN');await setup.query("UPDATE planning_features SET props='{\"private\":\"rollback\"}' WHERE space_id='A'");await setup.query('ROLLBACK');assert.equal((await read(start.cursor)).events.length,0);
   await setup.query("UPDATE planning_features SET props='{\"private\":\"never broadcast\"}' WHERE space_id='A'");
   const events=await read(start.cursor);assert.ok(events.events.length);assert.equal(events.events[0].kind,'planning');assert.deepEqual(events.events[0].context,c);assert.equal(JSON.stringify(events).includes('never broadcast'),false);
   const beforeForeign=events.cursor;await setup.query("UPDATE planning_features SET props='{}' WHERE space_id='B'");assert.equal((await read(beforeForeign)).events.length,0);
   await setup.query("UPDATE api_private.event_log SET created_at=now()-interval '25 hours'");assert.equal((await read(start.cursor)).refresh,true);
   await setup.query("DELETE FROM group_memberships WHERE student_key='A17::Alice'");await assert.rejects(read(events.cursor),{code:'FORBIDDEN'});
  }finally{await db.close();}
 });
});
