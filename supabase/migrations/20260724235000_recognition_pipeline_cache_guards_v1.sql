alter table public.listing_identity_resolution_cache
  add column if not exists recognition_pipeline_fingerprint text;

update public.listing_identity_resolution_cache
set recognition_pipeline_fingerprint = coalesce(
  nullif(version_fingerprint, ''),
  'legacy-unversioned:' || cache_key
)
where recognition_pipeline_fingerprint is null;

alter table public.listing_identity_resolution_cache
  alter column recognition_pipeline_fingerprint set not null;

create index if not exists listing_identity_resolution_cache_pipeline_fingerprint_idx
  on public.listing_identity_resolution_cache(recognition_pipeline_fingerprint, cache_status, expires_at desc);

create table if not exists public.listing_active_catalog_snapshot (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 1 check (revision > 0),
  content_revision text not null default 'catalog-revision-1',
  changed_table text,
  changed_operation text,
  updated_at timestamptz not null default clock_timestamp()
);

insert into public.listing_active_catalog_snapshot(singleton, revision, content_revision)
values (true, 1, 'catalog-revision-1')
on conflict (singleton) do nothing;

alter table public.listing_active_catalog_snapshot enable row level security;
revoke all on public.listing_active_catalog_snapshot from public, anon, authenticated;
grant select, insert, update, delete on public.listing_active_catalog_snapshot to service_role;

create or replace function public.bump_active_catalog_snapshot_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and not exists (
    select 1
    from (
      (select to_jsonb(old_rows) as row_data from old_rows
       except all
       select to_jsonb(new_rows) as row_data from new_rows)
      union all
      (select to_jsonb(new_rows) as row_data from new_rows
       except all
       select to_jsonb(old_rows) as row_data from old_rows)
    ) as changed_rows
  ) then
    return null;
  end if;

  insert into public.listing_active_catalog_snapshot(
    singleton,
    revision,
    content_revision,
    changed_table,
    changed_operation,
    updated_at
  ) values (
    true,
    1,
    'catalog-revision-1',
    tg_table_schema || '.' || tg_table_name,
    tg_op,
    clock_timestamp()
  )
  on conflict (singleton) do update
  set revision = public.listing_active_catalog_snapshot.revision + 1,
      content_revision = 'catalog-revision-' || (public.listing_active_catalog_snapshot.revision + 1)::text,
      changed_table = excluded.changed_table,
      changed_operation = excluded.changed_operation,
      updated_at = excluded.updated_at;
  return null;
end;
$$;

revoke all on function public.bump_active_catalog_snapshot_revision() from public, anon, authenticated;
grant execute on function public.bump_active_catalog_snapshot_revision() to service_role;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'catalog_sources',
    'catalog_products',
    'catalog_sets',
    'catalog_cards',
    'catalog_parallels',
    'card_identities',
    'card_reference_images',
    'card_image_embeddings'
  ] loop
    if to_regclass('public.' || target_table) is not null then
      execute format('drop trigger if exists %I on public.%I', 'bump_active_catalog_snapshot_revision', target_table);
      execute format('drop trigger if exists %I on public.%I', 'bump_active_catalog_snapshot_revision_on_update', target_table);
      execute format(
        'create trigger %I after insert or delete or truncate on public.%I for each statement execute function public.bump_active_catalog_snapshot_revision()',
        'bump_active_catalog_snapshot_revision',
        target_table
      );
      execute format(
        'create trigger %I after update on public.%I referencing old table as old_rows new table as new_rows for each statement execute function public.bump_active_catalog_snapshot_revision()',
        'bump_active_catalog_snapshot_revision_on_update',
        target_table
      );
    end if;
  end loop;
end;
$$;

create table if not exists public.listing_writer_final_replay (
  tenant_id text not null,
  image_generation_hash text not null check (image_generation_hash ~ '^[0-9a-f]{64}$'),
  writer_final_title text not null check (char_length(btrim(writer_final_title)) between 1 and 80),
  resolved_fields jsonb not null default '{}'::jsonb,
  field_states jsonb not null default '{}'::jsonb,
  identity_status text,
  ambiguity_status text,
  source_session_id text not null references public.v4_recognition_sessions(id) on delete cascade,
  source_feedback_event_id text,
  replay_status text not null default 'active' check (replay_status in ('active', 'tombstoned')),
  training_eligible boolean not null default false check (training_eligible = false),
  catalog_promotion_eligible boolean not null default false check (catalog_promotion_eligible = false),
  identity_truth boolean not null default false check (identity_truth = false),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, image_generation_hash)
);

alter table public.listing_writer_final_replay enable row level security;
revoke all on public.listing_writer_final_replay from public, anon, authenticated;
grant all on public.listing_writer_final_replay to service_role;

create or replace function public.sync_writer_final_replay_from_session()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  generation_hash text := lower(nullif(new.provider_result_summary ->> 'identity_cache_image_generation_hash', ''));
begin
  if new.status not in ('ACCEPTED', 'EDITED') or nullif(btrim(new.writer_final_title), '') is null then
    return new;
  end if;
  if generation_hash is null or generation_hash !~ '^[0-9a-f]{64}$' then
    return new;
  end if;

  insert into public.listing_writer_final_replay(
    tenant_id,
    image_generation_hash,
    writer_final_title,
    resolved_fields,
    field_states,
    identity_status,
    ambiguity_status,
    source_session_id,
    source_feedback_event_id,
    replay_status,
    training_eligible,
    catalog_promotion_eligible,
    identity_truth,
    updated_at
  ) values (
    new.tenant_id,
    generation_hash,
    btrim(new.writer_final_title),
    coalesce(new.resolved_fields, '{}'::jsonb),
    coalesce(new.field_states, '{}'::jsonb),
    nullif(new.provider_result_summary ->> 'identity_resolution_status', ''),
    nullif(new.provider_result_summary ->> 'ambiguity_status', ''),
    new.id,
    new.writer_feedback_event_id,
    'active',
    false,
    false,
    false,
    clock_timestamp()
  )
  on conflict (tenant_id, image_generation_hash) do update
  set writer_final_title = excluded.writer_final_title,
      resolved_fields = excluded.resolved_fields,
      field_states = excluded.field_states,
      identity_status = excluded.identity_status,
      ambiguity_status = excluded.ambiguity_status,
      source_session_id = excluded.source_session_id,
      source_feedback_event_id = excluded.source_feedback_event_id,
      replay_status = 'active',
      training_eligible = false,
      catalog_promotion_eligible = false,
      identity_truth = false,
      updated_at = excluded.updated_at;
  return new;
end;
$$;

revoke all on function public.sync_writer_final_replay_from_session() from public, anon, authenticated;
grant execute on function public.sync_writer_final_replay_from_session() to service_role;

drop trigger if exists sync_writer_final_replay_from_session on public.v4_recognition_sessions;
create trigger sync_writer_final_replay_from_session
after update of status, writer_final_title, writer_feedback_event_id
on public.v4_recognition_sessions
for each row
when (new.status in ('ACCEPTED', 'EDITED'))
execute function public.sync_writer_final_replay_from_session();

comment on table public.listing_active_catalog_snapshot is
  'Server-only monotonic revision of committed catalog decision state. Recognition cache fingerprints read content_revision automatically.';

comment on table public.listing_writer_final_replay is
  'Tenant-scoped writer-final replay authority for exact verified image generations. Never identity truth, training data, or catalog promotion truth.';
