import {prepareCatalog} from './fixtures/catalog.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {withUnifiedFixture,USERS,testIdentity} from './fixtures/unified.mjs';
let api,dbAPI;try{api=await import('../unified/catalog.mjs');dbAPI=await import('../unified/database.mjs');}catch{api={};}
test('native course transactions enforce staff, locked group, replay and actor authority',async()=>{
 assert.equal(typeof api.createCatalogService,'function');await withUnifiedFixture(async({setup,install,config})=>{
  await prepareCatalog(setup);
  await install();await setup.query(await readFile(new URL('../../linux/sql/unified/catalog.sql',import.meta.url),'utf8'));
  const db=dbAPI.createUnifiedDatabase(config),service=api.createCatalogService({database:db});const requestId='c0000000-0000-4000-8000-000000000001';
  try{
   await assert.rejects(service.execute(testIdentity(),'catalog.createGroup',{courseId:'course',name:'Group',requestId}),{code:'FORBIDDEN'});
   const input={courseId:'course',name:'Group',requestId};const [a,b]=await Promise.all([service.execute(testIdentity(USERS.teacher),'catalog.createGroup',input),service.execute(testIdentity(USERS.teacher),'catalog.createGroup',input)]);assert.deepEqual(a,b);
   assert.equal((await setup.query('SELECT count(*) n FROM course_groups')).rows[0].n,'1');
   const lockedId='c0000000-0000-4000-8000-000000000002';await service.execute(testIdentity(USERS.teacher),'catalog.lockGroup',{groupId:a.id,locked:true,requestId:lockedId});
   await assert.rejects(service.execute(testIdentity(USERS.other),'catalog.joinGroup',{courseId:'course',code:a.join_code,requestId:'c0000000-0000-4000-8000-000000000003'}),{code:'FORBIDDEN'});
   await service.execute(testIdentity(USERS.teacher),'catalog.lockGroup',{groupId:a.id,locked:false,requestId:'c0000000-0000-4000-8000-000000000004'});
   const joined=await service.execute(testIdentity(USERS.other),'catalog.joinGroup',{courseId:'course',code:a.join_code,requestId:'c0000000-0000-4000-8000-000000000005'});assert.equal(joined.student_key,'b::B');
   const listed=await service.execute(testIdentity(),'catalog.listGroups',{courseId:'course'});assert.equal(Object.hasOwn(listed[0],'join_code'),false,'students cannot enumerate joining codes');

   const boundary={type:'Polygon',coordinates:[[[113,23],[113.001,23],[113.001,23.001],[113,23.001],[113,23]]]};
   const village=await service.execute(testIdentity(USERS.admin),'admin.createVillage',{name:'Native geometry draft',boundary,requestId:'d0000000-0000-4000-8000-000000000001'});assert.equal(village.status,'draft');
   assert.equal((await setup.query('SELECT extensions.ST_IsValid(boundary) valid FROM villages WHERE id=$1',[village.id])).rows[0].valid,true);
   await assert.rejects(service.execute(testIdentity(USERS.admin),'admin.deleteVillage',{villageId:'b0000000-0000-4000-8000-000000000001',requestId:'d0000000-0000-4000-8000-000000000002'}),{code:'FORBIDDEN'});
   const removed=await service.execute(testIdentity(USERS.admin),'admin.deleteVillage',{villageId:village.id,requestId:'d0000000-0000-4000-8000-000000000003'});assert.equal(removed,village.id);
   const bootstrap=await service.bootstrap(testIdentity());assert.equal(bootstrap.profile.id,USERS.student);
   await assert.rejects(service.execute(testIdentity(USERS.teacher),'catalog.createGroup',{...input,name:'Other'}),{code:'REVISION_CONFLICT'});
   await assert.rejects(db.withIdentity(testIdentity(),c=>c.query('SELECT * FROM course_groups')),{code:'FORBIDDEN'});
  }finally{await db.close();}
 });
});
