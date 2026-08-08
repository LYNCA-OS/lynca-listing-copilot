create table if not exists public.listing_manual_recovery_records (
  id uuid primary key default gen_random_uuid(),
  schema_version text not null,
  tenant_id text not null,

  asset_id text not null,
  client_asset_ref text not null default '',

  failure_code text not null default '',
  failure_stage text not null default '',

  source text not null check (source in (
    'MANUAL_AFTER_RECOGNITION_FAILURE',
    'REJECTED_AFTER_RECOGNITION_FAILURE'
  )),
  manual_title text not null default '',

  operator_id text not null,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  training_eligible boolean not null default false,
  semantic_truth boolean not null default false,
  canonical_fields_approved boolean not null default false,

  constraint listing_manual_recovery_title_required
    check (source <> 'MANUAL_AFTER_RECOGNITION_FAILURE' or length(btrim(manual_title)) > 0),
  constraint listing_manual_recovery_never_training
    check (training_eligible = false),
  constraint listing_manual_recovery_never_truth
    check (semantic_truth = false and canonical_fields_approved = false)
);

create index if not exists listing_manual_recovery_asset_idx
  on public.listing_manual_recovery_records (tenant_id, asset_id, created_at desc);

alter table public.listing_manual_recovery_records enable row level security;

create or replace rule listing_manual_recovery_no_update as
  on update to public.listing_manual_recovery_records do instead nothing;
create or replace rule listing_manual_recovery_no_delete as
  on delete to public.listing_manual_recovery_records do instead nothing;

comment on table public.listing_manual_recovery_records is
  'COS-51 manual-after-failure ledger. Keyed on the durable asset, never on a recognition session. Append-only; never semantic truth and never training-eligible, enforced by check constraints rather than by convention.';;
