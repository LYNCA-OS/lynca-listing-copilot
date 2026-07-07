create table if not exists public.v4_writer_export_batches (
  id text primary key,
  schema_version text not null,
  status text not null default 'READY',
  exported_by text,
  asset_count integer not null default 0,
  item_count integer not null default 0,
  storage_bucket text,
  storage_object_path text,
  file_name text,
  file_size_bytes bigint,
  manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.v4_writer_export_items (
  id text primary key,
  export_batch_id text not null references public.v4_writer_export_batches(id) on delete cascade,
  recognition_session_id text,
  asset_id text,
  asset_index integer,
  final_title text not null default '',
  image_refs jsonb not null default '[]'::jsonb,
  training_use text not null default 'writer_export_reviewed_title',
  created_at timestamptz not null default now()
);

create index if not exists v4_writer_export_items_batch_idx
  on public.v4_writer_export_items(export_batch_id);

create index if not exists v4_writer_export_items_session_idx
  on public.v4_writer_export_items(recognition_session_id);

create index if not exists v4_writer_export_batches_created_idx
  on public.v4_writer_export_batches(created_at desc);

create index if not exists v4_writer_export_batches_manifest_gin_idx
  on public.v4_writer_export_batches using gin (manifest);

alter table public.v4_writer_export_batches enable row level security;
alter table public.v4_writer_export_items enable row level security;

grant select, insert, update, delete on public.v4_writer_export_batches to service_role;
grant select, insert, update, delete on public.v4_writer_export_items to service_role;
