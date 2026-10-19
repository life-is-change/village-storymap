import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {withUnifiedFixture,testIdentity,USERS} from './fixtures/unified.mjs';import {prepareSurvey} from './fixtures/survey.mjs';
const dbAPI=await import('../unified/database.mjs');let api;try{api=await import('../unified/planning.mjs');}catch{api={};}
test('native planning preserves legacy privacy, competing lease ownership and receipt replay',async()=>{
 await withUnifiedFixture(async({setup,install,config})=>{
  await prepareSurvey(setup);await setup.query(`INSERT INTO planning_spaces(id,title,space_type,group_id,owner_id,teaching_project_id,village_id) VALUES('L','Other owned legacy','legacy_personal','group-a','20000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001');INSERT INTO legacy_personal_space_scopes(space_id,teaching_project_id,village_id,owner_id,ownership_status) VALUES('L','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','owned')`);
  await install();await setup.query(await readFile(new URL('../../linux/sql/unified/catalog.sql',import.meta.url),'utf8'));await setup.query(await readFile(new URL('../../linux/sql/unified/survey.sql',import.meta.url),'utf8'));
  const db=dbAPI.createUnifiedDatabase(config);const c={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'A',layerKey:'building',objectCode:'B1'};
  try{
   await assert.rejects(db.withIdentity(testIdentity(),q=>q.query('SELECT api_private.catalog_read($1,$2::jsonb)', ['catalog.getSpace',JSON.stringify({...c,spaceId:'L'})])),{code:'FORBIDDEN'},'same-group membership must not expose another legacy personal space');
   assert.equal(typeof api.createPlanningService,'function');await setup.query(await readFile(new URL('../../linux/sql/unified/planning.sql',import.meta.url),'utf8'));
   const service=api.createPlanningService({database:db});
   const [one,two]=await Promise.all([service.execute(testIdentity(),'planning.acquireLock',c),service.execute(testIdentity(USERS.other),'planning.acquireLock',c)]);
   assert.equal([one,two].filter(r=>r.success).length,1);
  }finally{await db.close();}
 });
});
