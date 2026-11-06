-- Run against the autonomous Aliyun database, preserving installed function bodies.
CREATE OR REPLACE FUNCTION public.can_edit_practice_shared_space(sid text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,api_private,auth,pg_temp AS $body$
 SELECT auth.uid() IS NOT NULL AND api_private.profile_status()='active' AND EXISTS(
  SELECT 1 FROM public.planning_spaces s JOIN public.teaching_projects t ON t.id=s.teaching_project_id
  JOIN public.villages v ON v.id=s.village_id
  WHERE s.id=sid AND s.space_type='practice_shared' AND v.is_practice
   AND NOT s.readonly AND s.edit_enabled AND t.stage NOT IN ('completed','archived')
   AND public.context_space_accessible(t.id,s.village_id,s.id)
 )
$body$;
REVOKE ALL ON FUNCTION public.can_edit_practice_shared_space(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_edit_practice_shared_space(text) TO authenticated;

DO $migration$
DECLARE patch jsonb; edit jsonb; target oid; body text; old_text text; new_text text;
BEGIN
 FOR patch IN SELECT value FROM jsonb_array_elements($patches$[{"function": "public.context_space_mutable", "edits": [["or (space.space_type in ('practice_personal', 'formal_personal')", "or public.can_edit_practice_shared_space(space.id)\n        or (space.space_type in ('practice_personal', 'formal_personal')"]]}, {"function": "public.scene_edit_create_project", "edits": [["(p_scope_kind = 'group' and space.group_id = p_group_id and space.space_type = 'group_plan')", "(p_scope_kind = 'group' and ((space.group_id = p_group_id and space.space_type = 'group_plan')\n        or (space.space_type = 'formal_shared' and teaching.formal_village_id = space.village_id\n          and public.project_group_eligible(p_group_id, teaching.id))))"]]}, {"function": "api_private.file_guard", "edits": [["AND api_private.current_role()<>'admin' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;", "AND api_private.current_role()<>'admin' AND NOT public.can_edit_practice_shared_space(c->>'spaceId') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;"]]}, {"function": "public.register_group_model", "edits": [["public.current_profile_role() <> 'admin'", "(public.current_profile_role() <> 'admin' and not public.can_edit_practice_shared_space(p_space_id))"]]}, {"function": "public.place_group_model", "edits": [["public.current_profile_role() <> 'admin'", "(public.current_profile_role() <> 'admin' and not public.can_edit_practice_shared_space(p_space_id))"]]}, {"function": "public.restore_building_white_model", "edits": [["public.current_profile_role() <> 'admin'", "(public.current_profile_role() <> 'admin' and not public.can_edit_practice_shared_space(p_space_id))"], ["elsif public.current_profile_role() = 'admin' and exists (", "elsif (public.current_profile_role() = 'admin' or public.can_edit_practice_shared_space(p_space_id)) and exists ("]]}]$patches$::jsonb) LOOP
  SELECT p.oid INTO STRICT target FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname||'.'||p.proname=patch->>'function';
  body:=pg_get_functiondef(target);
  FOR edit IN SELECT value FROM jsonb_array_elements(patch->'edits') LOOP
   old_text:=edit->>0; new_text:=edit->>1;
   IF strpos(body,new_text)>0 THEN CONTINUE; END IF;
   IF (length(body)-length(replace(body,old_text,'')))/length(old_text)<>1 THEN
    RAISE EXCEPTION 'LIVE_FUNCTION_CHANGED %',patch->>'function';
   END IF;
   body:=replace(body,old_text,new_text);
  END LOOP;
  EXECUTE body;
 END LOOP;
END $migration$;
