import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import pg from 'pg';
import {createServer} from 'node:http';import {createSceneHandler} from '../scene/http.mjs';
import sceneClient from '../../3D_scenes_edit/persistence/scene-api-client.js';
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
  for(const groups of [[null],[{id:'bad',objectIds:'string'}],[{id:'bad',objectIds:['unknown']}],[{id:'bad',objectIds:[]},{id:'bad',objectIds:[]}]]){
   await assert.rejects(()=>run(a,'save',{document:{...saved,groups}}),{code:'INVALID_INPUT'});
   assert.deepEqual(await run(a,'load',{projectId:pid}),saved,'Rejected group document must leave stored content/revision unchanged');
  }
  await assert.rejects(()=>run(a,'save',{document:{...saved,baselineRef:{spaceId:'B',revision:0}}}),{code:'BASELINE_MISMATCH'});
  await assert.rejects(()=>run(a,'save',{document:{...saved,metadata:{scopeKind:'group',ownerId:b}}}),{code:'BASELINE_MISMATCH'});
  const version=await run(a,'version',{projectId:pid,revision:1,label:'Milestone'});
  assert.equal((await run(a,'versions',{projectId:pid})).length,1);
  await assert.rejects(()=>run(a,'version',{projectId:pid,revision:1,label:'Milestone'}),{code:'INVALID_INPUT'});
  assert.equal((await run(a,'load',{projectId:pid})).revision,1);
  const legacy=(await setup.query(`INSERT INTO scene_edit_versions(project_id,revision,label,document,preview_path,created_by)
   VALUES($1,1,'Legacy preview',$2::jsonb,'group/group-a/private-preview.png',$3) RETURNING id`,[pid,JSON.stringify(saved),a])).rows[0];
  for(const op of ['submit','restore'])await assert.rejects(()=>run(a,op,{versionId:legacy.id,...(op==='restore'?{title:'Not dropped silently'}:{})}),{code:'FILES_NOT_READY'});
  assert.equal((await setup.query('SELECT submission_status FROM scene_edit_versions WHERE id=$1',[legacy.id])).rows[0].submission_status,'milestone');
  assert.equal((await setup.query("SELECT status FROM scene_edit_projects WHERE id=$1",[pid])).rows[0].status,'draft');
  const restored=await run(a,'restore',{versionId:version.id,title:'Restored'});assert.equal(restored.revision,1);
  assert.equal((await run(a,'load',{projectId:restored.id})).baselineRef.spaceId,'A');
  const branch=await run(a,'branch',{projectId:pid,baselineRevision:2,title:'Branch'});assert.equal((await run(a,'load',{projectId:branch.id})).baselineRef.revision,2);
  const submitted=await run(a,'submit',{versionId:version.id});assert.equal(submitted.submissionStatus,'submitted');
  await assert.rejects(()=>run(a,'save',{document:saved}),{code:'PROJECT_SUBMITTED'});
  const sandbox=await run(adminId,'create',{...context,groupId:null,scopeKind:'admin_sandbox'});
  await assert.rejects(()=>run(teacher,'load',{projectId:sandbox.id}),{code:'FORBIDDEN'});
  await assert.rejects(()=>run(a,'create',{...context,groupId:null,scopeKind:'admin_sandbox'}),{code:'FORBIDDEN'});
  // Exercise the exact browser adapter -> HTTP JSON -> role/RPC path too.
  const server=createServer(createSceneHandler({database:db,verifyIdentity:async h=>{
   if(h!=='Bearer synthetic-only-token')throw {code:'UNAUTHORIZED'};return {userId:a};
  }}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
   const browser=sceneClient.createSceneApiClient({baseUrl:'http://127.0.0.1:'+server.address().port+'/api/v1/scene',getAccessToken:async()=> 'synthetic-only-token'});
   const made=await browser.createProject({...context,title:'Browser test'});assert.equal(made.ok,true);
   const loaded=await browser.loadProject(made.data.id);assert.equal(loaded.ok,true);
   loaded.data.objects=[{id:'bench',kind:'asset',category:'bench',layerId:'design',groupId:null,zIndex:0,
    geometry:{type:'Point',coordinates:[113,23]},transform:{headingDeg:0,pitchDeg:0,rollDeg:0,heightOffsetM:0,scale:[1,1,1]},properties:{assetRef:'seed:bench:wood'}}];
   loaded.data.assetRefs=['seed:bench:wood'];assert.equal((await browser.saveDraft(loaded.data)).data.revision,1);
   const stale=await browser.saveDraft(loaded.data);assert.equal(stale.code,'REVISION_CONFLICT');assert.equal(stale.remoteRevision,1);
   const fresh=await browser.loadProject(made.data.id);const milestone=await browser.createVersion({document:fresh.data,label:'Browser milestone'});assert.equal(milestone.ok,true);
   assert.equal((await browser.restoreVersionAsDraft({versionId:milestone.data.id,title:'Browser restore'})).ok,true);
   assert.equal((await browser.submitVersion(milestone.data.id)).data.submissionStatus,'submitted');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
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
