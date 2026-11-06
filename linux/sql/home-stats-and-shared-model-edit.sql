BEGIN;
SET LOCAL lock_timeout=3000;
CREATE FUNCTION public.can_edit_shared_model_space(p_space_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,auth,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.planning_spaces s WHERE s.id=p_space_id
  AND s.space_type IN ('practice_shared','formal_shared')
  AND public.context_space_mutable(s.teaching_project_id,s.village_id,s.id))
$$;
REVOKE ALL ON FUNCTION public.can_edit_shared_model_space(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_edit_shared_model_space(text) TO authenticated;
DO $patch$
DECLARE fname text; body text;
BEGIN
 FOREACH fname IN ARRAY ARRAY['api_private.file_guard','public.register_group_model','public.place_group_model','public.restore_building_white_model'] LOOP
  SELECT pg_get_functiondef(p.oid) INTO STRICT body FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname=split_part(fname,'.',1) AND p.proname=split_part(fname,'.',2);
  IF strpos(body,'public.can_edit_practice_shared_space(')=0 THEN RAISE EXCEPTION 'FUNCTION_CHANGED:%',fname;END IF;
  EXECUTE replace(body,'public.can_edit_practice_shared_space(','public.can_edit_shared_model_space(');
 END LOOP;
 body:=pg_get_functiondef('api_private.catalog_read(text,jsonb)'::regprocedure);
 IF (length(body)-length(replace(body,' CASE a','')))/length(' CASE a')<>1 OR strpos(body,'catalog.homeStats')>0 THEN RAISE EXCEPTION 'CATALOG_CHANGED';END IF;
 EXECUTE replace(body,' CASE a',$stats$ CASE a
 WHEN 'catalog.homeStats' THEN
  SELECT jsonb_build_object('registeredUsers',(SELECT count(*) FROM auth.users WHERE deleted_at IS NULL),
   'villageCount',count(*),'measuredVillages',count(*) FILTER(WHERE v.boundary IS NOT NULL),
   'areaSquareMeters',coalesce(sum(extensions.ST_Area(v.boundary::extensions.geography)) FILTER(WHERE v.boundary IS NOT NULL),0))
   INTO result FROM public.villages v WHERE v.status='published';
$stats$);
END $patch$;
COMMIT;
