import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import pg from 'pg';
const mod=await import('../scene/database.mjs').catch(()=>({}));
const raw=process.env.VILLAGE_TEST_PG_URL;if(!raw)throw Error('Explicit disposable PG URL required');
const url=new URL(raw);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.username!=='village_test_admin'||url.pathname!=='/postgres')throw Error('Disposable loopback cluster only');
const a='10000000-0000-4000-8000-000000000001',b='20000000-0000-4000-8000-000000000002',teacher='30000000-0000-4000-8000-000000000003',adminId='40000000-0000-4000-8000-000000000004';
const context={teachingProjectId:'a0000000-0000-4000-8000-000000000001',villageId:'b0000000-0000-4000-8000-000000000001',spaceId:'A',groupId:'group-a',scopeKind:'group',title:'C1 test',baselineRevision:0};

test('real source scene RPCs preserve scopes, atomic revisions, milestones, restore and membership revocation',async()=>{
 assert.equal(typeof mod.createSceneDatabase,'function');
 const admin=new pg.Client({connectionString:raw});await admin.connect();const name='village_scene_test_'+Date.now();let setup,db;
 try{
  await admin.query('CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN');await admin.query('CREATE DATABASE '+name);
 }catch(e){await admin.end();throw e;}
 try{
  setup=new pg.Client({connectionString:raw.replace(/\/postgres$/,'/'+name)});await setup.connect();
  await setup.query(await readFile(new URL('./fixtures/identity.sql',import.meta.url),'utf8'));
  await setup.query(`CREATE TABLE auth.users(id uuid primary key);INSERT INTO auth.users SELECT id FROM profiles;
   CREATE TABLE villages(id uuid primary key);CREATE TABLE course_groups(id text primary key);
   CREATE TABLE teaching_projects(id uuid primary key,course_id text);
   ALTER TABLE group_memberships ADD course_id text DEFAULT 'course';
   INSERT INTO course_groups VALUES('group-a'),('group-b');INSERT INTO villages VALUES('${context.villageId}');
   INSERT INTO teaching_projects VALUES('${context.teachingProjectId}','course');
   UPDATE planning_spaces SET teaching_project_id='${context.teachingProjectId}',village_id='${context.villageId}',space_type='group_plan';`);
  const source=await readFile(new URL('../../supabase_SQL/Scene Edit Studio.sql',import.meta.url),'utf8');
  await setup.query(source.split('insert into storage.buckets')[0]);
  await setup.query((await readFile(new URL('../../linux/sql/scene-write-candidate.sql',import.meta.url),'utf8')).replaceAll('village_scene_validation',name));
  await setup.query("ALTER ROLE village_scene_login PASSWORD 'synthetic-scene-only-01234567890123456789'");
  db=mod.createSceneDatabase({host:url.hostname,port:Number(url.port),database:name,user:'village_scene_login',password:'synthetic-scene-only-01234567890123456789'});
  const run=(id,op,input)=>db.run({userId:id},op,input);
  const created=await run(a,'create',context),pid=created.id;
  assert.equal(created.revision,0);
  assert.equal((await run(a,'find',contextForFind())).id,pid);
  await assert.rejects(()=>run(b,'load',{projectId:pid}),{code:'FORBIDDEN'});
  await assert.rejects(()=>run(b,'create',context),{code:'FORBIDDEN'});
  const doc=await run(teacher,'load',{projectId:pid});assert.equal(doc.projectId,pid);
  const results=await Promise.allSettled([run(a,'save',{document:doc}),run(a,'save',{document:doc})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const failed=results.find(r=>r.status==='rejected').reason;
  assert.equal(failed.code,'REVISION_CONFLICT');assert.equal(failed.remoteRevision,1);
  const saved=await run(a,'load',{projectId:pid});assert.equal(saved.revision,1);
  await assert.rejects(()=>run(a,'save',{document:{...saved,baselineRef:{spaceId:'B',revision:0}}}),{code:'BASELINE_MISMATCH'});
  await assert.rejects(()=>run(a,'save',{document:{...saved,metadata:{scopeKind:'group',ownerId:b}}}),{code:'BASELINE_MISMATCH'});
  const version=await run(a,'version',{projectId:pid,revision:1,label:'Milestone'});
  assert.equal((await run(a,'versions',{projectId:pid})).length,1);
  await assert.rejects(()=>run(a,'version',{projectId:pid,revision:1,label:'Milestone'}),{code:'INVALID_INPUT'});
  assert.equal((await run(a,'load',{projectId:pid})).revision,1);
  const restored=await run(a,'restore',{versionId:version.id,title:'Restored'});assert.equal(restored.revision,1);
  assert.equal((await run(a,'load',{projectId:restored.id})).baselineRef.spaceId,'A');
  const branch=await run(a,'branch',{projectId:pid,baselineRevision:2,title:'Branch'});assert.equal((await run(a,'load',{projectId:branch.id})).baselineRef.revision,2);
  const submitted=await run(a,'submit',{versionId:version.id});assert.equal(submitted.submissionStatus,'submitted');
  await assert.rejects(()=>run(a,'save',{document:saved}),{code:'PROJECT_SUBMITTED'});
  const sandbox=await run(adminId,'create',{...context,groupId:null,scopeKind:'admin_sandbox'});
  await assert.rejects(()=>run(teacher,'load',{projectId:sandbox.id}),{code:'FORBIDDEN'});
  await assert.rejects(()=>run(a,'create',{...context,groupId:null,scopeKind:'admin_sandbox'}),{code:'FORBIDDEN'});
  await setup.query("DELETE FROM group_memberships WHERE group_id='group-a'");
  const restoredDoc=await run(teacher,'load',{projectId:restored.id});
  await assert.rejects(()=>run(a,'save',{document:restoredDoc}),{code:'FORBIDDEN'});
  await assert.rejects(()=>run(a,'restore',{versionId:version.id,title:'Denied'}),{code:'FORBIDDEN'});
  await assert.rejects(()=>run('50000000-0000-4000-8000-000000000005','create',context),{code:'PROFILE_NOT_SYNCED'});
 }finally{
  await db?.close();await setup?.end();await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)');
  await admin.query('DROP ROLE IF EXISTS village_scene_login;DROP ROLE IF EXISTS authenticated;DROP ROLE IF EXISTS anon');await admin.end();
 }
});
function contextForFind(){const {title,baselineRevision,...rest}=context;return rest;}
