-- Read-only probe context. The caller substitutes a strictly validated UUID.
-- Use a private administrator sandbox; formal group plans need not exist in
-- a restored teaching/practice snapshot. Never create or modify source spaces.
WITH actor AS (
 SELECT id FROM public.profiles
 WHERE id='__PROBE_USER_UUID__'::uuid AND role='admin'
)
SELECT json_build_object(
 'is_admin',EXISTS(SELECT 1 FROM actor),
 'context',(
  SELECT json_build_object(
   'teachingProjectId',s.teaching_project_id,'villageId',s.village_id,
   'spaceId',s.id,'groupId',NULL::text,'scopeKind','admin_sandbox','baselineRevision',0)
  FROM public.planning_spaces s
  JOIN public.teaching_projects t ON t.id=s.teaching_project_id
  JOIN public.villages v ON v.id=s.village_id
  WHERE EXISTS(SELECT 1 FROM actor)
  ORDER BY (s.space_type='practice_shared') DESC NULLS LAST,s.id
  LIMIT 1
 )
) AS data;
