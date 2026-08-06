-- CSM Glass Box v1: the append-only review ledger. COS-42.
--
-- Reviews are INSERT-only by design. A correction that updated the resolution
-- it corrects would destroy the only record of what the model actually did, and
-- every accuracy number computed afterwards would be measuring a human-edited
-- past. So this table never carries a unique key on (asset, resolution): a
-- repeated decision is a new row, and `revision_sha256` is what lets a reader
-- tell a replay from a fresh judgement.
--
-- The corrected title stored here is always recomposed from corrected FIELDS
-- under a pinned composer version. A reviewer's own wording never enters.

create table if not exists public.csm_resolution_reviews (
  id uuid primary key default gen_random_uuid(),
  schema_version text not null,
  tenant_id text not null,

  -- Which exact facts were reviewed. All required: a review nobody can trace
  -- back to a run is an assertion about a card, not evidence about a system.
  asset_id text not null,
  recognition_session_id text not null,
  resolution_id text not null,
  output_id text not null,

  -- Provenance of the code that produced what was reviewed.
  resolver_version text not null,
  composer_version text not null,
  view_version text not null,

  reviewer_id text not null,
  verdict text not null check (verdict in ('APPROVED', 'CORRECTED', 'UNDECIDED')),
  corrections jsonb not null default '[]'::jsonb,

  -- Both sides kept. The original is never rewritten by the correction.
  original_fields jsonb not null default '{}'::jsonb,
  original_title text not null default '',
  corrected_fields jsonb not null default '{}'::jsonb,
  corrected_title text not null default '',

  -- UNDECIDED is excluded rather than counted as agreement: a reviewer who
  -- could not tell is not evidence that the resolver was right.
  excluded_from_metrics boolean not null default false,
  note text not null default '',
  revision_sha256 text not null,

  reviewed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint csm_review_corrected_has_corrections
    check (verdict <> 'CORRECTED' or jsonb_array_length(corrections) > 0),
  constraint csm_review_approved_has_no_corrections
    check (verdict <> 'APPROVED' or jsonb_array_length(corrections) = 0)
);

create index if not exists csm_resolution_reviews_asset_idx
  on public.csm_resolution_reviews (tenant_id, asset_id, created_at desc);
create index if not exists csm_resolution_reviews_metrics_idx
  on public.csm_resolution_reviews (tenant_id, verdict)
  where excluded_from_metrics = false;

alter table public.csm_resolution_reviews enable row level security;

-- Append-only at the database, not merely by convention in the application.
create or replace rule csm_resolution_reviews_no_update as
  on update to public.csm_resolution_reviews do instead nothing;
create or replace rule csm_resolution_reviews_no_delete as
  on delete to public.csm_resolution_reviews do instead nothing;

comment on table public.csm_resolution_reviews is
  'COS-42 CsmResolutionReview. Append-only; UPDATE and DELETE are rules to nothing. Corrected titles are recomposed from corrected fields, never parsed from a reviewer''s string.';
