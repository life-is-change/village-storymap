create table public.object_photos (
  id bigint generated always as identity primary key,
  object_code text not null,
  object_type text not null,
  photo_url text not null,
  photo_path text not null,
  note text,
  uploaded_at timestamptz not null default now()
);

alter table public.object_photos enable row level security;