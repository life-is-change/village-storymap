create policy "allow public upload to house-photos"
on storage.objects
for insert
to public
with check (bucket_id = 'house-photos');

create policy "allow public read from house-photos"
on storage.objects
for select
to public
using (bucket_id = 'house-photos');

create policy "allow public delete from house-photos"
on storage.objects
for delete
to public
using (bucket_id = 'house-photos');