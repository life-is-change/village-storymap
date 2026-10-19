import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';
export async function prepareCatalog(setup){
  await setup.query(`ALTER TABLE group_memberships ADD course_id text DEFAULT 'course',ADD student_name text DEFAULT 'A',ADD student_id text DEFAULT 'a',ADD role text DEFAULT 'member',ADD joined_at timestamptz DEFAULT now();ALTER TABLE group_memberships ADD UNIQUE(course_id,student_key);`);
  const src=await readFile(new URL('../../../supabase_SQL/Task-driven Course Workbench Schema.sql',import.meta.url),'utf8');
  for(const name of ['course_groups','task_progress','activity_events']){const ddl=src.match(new RegExp('create table if not exists public.'+name+' \\([\\s\\S]*?\\n\\);','i'))?.[0];assert.ok(ddl);await setup.query(ddl);}
  await setup.query("ALTER TABLE activity_events ADD teaching_project_id uuid,ADD village_id uuid;ALTER TABLE planning_spaces ADD owner_id uuid");

  const foundation=await readFile(new URL('../../../supabase_SQL/Multi-Village Dual-Track Foundation.sql',import.meta.url),'utf8');
  const lifecycle=await readFile(new URL('../../../supabase_SQL/Teaching Project Practice Catalog and Village Lifecycle.sql',import.meta.url),'utf8');
  await setup.query("ALTER TABLE villages ALTER id SET DEFAULT gen_random_uuid(),ADD is_practice boolean DEFAULT false,ADD default_crs text DEFAULT 'EPSG:4326',ADD created_by uuid REFERENCES auth.users,ADD created_at timestamptz DEFAULT now(),ADD updated_at timestamptz DEFAULT now();ALTER TABLE teaching_projects ADD formal_village_id uuid,ADD formal_project_open boolean DEFAULT false");
  for(const name of ['village_datasets','village_reality_models']){const ddl=foundation.match(new RegExp('create table if not exists public.'+name+' \\([\\s\\S]*?\\n\\);','i'))?.[0];assert.ok(ddl);await setup.query(ddl);}
  for(const [source,names] of [[foundation,['create_village_draft']],[lifecycle,['village_usage_breakdown','delete_unused_village']]])for(const name of names){const definition=source.match(new RegExp('create or replace function public.'+name+'\\([\\s\\S]*?\\n\\$\\$;','i'))?.[0];assert.ok(definition);await setup.query(definition);}
}
