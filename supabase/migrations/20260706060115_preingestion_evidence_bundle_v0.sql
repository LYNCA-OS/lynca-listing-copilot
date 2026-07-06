-- Pre-Ingestion Evidence Bundle v0.
--
-- This layer persists lightweight, reusable preprocessing near storage:
-- verified raw image metadata, derived-image references, deterministic crop
-- plans, evidence patches, and async worker jobs. It intentionally does not
-- run OCR, embeddings, image decoding, or model calls inside Postgres.

create table if not exists public.preingestion_bundles (
  bundle_id uuid primary key default gen_random_uuid(),
  asset_id text not null,
  source text not null default 'listing_preingest_api',
  status text not null default 'READY',
  images jsonb not null default '[]'::jsonb,
  derived_images jsonb not null default '[]'::jsonb,
  quality_summary jsonb not null default '{}'::jsonb,
  initial_evidence jsonb not null default '{}'::jsonb,
  evidence_patches jsonb not null default '[]'::jsonb,
  crop_plan jsonb not null default '[]'::jsonb,
  bundle_version text not null default 'preingestion-bundle-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint preingestion_bundles_status_chk
    check (status in ('READY', 'PARTIAL', 'PENDING_WORKER', 'FAILED'))
);

create unique index if not exists preingestion_bundles_asset_source_version_uidx
  on public.preingestion_bundles(asset_id, source, bundle_version);

create index if not exists preingestion_bundles_asset_id_idx
  on public.preingestion_bundles(asset_id);

create index if not exists preingestion_bundles_status_idx
  on public.preingestion_bundles(status, updated_at desc);

create index if not exists preingestion_bundles_images_gin_idx
  on public.preingestion_bundles using gin (images);

create index if not exists preingestion_bundles_evidence_gin_idx
  on public.preingestion_bundles using gin (evidence_patches);

alter table public.preingestion_bundles enable row level security;

create table if not exists public.preingestion_jobs (
  job_id uuid primary key default gen_random_uuid(),
  job_key text not null,
  asset_id text not null,
  bundle_id uuid references public.preingestion_bundles(bundle_id) on delete cascade,
  job_type text not null,
  status text not null default 'queued',
  priority integer not null default 50,
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint preingestion_jobs_type_chk
    check (job_type in (
      'build_bundle',
      'ocr_crop_verification',
      'visual_embedding',
      'surface_crop_analysis',
      'image_quality_deep_analysis'
    )),
  constraint preingestion_jobs_status_chk
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled'))
);

create unique index if not exists preingestion_jobs_job_key_uidx
  on public.preingestion_jobs(job_key);

create index if not exists preingestion_jobs_status_priority_idx
  on public.preingestion_jobs(status, priority asc, created_at asc);

create index if not exists preingestion_jobs_asset_idx
  on public.preingestion_jobs(asset_id);

alter table public.preingestion_jobs enable row level security;

create table if not exists public.image_derived_assets (
  derived_id uuid primary key default gen_random_uuid(),
  asset_id text not null,
  source_image_id text,
  source_object_path text,
  role text not null,
  object_path text not null,
  bucket text not null,
  content_sha256 text,
  crop_box jsonb,
  width integer,
  height integer,
  size bigint,
  content_type text,
  created_by text not null default 'preingestion',
  transform_version text,
  status text not null default 'ready',
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint image_derived_assets_status_chk
    check (status in ('ready', 'pending', 'failed', 'superseded'))
);

create unique index if not exists image_derived_assets_object_path_uidx
  on public.image_derived_assets(object_path);

create index if not exists image_derived_assets_asset_role_idx
  on public.image_derived_assets(asset_id, role);

create index if not exists image_derived_assets_sha_idx
  on public.image_derived_assets(content_sha256)
  where content_sha256 is not null;

alter table public.image_derived_assets enable row level security;

create table if not exists public.preingestion_evidence_patches (
  patch_id uuid primary key default gen_random_uuid(),
  bundle_id uuid references public.preingestion_bundles(bundle_id) on delete cascade,
  asset_id text not null,
  field text not null,
  value jsonb,
  raw_text text,
  text_candidates jsonb not null default '[]'::jsonb,
  source_type text not null,
  source_image_id text not null,
  crop_id text,
  confidence numeric,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists preingestion_evidence_patches_bundle_idx
  on public.preingestion_evidence_patches(bundle_id);

create index if not exists preingestion_evidence_patches_asset_field_idx
  on public.preingestion_evidence_patches(asset_id, field);

create index if not exists preingestion_evidence_patches_provenance_gin_idx
  on public.preingestion_evidence_patches using gin (provenance);

alter table public.preingestion_evidence_patches enable row level security;

create or replace function public.touch_preingestion_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists preingestion_bundles_touch_updated_at on public.preingestion_bundles;
create trigger preingestion_bundles_touch_updated_at
before update on public.preingestion_bundles
for each row execute function public.touch_preingestion_updated_at();

drop trigger if exists preingestion_jobs_touch_updated_at on public.preingestion_jobs;
create trigger preingestion_jobs_touch_updated_at
before update on public.preingestion_jobs
for each row execute function public.touch_preingestion_updated_at();

drop trigger if exists image_derived_assets_touch_updated_at on public.image_derived_assets;
create trigger image_derived_assets_touch_updated_at
before update on public.image_derived_assets
for each row execute function public.touch_preingestion_updated_at();

drop trigger if exists preingestion_evidence_patches_touch_updated_at on public.preingestion_evidence_patches;
create trigger preingestion_evidence_patches_touch_updated_at
before update on public.preingestion_evidence_patches
for each row execute function public.touch_preingestion_updated_at();

create or replace function public.enqueue_preingestion_bundle_job_from_verified_image()
returns trigger
language plpgsql
as $$
begin
  if new.asset_id is null
    or coalesce(new.object_verified, false) is not true
    or coalesce(new.storage_role, '') not in ('front_original', 'back_original', 'front_alternate', 'back_alternate')
  then
    return new;
  end if;

  insert into public.preingestion_jobs (
    job_key,
    asset_id,
    bundle_id,
    job_type,
    status,
    priority,
    payload
  )
  values (
    'build_bundle:' || new.asset_id,
    new.asset_id,
    null,
    'build_bundle',
    'queued',
    30,
    jsonb_build_object(
      'asset_id', new.asset_id,
      'trigger', 'listing_image_verifications',
      'storage_role', new.storage_role,
      'object_path', new.object_path
    )
  )
  on conflict (job_key) do update
    set status = case
        when public.preingestion_jobs.status in ('succeeded', 'cancelled') then 'queued'
        else public.preingestion_jobs.status
      end,
      payload = public.preingestion_jobs.payload || excluded.payload,
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists listing_image_verifications_enqueue_preingestion_job on public.listing_image_verifications;
create trigger listing_image_verifications_enqueue_preingestion_job
after insert or update of object_verified, storage_role, asset_id, object_path on public.listing_image_verifications
for each row execute function public.enqueue_preingestion_bundle_job_from_verified_image();
