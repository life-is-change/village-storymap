-- Post-apply verification follow-up for multi_village_dual_track_repair.
-- Archives context-free legacy collaboration rows and closes direct access to trigger helpers.
begin;

do $$
declare
  v_project_id uuid;
  v_village_id uuid;
  v_legacy_scope text;
begin
  select project.id, project.practice_village_id
  into v_project_id, v_village_id
  from public.teaching_projects project
  where project.course_id = 'mibu-village-planning'
  order by project.created_at desc
  limit 1;

  select space.id into v_legacy_scope
  from public.planning_spaces space
  where space.teaching_project_id = v_project_id
    and space.village_id = v_village_id
    and space.space_type = 'legacy_unscoped'
  limit 1;

  if v_project_id is null or v_village_id is null or v_legacy_scope is null then
    raise exception 'LEGACY_ARCHIVE_CONTEXT_REQUIRED';
  end if;

  update public.activity_events event
  set teaching_project_id = scope.teaching_project_id,
      village_id = scope.village_id
  from public.legacy_personal_space_scopes scope
  where event.space_id = scope.space_id
    and (event.teaching_project_id is null or event.village_id is null);

  update public.object_photos
  set teaching_project_id = coalesce(teaching_project_id, v_project_id),
      village_id = coalesce(village_id, v_village_id),
      space_id = coalesce(nullif(space_id, ''), v_legacy_scope)
  where teaching_project_id is null or village_id is null or nullif(space_id, '') is null;

  update public.object_comments
  set teaching_project_id = coalesce(teaching_project_id, v_project_id),
      village_id = coalesce(village_id, v_village_id),
      space_id = coalesce(nullif(space_id, ''), v_legacy_scope)
  where teaching_project_id is null or village_id is null or nullif(space_id, '') is null;

  update public.activity_events
  set teaching_project_id = coalesce(teaching_project_id, v_project_id),
      village_id = coalesce(village_id, v_village_id),
      space_id = coalesce(nullif(space_id, ''), v_legacy_scope)
  where teaching_project_id is null or village_id is null or nullif(space_id, '') is null;

  if exists (select 1 from public.object_photos where teaching_project_id is null or village_id is null or nullif(space_id, '') is null)
     or exists (select 1 from public.object_comments where teaching_project_id is null or village_id is null or nullif(space_id, '') is null)
     or exists (select 1 from public.activity_events where teaching_project_id is null or village_id is null or nullif(space_id, '') is null) then
    raise exception 'LEGACY_CONTEXT_BACKFILL_FAILED';
  end if;
end;
$$;

revoke all on function public.context_space_mutable(uuid,uuid,text) from public, anon;
grant execute on function public.context_space_mutable(uuid,uuid,text) to authenticated;
revoke all on function public.prepare_legacy_personal_planning_space() from public, anon, authenticated;
revoke all on function public.prepare_legacy_personal_planning_feature() from public, anon, authenticated;

commit;
