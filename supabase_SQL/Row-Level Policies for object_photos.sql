create policy "allow read object_photos"
on public.object_photos
for select
to public
using (true);

create policy "allow insert object_photos"
on public.object_photos
for insert
to public
with check (true);

create policy "allow delete object_photos"
on public.object_photos
for delete
to public
using (true);