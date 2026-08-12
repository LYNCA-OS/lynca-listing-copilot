-- COS-59 Collectible Semantic State v1, audit-only extension.
--
-- Additive only. This table does not activate a writer, provider call, title
-- projection, trigger on the live recognition session, or read-path change.
-- A separately reviewed release must wire any producer after grounded-
-- understanding evidence passes; until then the schema is inert.

create table if not exists public.csm_collectible_semantic_state_audits (
  id text primary key,
  tenant_id text not null,
  recognition_session_id text not null,
  resolution_id text not null,
  state_revision integer not null default 1,

  schema_version text not null,
  harness_version text not null,
  source_inventory_sha256 text not null,
  semantic_state_sha256 text not null,
  semantic_state jsonb not null,

  activation_mode text not null default 'AUDIT_ONLY',
  provider_calls_added integer not null default 0,
  writer_projection_active boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),

  constraint csm_semantic_state_audit_id_check
    check (id ~ '^cssaud_[a-zA-Z0-9._:-]{1,120}$'),
  constraint csm_semantic_state_audit_session_fk foreign key (
    tenant_id, recognition_session_id
  ) references public.v4_recognition_sessions(tenant_id, id) on delete restrict,
  constraint csm_semantic_state_audit_resolution_fk foreign key (
    tenant_id, resolution_id, recognition_session_id
  ) references public.csm_identity_resolutions(tenant_id, id, recognition_session_id)
    on delete restrict,
  constraint csm_semantic_state_audit_revision_check check (state_revision >= 1),
  constraint csm_semantic_state_audit_version_check check (
    schema_version = 'collectible-semantic-state-v1'
    and harness_version = 'frontier-model-csm-harness-v1'
  ),
  constraint csm_semantic_state_audit_hash_check check (
    source_inventory_sha256 ~ '^[0-9a-f]{64}$'
    and semantic_state_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint csm_semantic_state_audit_payload_check check (
    jsonb_typeof(semantic_state) = 'object'
    and semantic_state ->> 'schema_version' = schema_version
    and semantic_state ->> 'source_inventory_sha256' = source_inventory_sha256
    and not semantic_state ?| array[
      'title', 'marketplace_output', 'private_reasoning', 'chain_of_thought'
    ]
  ),
  constraint csm_semantic_state_audit_inert_check check (
    activation_mode = 'AUDIT_ONLY'
    and provider_calls_added = 0
    and writer_projection_active = false
  ),
  constraint csm_semantic_state_audit_session_revision_key unique (
    tenant_id, recognition_session_id, state_revision
  )
);

create index if not exists csm_semantic_state_audits_resolution_idx
  on public.csm_collectible_semantic_state_audits (
    tenant_id, recognition_session_id, resolution_id, state_revision desc
  );

alter table public.csm_collectible_semantic_state_audits enable row level security;
revoke all on table public.csm_collectible_semantic_state_audits
  from public, anon, authenticated;
revoke all on table public.csm_collectible_semantic_state_audits
  from service_role;
grant select, insert on table public.csm_collectible_semantic_state_audits
  to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.csm_collectible_semantic_state_audits'::regclass
      and tgname = 'prevent_csm_semantic_state_audit_mutation'
      and not tgisinternal
  ) then
    create trigger prevent_csm_semantic_state_audit_mutation
      before update or delete on public.csm_collectible_semantic_state_audits
      for each row execute function private.prevent_csm_shadow_fact_mutation();
  end if;
end;
$$;

comment on table public.csm_collectible_semantic_state_audits is
  'COS-59 append-only audit extension for Collectible Semantic State v1. Inert: zero added provider calls and no Writer projection activation.';
