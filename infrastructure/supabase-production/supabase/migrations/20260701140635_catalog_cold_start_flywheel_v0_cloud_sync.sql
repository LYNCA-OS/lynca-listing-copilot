alter table public.catalog_gap_queue
  add column if not exists source_batch text not null default '',
  add column if not exists query_image_ids text[] not null default '{}'::text[],
  add column if not exists ai_draft_title text,
  add column if not exists observed_fields jsonb not null default '{}'::jsonb,
  add column if not exists unresolved_fields text[] not null default '{}'::text[],
  add column if not exists high_risk_fields text[] not null default '{}'::text[],
  add column if not exists external_retrieval_hints jsonb not null default '[]'::jsonb,
  add column if not exists marketplace_hints jsonb not null default '[]'::jsonb,
  add column if not exists reason text,
  add column if not exists cold_start_status text
    check (
      cold_start_status is null
      or cold_start_status in (
        'SAFE_DRAFT_READY',
        'WRITER_REVIEW_REQUIRED',
        'DEEP_RESEARCH_REQUIRED',
        'CATALOG_GAP_REQUIRED',
        'MARKETPLACE_HINTS_ONLY',
        'NO_APPROVED_CATALOG_MATCH'
      )
    ),
  add column if not exists writer_action_required boolean not null default true,
  add column if not exists writer_final_title text,
  add column if not exists writer_confirmed_fields jsonb,
  add column if not exists promoted_catalog_identity_id uuid references public.card_identities(identity_id) on delete set null,
  add column if not exists promotion_status text not null default 'pending'
    check (promotion_status in ('pending', 'approved', 'rejected', 'promoted', 'merged')),
  add column if not exists training_eligible boolean not null default false;

create index if not exists catalog_gap_queue_cold_start_status_idx
  on public.catalog_gap_queue(cold_start_status, promotion_status, created_at desc)
  where cold_start_status is not null;

create index if not exists catalog_gap_queue_promoted_identity_idx
  on public.catalog_gap_queue(promoted_catalog_identity_id)
  where promoted_catalog_identity_id is not null;

comment on column public.catalog_gap_queue.source_batch is
  'External/source batch identifier for image-only cold-start intake. This does not imply reviewed ground truth.';

comment on column public.catalog_gap_queue.query_image_ids is
  'Image ids used as the query evidence for cold-start catalog gap review.';

comment on column public.catalog_gap_queue.ai_draft_title is
  'Image-only AI safe draft title awaiting writer confirmation; not training data until reviewed.';

comment on column public.catalog_gap_queue.external_retrieval_hints is
  'Ephemeral external weak hints for writer review. Marketplace or web hints are never approved truth.';

comment on column public.catalog_gap_queue.marketplace_hints is
  'Marketplace metadata kept as weak reviewer context only, never catalog ground truth.';

comment on column public.catalog_gap_queue.training_eligible is
  'False for tests and marketplace imports by default. Set true only after writer-reviewed promotion policy allows training.';

create or replace function public.sync_catalog_gap_cold_start_promotion_fields()
returns trigger
language plpgsql
as $$
begin
  if new.resolved_identity_id is not null and new.status in ('approved', 'merged') then
    new.promoted_catalog_identity_id := coalesce(new.promoted_catalog_identity_id, new.resolved_identity_id);
    new.promotion_status := case
      when new.promotion_status in ('promoted', 'merged') then new.promotion_status
      when new.status = 'merged' then 'merged'
      else 'promoted'
    end;
    new.writer_action_required := false;
    new.cold_start_status := coalesce(new.cold_start_status, 'SAFE_DRAFT_READY');
  end if;
  return new;
end;
$$;

drop trigger if exists catalog_gap_queue_sync_cold_start_promotion_fields
  on public.catalog_gap_queue;

create trigger catalog_gap_queue_sync_cold_start_promotion_fields
before update on public.catalog_gap_queue
for each row
when (
  old.status is distinct from new.status
  or old.resolved_identity_id is distinct from new.resolved_identity_id
  or old.promoted_catalog_identity_id is distinct from new.promoted_catalog_identity_id
)
execute function public.sync_catalog_gap_cold_start_promotion_fields();

revoke all on function public.sync_catalog_gap_cold_start_promotion_fields() from public, anon, authenticated;
grant execute on function public.sync_catalog_gap_cold_start_promotion_fields() to service_role;

