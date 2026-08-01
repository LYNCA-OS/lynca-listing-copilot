-- COS-25 / CSM stage shadow foundation v1.
--
-- Additive only. This migration does not change the production recognition
-- reader, queue, upload path, provider concurrency, resolver, or renderer.
-- v4_recognition_sessions remains the single run owner. The normalized CSM
-- layer tables are append-only shadow facts linked to that existing run.

create table if not exists public.csm_registry_releases (
  id text primary key,
  registry_version text not null unique,
  content_sha256 text not null,
  sem_standard_version text not null,
  registry_payload jsonb not null default '{}'::jsonb,
  promoted_by text,
  promoted_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint csm_registry_releases_id_check check (id ~ '^registry_[a-zA-Z0-9._:-]{1,120}$'),
  constraint csm_registry_releases_hash_check check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint csm_registry_releases_payload_check check (jsonb_typeof(registry_payload) = 'object')
);

-- The thin path has no external Registry dependency, but the CSM contract
-- requires every resolution to name the exact semantic/rule release it used.
-- Seed that immutable local release before adding/writing any foreign keys.
insert into public.csm_registry_releases (
  id, registry_version, content_sha256, sem_standard_version,
  registry_payload, promoted_by, promoted_at
) values (
  'registry_thin_sem_v25',
  'thin-path-registry-release-v1',
  'ac36d845fe8ca6ad21b017560736864f077fc67a1a864ad9947ac25b8432a6c7',
  'linear-cos-10-23-v25',
  '{"mode":"local_sem_and_composer_only","external_catalog":false}'::jsonb,
  'migration:20260728190000',
  '2026-07-28T19:00:00Z'::timestamptz
)
on conflict (id) do nothing;

