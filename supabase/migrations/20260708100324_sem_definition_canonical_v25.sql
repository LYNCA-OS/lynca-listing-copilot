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
  'linear-cos-10-23-v25',
  'canonical',
  'LINEAR_COS_10_TO_COS_23',
  '{
    "marketplace_title_limit": 80,
    "linear_issues": ["COS-10", "COS-11", "COS-12", "COS-13", "COS-14", "COS-20", "COS-21", "COS-22", "COS-23"],
    "canonical_editable_fields": ["year", "ip_sport", "language", "manufacturer", "product", "set", "subject", "card_name", "card_number", "descriptive_rarity", "numerical_rarity", "release_variant", "print_finish", "special_stamp", "grading_info", "description", "search_optimization"],
    "candidate_control_plane": {
      "participation_levels": ["LEVEL_0_SHADOW", "LEVEL_1_PROMPT_ASSIST", "LEVEL_2_EVIDENCE_SUPPORT", "LEVEL_3_FIELD_APPLICATION"],
      "field_permissions": ["can_apply", "support_only", "suggest_only", "forbidden"],
      "policy": "Candidates are auditable evidence. Identity Resolution owns resolved semantic fields; Renderer consumes resolved fields only."
    },
    "governance": {
      "default_mode": "boundary_first_not_field_expansion_first",
      "implementation_terms": ["serial_number", "serial_denominator", "print_run_number", "print_run_numerator", "print_run_denominator", "numbered_to", "fast_scout", "candidate_control_plane", "participation_level", "l1_shadow", "provider_slot"]
    },
    "title_orders": {
      "standard": ["year", "manufacturer", "product", "set", "subject", "card_name", "release_variant", "print_finish", "numerical_rarity", "descriptive_rarity", "card_number", "search_optimization", "grading_info"],
      "tcg": ["year", "ip", "language", "manufacturer", "product", "set", "subject", "card_name", "card_number", "descriptive_rarity", "numerical_rarity", "variant", "product_finish", "special_stamp", "grading_info", "description", "search_optimization"],
      "lot": ["lot_quantity", "year", "manufacturer_product_set", "subjects_max_3", "shared_card_name_or_design", "shared_print_finish", "shared_numerical_rarity", "search_optimization"]
    },
    "boundaries": {
      "card_number": "Printed design, checklist, set, or card-type identifier. Low priority in non-TCG; identity anchor in TCG.",
      "numerical_rarity": "CSM field for production quantity or limited-numbering semantics. Implementation may store supporting evidence as print_run_* or serial_* aliases.",
      "catalog_assist": "Catalog evidence is trusted only after current-image anchor agreement and zero material conflicts.",
      "observation_fusion": "Recognition/OCR/retrieval output observed candidates and evidence patches, not resolved semantic truth.",
      "commercial_feedback": "Writer edits are commercial feedback first; semantic learning requires later extraction or field review.",
      "lot_workflow": "Multiple separate cards route to Lot grammar instead of a failed single-card identity.",
      "writer_visible_boundary": "Production writers see loading/progress and L2 complete title drafts only. L0, internal scout, L1 shadow, raw candidates, and learning artifacts remain internal.",
      "release_gate": "V4 release requires both CSM field-level quality and production queue readiness, not title proxy recall alone."
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
  alter column sem_standard_version set default 'linear-cos-10-23-v25';

alter table if exists public.v4_learning_events
  alter column sem_standard_version set default 'linear-cos-10-23-v25';

comment on table public.sem_definitions is
  'Server-side SEM definition registry. Current canonical version comes from Linear COS-10 to COS-23 and is not public frontend configuration.';

comment on column public.v4_learning_events.feedback_layer is
  'Commercial feedback is writer title behavior. It is not semantic truth unless separately promoted or field-reviewed.';
