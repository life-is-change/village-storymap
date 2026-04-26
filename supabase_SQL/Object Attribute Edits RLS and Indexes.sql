alter table public.object_attribute_edits enable row level security;
alter table public.object_photos enable row level security;

create index if not exists object_attribute_edits_object_type_idx
on public.object_attribute_edits (object_type);

create index if not exists object_attribute_edits_updated_at_idx
on public.object_attribute_edits (updated_at desc);

drop policy if exists "allow read object_attribute_edits" on public.object_attribute_edits;
create policy "allow read object_attribute_edits"
on public.object_attribute_edits
for select
to public
using (true);

drop policy if exists "allow insert object_attribute_edits" on public.object_attribute_edits;
create policy "allow insert object_attribute_edits"
on public.object_attribute_edits
for insert
to public
with check (true);

drop policy if exists "allow update object_attribute_edits" on public.object_attribute_edits;
create policy "allow update object_attribute_edits"
on public.object_attribute_edits
for update
to public
using (true)
with check (true);

drop policy if exists "allow delete object_attribute_edits" on public.object_attribute_edits;
create policy "allow delete object_attribute_edits"
on public.object_attribute_edits
for delete
to public
using (true);
