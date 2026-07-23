-- Incremental migration: allow students to delete contour features while
-- keeping contour add/update operations forbidden.

create or replace function public.save_personal_feature_edit_batch(
  p_space_id uuid,
  p_changes jsonb
) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_change jsonb;
  v_layer_key text;
  v_action text;
  v_object_code text;
  v_version_id uuid;
  v_saved integer := 0;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(p_changes) <> 'array' then raise exception 'INVALID_CHANGES'; end if;
  if not exists(
    select 1 from public.course_personal_spaces
    where id=p_space_id and owner_id=v_user_id
  ) then raise exception 'FORBIDDEN'; end if;

  for v_change in select value from jsonb_array_elements(p_changes)
  loop
    v_action := v_change->>'action';
    v_layer_key := v_change->>'layerKey';
    v_object_code := nullif(trim(v_change->>'objectCode'), '');

    if v_action not in ('add','update','delete')
       or v_layer_key not in ('building','road','water','contours')
       or v_object_code is null
       or (v_layer_key='contours' and v_action<>'delete')
    then raise exception 'INVALID_CHANGE'; end if;

    select s.current_version_id into v_version_id
    from public.personal_layer_selections s
    join public.personal_layer_versions v on v.id=s.current_version_id
    where s.space_id=p_space_id and s.layer_key=v_layer_key
      and v.space_id=p_space_id and v.layer_key=v_layer_key
      and (v.editable or (v_layer_key='contours' and v_action='delete'));
    if v_version_id is null then raise exception 'EDITABLE_CURRENT_VERSION_REQUIRED'; end if;

    if v_action='delete' then
      update public.personal_layer_features
      set is_deleted=true, updated_at=now()
      where space_id=p_space_id and layer_version_id=v_version_id
        and layer_key=v_layer_key and object_code=v_object_code;
      if not found then raise exception 'FEATURE_NOT_FOUND'; end if;
    else
      if jsonb_typeof(v_change->'afterGeom') <> 'object'
      then raise exception 'INVALID_FEATURE_GEOMETRY'; end if;
      insert into public.personal_layer_features(
        space_id,layer_version_id,layer_key,object_code,object_name,geom,props,is_deleted,updated_at
      ) values(
        p_space_id,v_version_id,v_layer_key,v_object_code,
        coalesce(nullif(v_change->>'objectName',''),v_object_code),
        v_change->'afterGeom',coalesce(v_change->'afterProps','{}'::jsonb),false,now()
      )
      on conflict(layer_version_id,object_code) do update set
        object_name=excluded.object_name,
        geom=excluded.geom,
        props=excluded.props,
        is_deleted=false,
        updated_at=now();
    end if;
    v_saved := v_saved + 1;
  end loop;

  update public.personal_layer_versions v
  set feature_count=(
    select count(*) from public.personal_layer_features f
    where f.layer_version_id=v.id and not f.is_deleted
  )
  where v.id in (
    select s.current_version_id from public.personal_layer_selections s
    where s.space_id=p_space_id
  );
  return v_saved;
end;
$$;

revoke all on function public.save_personal_feature_edit_batch(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_personal_feature_edit_batch(uuid,jsonb) to authenticated;
