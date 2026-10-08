-- Allow an authorized uploader or administrator to remove a source photo after
-- facade generation has finished, while retaining the generation record.
-- Safe to run repeatedly after Facade Generation Worker Queue.sql.

alter table public.facade_generation_runs
  alter column photo_id drop not null;

alter table public.facade_generation_runs
  drop constraint if exists facade_generation_runs_photo_id_fkey;

alter table public.facade_generation_runs
  add constraint facade_generation_runs_photo_id_fkey
  foreign key (photo_id) references public.object_photos(id) on delete set null;

create or replace function public.delete_object_photo_safely(p_photo_id bigint)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_photo public.object_photos%rowtype;
  v_current_name text;
  v_legacy_name_count integer := 0;
  v_snapshot_referenced boolean := false;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into v_photo
  from public.object_photos
  where id = p_photo_id
  for update;
  if not found then raise exception 'PHOTO_NOT_FOUND'; end if;

  if v_photo.teaching_project_id is not null
     and v_photo.village_id is not null
     and v_photo.space_id is not null
     and not public.context_space_accessible(
       v_photo.teaching_project_id,
       v_photo.village_id,
       v_photo.space_id
     )
  then raise exception 'PROJECT_ACCESS_REQUIRED'; end if;

  v_current_name := public.current_profile_display_name();
  if v_photo.uploaded_by_user_id is null and nullif(btrim(v_current_name), '') is not null then
    select count(*) into v_legacy_name_count
    from public.profiles
    where lower(btrim(display_name)) = lower(btrim(v_current_name));
  end if;

  if coalesce(public.current_profile_role(), '') <> 'admin'
     and coalesce(v_photo.uploaded_by_user_id = auth.uid(), false) is not true
     and not (
       v_photo.uploaded_by_user_id is null
       and v_legacy_name_count = 1
       and lower(btrim(coalesce(v_photo.uploaded_by, ''))) = lower(btrim(v_current_name))
     )
  then raise exception 'PHOTO_DELETE_FORBIDDEN'; end if;

  if exists (
    select 1
    from public.facade_generation_runs run
    where run.photo_id = p_photo_id
      and run.status in (
        'queued_rectification', 'claimed_rectification', 'rectifying',
        'awaiting_crop', 'queued_generation', 'claimed_generation',
        'generating', 'cancel_requested'
      )
  ) then raise exception 'FACADE_PHOTO_PROCESSING'; end if;

  if to_regclass('public.survey_snapshot_photo_refs') is not null then
    execute 'select exists (select 1 from public.survey_snapshot_photo_refs where photo_id = $1)'
      into v_snapshot_referenced using p_photo_id;
  end if;
  if v_snapshot_referenced then raise exception 'SNAPSHOT_PHOTO_IMMUTABLE'; end if;

  delete from public.object_photos where id = p_photo_id;
  return jsonb_build_object(
    'deleted', true,
    'photoPath', v_photo.photo_path,
    'photoUrl', v_photo.photo_url
  );
end;
$$;

revoke all on function public.delete_object_photo_safely(bigint) from public, anon;
grant execute on function public.delete_object_photo_safely(bigint) to authenticated;
