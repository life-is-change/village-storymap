import {failure} from './errors.mjs';
export const ME_COLUMNS='id,student_id,display_name,role,gender,class_name,grade';
const personal='id,title,owner_id,course_id,village_id,space_type';
const group='s.id,s.title,s.course_id,s.group_id,s.space_type,s.teaching_project_id,s.village_id';
const visible="(public.current_profile_role() IN ('teacher','admin') OR EXISTS (SELECT 1 FROM public.group_memberships m WHERE m.group_id=s.group_id AND m.student_key=public.current_profile_student_key()))";
export async function getMe(client,userId){
 const {rows}=await client.query('SELECT '+ME_COLUMNS+' FROM public.profiles WHERE id=$1',[userId]);
 if(!rows.length)throw failure('PROFILE_NOT_SYNCED');return rows[0];
}
export async function listCourses(client){return (await client.query('SELECT id,title,village_id FROM public.courses ORDER BY id LIMIT 100')).rows;}
export async function listSpaces(client,{kind,limit,offset},userId){
 if(kind==='personal')return (await client.query('SELECT '+personal+' FROM public.course_personal_spaces WHERE owner_id=$1 ORDER BY id LIMIT $2 OFFSET $3',[userId,limit,offset])).rows;
 return (await client.query('SELECT '+group+' FROM public.planning_spaces s WHERE '+visible+' ORDER BY s.id LIMIT $1 OFFSET $2',[limit,offset])).rows;
}
export async function getSpace(client,kind,id,userId){
 const query=kind==='personal'
  ? ['SELECT '+personal+' FROM public.course_personal_spaces WHERE id=$1 AND owner_id=$2',[id,userId]]
  : ['SELECT '+group+' FROM public.planning_spaces s WHERE s.id=$1 AND '+visible,[id]];
 return (await client.query(...query)).rows[0]??null;
}

// Keep source Storage RLS in force AND constrain each allowed bucket explicitly.
// Legacy public house-photo reads remain authenticated at this candidate API.
export async function getStorageObject(client,id){
 return (await client.query(`SELECT o.id,o.bucket_id AS bucket,o.name,
 to_char(o.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS snapshot_updated_at,
 o.metadata->'size' AS declared_size,o.metadata->>'eTag' AS snapshot_etag,to_jsonb(o)->>'version' AS snapshot_version FROM storage.objects o
 WHERE o.id=$1 AND CASE o.bucket_id
 WHEN 'house-photos' THEN auth.uid() IS NOT NULL
 WHEN 'group-models' THEN (
   public.current_profile_role()='admin' OR split_part(o.name,'/',1)='shared'
   OR (split_part(o.name,'/',1)='users' AND split_part(o.name,'/',2)=auth.uid()::text)
   OR (split_part(o.name,'/',1)='groups' AND EXISTS (
     SELECT 1 FROM public.group_memberships m WHERE m.group_id=split_part(o.name,'/',2)
     AND m.student_key=public.current_profile_student_key())))
 WHEN 'scene-assets' THEN EXISTS (SELECT 1 FROM public.scene_edit_assets a
   WHERE a.storage_path=o.name AND public.can_read_scene_edit_asset(a.scope_kind,a.course_id,a.group_id,a.owner_id))
 WHEN 'scene-version-previews' THEN EXISTS (SELECT 1 FROM public.scene_edit_versions v
   WHERE v.preview_path=o.name AND public.can_read_scene_edit_project(v.project_id))
 WHEN 'village-datasets' THEN public.can_read_village_dataset_object(o.name)
 ELSE false END`,[id])).rows[0]??null;
}
