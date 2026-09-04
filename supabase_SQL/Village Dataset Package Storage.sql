-- Private storage for administrator-imported village V0 packages.
-- Apply after Multi-Village Dual-Track Repair.sql.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'village-datasets',
  'village-datasets',
  false,
  52428800,
  array['application/json','application/geo+json','image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_read_village_dataset_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, storage, pg_temp
as $$
  select auth.uid() is not null and (
    public.current_profile_role() in ('teacher', 'admin')
    or exists (
      select 1
      from public.village_datasets dataset
      where dataset.status = 'published'
        and (
          dataset.imagery_config->>'path' = p_name
          or exists (
            select 1
            from jsonb_array_elements(coalesce(dataset.layer_manifest->'layers', '[]'::jsonb)) layer
            where layer->>'path' = p_name
          )
        )
    )
  );
$$;

revoke all on function public.can_read_village_dataset_object(text) from public, anon;
grant execute on function public.can_read_village_dataset_object(text) to authenticated;

drop policy if exists village_datasets_read on storage.objects;
drop policy if exists village_datasets_insert on storage.objects;
drop policy if exists village_datasets_update on storage.objects;
drop policy if exists village_datasets_delete on storage.objects;

create policy village_datasets_read on storage.objects
for select to authenticated
using (
  bucket_id = 'village-datasets'
  and public.can_read_village_dataset_object(name)
);

create policy village_datasets_insert on storage.objects
for insert to authenticated
with check (
  bucket_id = 'village-datasets'
  and public.current_profile_role() in ('teacher', 'admin')
  and (storage.foldername(name))[1] ~ '^[0-9a-fA-F-]{36}$'
);

create policy village_datasets_update on storage.objects
for update to authenticated
using (bucket_id = 'village-datasets' and public.current_profile_role() in ('teacher', 'admin'))
with check (bucket_id = 'village-datasets' and public.current_profile_role() in ('teacher', 'admin'));

create policy village_datasets_delete on storage.objects
for delete to authenticated
using (bucket_id = 'village-datasets' and public.current_profile_role() in ('teacher', 'admin'));

commit;
