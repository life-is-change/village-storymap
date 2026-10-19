import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';import {preparePlanning} from './planning.mjs';
export async function prepareFiles(setup){
 await preparePlanning(setup);
 await setup.query(`ALTER TABLE course_personal_spaces ADD teaching_project_id uuid;
  UPDATE course_personal_spaces SET course_id='course',teaching_project_id='a0000000-0000-4000-8000-000000000001',village_id='b0000000-0000-4000-8000-000000000001' WHERE owner_id='10000000-0000-4000-8000-000000000001';
  CREATE SCHEMA storage;CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text,name text,updated_at timestamptz DEFAULT '2026-10-19T00:00:00Z',metadata jsonb,version text);
  UPDATE survey_feature_reviews SET geometry_status='confirmed_unchanged';`);
 const model=await readFile(new URL('../../../supabase_SQL/Group Model Library.sql',import.meta.url),'utf8');
 for(const name of ['group_model_assets','building_model_bindings','model_operation_events']){const ddl=model.match(new RegExp('create table if not exists public.'+name+' \\([\\s\\S]*?\\n\\);','i'))?.[0];assert.ok(ddl);await setup.query(ddl);}
 for(const name of ['can_access_model_scope','register_group_model','place_group_model','restore_building_white_model']){const ddl=model.match(new RegExp('create or replace function public.'+name+'\\([\\s\\S]*?\\n\\$\\$;','i'))?.[0];assert.ok(ddl);await setup.query(ddl);}
 for(const[file,name]of [['Village Dataset Package Storage.sql','can_read_village_dataset_object'],['Multi-Village Dual-Track Foundation.sql','save_village_dataset_draft']]){const src=await readFile(new URL('../../../supabase_SQL/'+file,import.meta.url),'utf8');const ddl=src.match(new RegExp('create or replace function public.'+name+'\\([\\s\\S]*?\\n\\$\\$;','i'))?.[0];assert.ok(ddl);await setup.query(ddl);}
}