alter table public.v4_recognition_sessions
  add column if not exists csm_contract_version text,
  add column if not exists csm_registry_release_id text,
  add column if not exists csm_grammar text,
  add column if not exists csm_grammar_confidence double precision,
  add column if not exists recognition_pipeline_fingerprint text,
  add column if not exists csm_owner_versions jsonb not null default '{}'::jsonb,
  add column if not exists csm_recognition_stage_status text not null default 'NOT_STARTED',
  add column if not exists csm_resolution_stage_status text not null default 'NOT_STARTED',
  add column if not exists csm_composition_stage_status text not null default 'NOT_STARTED',
  add column if not exists csm_recognition_packet_sha256 text,
  add column if not exists csm_resolution_packet_sha256 text,
  add column if not exists csm_marketplace_packet_sha256 text;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.v4_recognition_sessions'::regclass
      and conname = 'v4_sessions_csm_registry_release_fk'
  ) then
    alter table public.v4_recognition_sessions
      add constraint v4_sessions_csm_registry_release_fk
      foreign key (csm_registry_release_id)
      references public.csm_registry_releases(id)
      on delete restrict not valid;
    alter table public.v4_recognition_sessions
      validate constraint v4_sessions_csm_registry_release_fk;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.v4_recognition_sessions'::regclass
      and conname = 'v4_sessions_csm_grammar_check'
  ) then
    alter table public.v4_recognition_sessions
      add constraint v4_sessions_csm_grammar_check
      check (csm_grammar is null or csm_grammar in ('TCG', 'NON_TCG')) not valid;
    alter table public.v4_recognition_sessions
      validate constraint v4_sessions_csm_grammar_check;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.v4_recognition_sessions'::regclass
      and conname = 'v4_sessions_csm_grammar_confidence_check'
  ) then
    alter table public.v4_recognition_sessions
      add constraint v4_sessions_csm_grammar_confidence_check
      check (csm_grammar_confidence is null or csm_grammar_confidence between 0 and 1) not valid;
    alter table public.v4_recognition_sessions
      validate constraint v4_sessions_csm_grammar_confidence_check;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.v4_recognition_sessions'::regclass
      and conname = 'v4_sessions_csm_pipeline_fingerprint_check'
  ) then
    alter table public.v4_recognition_sessions
      add constraint v4_sessions_csm_pipeline_fingerprint_check
      check (
        recognition_pipeline_fingerprint is null
        or recognition_pipeline_fingerprint ~ '^[0-9a-f]{64}$'
      ) not valid;
    alter table public.v4_recognition_sessions
      validate constraint v4_sessions_csm_pipeline_fingerprint_check;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.v4_recognition_sessions'::regclass
      and conname = 'v4_sessions_csm_owner_versions_check'
  ) then
    alter table public.v4_recognition_sessions
      add constraint v4_sessions_csm_owner_versions_check
      check (jsonb_typeof(csm_owner_versions) = 'object') not valid;
    alter table public.v4_recognition_sessions
      validate constraint v4_sessions_csm_owner_versions_check;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.v4_recognition_sessions'::regclass
      and conname = 'v4_sessions_csm_stage_status_check'
  ) then
    alter table public.v4_recognition_sessions
      add constraint v4_sessions_csm_stage_status_check check (
        csm_recognition_stage_status in ('NOT_STARTED', 'RUNNING', 'COMPLETE', 'FAILED')
        and csm_resolution_stage_status in ('NOT_STARTED', 'RUNNING', 'COMPLETE', 'FAILED')
        and csm_composition_stage_status in ('NOT_STARTED', 'RUNNING', 'COMPLETE', 'FAILED')
      ) not valid;
    alter table public.v4_recognition_sessions
      validate constraint v4_sessions_csm_stage_status_check;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.v4_recognition_sessions'::regclass
      and conname = 'v4_sessions_csm_packet_hashes_check'
  ) then
    alter table public.v4_recognition_sessions
      add constraint v4_sessions_csm_packet_hashes_check check (
        (csm_recognition_packet_sha256 is null or csm_recognition_packet_sha256 ~ '^[0-9a-f]{64}$')
        and (csm_resolution_packet_sha256 is null or csm_resolution_packet_sha256 ~ '^[0-9a-f]{64}$')
        and (csm_marketplace_packet_sha256 is null or csm_marketplace_packet_sha256 ~ '^[0-9a-f]{64}$')
      ) not valid;
    alter table public.v4_recognition_sessions
      validate constraint v4_sessions_csm_packet_hashes_check;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.v4_recognition_sessions'::regclass
      and conname = 'v4_sessions_csm_metadata_complete_check'
  ) then
    alter table public.v4_recognition_sessions
      add constraint v4_sessions_csm_metadata_complete_check check (
        csm_contract_version is null
        or (
          csm_registry_release_id is not null
          and csm_grammar is not null
          and csm_grammar_confidence is not null
          and recognition_pipeline_fingerprint is not null
          and csm_owner_versions <> '{}'::jsonb
        )
      ) not valid;
    alter table public.v4_recognition_sessions
      validate constraint v4_sessions_csm_metadata_complete_check;
  end if;
end;
$$;

create table if not exists public.csm_evidence_observations (
  id text primary key,
  tenant_id text not null,
  recognition_session_id text not null,
  contract_version text not null,
  bracket text not null,
  raw_value jsonb not null default 'null'::jsonb,
  normalized_value jsonb not null default 'null'::jsonb,
  modality text not null,
  source_ref jsonb not null default '{}'::jsonb,
  observation_confidence double precision not null,
  normalization_version text not null,
  normalization_outcome text not null,
  normalization_reason_code text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint csm_evidence_session_fk foreign key (tenant_id, recognition_session_id)
    references public.v4_recognition_sessions(tenant_id, id) on delete cascade,
  constraint csm_evidence_bracket_check check (bracket in (
    'year', 'ip_sport', 'language', 'manufacturer', 'product', 'set', 'subject',
    'card_name', 'card_number', 'descriptive_rarity', 'numerical_rarity',
    'release_variant', 'print_finish', 'special_stamp', 'grading_info',
    'description', 'search_optimization'
  )),
  constraint csm_evidence_modality_check check (modality in (
    'WHOLE_CARD_VISUAL', 'CARD_TEXT_OCR', 'SLAB_LABEL', 'REGISTRY'
  )),
  constraint csm_evidence_confidence_check check (observation_confidence between 0 and 1),
  constraint csm_evidence_normalization_check check (
    normalization_outcome in ('KEPT', 'DROPPED')
    and (normalization_outcome <> 'KEPT' or normalized_value <> 'null'::jsonb)
  ),
  constraint csm_evidence_source_ref_check check (jsonb_typeof(source_ref) = 'object'),
  constraint csm_evidence_tenant_id_id_session_key unique (tenant_id, id, recognition_session_id)
);

