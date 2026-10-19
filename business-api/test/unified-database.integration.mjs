import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {withUnifiedFixture,testIdentity,USERS} from './fixtures/unified.mjs';
let api;try{api=await import('../unified/database.mjs');}catch{api={};}
test('native PostgreSQL/PostGIS candidate enforces isolation, source project uniqueness and a four connection pool',async()=>{
 assert.equal(typeof api.createUnifiedDatabase,'function');
 await withUnifiedFixture(async({setup,config,install})=>{
  await install();const db=api.createUnifiedDatabase(config);try{
   assert.equal(await db.verifyInstallation(),1);
   assert.deepEqual(await db.withIdentity(testIdentity(),async c=>(await c.query('SELECT id FROM profiles ORDER BY id')).rows),[{id:USERS.student}]);
   assert.equal(await db.withIdentity(testIdentity(USERS.teacher),async c=>(await c.query('SELECT count(*) n FROM profiles')).rows[0].n),'4');
   await assert.rejects(db.withIdentity(testIdentity(),c=>c.query('SELECT public.test_unsafe_unified()')),{code:'FORBIDDEN'});
   await assert.rejects(setup.query("INSERT INTO teaching_projects VALUES('a0000000-0000-4000-8000-000000000002','course','Second active','design','b0000000-0000-4000-8000-000000000001')"),e=>e.code==='23505');
   assert.equal((await setup.query('SELECT extensions.ST_IsValid(boundary) ok FROM villages')).rows[0].ok,true);
   const cross=new pg.Client({...config,database:'postgres'});try{await assert.rejects(cross.connect(),/pg_hba.conf/);}finally{await cross.end();}
   let entered=0,release,ready;const gate=new Promise(r=>release=r),all=new Promise(r=>ready=r);
   const pending=Array.from({length:4},()=>db.withIdentity(testIdentity(),async()=>{if(++entered===4)ready();await gate;return true;}));
   let extra;try{await Promise.race([all,Promise.all(pending)]);extra=db.withIdentity(testIdentity(),async()=>{entered++;return 'done';});assert.equal(await Promise.race([extra,new Promise(r=>setTimeout(()=>r('queued'),150))]),'queued');}finally{release();await Promise.allSettled(pending);await extra?.catch(()=>{});}
   assert.equal(await extra,'done');assert.equal(entered,5);
   await setup.query('UPDATE profiles SET disabled_at=now() WHERE id=$1',[USERS.student]);
   await assert.rejects(db.withIdentity(testIdentity(),()=>{}),{code:'PROFILE_DISABLED'});
   assert.equal((await setup.query('SELECT count(*) n FROM teaching_projects')).rows[0].n,'1');
  }finally{await db.close();}
 });
});
