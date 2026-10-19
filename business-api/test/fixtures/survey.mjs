import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';import {prepareCatalog} from './catalog.mjs';
export async function prepareSurvey(setup){
  await prepareCatalog(setup);
  for(const [file,tables] of [['Community Tasks, Photos, Edits & Points Schema.sql',['community_tasks','object_photos','object_attribute_edits','user_stats','points_ledger']],['Object Comments for Multi-Identity Replies.sql',['object_comments']]]){
   const source=await readFile(new URL('../../../supabase_SQL/'+file,import.meta.url),'utf8');
   for(const table of tables){const ddl=source.match(new RegExp('create table if not exists (?:public\\.)?'+table+' \\([\\s\\S]*?\\n\\);','i'))?.[0];assert.ok(ddl);await setup.query(ddl);}
  }
  for(const table of ['object_photos','object_attribute_edits','object_comments','community_tasks'])await setup.query(`ALTER TABLE ${table} ADD teaching_project_id uuid,ADD village_id uuid${table==='community_tasks'?'':',ADD space_id text'}`);
  await setup.query("ALTER TABLE community_tasks ADD target_layer_key text,ADD target_object_code text;ALTER TABLE object_photos ADD survey_layer_key text,ADD photo_path text;ALTER TABLE object_comments ADD survey_layer_key text;ALTER TABLE object_attribute_edits ADD survey_layer_key text;ALTER TABLE object_attribute_edits DROP CONSTRAINT object_attribute_edits_object_code_object_type_key;ALTER TABLE object_attribute_edits ADD UNIQUE(teaching_project_id,village_id,space_id,object_code,object_type)");
  await setup.query(`CREATE TABLE survey_feature_reviews(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),teaching_project_id uuid,village_id uuid,space_id text,layer_key text,object_code text,geometry_status text,geometry_revision bigint DEFAULT 0,is_deleted boolean DEFAULT false);
   UPDATE planning_spaces SET teaching_project_id='a0000000-0000-4000-8000-000000000001',village_id='b0000000-0000-4000-8000-000000000001',space_type='formal_shared' WHERE id='A';
   INSERT INTO survey_feature_reviews(teaching_project_id,village_id,space_id,layer_key,object_code,geometry_status) VALUES('a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','A','building','B1','pending');`);

  await setup.query(`INSERT INTO object_comments(id,object_code,object_type,author_name,content,teaching_project_id,village_id,space_id) VALUES(899,'B2','building','Legacy author','Legacy comment','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','A');
   INSERT INTO object_attribute_edits(object_code,object_type,data,teaching_project_id,village_id,space_id) VALUES('COMMENT_899','object_comment_interactions','{"likes":["A","Unknown legacy"],"replies":[{"author":"Legacy reply","content":"Kept"}]}','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','A');
   INSERT INTO user_stats(user_name,total_points) VALUES('A',17);INSERT INTO points_ledger(user_name,delta,reason) VALUES('A',17,'Legacy points');`);

  const locks=await readFile(new URL('../../../supabase_SQL/Shared Current Survey Versioning and Feature Locks.sql',import.meta.url),'utf8');
  await setup.query(locks.match(/create table if not exists public.feature_edit_locks \([\s\S]*?\n\);/i)[0]);
  await setup.query('ALTER TABLE feature_edit_locks ADD teaching_project_id uuid,ADD village_id uuid,ADD editor_user_id uuid;ALTER TABLE survey_feature_reviews ADD first_reviewed_by uuid,ADD first_reviewed_at timestamptz,ADD latest_modified_by uuid,ADD latest_modified_at timestamptz,ADD updated_at timestamptz');
  for(const [file,names] of [['Multi-Village Dual-Track Repair.sql',['context_space_accessible','context_space_mutable']],['Shared Survey Calibration and Freeze.sql',['assert_survey_review_context','confirm_survey_feature_geometry']]]){
   const source=await readFile(new URL('../../../supabase_SQL/'+file,import.meta.url),'utf8');
   for(const name of names){const definition=[...source.matchAll(new RegExp('create or replace function public.'+name+'\\([\\s\\S]*?\\n\\$[a-z_]*\\$;','ig'))].at(-1)?.[0];assert.ok(definition,name);await setup.query(definition);}
  }
}
