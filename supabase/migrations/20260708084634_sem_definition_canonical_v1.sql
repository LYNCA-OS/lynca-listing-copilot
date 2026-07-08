create table if not exists public.sem_definitions (
  id text primary key,
  version text not null,
  status text not null default 'canonical',
  source text not null,
  definition jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sem_definitions enable row level security;

revoke all on table public.sem_definitions from public, anon, authenticated;
grant select, insert, update, delete on table public.sem_definitions to service_role;

insert into public.sem_definitions (
  id,
  version,
  status,
  source,
  definition,
  updated_at
) values (
  'lynca_sem_canonical_v1',
  'linear-cos-10-14-v1',
  'canonical',
  'LINEAR_COS_10_TO_COS_14',
  '{
    "marketplace_title_limit": 80,
    "linear_issues": ["COS-10", "COS-11", "COS-12", "COS-13", "COS-14"],
    "title_orders": {
      "standard": ["year", "manufacturer", "product", "set", "subject", "card_name", "release_variant", "print_finish", "numerical_rarity", "descriptive_rarity", "card_number", "search_optimization", "grading_info"],
      "tcg": ["year", "ip", "language", "manufacturer", "product", "set", "subject", "card_name", "card_number", "descriptive_rarity", "numerical_rarity", "variant", "product_finish", "special_stamp", "grading_info", "description", "search_optimization"],
      "lot": ["lot_quantity", "year", "manufacturer_product_set", "subjects_max_3", "shared_card_name_or_design", "shared_print_finish", "shared_numerical_rarity", "search_optimization"]
    },
    "boundaries": {
      "card_number": "Printed design, checklist, set, or card-type identifier. Low priority in non-TCG; identity anchor in TCG.",
      "numerical_rarity": "Current-card print-limit serialization such as 2/3, 15/150, #/50, or 1/1.",
      "catalog_assist": "Catalog evidence is trusted only after current-image anchor agreement and zero material conflicts.",
      "observation_fusion": "Recognition/OCR/retrieval output observed candidates and evidence patches, not resolved semantic truth.",
      "commercial_feedback": "Writer edits are commercial feedback first; semantic learning requires later extraction or field review.",
      "lot_workflow": "Multiple separate cards route to Lot grammar instead of a failed single-card identity."
    }
  }'::jsonb,
  now()
)
on conflict (id) do update set
  version = excluded.version,
  status = excluded.status,
  source = excluded.source,
  definition = excluded.definition,
  updated_at = now();

alter table if exists public.v4_writer_feedback_events
  add column if not exists sem_standard_version text not null default 'linear-cos-10-14-v1';

alter table if exists public.v4_learning_events
  add column if not exists sem_standard_version text not null default 'linear-cos-10-14-v1',
  add column if not exists feedback_layer text not null default 'COMMERCIAL_FEEDBACK',
  add column if not exists semantic_learning_status text not null default 'TRAINING_CANDIDATE_FROM_WRITER_TITLE',
  add column if not exists semantic_truth boolean not null default false,
  add column if not exists writer_semantic_label_required boolean not null default false;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'v4_learning_events'
  ) then
    create index if not exists v4_learning_events_sem_standard_idx
      on public.v4_learning_events(sem_standard_version, feedback_layer, semantic_learning_status);
  end if;
end $$;

comment on table public.sem_definitions is
  'Server-side SEM definition registry. Current canonical version comes from Linear COS-10 to COS-14 and is not public frontend configuration.';

comment on column public.v4_learning_events.feedback_layer is
  'Commercial feedback is writer title behavior. It is not semantic truth unless separately promoted or field-reviewed.';
