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
