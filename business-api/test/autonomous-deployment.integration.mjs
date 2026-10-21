// Disposable source fixture -> real four-container deployment -> private backup.
// No original Supabase, public CA, provider or GPU request is permitted.
import test from 'node:test';import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';import {readFile} from 'node:fs/promises';
import {withUnifiedFixture,USERS} from './fixtures/unified.mjs';import {prepareFiles} from './fixtures/files.mjs';

test('full committed coordinator preserves imported accounts and real business files across restart and own backup restore',async()=>{
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.VILLAGE_TEST_AUTONOMOUS_RUNTIME,'1');
 let prepared=false,postgresCreated=false;
 const password='synthetic-ci-password-0001';
 function docker(args){try{return execFileSync('docker',['--context','default',...args],{encoding:'utf-8',stdio:['ignore','pipe','pipe'],timeout:120000});}catch{throw Error('DISPOSABLE_SOURCE_AUTH_BOOTSTRAP_FAILED');}}
 const prepareAuth=async({setup,url})=>{
  assert.equal((await setup.query("SELECT 1 FROM pg_roles WHERE rolname='postgres'")).rowCount,0);
  await setup.query('CREATE ROLE postgres NOLOGIN NOSUPERUSER NOBYPASSRLS');postgresCreated=true;
  await setup.query('CREATE SCHEMA auth;CREATE EXTENSION pgcrypto WITH SCHEMA extensions;ALTER ROLE village_test_admin IN DATABASE village_unified_candidate SET search_path=auth');
  const auth=JSON.parse(await readFile(new URL('../../linux/auth-runtime.json',import.meta.url),'utf8'));
  docker(['run','--rm','--network','host','--env','GOTRUE_DB_DRIVER=postgres','--env','GOTRUE_DB_NAMESPACE=auth',
   '--env',`GOTRUE_DB_DATABASE_URL=postgresql://village_test_admin:synthetic-ci-only@127.0.0.1:${url.port}/village_unified_candidate`,
   '--env','API_EXTERNAL_URL=https://8.148.248.237/auth/v1','--env','GOTRUE_SITE_URL=https://8.148.248.237',
   '--env','GOTRUE_JWT_SECRET=synthetic-source-migration-only-signing-secret-00000000000',auth.image,'auth','migrate']);
  for(const [kind,id] of Object.entries(USERS)){
   const student=kind==='admin'?'332':kind;
   await setup.query(`INSERT INTO auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,recovery_token,email_change_token_new,email_change_token_current,reauthentication_token)
    VALUES('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated',$2,extensions.crypt($3,extensions.gen_salt('bf',4)),now(),'{"provider":"email","providers":["email"]}',$4::jsonb,now(),now(),'','','','','')`,
    [id,'sid-'+student+'@rzmbmwauomzwiyenafha.supabase.co',password,JSON.stringify({student_id:student,display_name:kind})]);
   await setup.query("INSERT INTO auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at) VALUES(gen_random_uuid(),$1::uuid,$1::uuid::text,$2::jsonb,'email',now(),now())",[id,JSON.stringify({sub:id,email:'sid-'+student+'@rzmbmwauomzwiyenafha.supabase.co'})]);
  }
  prepared=true;
 };
 const authCleanup=async admin=>{if(postgresCreated)await admin.query('DROP ROLE postgres');};
 await withUnifiedFixture(async({setup})=>{
  assert.equal(prepared,true,'PINNED_AUTH_FIXTURE_REQUIRED');
  await prepareFiles(setup);
  await setup.query('ALTER TABLE teaching_projects ADD created_by uuid; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean NOT NULL DEFAULT false);CREATE TABLE public.geoprocessing_villages(village_id text PRIMARY KEY,active boolean);');
  await setup.query("INSERT INTO public.geoprocessing_villages VALUES('b0000000-0000-4000-8000-000000000001',true)");
  // The real legacy source predates the optional project-context migration.
  // Do not silently supply that column via preparePlanning in this fixture.
  await setup.query(`ALTER TABLE public.course_personal_spaces DROP COLUMN teaching_project_id;
   ALTER TABLE public.course_personal_spaces ALTER COLUMN id SET DEFAULT gen_random_uuid();
   UPDATE public.course_personal_spaces SET space_type='course_personal';
   ALTER TABLE public.course_personal_spaces ADD CHECK(space_type='course_personal');
   CREATE UNIQUE INDEX personal_legacy_owner_context ON public.course_personal_spaces(owner_id,course_id,village_id,space_type);`);
  // Match the real source's mandatory survey baseline, rather than a nullable
  // simplified fixture that silently accepts incomplete shared TEST spaces.
  await setup.query(`INSERT INTO public.village_datasets(id,village_id,version_number,version_label,source_kind,status,created_by)
   VALUES('b9000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001',1,'Source fixture baseline','uploaded_bundle','ready','40000000-0000-4000-8000-000000000004');
   UPDATE public.survey_feature_reviews SET base_dataset_id='b9000000-0000-4000-8000-000000000001';
   ALTER TABLE public.survey_feature_reviews ALTER COLUMN base_dataset_id SET NOT NULL;`);
  for(const [kind,id] of Object.entries(USERS))await setup.query('UPDATE public.profiles SET student_id=$1 WHERE id=$2',[kind==='admin'?'332':kind,id]);
  await setup.query((await readFile(new URL('../../supabase_SQL/Scene Edit Studio.sql',import.meta.url),'utf8')).split('insert into storage.buckets')[0]);
  for(const name of ['house-photos','scene-assets','scene-version-previews','group-models','village-datasets','geoprocessing-results','facade-generation'])await setup.query('INSERT INTO storage.buckets(id,name) VALUES($1,$1)',[name]);
  for(const [index,bucket] of ['house-photos','geoprocessing-results','facade-generation'].entries())await setup.query(
   "INSERT INTO storage.objects(id,bucket_id,name,metadata,version) VALUES($1,$2,'fixture/legacy.bin',$3::jsonb,'fixture-v1')",
   ['d1a00000-0000-4000-8000-00000000000'+(index+1),bucket,JSON.stringify({size:Buffer.byteLength('synthetic legacy private bytes\n')})]);
  const child=spawnSync('python3',['linux/scripts/test-autonomous-deployment-ci.py'],{encoding:'utf8',timeout:1200000,maxBuffer:2*1024**2});
  console.log(child.stdout?.trim());assert.equal(child.status,0,'DISPOSABLE_COORDINATOR_FAILED '+String(child.stderr??'').slice(-1500));
 },{prepareAuth,authCleanup});
});
