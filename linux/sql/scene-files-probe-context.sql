-- Read-only own profile/membership and private admin context. No permission edits.
WITH actor AS (SELECT * FROM public.profiles WHERE id='__PROBE_USER_UUID__'::uuid),
membership AS (
 SELECT m.course_id,m.group_id FROM public.group_memberships m JOIN actor a ON m.student_key=a.student_id||'::'||a.display_name
 WHERE __COURSE_FILTER__ IS NULL OR m.course_id=__COURSE_FILTER__ ORDER BY m.course_id,m.group_id LIMIT 1
)
SELECT json_build_object(
 'profile',EXISTS(SELECT 1 FROM actor),
 'is_admin',EXISTS(SELECT 1 FROM actor WHERE role='admin'),
 'membership',(SELECT json_build_object('courseId',course_id,'groupId',group_id) FROM membership),
 'context',(
 SELECT json_build_object('teachingProjectId',s.teaching_project_id,'villageId',s.village_id,'spaceId',s.id,'groupId',NULL::text,'scopeKind','admin_sandbox','baselineRevision',0,'courseId',t.course_id)
 FROM public.planning_spaces s JOIN public.teaching_projects t ON t.id=s.teaching_project_id JOIN public.villages v ON v.id=s.village_id
 WHERE EXISTS(SELECT 1 FROM actor WHERE role='admin') AND (__COURSE_FILTER__ IS NULL OR t.course_id=__COURSE_FILTER__)
 ORDER BY (s.space_type='practice_shared') DESC NULLS LAST,s.id LIMIT 1
 )) AS data;