create table if not exists public.csm_bracket_candidates (
  id text primary key,
  tenant_id text not null,
  recognition_session_id text not null,
  contract_version text not null,
  bracket text not null,
  value_kind text not null,
  canonical_value jsonb not null default 'null'::jsonb,
  empty_reason text,
  source_trust text not null,
  candidate_confidence double precision not null,
  candidate_rank integer,
  created_at timestamptz not null default clock_timestamp(),
  constraint csm_candidate_session_fk foreign key (tenant_id, recognition_session_id)
    references public.v4_recognition_sessions(tenant_id, id) on delete cascade,
  constraint csm_candidate_bracket_check check (bracket in (
    'year', 'ip_sport', 'language', 'manufacturer', 'product', 'set', 'subject',
    'card_name', 'card_number', 'descriptive_rarity', 'numerical_rarity',
    'release_variant', 'print_finish', 'special_stamp', 'grading_info',
    'description', 'search_optimization'
  )),
  constraint csm_candidate_value_check check (
    (value_kind = 'VALUE' and canonical_value <> 'null'::jsonb and empty_reason is null)
    or (
      value_kind = 'EMPTY'
      and canonical_value = 'null'::jsonb
      and empty_reason in ('ABSENT', 'INSUFFICIENT_EVIDENCE')
    )
  ),
  constraint csm_candidate_confidence_check check (candidate_confidence between 0 and 1),
  constraint csm_candidate_rank_check check (candidate_rank is null or candidate_rank >= 1),
  constraint csm_candidate_tenant_id_id_session_key unique (tenant_id, id, recognition_session_id)
);

create table if not exists public.csm_candidate_evidence_links (
  tenant_id text not null,
  recognition_session_id text not null,
  candidate_id text not null,
  evidence_observation_id text not null,
  relationship text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (candidate_id, evidence_observation_id, relationship),
  constraint csm_candidate_link_candidate_fk foreign key (
    tenant_id, candidate_id, recognition_session_id
  ) references public.csm_bracket_candidates(tenant_id, id, recognition_session_id)
    on delete cascade,
  constraint csm_candidate_link_evidence_fk foreign key (
    tenant_id, evidence_observation_id, recognition_session_id
  ) references public.csm_evidence_observations(tenant_id, id, recognition_session_id)
    on delete cascade,
  constraint csm_candidate_link_relationship_check check (
    relationship in ('SUPPORTS', 'CONTRADICTS')
  )
);

create table if not exists public.csm_identity_resolutions (
  id text primary key,
  tenant_id text not null,
  recognition_session_id text not null,
  contract_version text not null,
  revision integer not null,
  grammar text not null,
  registry_release_id text not null references public.csm_registry_releases(id) on delete restrict,
  resolver_version text not null,
  conflict_policy_version text not null,
  recognition_packet_sha256 text not null,
  resolution_status text not null default 'COMPLETE',
  created_at timestamptz not null default clock_timestamp(),
  constraint csm_resolution_session_fk foreign key (tenant_id, recognition_session_id)
    references public.v4_recognition_sessions(tenant_id, id) on delete cascade,
  constraint csm_resolution_revision_check check (revision >= 1),
  constraint csm_resolution_grammar_check check (grammar in ('TCG', 'NON_TCG')),
  constraint csm_resolution_packet_hash_check check (recognition_packet_sha256 ~ '^[0-9a-f]{64}$'),
  constraint csm_resolution_status_check check (resolution_status = 'COMPLETE'),
  constraint csm_resolution_session_revision_key unique (recognition_session_id, revision),
  constraint csm_resolution_tenant_id_id_session_key unique (tenant_id, id, recognition_session_id)
);