comment on function public.sync_catalog_gap_cold_start_promotion_fields() is
  'Keeps cold-start catalog gap promotion columns synchronized in the same transaction as promote_card_reference_to_approved gap updates.';

alter table public.catalog_gap_queue
  add column if not exists image_ids text[] not null default '{}'::text[],
  add column if not exists internal_candidates jsonb not null default '[]'::jsonb,
  add column if not exists official_candidates jsonb not null default '[]'::jsonb,
  add column if not exists external_candidates jsonb not null default '[]'::jsonb,
  add column if not exists selected_candidate_id text,
  add column if not exists rejected_candidate_ids text[] not null default '{}'::text[],
  add column if not exists field_diff jsonb not null default '[]'::jsonb,
  add column if not exists review_time_ms integer check (review_time_ms is null or review_time_ms >= 0);

alter table public.catalog_gap_queue
  drop constraint if exists catalog_gap_queue_cold_start_status_check;

alter table public.catalog_gap_queue
  add constraint catalog_gap_queue_cold_start_status_check
  check (
    cold_start_status is null
    or cold_start_status in (
      'EXACT_INTERNAL_MATCH',
      'OFFICIAL_CHECKLIST_MATCH',
      'EXTERNAL_DIRECTORY_CANDIDATES_ONLY',
      'MARKETPLACE_HINTS_ONLY',
      'SAFE_DRAFT_READY',
      'WRITER_REVIEW_REQUIRED',
      'DEEP_RESEARCH_REQUIRED',
      'CATALOG_GAP_REQUIRED',
      'NO_APPROVED_CATALOG_MATCH'
    )
  );

create index if not exists catalog_gap_queue_selected_candidate_idx
  on public.catalog_gap_queue(selected_candidate_id)
  where selected_candidate_id is not null;

create index if not exists catalog_gap_queue_external_candidates_gin_idx
  on public.catalog_gap_queue using gin (external_candidates);

create table if not exists public.catalog_flywheel_hard_negatives (
  hard_negative_id uuid primary key default gen_random_uuid(),
  query_card_id text not null,
  correct_identity_id text,
  wrong_candidate_id text not null,
  wrong_candidate_source_trust text,
  error_type text not null
    check (error_type in (
      'writer_rejected_candidate',
      'top1_wrong_correct_in_topk',
      'high_similarity_direct_conflict',
      'catalog_correct_not_selected',
      'safe_assist_near_conflict',
      'other'
    )),
  similarity_features jsonb not null default '{}'::jsonb,
  matched_fields jsonb not null default '{}'::jsonb,
  conflicting_fields jsonb not null default '[]'::jsonb,
  writer_resolution text,
  reviewed_by text,
  training_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists catalog_flywheel_hard_negatives_query_idx
  on public.catalog_flywheel_hard_negatives(query_card_id, created_at desc);

create index if not exists catalog_flywheel_hard_negatives_wrong_candidate_idx
  on public.catalog_flywheel_hard_negatives(wrong_candidate_id, created_at desc);

alter table public.catalog_flywheel_hard_negatives enable row level security;

revoke all on table public.catalog_flywheel_hard_negatives from public, anon, authenticated;
grant select, insert, update, delete on table public.catalog_flywheel_hard_negatives to service_role;

comment on column public.catalog_gap_queue.internal_candidates is
  'Reviewed internal candidates available during cold-start. Only reviewed/writer-confirmed data can be promoted.';

comment on column public.catalog_gap_queue.official_candidates is
  'Official checklist candidates used as legality support, not marketplace title truth.';

comment on column public.catalog_gap_queue.external_candidates is
  'Licensed external-directory candidates for candidate generation, legality checks, alias learning, reranker features, and writer reference. Never direct title truth.';

comment on column public.catalog_gap_queue.selected_candidate_id is
  'Candidate selected by a writer during confirmation. Selection alone does not promote without writer-confirmed fields/title.';

comment on column public.catalog_gap_queue.rejected_candidate_ids is
  'Candidates explicitly rejected by a writer; used to generate hard negatives after review.';

comment on column public.catalog_gap_queue.field_diff is
  'Field-level diff between AI observed fields and writer-confirmed fields.';

comment on table public.catalog_flywheel_hard_negatives is
  'Server-only hard negative store generated from writer-reviewed catalog cold-start decisions. Marketplace/eBay tests are training-ineligible unless explicitly reviewed and allowed.';;
