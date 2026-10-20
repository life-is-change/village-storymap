import {readFile} from 'node:fs/promises';import {prepareSurvey} from './survey.mjs';import assert from 'node:assert/strict';
export async function prepareBridge(setup){
 await prepareSurvey(setup);await setup.query(`CREATE PUBLICATION supabase_realtime;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT current_setting('request.jwt.claim.role',true)$$;
  CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,metadata jsonb DEFAULT '{}');
  CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$SELECT (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1]$$;
  GRANT USAGE ON SCHEMA public,auth,storage TO authenticated,anon,service_role;GRANT SELECT ON storage.objects TO authenticated,anon;
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;CREATE POLICY deliberately_permissive_source ON storage.objects FOR SELECT TO authenticated,anon USING(true);`);
 for(const file of ['Geoprocessing Worker Queue.sql','Facade Generation Worker Queue.sql','Cloud Facade Provider Runs.sql','Geoprocessing Local Source Inputs.sql','Geoprocessing Village AOI Limits.sql'])await setup.query(await readFile(new URL('../../../supabase_SQL/'+file,import.meta.url),'utf8'));
 // Install the real source import routine with its declared return row types;
 // the isolation check must run before any ordinary business write in it.
 const personal=await readFile(new URL('../../../supabase_SQL/Personal Figure Ground Spaces and Layer Versions.sql',import.meta.url),'utf8');
 for(const name of ['personal_result_bundles','personal_layer_versions','personal_layer_features','personal_layer_selections']){const ddl=personal.match(new RegExp('create table if not exists public.'+name+' \\([\\s\\S]*?\\n\\);','i'))?.[0];assert.ok(ddl);await setup.query(ddl);}
 await setup.query(personal.match(/create or replace function public.import_geoprocessing_result\([\s\S]*?\n\$\$;/i)[0]);await setup.query('GRANT EXECUTE ON FUNCTION public.import_geoprocessing_result(uuid,jsonb) TO authenticated');
 await setup.query(`UPDATE villages SET is_practice=true;
  INSERT INTO geoprocessing_villages VALUES('b0000000-0000-4000-8000-000000000001','Worker prepared','[113,23,113.001,23.001]',2,true);
  INSERT INTO worker_heartbeats(worker_id,state,version) VALUES('worker','available','synthetic-compatible');
  INSERT INTO geoprocessing_source_status(village_id,ready,bounds,worker_id) VALUES('b0000000-0000-4000-8000-000000000001',true,'[113,23,113.001,23.001]','worker');`);
}