create table if not exists public.csm_resolved_brackets (
  tenant_id text not null,
  recognition_session_id text not null,
  resolution_id text not null,
  bracket text not null,
  selected_kind text not null,
  canonical_value jsonb not null default 'null'::jsonb,
  empty_reason text,
  selected_candidate_id text,
  alternate_candidate_ids jsonb not null default '[]'::jsonb,
  rationale_codes jsonb not null default '[]'::jsonb,
  semantic_confidence double precision not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (resolution_id, bracket),
  constraint csm_resolved_bracket_resolution_fk foreign key (
    tenant_id, resolution_id, recognition_session_id
  ) references public.csm_identity_resolutions(tenant_id, id, recognition_session_id)
    on delete cascade,
  constraint csm_resolved_bracket_candidate_fk foreign key (
    tenant_id, selected_candidate_id, recognition_session_id
  ) references public.csm_bracket_candidates(tenant_id, id, recognition_session_id)
    on delete restrict,
  constraint csm_resolved_bracket_name_check check (bracket in (
    'year', 'ip_sport', 'language', 'manufacturer', 'product', 'set', 'subject',
    'card_name', 'card_number', 'descriptive_rarity', 'numerical_rarity',
    'release_variant', 'print_finish', 'special_stamp', 'grading_info',
    'description', 'search_optimization'
  )),
  constraint csm_resolved_bracket_value_check check (
    (
      selected_kind = 'VALUE'
      and canonical_value <> 'null'::jsonb
      and empty_reason is null
      and selected_candidate_id is not null
    )
    or (
      selected_kind = 'EMPTY'
      and canonical_value = 'null'::jsonb
      and empty_reason in ('ABSENT', 'INSUFFICIENT_EVIDENCE')
      and selected_candidate_id is null
    )
  ),
  constraint csm_resolved_bracket_alternates_check check (
    jsonb_typeof(alternate_candidate_ids) = 'array'
  ),
  constraint csm_resolved_bracket_rationale_check check (
    jsonb_typeof(rationale_codes) = 'array' and jsonb_array_length(rationale_codes) > 0
  ),
  constraint csm_resolved_bracket_confidence_check check (semantic_confidence between 0 and 1)
);

create table if not exists public.csm_marketplace_outputs (
  id text primary key,
  tenant_id text not null,
  recognition_session_id text not null,
  resolution_id text not null,
  contract_version text not null,
  marketplace text not null,
  composer_version text not null,
  marketplace_profile_version text not null,
  resolution_packet_sha256 text not null,
  title text not null,
  structured_output jsonb not null default '{}'::jsonb,
  included_brackets jsonb not null default '[]'::jsonb,
  dropped_trace jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint csm_marketplace_resolution_fk foreign key (
    tenant_id, resolution_id, recognition_session_id
  ) references public.csm_identity_resolutions(tenant_id, id, recognition_session_id)
    on delete cascade,
  constraint csm_marketplace_kind_check check (marketplace = 'EBAY'),
  constraint csm_marketplace_packet_hash_check check (resolution_packet_sha256 ~ '^[0-9a-f]{64}$'),
  constraint csm_marketplace_title_check check (char_length(title) between 1 and 80),
  constraint csm_marketplace_structured_check check (
    jsonb_typeof(structured_output) = 'object'
    and not structured_output ?| array[
      'evidence', 'candidates', 'provider_response', 'raw_model_response'
    ]
  ),
  constraint csm_marketplace_included_check check (jsonb_typeof(included_brackets) = 'array'),
  constraint csm_marketplace_dropped_check check (jsonb_typeof(dropped_trace) = 'array')
);

create index if not exists csm_evidence_session_bracket_idx
  on public.csm_evidence_observations(tenant_id, recognition_session_id, bracket);
create index if not exists csm_candidates_session_bracket_rank_idx
  on public.csm_bracket_candidates(tenant_id, recognition_session_id, bracket, candidate_rank);
create index if not exists csm_candidate_links_session_idx
  on public.csm_candidate_evidence_links(tenant_id, recognition_session_id);
create index if not exists csm_resolutions_session_revision_idx
  on public.csm_identity_resolutions(tenant_id, recognition_session_id, revision desc);
create index if not exists csm_marketplace_session_idx
  on public.csm_marketplace_outputs(tenant_id, recognition_session_id, created_at desc);

