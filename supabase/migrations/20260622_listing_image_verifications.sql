create table if not exists public.listing_image_verifications (
  object_path text primary key,
  bucket text not null,
  asset_id text,
  image_id text,
  storage_role text,
  content_type text not null,
  size integer not null,
  width integer not null,
  height integer not null,
  object_verified boolean not null default false,
  dimension_source text,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists listing_image_verifications_asset_id_idx
  on public.listing_image_verifications(asset_id);

create index if not exists listing_image_verifications_verified_at_idx
  on public.listing_image_verifications(verified_at desc);

alter table public.listing_image_verifications enable row level security;
