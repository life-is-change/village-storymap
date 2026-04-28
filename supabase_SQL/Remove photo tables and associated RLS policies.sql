drop policy if exists "allow read object_photos" on public.object_photos;
drop policy if exists "allow insert object_photos" on public.object_photos;
drop policy if exists "allow delete object_photos" on public.object_photos;

drop policy if exists "allow read house_photos" on public.house_photos;
drop policy if exists "allow insert house_photos" on public.house_photos;
drop policy if exists "allow delete house_photos" on public.house_photos;

drop policy if exists "allow public upload to house-photos" on storage.objects;
drop policy if exists "allow public read from house-photos" on storage.objects;
drop policy if exists "allow public delete from house-photos" on storage.objects;

drop policy if exists "public can upload to house-photos" on storage.objects;
drop policy if exists "public can read from house-photos" on storage.objects;
drop policy if exists "public can delete from house-photos" on storage.objects;

drop table if exists public.house_photos;
drop table if exists public.object_photos;