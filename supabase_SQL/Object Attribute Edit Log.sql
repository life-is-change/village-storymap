create table if not exists public.object_attribute_edits (
  id bigint generated always as identity primary key,
  object_code text not null,
  object_type text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists object_attribute_edits_code_type_idx
on public.object_attribute_edits (object_code, object_type);