BEGIN;
SET LOCAL lock_timeout=3000;
DO $patch$
DECLARE body text;old text;replacement text;
BEGIN
 body:=pg_get_functiondef('api_private.file_commit(uuid,text,jsonb)'::regprocedure);
 old:=$old$WHEN personal.id IS NOT NULL THEN 'personal'$old$;
 replacement:=$new$WHEN personal.id IS NOT NULL OR (space.space_type IN('practice_personal','formal_personal') AND space.owner_id=auth.uid()) THEN 'personal'$new$;
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'FILE_COMMIT_CHANGED';END IF;
 EXECUTE replace(body,old,replacement);
 body:=replace(pg_get_functiondef('public.place_group_model(uuid,text,text,jsonb)'::regprocedure),chr(13),'');
 old:=substring(body from $re$if v_asset[.]scope_kind = 'personal' and not exists [(][^;]+?[)] then$re$);
 IF old IS NULL THEN RAISE EXCEPTION 'MODEL_PLACE_CHANGED';END IF;
 replacement:=regexp_replace(old,'[)] then$', $new$) and not exists (
    select 1 from public.planning_spaces personal_space
    where personal_space.id = p_space_id
      and personal_space.space_type in ('practice_personal','formal_personal')
      and personal_space.owner_id = auth.uid()
      and personal_space.owner_id = v_asset.owner_id
  ) then$new$);
 IF strpos(body,old)=0 THEN RAISE EXCEPTION 'MODEL_PLACE_CHANGED';END IF;
 EXECUTE replace(body,old,replacement);
END $patch$;
COMMIT;
