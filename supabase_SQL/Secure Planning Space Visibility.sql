-- Restrict legacy/group planning spaces to staff or members of the owning course group.
-- Personal figure-ground spaces remain in course_personal_spaces and are not stored here.

create or replace function public.current_profile_student_key()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select student_id || '::' || display_name
  from public.profiles
  where id = auth.uid();
$$;

revoke all on function public.current_profile_student_key() from public, anon, authenticated;
grant execute on function public.current_profile_student_key() to authenticated;

alter table public.planning_spaces enable row level security;

drop policy if exists "Allow all" on public.planning_spaces;
drop policy if exists planning_spaces_select_visible on public.planning_spaces;
drop policy if exists planning_spaces_insert_visible on public.planning_spaces;
drop policy if exists planning_spaces_update_visible on public.planning_spaces;
drop policy if exists planning_spaces_delete_staff on public.planning_spaces;

create policy planning_spaces_select_visible
on public.planning_spaces
for select to authenticated
using (
  public.current_profile_role() in ('teacher', 'admin')
  or (
    space_type = 'course_group'
    and group_id is not null
    and exists (
      select 1
      from public.group_memberships membership
      where membership.group_id = public.planning_spaces.group_id
        and membership.student_key = public.current_profile_student_key()
    )
  )
);

create policy planning_spaces_insert_visible
on public.planning_spaces
for insert to authenticated
with check (
  public.current_profile_role() in ('teacher', 'admin')
  or (
    space_type = 'course_group'
    and group_id is not null
    and exists (
      select 1
      from public.group_memberships membership
      where membership.group_id = public.planning_spaces.group_id
        and membership.student_key = public.current_profile_student_key()
    )
  )
);

create policy planning_spaces_update_visible
on public.planning_spaces
for update to authenticated
using (
  public.current_profile_role() in ('teacher', 'admin')
  or (
    space_type = 'course_group'
    and group_id is not null
    and exists (
      select 1
      from public.group_memberships membership
      where membership.group_id = public.planning_spaces.group_id
        and membership.student_key = public.current_profile_student_key()
    )
  )
)
with check (
  public.current_profile_role() in ('teacher', 'admin')
  or (
    space_type = 'course_group'
    and group_id is not null
    and exists (
      select 1
      from public.group_memberships membership
      where membership.group_id = public.planning_spaces.group_id
        and membership.student_key = public.current_profile_student_key()
    )
  )
);

create policy planning_spaces_delete_staff
on public.planning_spaces
for delete to authenticated
using (public.current_profile_role() in ('teacher', 'admin'));

revoke all on table public.planning_spaces from anon;
revoke all on table public.planning_spaces from authenticated;
grant select, insert, update, delete on table public.planning_spaces to authenticated;
