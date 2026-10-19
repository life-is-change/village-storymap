import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';import {readFile,mkdtemp,rm} from 'node:fs/promises';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createServer} from 'node:http';
import {createSceneFilesDatabase} from '../scene-files/database.mjs';import {createFileStore} from '../scene-files/file-store.mjs';import {createUploadService} from '../scene-files/uploads.mjs';import {createSceneFilesService} from '../scene-files/scene.mjs';import {createSceneFilesHandler} from '../scene-files/http.mjs';
const raw=process.env.VILLAGE_TEST_PG_URL;if(!raw)throw Error('Explicit disposable PG URL required');const url=new URL(raw);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.username!=='village_test_admin'||url.pathname!=='/postgres')throw Error('Disposable loopback cluster only');
const name='village_scene_files_validation',course='c2a-test-20261019';
async function fixtureSQL(create){const script="import importlib.util,sys\ns=importlib.util.spec_from_file_location('fixture',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.context_sql(create=sys.argv[2]=='yes'))";return (await promisify(execFile)(process.env.VILLAGE_TEST_PYTHON||'python3',['-c',script,fileURLToPath(new URL('../../linux/scripts/prepare-scene-files-test-context.py',import.meta.url)),create?'yes':'no'])).stdout;}
test('approved synthetic context is isolated, idempotent, transactional and obeys source membership RPC',async()=>{
 const admin=new pg.Client({connectionString:raw});await admin.connect();let db,apiDB,root,server,owned=false,roles=false;
 try{
  assert.equal((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[name])).rowCount,0,'Never reuse another test database');
  await admin.query('CREATE DATABASE '+name);owned=true;await admin.query('CREATE ROLE authenticated NOLOGIN;CREATE ROLE anon NOLOGIN');roles=true;
  db=new pg.Client({connectionString:raw.replace(/\/postgres$/,'/'+name)});await db.connect();await db.query(await readFile(new URL('./fixtures/identity.sql',import.meta.url),'utf8'));
  await db.query(`DELETE FROM group_memberships;UPDATE profiles SET student_id='25213040' WHERE student_id='a';UPDATE profiles SET student_id='332' WHERE role='admin';
   CREATE TABLE auth.users(id uuid PRIMARY KEY);INSERT INTO auth.users SELECT id FROM profiles;
   CREATE SCHEMA extensions;CREATE DOMAIN extensions.geometry AS text;
   CREATE TABLE villages(id uuid PRIMARY KEY,name text NOT NULL,is_practice boolean DEFAULT false,boundary extensions.geometry NOT NULL,status text DEFAULT 'draft',created_by uuid REFERENCES auth.users);
   CREATE TABLE teaching_projects(id uuid PRIMARY KEY,course_id text REFERENCES courses,name text,practice_village_id uuid REFERENCES villages,stage text,created_by uuid REFERENCES auth.users);
   CREATE TABLE course_groups(id text PRIMARY KEY,course_id text REFERENCES courses,name text,join_code text UNIQUE,created_by text,space_id text);
   ALTER TABLE group_memberships ADD id bigserial PRIMARY KEY,ADD course_id text REFERENCES courses,ADD student_name text,ADD student_id text,ADD role text DEFAULT 'member',ADD UNIQUE(course_id,student_key),ADD FOREIGN KEY(group_id) REFERENCES course_groups;
   ALTER TABLE planning_spaces ADD creator_name text,ADD readonly boolean DEFAULT false,ADD edit_enabled boolean DEFAULT true,ADD expanded boolean DEFAULT true,ADD created_at timestamptz DEFAULT now(),ADD FOREIGN KEY(teaching_project_id) REFERENCES teaching_projects,ADD FOREIGN KEY(village_id) REFERENCES villages;`);
  const before=await db.query('SELECT * FROM courses ORDER BY id');const read=await fixtureSQL(false),write=await fixtureSQL(true);
  assert.ok((await db.query(read)).some(r=>r.rows?.some(v=>v.data?.status==='empty')));assert.equal((await db.query('SELECT count(*) FROM group_memberships')).rows[0].count,'0');
  await db.query(`CREATE FUNCTION fail_test_context() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'synthetic failure';END$$;CREATE TRIGGER fail_test_context BEFORE INSERT ON group_memberships FOR EACH ROW EXECUTE FUNCTION fail_test_context()`);
  await assert.rejects(()=>db.query(write));await db.query('ROLLBACK');assert.equal((await db.query('SELECT 1 FROM courses WHERE id=$1',[course])).rowCount,0,'entire fixture rolls back');await db.query('DROP TRIGGER fail_test_context ON group_memberships');
  await db.query(write);await db.query(write);assert.equal((await db.query('SELECT count(*) FROM group_memberships')).rows[0].count,'1');
  assert.deepEqual((await db.query("SELECT * FROM courses WHERE id<>$1 ORDER BY id",[course])).rows,before.rows,'existing course untouched');
  assert.equal((await db.query("SELECT count(*) FROM profiles WHERE student_id IN ('25213040','332')")).rows[0].count,'2','no new identities');
  await db.query((await readFile(new URL('../../supabase_SQL/Scene Edit Studio.sql',import.meta.url),'utf8')).split('insert into storage.buckets')[0]);
  await db.query("BEGIN;SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);SET LOCAL ROLE authenticated");
  assert.equal((await db.query('SELECT is_scene_edit_group_member($1,$2) ok',['c2a-test-group-20261019',course])).rows[0].ok,true);
  const asset=(await db.query("SELECT scene_edit_register_asset($1,NULL,'personal','model','personal/10000000-0000-4000-8000-000000000001/synthetic.glb','C2a TEST','model/gltf-binary',100,'{}','student-provided') data",[course])).rows[0].data;assert.equal(asset.course_id,course);await db.query('COMMIT');
  // Exact helper -> actual context query -> C2 HTTP -> Python upload/save probe.
  // Geometry is a text domain adapter here; native PostGIS casting remains cloud verification.
  await db.query(await readFile(new URL('../../linux/sql/scene-files-candidate.sql',import.meta.url),'utf8'));
  await db.query("ALTER ROLE village_scene_files_login PASSWORD 'synthetic-context-only-01234567890123456789'");
  apiDB=createSceneFilesDatabase({host:url.hostname,port:Number(url.port),database:name,user:'village_scene_files_login',password:'synthetic-context-only-01234567890123456789'});
  root=await mkdtemp(join(tmpdir(),'village-files-context-'));const store=await createFileStore({root}),scenes=createSceneFilesService({database:apiDB,store}),uploads=createUploadService({database:apiDB,store,spaceAvailable:async()=>10*1024**3,commitPreview:scenes.commitPreview});
  server=createServer(createSceneFilesHandler({verifyIdentity:async h=>{if(h==='Bearer admin')return {userId:'40000000-0000-4000-8000-000000000004'};if(h==='Bearer good')return {userId:'10000000-0000-4000-8000-000000000001'};throw {code:'UNAUTHORIZED'};},database:scenes,uploads}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const template=(await readFile(new URL('../../linux/sql/scene-files-probe-context.sql',import.meta.url),'utf8')).replaceAll('__COURSE_FILTER__',"'"+course+"'");
  const studentContext=(await db.query(template.replaceAll('__PROBE_USER_UUID__','10000000-0000-4000-8000-000000000001'))).rows[0].data;
  const adminContext=(await db.query(template.replaceAll('__PROBE_USER_UUID__','40000000-0000-4000-8000-000000000004'))).rows[0].data;
  assert.equal(studentContext.membership.courseId,course);assert.equal(adminContext.context.courseId,course);
  const script="import importlib.util,json,sys\ns=importlib.util.spec_from_file_location('probe',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);m.BASE=sys.argv[2]\nprint(json.dumps(m.perform_probe(m.caller('admin'),m.caller('good'),json.loads(sys.argv[3]),lambda f,r:m.download('admin',f,r),lambda:None,lambda v:None)))";
  const result=await promisify(execFile)(process.env.VILLAGE_TEST_PYTHON||'python3',['-c',script,fileURLToPath(new URL('../../linux/scripts/probe-scene-files.py',import.meta.url)),'http://127.0.0.1:'+server.address().port+'/api/v1/scene-files',JSON.stringify({...adminContext,membership:studentContext.membership})],{timeout:90000});
  assert.equal(JSON.parse(result.stdout).status,'authenticated_scene_files_probe_passed');
  await db.query("UPDATE courses SET title='collision' WHERE id=$1",[course]);await assert.rejects(()=>db.query(write),/C2A_TEST_CONTEXT_COLLISION/);await db.query('ROLLBACK');
 }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await apiDB?.close();await db?.end();if(owned)await admin.query('DROP DATABASE '+name+' WITH (FORCE)');if(roles)await admin.query('DROP ROLE IF EXISTS village_scene_files_login;DROP ROLE authenticated;DROP ROLE anon');await admin.end();if(root)await rm(root,{recursive:true,force:true});}
});
