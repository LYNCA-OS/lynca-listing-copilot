-- Manual work recorded after a recognition failure. COS-51.
--
-- The deadlock this ends: a card whose recognition failed has no
-- `recognition_session_id`, every writer persistence path required one, so an
-- operator could type a perfectly good title and have nowhere to put it. The
-- card could not leave its position and the rest of the batch was unreachable.
--
-- The fix is NOT to relax the AI feedback contract. A title typed after a
-- failure is commercial output, not evidence about a model that never
-- answered -- there is no generated title to compare it against and no
-- resolved fields it approves. Feeding it back as AI feedback would teach the
-- flywheel from a case the model never saw.
--
-- So this is a separate ledger with the opposite defaults: never semantic
-- truth, never training-eligible, no canonical-field approval. It exists to
-- let the transaction be acknowledged and the queue advance, and to keep an
-- audit trail of what the operator did when the system could not help them.

create table if not exists public.listing_manual_recovery_records (
  id uuid primary key default gen_random_uuid(),
  schema_version text not null,
  tenant_id text not null,

  -- The durable asset, NOT a recognition session. That is the whole point:
  -- the asset survives a failed recognition and the session does not exist.
  asset_id text not null,
  client_asset_ref text not null default '',

  -- What failed, so a later reader can tell an operator working around a
  -- storage collision from one working around a provider outage.
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

  -- Stored as columns rather than left implicit, so a query that joins this
  -- table into a training set has to actively ignore them to get it wrong.
  training_eligible boolean not null default false,
  semantic_truth boolean not null default false,
  canonical_fields_approved boolean not null default false,

  -- A saved recovery must carry a title; a rejection must not invent one.
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

-- Append-only at the database. An operator correcting their own workaround
-- writes a new row; the record of what they first did is not editable.
create or replace rule listing_manual_recovery_no_update as
  on update to public.listing_manual_recovery_records do instead nothing;
create or replace rule listing_manual_recovery_no_delete as
  on delete to public.listing_manual_recovery_records do instead nothing;

comment on table public.listing_manual_recovery_records is
  'COS-51 manual-after-failure ledger. Keyed on the durable asset, never on a recognition session. Append-only; never semantic truth and never training-eligible, enforced by check constraints rather than by convention.';
