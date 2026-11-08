BEGIN;
SET LOCAL lock_timeout = '3s';

-- Install after unified survey and vector interviews. Extend the existing
-- administrator-only read without changing the API route or its contract.
CREATE OR REPLACE FUNCTION api_private.admin_message_records() RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public, api_private, pg_temp AS $$
  SELECT coalesce(jsonb_agg(record ORDER BY created_at DESC), '[]'::jsonb)
  FROM (
    SELECT to_jsonb(t) - 'local_actor_id' AS record, t.created_at
    FROM (SELECT * FROM public.community_tasks WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1000) t
    UNION ALL
    SELECT jsonb_build_object(
      'id', 'comment:' || c.id, 'record_kind', 'comment',
      'reporter_name', c.author_name, 'description', c.content,
      'created_at', c.created_at, 'object_code', c.object_code,
      'layer_key', coalesce(c.survey_layer_key, c.object_type), 'village_name', v.name
    ), c.created_at
    FROM (SELECT * FROM public.object_comments WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1000) c
    LEFT JOIN public.villages v ON v.id = c.village_id
    UNION ALL
    SELECT jsonb_build_object(
      'id', 'interview:' || i.id, 'record_kind', 'interview',
      'reporter_name', i.author_name, 'description', i.content,
      'created_at', i.created_at, 'interviewed_at', i.interviewed_at,
      'interviewee', i.interviewee, 'object_code', i.object_code,
      'layer_key', i.layer_key, 'village_name', v.name
    ), i.created_at
    FROM (SELECT * FROM api_private.object_interviews WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1000) i
    LEFT JOIN public.villages v ON v.id = i.village_id
  ) records;
$$;
REVOKE ALL ON FUNCTION api_private.admin_message_records() FROM PUBLIC, anon, authenticated;

DO $migration$
DECLARE
  definition text := pg_get_functiondef('api_private.catalog_read(text,jsonb)'::regprocedure);
  original text := $branch$WHEN 'admin.listMessages' THEN
 IF api_private.current_role()<>'admin' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(t)-'local_actor_id'),'[]') INTO result FROM (SELECT * FROM public.community_tasks WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 1000)t;$branch$;
  replacement text := $branch$WHEN 'admin.listMessages' THEN
 IF api_private.current_role()<>'admin' THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 result := api_private.admin_message_records();$branch$;
BEGIN
  PERFORM api_private.admin_message_records();
  IF strpos(definition, replacement) > 0 THEN RETURN; END IF;
  IF strpos(definition, original) = 0 THEN
    RAISE EXCEPTION 'Unexpected admin.listMessages definition';
  END IF;
  EXECUTE replace(definition, original, replacement);
END;
$migration$;
COMMIT;
