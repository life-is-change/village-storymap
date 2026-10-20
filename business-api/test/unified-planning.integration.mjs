import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {withUnifiedFixture,testIdentity,USERS} from './fixtures/unified.mjs';import {preparePlanning} from './fixtures/planning.mjs';
const dbAPI=await import('../unified/database.mjs');let api;try{api=await import('../unified/planning.mjs');}catch{api={};}
test('native planning preserves legacy privacy, competing lease ownership and receipt replay',async()=>{
 await withUnifiedFixture(async({setup,install,config})=>{
  await preparePlanning(setup);await setup.query(`INSERT INTO planning_spaces(id,title,space_type,group_id,owner_id,teaching_project_id,village_id) VALUES('L','Other owned legacy','legacy_personal','group-a','20000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001');INSERT INTO legacy_personal_space_scopes(space_id,teaching_project_id,village_id,owner_id,ownership_status) VALUES('L','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','owned')`);
  await install();await setup.query(await readFile(new URL('../../linux/sql/unified/catalog.sql',import.meta.url),'utf8'));await setup.query(await readFile(new URL('../../linux/sql/unified/survey.sql',import.meta.url),'utf8'));
  const db=dbAPI.createUnifiedDatabase(config);const c={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'A',layerKey:'building',objectCode:'B1'};
  try{
   await assert.rejects(db.withIdentity(testIdentity(),q=>q.query('SELECT api_private.catalog_read($1,$2::jsonb)', ['catalog.getSpace',JSON.stringify({...c,spaceId:'L'})])),{code:'FORBIDDEN'},'same-group membership must not expose another legacy personal space');
   assert.equal(typeof api.createPlanningService,'function');await setup.query(await readFile(new URL('../../linux/sql/unified/planning.sql',import.meta.url),'utf8'));
   const service=api.createPlanningService({database:db});
   const [one,two]=await Promise.all([service.execute(testIdentity(),'planning.acquireLock',c),service.execute(testIdentity(USERS.other),'planning.acquireLock',c)]);
   assert.equal([one,two].filter(r=>r.success).length,1);
   const winner=one.success?USERS.student:USERS.other,loser=one.success?USERS.other:USERS.student,lease=one.success?one:two;
   assert.equal((await service.execute(testIdentity(loser),'planning.heartbeatLock',{...c,lockToken:lease.lockToken})).success,false);
   await setup.query("UPDATE feature_edit_locks SET expires_at=now()-interval '1 second'");
   assert.equal((await service.execute(testIdentity(winner),'planning.heartbeatLock',{...c,lockToken:lease.lockToken})).success,false,'expired token cannot renew');
   const next=await service.execute(testIdentity(loser),'planning.acquireLock',c);assert.equal(next.success,true);assert.notEqual(next.lockToken,lease.lockToken);
   const polygon=n=>({type:'Polygon',coordinates:[[[113,23],[113+n,23],[113+n,23+n],[113,23]]]});
   const input={...c,changes:[{action:'update',layerKey:'building',objectCode:'B1',afterGeom:polygon(0.002),afterProps:{name:'Current'},beforeGeom:polygon(0.5),beforeProps:{forged:true},expectedGeometryRevision:0,lockToken:next.lockToken}],requestId:'c0000000-0000-4000-8000-000000000001'};delete input.layerKey;delete input.objectCode;
   const [saved,replayed]=await Promise.all([service.execute(testIdentity(loser),'planning.saveBatch',input),service.execute(testIdentity(loser),'planning.saveBatch',input)]);assert.equal(saved,replayed);
   const versions=await setup.query('SELECT * FROM feature_versions');assert.equal(versions.rowCount,1);assert.equal(versions.rows[0].before_props.forged,undefined);assert.deepEqual(versions.rows[0].before_geom,polygon(0.001));
   const currentLease=await service.execute(testIdentity(loser),'planning.acquireLock',c);
   await assert.rejects(service.execute(testIdentity(loser),'planning.saveBatch',{...input,requestId:'c0000000-0000-4000-8000-000000000002',changes:[{...input.changes[0],lockToken:currentLease.lockToken}]}),{code:'REVISION_CONFLICT'});
   await service.execute(testIdentity(loser),'planning.releaseLock',{...c,lockToken:currentLease.lockToken});
   const personal={spaceId:'a0000000-0000-4000-8000-000000000001',changes:[{action:'update',layerKey:'building',objectCode:'P1',layerVersionId:'f0000000-0000-4000-8000-000000000003',afterGeom:polygon(0.001),afterProps:{}}],requestId:'d0000000-0000-4000-8000-000000000001'};
   await assert.rejects(service.execute(testIdentity(USERS.other),'personal.saveBatch',personal),{code:'FORBIDDEN'});
   assert.equal(await service.execute(testIdentity(),'personal.saveBatch',personal),1);
   assert.equal((await service.execute(testIdentity(),'personal.listFeatures',{versionId:'f0000000-0000-4000-8000-000000000003'})).length,1);
   await assert.rejects(service.execute(testIdentity(),'personal.saveBatch',{...personal,requestId:'d0000000-0000-4000-8000-000000000002',changes:[{...personal.changes[0],layerVersionId:'f0000000-0000-4000-8000-000000000009'}]}),{code:'REVISION_CONFLICT'});
   const context={teachingProjectId:c.teachingProjectId,villageId:c.villageId,spaceId:'A'};
   const first=await service.execute(testIdentity(USERS.teacher),'planning.freezeSnapshot',{...context,label:'Baseline one',requestId:'e0000000-0000-4000-8000-000000000001'});assert.ok(first.snapshotId);
   const g={...c,spaceId:'G'},groupLease=await service.execute(testIdentity(),'planning.acquireLock',g);
   const groupInput={...context,spaceId:'G',changes:[{action:'update',layerKey:'building',objectCode:'B1',baseObjectCode:'B1',afterGeom:polygon(0.003),afterProps:{name:'Group'},expectedRevision:0,lockToken:groupLease.lockToken}],requestId:'e0000000-0000-4000-8000-000000000002'};
   const groupSaved=await service.execute(testIdentity(),'planning.saveBatch',groupInput);assert.equal(groupSaved.saved,1);
   await service.execute(testIdentity(),'planning.releaseLock',{...g,lockToken:groupLease.lockToken});
   const secondLease=await service.execute(testIdentity(),'planning.acquireLock',c);
   await service.execute(testIdentity(),'planning.saveBatch',{...input,requestId:'e0000000-0000-4000-8000-000000000003',changes:[{...input.changes[0],expectedGeometryRevision:1,lockToken:secondLease.lockToken,afterGeom:polygon(0.004)}]});
   const second=await service.execute(testIdentity(USERS.teacher),'planning.freezeSnapshot',{...context,label:'Baseline two',requestId:'e0000000-0000-4000-8000-000000000004'});
   const groupContext={...context,spaceId:'G'};
   const applied=await service.execute(testIdentity(),'planning.applyBaseline',{...groupContext,targetSnapshotId:second.snapshotId,expectedBaseSnapshotId:first.snapshotId,requestId:'e0000000-0000-4000-8000-000000000005'});assert.ok(applied);
   const conflicts=await service.execute(testIdentity(),'planning.conflicts',groupContext);assert.equal(conflicts.length,1);
   await service.execute(testIdentity(),'planning.resolveConflict',{conflictId:conflicts[0].id,resolution:'keep_group',requestId:'e0000000-0000-4000-8000-000000000006'});
   const points=await service.execute(testIdentity(),'planning.restorePoints',groupContext);assert.equal(points.length,1);
   await service.execute(testIdentity(USERS.teacher),'planning.restorePoint',{restorePointId:points[0].id,requestId:'e0000000-0000-4000-8000-000000000007'});
   const restored=await service.execute(testIdentity(),'planning.baselineState',groupContext);assert.equal(restored.current.id,first.snapshotId);
   const rows=await service.execute(testIdentity(),'planning.listFeatures',{...groupContext,layerKey:'building'});assert.deepEqual(rows[0].geom,polygon(0.003));assert.ok((await setup.query('SELECT count(*) n FROM feature_versions')).rows[0].n>=3);

   const {createMcService}=await import('../unified/mc.mjs');const mc=createMcService({database:db});
   await setup.query("INSERT INTO mc_sync_config(village_id,min_lon,min_lat,max_lon,max_lat,mc_origin_x,mc_origin_y,mc_origin_z,mc_width,mc_depth) VALUES('b0000000-0000-4000-8000-000000000001',113,23,114,24,0,64,0,100,100)");
   const mcInput={...context,requestId:'e1000000-0000-4000-8000-000000000001'};
   const exported=await mc.exportBuildings(testIdentity(),mcInput);assert.equal(exported.count,1);
   assert.deepEqual(await mc.exportBuildings(testIdentity(),mcInput),exported);
   assert.equal((await setup.query('SELECT count(*) n FROM mc_building_state')).rows[0].n,'1');
   await assert.rejects(mc.getConfig(testIdentity(),{...context,spaceId:'L'}),{code:'FORBIDDEN'});
   const beforeRename=(await service.execute(testIdentity(),'planning.listFeatures',{...context,layerKey:'building'}))[0];
   const oldLease=await service.execute(testIdentity(),'planning.acquireLock',{...c,objectCode:'B1'}),newLease=await service.execute(testIdentity(),'planning.acquireLock',{...c,objectCode:'B9'});
   const renamed={...context,objectCode:'B1',newCode:'B9',expectedRevision:Number(beforeRename.geometry_revision||0),lockToken:oldLease.lockToken,newLockToken:newLease.lockToken,requestId:'e1000000-0000-4000-8000-000000000002'};
   await service.execute(testIdentity(),'planning.renameBuilding',renamed);
   assert.equal((await service.execute(testIdentity(),'planning.listFeatures',{...context,layerKey:'building'})).some(row=>row.object_code==='B9'),true);
   await service.execute(testIdentity(),'planning.renameBuilding',renamed);

  }finally{await db.close();}
 });
});
