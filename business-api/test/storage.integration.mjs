import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import pg from 'pg';import {createDatabase} from '../src/database.mjs';import {getStorageObject} from '../src/repository.mjs';
const raw=process.env.VILLAGE_TEST_PG_URL;if(!raw)throw Error('Explicit disposable PG URL required');
const url=new URL(raw);if(!['127.0.0.1','localhost'].includes(url.hostname)||url.username!=='village_test_admin'||url.pathname!=='/postgres')throw Error('Disposable loopback cluster only');
test('real Storage RLS and explicit bucket scopes prevent cross-user and GPU reads',async()=>{
 const admin=new pg.Client({connectionString:raw});await admin.connect();const name='village_storage_test_'+Date.now();let setup,db;
 const a='10000000-0000-4000-8000-000000000001',b='20000000-0000-4000-8000-000000000002';
 try{
  await admin.query('CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN');await admin.query('CREATE DATABASE '+name);
  setup=new pg.Client({connectionString:raw.replace(/\/postgres$/,'/'+name)});await setup.connect();
  await setup.query(await readFile(new URL('./fixtures/identity.sql',import.meta.url),'utf8'));
  await setup.query(`CREATE SCHEMA storage;CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text);
   ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;GRANT USAGE ON SCHEMA storage TO authenticated;GRANT SELECT ON storage.objects TO authenticated;
   CREATE TABLE public.scene_edit_assets(storage_path text,scope_kind text,course_id text,group_id text,owner_id uuid);
   CREATE TABLE public.scene_edit_versions(preview_path text,project_id uuid);
   CREATE TABLE public.village_datasets(status text,imagery_config jsonb,layer_manifest jsonb);
   GRANT SELECT ON public.scene_edit_assets,public.scene_edit_versions,public.village_datasets TO authenticated;
   CREATE FUNCTION public.can_read_scene_edit_asset(text,text,text,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $4=auth.uid() $$;
   CREATE FUNCTION public.can_read_scene_edit_project(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1=auth.uid() $$;`);
  const datasets=await readFile(new URL('../../supabase_SQL/Village Dataset Package Storage.sql',import.meta.url),'utf8');
  await setup.query(datasets.match(/create or replace function public\.can_read_village_dataset_object[\s\S]*?\$\$;/i)[0]);
  await setup.query("CREATE POLICY source_storage ON storage.objects FOR SELECT TO authenticated USING (name<>'shared/blocked.glb')");
  // Deliberately permissive source policy: the API's explicit predicates must still isolate scopes.
  const objects=[['group-models',`users/${a}/a.glb`],['group-models',`users/${b}/b.glb`],['group-models','groups/group-a/c.glb'],['group-models','shared/d.glb'],['group-models','shared/blocked.glb'],['house-photos','photo.jpg'],['facade-generation','result.png'],['scene-assets','personal/a.glb'],['scene-version-previews','preview.png'],['village-datasets','published.json'],['village-datasets','draft.json']];
  const ids=objects.map((_,i)=>'a0000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
  for(let i=0;i<objects.length;i++)await setup.query('INSERT INTO storage.objects VALUES($1,$2,$3)',[ids[i],...objects[i]]);
  await setup.query("INSERT INTO scene_edit_assets VALUES('personal/a.glb','personal',null,null,$1)",[a]);
  await setup.query("INSERT INTO scene_edit_versions VALUES('preview.png',$1)",[a]);
  await setup.query(`INSERT INTO village_datasets VALUES('published','{"path":"published.json"}','{}')`);
  await setup.query("CREATE ROLE village_storage_login LOGIN NOINHERIT PASSWORD 'synthetic-storage-only-123456789';GRANT authenticated TO village_storage_login");
  db=createDatabase({host:url.hostname,port:Number(url.port),database:name,user:'village_storage_login',password:'synthetic-storage-only-123456789'});
  for(const [uid,expected] of [[a,[true,false,true,true,false,true,false,true,true,true,false]],[b,[false,true,false,true,false,true,false,false,false,true,false]]]){
   for(let i=0;i<ids.length;i++)await db.withIdentity({userId:uid},async c=>assert.equal(Boolean(await getStorageObject(c,ids[i])),expected[i],String(i)));
  }
  await setup.query("DELETE FROM group_memberships WHERE group_id='group-a'");
  await db.withIdentity({userId:a},async c=>assert.equal(await getStorageObject(c,ids[2]),null));
  await assert.rejects(()=>db.withIdentity({userId:a},c=>c.query('DELETE FROM storage.objects')),{code:'DB_UNAVAILABLE'});
 }finally{
  await db?.close();await setup?.end();await admin.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)');
  await admin.query('DROP ROLE IF EXISTS village_storage_login;DROP ROLE IF EXISTS authenticated;DROP ROLE IF EXISTS anon');await admin.end();
 }
});