create or replace function private.validate_csm_stage_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    new.csm_recognition_stage_status <> 'NOT_STARTED'
    or new.csm_resolution_stage_status <> 'NOT_STARTED'
    or new.csm_composition_stage_status <> 'NOT_STARTED'
  ) and new.csm_contract_version is null then
    raise exception using errcode = '23514', message = 'csm_contract_metadata_required_before_stage_start';
  end if;

  if new.csm_resolution_stage_status in ('RUNNING', 'COMPLETE')
     and new.csm_recognition_stage_status <> 'COMPLETE' then
    raise exception using errcode = '23514', message = 'csm_resolution_requires_recognition_complete';
  end if;

  if new.csm_composition_stage_status in ('RUNNING', 'COMPLETE')
     and new.csm_resolution_stage_status <> 'COMPLETE' then
    raise exception using errcode = '23514', message = 'csm_composition_requires_resolution_complete';
  end if;

  if new.csm_recognition_stage_status = 'COMPLETE'
     and new.csm_recognition_packet_sha256 is null then
    raise exception using errcode = '23514', message = 'csm_recognition_packet_hash_required';
  end if;

  if new.csm_resolution_stage_status = 'COMPLETE'
     and new.csm_resolution_packet_sha256 is null then
    raise exception using errcode = '23514', message = 'csm_resolution_packet_hash_required';
  end if;

  if new.csm_composition_stage_status = 'COMPLETE'
     and new.csm_marketplace_packet_sha256 is null then
    raise exception using errcode = '23514', message = 'csm_marketplace_packet_hash_required';
  end if;

  if tg_op = 'UPDATE' then
    if old.csm_recognition_stage_status = 'COMPLETE'
       and new.csm_recognition_stage_status <> 'COMPLETE' then
      raise exception using errcode = '23514', message = 'csm_recognition_stage_cannot_regress';
    end if;
    if old.csm_resolution_stage_status = 'COMPLETE'
       and new.csm_resolution_stage_status <> 'COMPLETE' then
      raise exception using errcode = '23514', message = 'csm_resolution_stage_cannot_regress';
    end if;
    if old.csm_composition_stage_status = 'COMPLETE'
       and new.csm_composition_stage_status <> 'COMPLETE' then
      raise exception using errcode = '23514', message = 'csm_composition_stage_cannot_regress';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.validate_csm_stage_transition()
  from public, anon, authenticated;
grant execute on function private.validate_csm_stage_transition()
  to service_role;

drop trigger if exists validate_csm_stage_transition
  on public.v4_recognition_sessions;
create trigger validate_csm_stage_transition
before insert or update of
  csm_recognition_stage_status,
  csm_resolution_stage_status,
  csm_composition_stage_status,
  csm_recognition_packet_sha256,
  csm_resolution_packet_sha256,
  csm_marketplace_packet_sha256
on public.v4_recognition_sessions
for each row execute function private.validate_csm_stage_transition();

create or replace function private.prevent_csm_shadow_fact_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'csm_shadow_facts_are_append_only';
end;
$$;

revoke all on function private.prevent_csm_shadow_fact_mutation()
  from public, anon, authenticated;
grant execute on function private.prevent_csm_shadow_fact_mutation()
  to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'csm_registry_releases',
    'csm_evidence_observations',
    'csm_bracket_candidates',
    'csm_candidate_evidence_links',
    'csm_identity_resolutions',
    'csm_resolved_brackets',
    'csm_marketplace_outputs'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated', table_name);
    execute format('grant select, insert on table public.%I to service_role', table_name);
    execute format('drop trigger if exists prevent_csm_shadow_fact_mutation on public.%I', table_name);
    execute format(
      'create trigger prevent_csm_shadow_fact_mutation before update or delete on public.%I for each row execute function private.prevent_csm_shadow_fact_mutation()',
      table_name
    );
  end loop;
end;
$$;

comment on table public.csm_evidence_observations is
  'Append-only CSM raw/normalized observation layer. Observation confidence is not semantic confidence.';
comment on table public.csm_bracket_candidates is
  'Append-only Recognition Worker candidate layer. Candidate values are not canonical truth.';
comment on table public.csm_identity_resolutions is
  'Append-only Identity Resolver revision header; canonical bracket rows live in csm_resolved_brackets.';
comment on table public.csm_marketplace_outputs is
  'Append-only marketplace projection from a completed canonical resolution; never the canonical identity.';
;
