create index object_photos_object_code_idx
on public.object_photos (object_code);

create index object_photos_object_type_idx
on public.object_photos (object_type);

create index object_photos_uploaded_at_idx
on public.object_photos (uploaded_at desc);