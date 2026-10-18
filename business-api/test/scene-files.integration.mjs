import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';import {readFile,mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {Readable} from 'node:stream';
import {assetInput,glb,userA} from './fixtures/scene-files.mjs';import {createFileStore} from '../scene-files/file-store.mjs';
const dbmod=await import('../scene-files/database.mjs').catch(()=>({})),upmod=await import('../scene-files/uploads.mjs').catch(()=>({}));
const raw=process.env.VILLAGE_TEST_PG_URL;if(!raw)throw Error('Explicit disposable PG URL required');const url=new URL(raw);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.username!=='village_test_admin'||url.pathname!=='/postgres')throw Error('Disposable loopback cluster only');
const userB='20000000-0000-4000-8000-000000000002';
test('real source permissions, idempotent files, rollback, cleanup and revocation',async()=>{
 assert.equal(typeof dbmod.createSceneFilesDatabase,'function');assert.equal(typeof upmod.createUploadService,'function');
 const admin=new pg.Client({connectionString:raw});await admin.connect();const name='village_scene_files_test_'+Date.now();const root=await mkdtemp(join(tmpdir(),'village-upload-pg-'));let setup,db;
 try{
  await admin.query('CREATE ROLE authenticated NOLOGIN;CREATE ROLE anon NOLOGIN');await admin.query('CREATE DATABASE '+name);
 }catch(e){await admin.end();throw e;}
 try{
  setup=new pg.Client({connectionString:raw.replace(/\/postgres$/,'/'+name)});await setup.connect();
  await setup.query(await readFile(new URL('./fixtures/identity.sql',import.meta.url),'utf8'));
  await setup.query(`CREATE TABLE auth.users(id uuid primary key);INSERT INTO auth.users SELECT id FROM profiles;
  CREATE TABLE villages(id uuid primary key);CREATE TABLE course_groups(id text primary key);CREATE TABLE teaching_projects(id uuid primary key,course_id text);
  ALTER TABLE group_memberships ADD course_id text DEFAULT 'course';INSERT INTO course_groups VALUES('group-a'),('group-b');
  INSERT INTO villages VALUES('b0000000-0000-4000-8000-000000000001');INSERT INTO teaching_projects VALUES('a0000000-0000-4000-8000-000000000001','course');`);
  await setup.query((await readFile(new URL('../../supabase_SQL/Scene Edit Studio.sql',import.meta.url),'utf8')).split('insert into storage.buckets')[0]);
  await setup.query((await readFile(new URL('../../linux/sql/scene-files-candidate.sql',import.meta.url),'utf8')).replaceAll('village_scene_files_validation',name));
  await setup.query("ALTER ROLE village_scene_files_login PASSWORD 'synthetic-files-only-01234567890123456789'");
  db=dbmod.createSceneFilesDatabase({host:url.hostname,port:Number(url.port),database:name,user:'village_scene_files_login',password:'synthetic-files-only-01234567890123456789'});
  const store=await createFileStore({root}),service=upmod.createUploadService({database:db,store,spaceAvailable:async()=>10*1024**3});const a={userId:userA},b={userId:userB};
  const input=assetInput(),session=await service.create(a,input);assert.equal((await service.create(a,input)).id,session.id);
  await assert.rejects(()=>service.create(a,{...input,context:{...input.context,courseId:'changed'}}),{code:'UPLOAD_CONFLICT'});
  await assert.rejects(()=>service.status(b,session.id),{code:'FORBIDDEN'});
  const file=session.files[0];await service.upload(a,session.id,'display',Readable.from([glb()]));
  await assert.rejects(()=>service.upload(a,session.id,'display',Readable.from([Buffer.alloc(glb().length)])),{code:'UPLOAD_CONFLICT'});
  const commit={displayName:'Bench',license:'student-provided',metadata:{category:'bench'}},asset=await service.commit(a,session.id,commit);
  assert.equal(asset.display_name,'Bench');assert.equal((await service.commit(a,session.id,commit)).id,asset.id,'lost response retry returns same row');
  await assert.rejects(()=>service.commit(a,session.id,{...commit,displayName:'different'}),{code:'UPLOAD_CONFLICT'});
  assert.equal((await setup.query('SELECT count(*) FROM scene_edit_assets')).rows[0].count,'1');
  const opened=await service.read(a,file.id);assert.equal(opened.size,glb().length);await opened.close();await assert.rejects(()=>service.read(b,file.id),{code:'FORBIDDEN'});
  await assert.rejects(()=>service.commit(a,session.id,{...commit,metadata:{lowStoragePath:'somebody/else'}}),{code:'INVALID_INPUT'});
  await assert.rejects(()=>db.withIdentity(a,c=>c.query("UPDATE scene_files.sessions SET state='committed' WHERE id=$1",[session.id])),{code:'DB_UNAVAILABLE'});
  const pending=await service.create(a,assetInput());await assert.rejects(()=>service.commit(a,pending.id,commit),{code:'FILES_NOT_READY'});
  const orphan=await service.create(a,assetInput());await service.upload(a,orphan.id,'display',Readable.from([glb()]));
  await setup.query(`CREATE FUNCTION public.fail_files_test_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${orphan.id}'::uuid AND NEW.state='committed' THEN RAISE EXCEPTION 'synthetic commit failure';END IF;RETURN NEW;END;$$;
   CREATE TRIGGER fail_files_test_commit BEFORE UPDATE ON scene_files.sessions FOR EACH ROW EXECUTE FUNCTION public.fail_files_test_commit()`);
  await assert.rejects(()=>service.commit(a,orphan.id,commit),{code:'DB_UNAVAILABLE'});
  assert.equal((await setup.query('SELECT count(*) FROM scene_edit_assets')).rows[0].count,'1','source RPC insert rolls back with session failure');await assert.rejects(()=>service.read(a,orphan.files[0].id),{code:'FORBIDDEN'});
  await setup.query('DROP TRIGGER fail_files_test_commit ON scene_files.sessions');
  const limited=upmod.createUploadService({database:db,store,spaceAvailable:async()=>0});await assert.rejects(()=>limited.create(a,assetInput()),{code:'QUOTA_EXCEEDED'});
  const second=await service.create(a,assetInput());await service.upload(a,second.id,'display',Readable.from([glb()]));
  await setup.query("DELETE FROM group_memberships WHERE group_id='group-a'");
  await assert.rejects(()=>service.commit(a,second.id,commit),{code:'FORBIDDEN'});
  assert.equal((await setup.query('SELECT count(*) FROM scene_edit_assets')).rows[0].count,'1');await assert.rejects(()=>service.read(a,second.files[0].id),{code:'FORBIDDEN'});
  await setup.query("UPDATE scene_files.sessions SET expires_at=now()-interval '25 hours' WHERE id=$1",[second.id]);
  const report=await service.cleanup({execute:false});assert.equal(report.files,1);
  const [cleaned,expiredCommit]=await Promise.allSettled([service.cleanup({execute:true}),service.commit(a,second.id,commit)]);assert.equal(cleaned.status,'fulfilled');assert.equal(expiredCommit.status,'rejected');
  const surviving=await service.read(a,file.id);await surviving.close();await assert.rejects(()=>service.commit(a,second.id,commit));
  await db.withIdentity(a,async c=>assert.equal((await c.query('SELECT * FROM scene_files.sessions WHERE user_id=$1',[userB])).rows.length,0));
 }finally{await db?.close();await setup?.end();await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)');await admin.query('DROP ROLE IF EXISTS village_scene_files_login;DROP ROLE IF EXISTS authenticated;DROP ROLE IF EXISTS anon');await admin.end();await rm(root,{recursive:true,force:true});}
});
