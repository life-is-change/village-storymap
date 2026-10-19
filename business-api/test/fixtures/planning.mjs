import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';import {prepareSurvey} from './survey.mjs';
async function source(name){return readFile(new URL('../../../supabase_SQL/'+name,import.meta.url),'utf8');}
async function tables(setup,text,names){for(const name of names){const ddl=text.match(new RegExp('create table if not exists (?:public\\.)?'+name+' \\([\\s\\S]*?\\n\\);','i'))?.[0];assert.ok(ddl,name);await setup.query(ddl);}}
export async function preparePlanning(setup){
 await prepareSurvey(setup);
 const versioning=await source('Shared Current Survey Versioning and Feature Locks.sql'),survey=await source('Shared Survey Calibration and Freeze.sql'),group=await source('Group Plan Baseline Update.sql'),repair=await source('Multi-Village Dual-Track Repair.sql'),personal=await source('Personal Figure Ground Spaces and Layer Versions.sql');
 await tables(setup,await source('Planning features table with RLS and timestamps.sql'),['planning_features']);
 await tables(setup,versioning,['feature_change_batches','feature_versions','feature_snapshots','feature_snapshot_items']);
 await setup.query(`ALTER TABLE planning_features ADD teaching_project_id uuid,ADD village_id uuid,ADD operation_kind text,ADD base_object_code text,ADD base_snapshot_id uuid REFERENCES feature_snapshots,ADD feature_revision bigint DEFAULT 0;
  ALTER TABLE feature_change_batches ADD teaching_project_id uuid,ADD village_id uuid,ADD editor_user_id uuid;
  ALTER TABLE feature_versions ADD teaching_project_id uuid,ADD village_id uuid,ADD created_by_user_id uuid;
  ALTER TABLE feature_snapshots ADD teaching_project_id uuid,ADD village_id uuid,ADD version_number integer,ADD recommended_for_groups boolean DEFAULT false,ADD stats jsonb DEFAULT '{}';
  ALTER TABLE planning_spaces ADD base_snapshot_id uuid REFERENCES feature_snapshots,ADD base_dataset_id uuid REFERENCES village_datasets,ADD creator_name text,ADD created_at timestamptz DEFAULT now(),ADD expanded boolean DEFAULT true,ADD selected_layers jsonb DEFAULT '[]',ADD basemap_visible boolean DEFAULT true,ADD view_mode text DEFAULT '2d';
  ALTER TABLE feature_edit_locks DROP CONSTRAINT feature_edit_locks_pkey;ALTER TABLE feature_edit_locks ADD PRIMARY KEY(teaching_project_id,village_id,space_id,layer_key,object_code);
  ALTER TABLE survey_feature_reviews ADD is_v0_baseline boolean DEFAULT true,ADD baseline_object_code text,ADD base_dataset_id uuid,ADD latest_geometry_batch_id uuid;
  UPDATE survey_feature_reviews SET baseline_object_code=object_code;
  ALTER TABLE course_personal_spaces ALTER village_id TYPE text USING village_id::text;ALTER TABLE course_personal_spaces ADD teaching_project_id uuid,ADD created_at timestamptz DEFAULT now(),ADD updated_at timestamptz DEFAULT now();
  CREATE TABLE geoprocessing_runs(id uuid PRIMARY KEY);
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
  INSERT INTO course_groups(id,course_id,name,join_code,space_id) VALUES('group-a','course','Group A','GROUPA','G');
  INSERT INTO group_memberships(course_id,group_id,student_key,student_name,student_id) VALUES('course','group-a','b::B','B','b');
  UPDATE teaching_projects SET formal_village_id=practice_village_id,formal_project_open=true;
  UPDATE course_personal_spaces SET course_id='course',village_id='b0000000-0000-4000-8000-000000000001',space_type='formal_personal',teaching_project_id='a0000000-0000-4000-8000-000000000001';`);
 await tables(setup,group,['group_baseline_updates','group_baseline_conflicts','group_plan_restore_points']);
 await tables(setup,survey,['community_task_versions','survey_snapshot_photo_refs','survey_snapshot_issue_refs']);
 await tables(setup,personal,['personal_result_bundles','personal_layer_versions','personal_layer_features','personal_layer_selections']);
 const auth=await source('Supabase Auth Profiles and Identity RLS.sql');
 for(const [text,names,latest] of [[auth,['current_profile_display_name'],true],[repair,['is_service_role_request','assert_feature_space_context'],true],[repair,['acquire_feature_edit_lock','heartbeat_feature_edit_lock','release_feature_edit_lock','freeze_feature_snapshot'],false],[survey,['initialize_shared_survey_reviews','save_feature_edit_batch','get_shared_survey_dashboard','list_shared_survey_features','restore_survey_feature_version','freeze_shared_survey_snapshot'],true],[personal,['set_personal_layer_version','delete_personal_layer_version'],true],[await source('Enable Personal Contour Delete.sql'),['save_personal_feature_edit_batch'],true]]){
  for(const name of names){const found=[...text.matchAll(new RegExp('create or replace function public.'+name+'\\([\\s\\S]*?\\n\\$[a-z_]*\\$;','ig'))];assert.ok(found.length,name);await setup.query(found[latest?found.length-1:0][0]);}
 }
 for(const match of group.matchAll(/create or replace function public\.[a-z_]+\([\s\S]*?\n\$[a-z_]*\$;/ig))await setup.query(match[0]);
 const geom={type:'Polygon',coordinates:[[[113,23],[113.001,23],[113.001,23.001],[113,23]]]};
 await setup.query("INSERT INTO planning_features(space_id,layer_key,object_code,object_name,geom,props,teaching_project_id,village_id) VALUES('A','building','B1','Building',$1::jsonb,'{}','a0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001')",[JSON.stringify(geom)]);
 await setup.query(`INSERT INTO geoprocessing_runs VALUES('f0000000-0000-4000-8000-000000000001');INSERT INTO personal_result_bundles(id,space_id,source_run_id) VALUES('f0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001');
 INSERT INTO personal_layer_versions(id,space_id,bundle_id,layer_key,version_number,source_run_id) VALUES('f0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002','building',1,'f0000000-0000-4000-8000-000000000001');
 INSERT INTO personal_layer_selections(space_id,layer_key,current_version_id) VALUES('a0000000-0000-4000-8000-000000000001','building','f0000000-0000-4000-8000-000000000003');`);
}
