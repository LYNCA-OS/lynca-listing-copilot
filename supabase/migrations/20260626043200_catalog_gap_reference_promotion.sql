create table if not exists public.catalog_gap_queue (
  gap_id uuid primary key default gen_random_uuid(),
  source_feedback_id uuid,
  asset_id text,
  physical_card_id text,
  proposed_identity_fields jsonb not null default '{}'::jsonb,
  proposed_instance_fields jsonb not null default '{}'::jsonb,
  gap_reason text not null default 'no_exact_match'
    check (gap_reason in (
      'new_identity',
      'no_exact_match',
      'catalog_conflict',
      'reference_needed',
      'field_review_needed',
      'other'
    )),
  status text not null default 'open'
    check (status in ('open', 'in_review', 'approved', 'rejected', 'merged')),
  resolved_identity_id uuid references public.card_identities(identity_id) on delete set null,
  reviewed_by text,
  reviewer_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.card_reference_promotion_events (
  promotion_event_id uuid primary key default gen_random_uuid(),
  identity_id uuid references public.card_identities(identity_id) on delete set null,
  reference_image_id uuid references public.card_reference_images(reference_image_id) on delete set null,
  source_gap_id uuid references public.catalog_gap_queue(gap_id) on delete set null,
  source_feedback_id uuid,
  action text not null
    check (action in (
      'promote_new_identity',
      'attach_reference_to_existing_identity',
      'approve_reference_image',
      'reject_reference_image',
      'merge_identity'
    )),
  actor text,
  before_status text,
  after_status text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists catalog_gap_queue_status_created_idx
  on public.catalog_gap_queue(status, gap_reason, created_at desc);

create index if not exists catalog_gap_queue_feedback_idx
  on public.catalog_gap_queue(source_feedback_id)
  where source_feedback_id is not null;

create index if not exists card_reference_promotion_events_identity_idx
  on public.card_reference_promotion_events(identity_id, created_at desc)
  where identity_id is not null;

alter table public.catalog_gap_queue enable row level security;
alter table public.card_reference_promotion_events enable row level security;

revoke all on table public.catalog_gap_queue from anon, authenticated;
revoke all on table public.card_reference_promotion_events from anon, authenticated;
grant select, insert, update, delete on table public.catalog_gap_queue to service_role;
grant select, insert, update, delete on table public.card_reference_promotion_events to service_role;

comment on table public.catalog_gap_queue is
  'Server-only queue for writer-reviewed catalog gaps. Corrected titles are hints only; approved field labels must be supplied before promotion.';

comment on table public.card_reference_promotion_events is
  'Audit log for promoting a writer-reviewed card into a catalog identity or adding a new approved reference image to an existing identity.';
