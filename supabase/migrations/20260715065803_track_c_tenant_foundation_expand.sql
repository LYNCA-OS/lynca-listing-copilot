-- Track C / Production Engineering: tenant foundation (expand + backfill).
--
-- Rollout contract:
--   * this migration is additive and safe to re-run;
--   * existing customer-generated rows are assigned to tenant_legacy;
--   * the former v4_recognition_jobs.tenant_id scheduler scope is preserved
--     as legacy_scheduler_scope_id before a real tenant_id is introduced;
--   * child writes inherit tenant_id from their parent and reject mismatches;
--   * platform-owned catalog data, sem_definitions, vector index snapshots,
--     and global capacity leases intentionally remain shared infrastructure.
--
-- Do not apply this file directly to production from a workstation. It is
-- committed migration source and must pass the normal preview/rollout gate.

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create table if not exists public.tenants (
  id text primary key default ('tenant_' || replace(gen_random_uuid()::text, '-', '')),
  name text not null,
  plan text not null default 'pilot',
  status text not null default 'ACTIVE',
  disabled_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint tenants_id_format_check check (id ~ '^tenant_[a-z0-9][a-z0-9_-]{0,62}$'),
  constraint tenants_status_check check (status in ('ACTIVE', 'DISABLED')),
  constraint tenants_disabled_state_check check (
    (status = 'ACTIVE' and disabled_at is null)
    or (status = 'DISABLED' and disabled_at is not null)
  )
);

create table if not exists public.users (
  id text primary key default ('user_' || replace(gen_random_uuid()::text, '-', '')),
  auth_user_id uuid,
  legacy_operator_id text,
  email text,
  status text not null default 'ACTIVE',
  session_version bigint not null default 1,
  disabled_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint users_auth_user_id_key unique (auth_user_id),
  constraint users_legacy_operator_id_key unique (legacy_operator_id),
  constraint users_status_check check (status in ('ACTIVE', 'DISABLED')),
  constraint users_session_version_check check (session_version >= 1),
  constraint users_disabled_state_check check (
    (status = 'ACTIVE' and disabled_at is null)
    or (status = 'DISABLED' and disabled_at is not null)
  )
);

create table if not exists public.tenant_members (
  tenant_id text not null,
  user_id text not null,
  role text not null,
  status text not null default 'ACTIVE',
  disabled_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint tenant_members_pkey primary key (tenant_id, user_id),
  constraint tenant_members_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint tenant_members_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade,
  constraint tenant_members_role_check check (role in ('OWNER', 'MANAGER', 'WRITER')),
  constraint tenant_members_status_check check (status in ('ACTIVE', 'DISABLED')),
  constraint tenant_members_disabled_state_check check (
    (status = 'ACTIVE' and disabled_at is null)
    or (status = 'DISABLED' and disabled_at is not null)
  )
);

-- Repair an earlier or partially-applied preview schema without replacing it.
alter table public.tenants
  add column if not exists name text,
  add column if not exists plan text default 'pilot',
  add column if not exists status text default 'ACTIVE',
  add column if not exists disabled_at timestamptz,
  add column if not exists created_at timestamptz default clock_timestamp(),
  add column if not exists updated_at timestamptz default clock_timestamp();

alter table public.users
  add column if not exists auth_user_id uuid,
  add column if not exists legacy_operator_id text,
  add column if not exists email text,
  add column if not exists status text default 'ACTIVE',
  add column if not exists session_version bigint default 1,
  add column if not exists disabled_at timestamptz,
  add column if not exists created_at timestamptz default clock_timestamp(),
  add column if not exists updated_at timestamptz default clock_timestamp();

alter table public.tenant_members
  add column if not exists role text default 'WRITER',
  add column if not exists status text default 'ACTIVE',
  add column if not exists disabled_at timestamptz,
  add column if not exists created_at timestamptz default clock_timestamp(),
  add column if not exists updated_at timestamptz default clock_timestamp();

update public.tenants
set name = coalesce(nullif(name, ''), id),
    plan = coalesce(nullif(plan, ''), 'pilot'),
    status = coalesce(nullif(status, ''), 'ACTIVE'),
    created_at = coalesce(created_at, clock_timestamp()),
    updated_at = coalesce(updated_at, clock_timestamp())
where name is null
   or nullif(plan, '') is null
   or nullif(status, '') is null
   or created_at is null
   or updated_at is null;

update public.users
set status = coalesce(nullif(status, ''), 'ACTIVE'),
    session_version = greatest(coalesce(session_version, 1), 1),
    created_at = coalesce(created_at, clock_timestamp()),
    updated_at = coalesce(updated_at, clock_timestamp())
where nullif(status, '') is null
   or session_version is null
   or session_version < 1
   or created_at is null
   or updated_at is null;

update public.tenant_members
set role = coalesce(nullif(role, ''), 'WRITER'),
    status = coalesce(nullif(status, ''), 'ACTIVE'),
    created_at = coalesce(created_at, clock_timestamp()),
    updated_at = coalesce(updated_at, clock_timestamp())
where nullif(role, '') is null
   or nullif(status, '') is null
   or created_at is null
   or updated_at is null;

alter table public.tenants
  alter column name set not null,
  alter column plan set default 'pilot',
  alter column plan set not null,
  alter column status set default 'ACTIVE',
  alter column status set not null,
  alter column created_at set default clock_timestamp(),
  alter column created_at set not null,
  alter column updated_at set default clock_timestamp(),
  alter column updated_at set not null;

alter table public.users
  alter column status set default 'ACTIVE',
  alter column status set not null,
  alter column session_version set default 1,
  alter column session_version set not null,
  alter column created_at set default clock_timestamp(),
  alter column created_at set not null,
  alter column updated_at set default clock_timestamp(),
  alter column updated_at set not null;

alter table public.tenant_members
  alter column role set not null,
  alter column status set default 'ACTIVE',
  alter column status set not null,
  alter column created_at set default clock_timestamp(),
  alter column created_at set not null,
  alter column updated_at set default clock_timestamp(),
  alter column updated_at set not null;

-- Keep the default PostgREST relation names stable for membership joins.
do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.tenant_members'::regclass
      and conname = 'tenant_members_tenant_id_fkey'
  ) then
    alter table public.tenant_members
      add constraint tenant_members_tenant_id_fkey
      foreign key (tenant_id) references public.tenants(id) on delete cascade not valid;
    alter table public.tenant_members
      validate constraint tenant_members_tenant_id_fkey;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.tenant_members'::regclass
      and conname = 'tenant_members_user_id_fkey'
  ) then
    alter table public.tenant_members
      add constraint tenant_members_user_id_fkey
      foreign key (user_id) references public.users(id) on delete cascade not valid;
    alter table public.tenant_members
      validate constraint tenant_members_user_id_fkey;
  end if;

  if pg_catalog.to_regclass('auth.users') is not null
     and not exists (
       select 1
       from pg_catalog.pg_constraint
       where conrelid = 'public.users'::regclass
         and conname = 'users_auth_user_id_fkey'
     ) then
    alter table public.users
      add constraint users_auth_user_id_fkey
      foreign key (auth_user_id) references auth.users(id) on delete set null not valid;
    alter table public.users validate constraint users_auth_user_id_fkey;
  end if;

end;
$$;

create index if not exists tenant_members_user_status_idx
  on public.tenant_members(user_id, status, tenant_id);

create index if not exists tenant_members_tenant_role_status_idx
  on public.tenant_members(tenant_id, role, status, user_id);

create index if not exists users_auth_status_idx
  on public.users(auth_user_id, status)
  where auth_user_id is not null;

insert into public.tenants (
  id,
  name,
  plan,
  status,
  disabled_at
) values (
  'tenant_legacy',
  'Legacy shared workspace',
  'pilot',
  'ACTIVE',
  null
)
on conflict (id) do nothing;

-- user_legacy is an explicit active compatibility principal. Unknown operator
-- identifiers discovered below are preserved but disabled until mapped.
insert into public.users (
  id,
  legacy_operator_id,
  email,
  status,
  session_version,
  disabled_at
) values (
  'user_legacy',
  'user_legacy',
  null,
  'ACTIVE',
  1,
  null
)
on conflict (id) do update
set status = 'ACTIVE',
    session_version = greatest(public.users.session_version, 1),
    disabled_at = null,
    updated_at = clock_timestamp();

insert into public.tenant_members (
  tenant_id,
  user_id,
  role,
  status,
  disabled_at
) values (
  'tenant_legacy',
  'user_legacy',
  'OWNER',
  'ACTIVE',
  null
)
on conflict (tenant_id, user_id) do update
set role = 'OWNER',
    status = 'ACTIVE',
    disabled_at = null,
    updated_at = clock_timestamp();

-- A tenant must always retain at least one active Owner. The tenant-scoped
-- advisory transaction lock serializes concurrent Owner removals/demotions,
-- so two requests cannot both observe the other Owner and leave zero Owners.
create or replace function private.preserve_last_active_tenant_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id text := old.tenant_id;
  v_removes_active_owner boolean := false;
begin
  if tg_op = 'DELETE' then
    v_removes_active_owner := old.role = 'OWNER'
      and old.status = 'ACTIVE'
      and old.disabled_at is null;
  else
    v_removes_active_owner := old.role = 'OWNER'
      and old.status = 'ACTIVE'
      and old.disabled_at is null
      and (
        new.tenant_id is distinct from old.tenant_id
        or new.role is distinct from 'OWNER'
        or new.status is distinct from 'ACTIVE'
        or new.disabled_at is not null
      );
  end if;

  if not v_removes_active_owner then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('lynca:last-owner:' || v_tenant_id, 0)
  );

  if not exists (
    select 1
    from public.tenant_members member
    where member.tenant_id = v_tenant_id
      and member.user_id <> old.user_id
      and member.role = 'OWNER'
      and member.status = 'ACTIVE'
      and member.disabled_at is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'track_c_last_active_owner_required';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.preserve_last_active_tenant_owner()
  from public, anon, authenticated;
grant execute on function private.preserve_last_active_tenant_owner()
  to service_role;

drop trigger if exists track_c_preserve_last_active_tenant_owner
  on public.tenant_members;
create trigger track_c_preserve_last_active_tenant_owner
before update or delete on public.tenant_members
for each row execute function private.preserve_last_active_tenant_owner();

-- Mirror Auth identities into the application user registry without granting
-- tenant membership. Membership provisioning remains an explicit action.
do $$
begin
  if pg_catalog.to_regclass('auth.users') is not null then
    insert into public.users (
      id,
      auth_user_id,
      email,
      status,
      session_version,
      disabled_at,
      created_at,
      updated_at
    )
    select
      'user_auth_' || replace(auth_users.id::text, '-', ''),
      auth_users.id,
      auth_users.email,
      'ACTIVE',
      1,
      null,
      coalesce(auth_users.created_at, clock_timestamp()),
      clock_timestamp()
    from auth.users auth_users
    on conflict (auth_user_id) do update
    set email = coalesce(excluded.email, public.users.email),
        updated_at = clock_timestamp();
  end if;
end;
$$;

create or replace function private.current_app_user_id()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select app_user.id
  from public.users app_user
  where app_user.auth_user_id = (select auth.uid())
    and app_user.status = 'ACTIVE'
    and app_user.disabled_at is null
  limit 1
$$;

create or replace function private.is_tenant_member(p_tenant_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members member
    join public.tenants tenant on tenant.id = member.tenant_id
    join public.users app_user on app_user.id = member.user_id
    where member.tenant_id = p_tenant_id
      and member.user_id = private.current_app_user_id()
      and member.status = 'ACTIVE'
      and member.disabled_at is null
      and tenant.status = 'ACTIVE'
      and tenant.disabled_at is null
      and app_user.status = 'ACTIVE'
      and app_user.disabled_at is null
  )
$$;

create or replace function private.has_tenant_permission(
  p_tenant_id text,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.tenant_members member
    join public.tenants tenant on tenant.id = member.tenant_id
    join public.users app_user on app_user.id = member.user_id
    where member.tenant_id = p_tenant_id
      and member.user_id = private.current_app_user_id()
      and member.status = 'ACTIVE'
      and member.disabled_at is null
      and tenant.status = 'ACTIVE'
      and tenant.disabled_at is null
      and app_user.status = 'ACTIVE'
      and app_user.disabled_at is null
      and case upper(coalesce(p_permission, ''))
        when 'MANAGE_MEMBERS' then member.role = 'OWNER'
        when 'MANAGE_TENANT' then member.role = 'OWNER'
        when 'VIEW_COSTS' then member.role = 'OWNER'
        when 'EXPORT' then member.role = 'OWNER'
        when 'VIEW_ALL' then member.role in ('OWNER', 'MANAGER')
        when 'OPERATE' then member.role in ('OWNER', 'MANAGER')
        when 'UPLOAD' then member.role in ('OWNER', 'MANAGER')
        when 'ASSIGN_TASK' then member.role in ('OWNER', 'MANAGER')
        when 'VIEW_ASSET' then member.role in ('OWNER', 'MANAGER', 'WRITER')
        when 'WRITE_TITLE' then member.role in ('OWNER', 'WRITER')
        when 'SUBMIT_FEEDBACK' then member.role in ('OWNER', 'WRITER')
        else false
      end
  )
$$;

create or replace function private.can_view_app_user(p_user_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id = private.current_app_user_id()
    or exists (
      select 1
      from public.tenant_members self_member
      join public.tenant_members other_member
        on other_member.tenant_id = self_member.tenant_id
      join public.tenants tenant
        on tenant.id = self_member.tenant_id
      where self_member.user_id = private.current_app_user_id()
        and other_member.user_id = p_user_id
        and self_member.role in ('OWNER', 'MANAGER')
        and self_member.status = 'ACTIVE'
        and self_member.disabled_at is null
        and other_member.status = 'ACTIVE'
        and other_member.disabled_at is null
        and tenant.status = 'ACTIVE'
        and tenant.disabled_at is null
    )
$$;

create or replace function private.current_user_matches_operator(p_operator_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users app_user
    where app_user.id = private.current_app_user_id()
      and (
        app_user.id = p_operator_id
        or app_user.legacy_operator_id = p_operator_id
      )
  )
$$;

revoke all on function private.current_app_user_id() from public, anon, authenticated;
revoke all on function private.is_tenant_member(text) from public, anon, authenticated;
revoke all on function private.has_tenant_permission(text, text) from public, anon, authenticated;
revoke all on function private.can_view_app_user(text) from public, anon, authenticated;
revoke all on function private.current_user_matches_operator(text) from public, anon, authenticated;

grant execute on function private.current_app_user_id() to authenticated, service_role;
grant execute on function private.is_tenant_member(text) to authenticated, service_role;
grant execute on function private.has_tenant_permission(text, text) to authenticated, service_role;
grant execute on function private.can_view_app_user(text) to authenticated, service_role;
grant execute on function private.current_user_matches_operator(text) to authenticated, service_role;

alter table public.tenants enable row level security;
alter table public.users enable row level security;
alter table public.tenant_members enable row level security;

revoke all on table public.tenants from public, anon, authenticated;
revoke all on table public.users from public, anon, authenticated;
revoke all on table public.tenant_members from public, anon, authenticated;

grant select, insert, update, delete on table public.tenants to service_role;
grant select, insert, update, delete on table public.users to service_role;
grant select, insert, update, delete on table public.tenant_members to service_role;

-- Application sessions are server-signed cookies and every commercial write
-- goes through an API that re-checks current membership/RBAC. Do not expose a
-- second browser Data API mutation surface; RLS remains defense in depth.
revoke all on table public.tenants from authenticated;
revoke all on table public.users from authenticated;
revoke all on table public.tenant_members from authenticated;

drop policy if exists track_c_tenants_select on public.tenants;
create policy track_c_tenants_select
  on public.tenants
  for select
  to authenticated
  using (private.is_tenant_member(id));

drop policy if exists track_c_tenants_update on public.tenants;
create policy track_c_tenants_update
  on public.tenants
  for update
  to authenticated
  using (private.has_tenant_permission(id, 'MANAGE_TENANT'))
  with check (private.has_tenant_permission(id, 'MANAGE_TENANT'));

drop policy if exists track_c_users_select on public.users;
create policy track_c_users_select
  on public.users
  for select
  to authenticated
  using (private.can_view_app_user(id));

drop policy if exists track_c_users_update_self on public.users;
create policy track_c_users_update_self
  on public.users
  for update
  to authenticated
  using (id = private.current_app_user_id())
  with check (id = private.current_app_user_id());

drop policy if exists track_c_tenant_members_select on public.tenant_members;
create policy track_c_tenant_members_select
  on public.tenant_members
  for select
  to authenticated
  using (private.has_tenant_permission(tenant_id, 'VIEW_ALL'));

drop policy if exists track_c_tenant_members_insert on public.tenant_members;
create policy track_c_tenant_members_insert
  on public.tenant_members
  for insert
  to authenticated
  with check (private.has_tenant_permission(tenant_id, 'MANAGE_MEMBERS'));

drop policy if exists track_c_tenant_members_update on public.tenant_members;
create policy track_c_tenant_members_update
  on public.tenant_members
  for update
  to authenticated
  using (private.has_tenant_permission(tenant_id, 'MANAGE_MEMBERS'))
  with check (private.has_tenant_permission(tenant_id, 'MANAGE_MEMBERS'));

drop policy if exists track_c_tenant_members_delete on public.tenant_members;
create policy track_c_tenant_members_delete
  on public.tenant_members
  for delete
  to authenticated
  using (private.has_tenant_permission(tenant_id, 'MANAGE_MEMBERS'));

-- tenant_id used to be a scheduler fairness hint. Preserve it before adding
-- the actual customer ownership column.
do $$
begin
  if pg_catalog.to_regclass('public.v4_recognition_jobs') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'v4_recognition_jobs'
        and column_name = 'tenant_id'
    ) and not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'v4_recognition_jobs'
        and column_name = 'legacy_scheduler_scope_id'
    ) then
      alter table public.v4_recognition_jobs
        rename column tenant_id to legacy_scheduler_scope_id;
    elsif not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'v4_recognition_jobs'
        and column_name = 'legacy_scheduler_scope_id'
    ) then
      alter table public.v4_recognition_jobs
        add column legacy_scheduler_scope_id text;
    end if;
  end if;
end;
$$;

create table if not exists public.v4_recognition_batches (
  id text primary key default ('batch_' || replace(gen_random_uuid()::text, '-', '')),
  tenant_id text not null default 'tenant_legacy'
    references public.tenants(id) on delete restrict,
  created_by_user_id text references public.users(id) on delete set null,
  assigned_to_user_id text references public.users(id) on delete set null,
  status text not null default 'QUEUED',
  item_count integer not null default 0,
  completed_count integer not null default 0,
  failed_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  constraint v4_recognition_batches_status_check check (
    status in (
      'QUEUED',
      'RUNNING',
      'COMPLETED',
      'PARTIAL_FAILED',
      'FAILED',
      'CANCELLED',
      'LEGACY_IMPORTED'
    )
  ),
  constraint v4_recognition_batches_counts_check check (
    item_count >= 0
    and completed_count >= 0
    and failed_count >= 0
    and completed_count + failed_count <= item_count
  ),
  constraint v4_recognition_batches_metadata_check check (jsonb_typeof(metadata) = 'object')
);

comment on column public.v4_recognition_batches.assigned_to_user_id is
  'Deprecated summary field. A batch may contain multiple independently assigned recognition sessions; use session/job assigned_to_user_id.';

-- Tenant ownership is immutable after a row is created. Moving an operational
-- row between tenants would leave descendants behind and can turn an otherwise
-- safe legacy ON DELETE CASCADE into a cross-tenant delete. A reassignment must
-- therefore be an explicit copy operation, never an UPDATE of tenant_id.
create or replace function private.prevent_tenant_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception using
      errcode = '23514',
      message = 'track_c_tenant_id_immutable';
  end if;
  return new;
end;
$$;

revoke all on function private.prevent_tenant_change() from public, anon, authenticated;
grant execute on function private.prevent_tenant_change() to authenticated, service_role;

-- Customer operational and customer-generated learning data. Shared catalog
-- registries are deliberately absent from this allowlist.
do $$
declare
  v_table text;
  v_constraint text;
  v_tenant_scoped_tables text[] := array[
    'listing_assets',
    'listing_analysis_runs',
    'listing_reviews',
    'listing_image_verifications',
    'listing_publish_jobs',
    'catalog_gap_queue',
    'preingestion_bundles',
    'preingestion_jobs',
    'image_derived_assets',
    'preingestion_evidence_patches',
    'v4_recognition_batches',
    'v4_recognition_sessions',
    'v4_preingestion_bundles',
    'v4_field_evidence',
    'v4_candidate_traces',
    'v4_writer_feedback_events',
    'v4_learning_events',
    'v4_production_quality_ledger',
    'v4_catalog_gap_queue',
    'v4_recognition_jobs',
    'v4_writer_export_batches',
    'v4_writer_export_items',
    'listing_identity_resolution_cache',
    'v4_fast_scout_cache',
    'vector_query_logs',
    'vector_retrieval_runs',
    'vector_retrieval_candidates',
    'data_loop_integration_runs',
    'recognition_workflow_events',
    'data_quality_findings',
    'annotation_tasks',
    'reviewed_field_annotations',
    'crop_annotations',
    'hard_negative_examples'
  ];
begin
  foreach v_table in array v_tenant_scoped_tables loop
    if pg_catalog.to_regclass(format('public.%I', v_table)) is null then
      continue;
    end if;

    execute format(
      'alter table public.%I add column if not exists tenant_id text',
      v_table
    );
    execute format(
      'alter table public.%I alter column tenant_id set default %L',
      v_table,
      'tenant_legacy'
    );
    execute format(
      'update public.%I set tenant_id = %L where tenant_id is null or btrim(tenant_id) = %L',
      v_table,
      'tenant_legacy',
      ''
    );

    v_constraint := left(v_table || '_tenant_id_fkey', 63);
    if not exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = pg_catalog.to_regclass(format('public.%I', v_table))
        and constraint_row.conname = v_constraint
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (tenant_id) references public.tenants(id) on delete restrict not valid',
        v_table,
        v_constraint
      );
      execute format(
        'alter table public.%I validate constraint %I',
        v_table,
        v_constraint
      );
    end if;

    execute format(
      'alter table public.%I alter column tenant_id set not null',
      v_table
    );
    -- The legacy default exists only for the one-time backfill above. Keeping
    -- it for live writes would silently mis-attribute an omitted tenant to the
    -- compatibility tenant instead of failing closed.
    execute format(
      'alter table public.%I alter column tenant_id drop default',
      v_table
    );
    execute format(
      'create index if not exists %I on public.%I (tenant_id)',
      left(v_table || '_tenant_id_idx', 63),
      v_table
    );
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format(
      'grant select, insert, update, delete on table public.%I to service_role',
      v_table
    );
    execute format('revoke all on table public.%I from authenticated', v_table);

    execute format(
      'drop trigger if exists track_c_tenant_id_immutable on public.%I',
      v_table
    );
    execute format(
      'create trigger track_c_tenant_id_immutable before update of tenant_id on public.%I for each row execute function private.prevent_tenant_change()',
      v_table
    );

    execute format('drop policy if exists track_c_tenant_select on public.%I', v_table);
    execute format(
      'create policy track_c_tenant_select on public.%I for select to authenticated using (private.has_tenant_permission(tenant_id, %L))',
      v_table,
      'VIEW_ALL'
    );
    execute format('drop policy if exists track_c_tenant_insert on public.%I', v_table);
    execute format(
      'create policy track_c_tenant_insert on public.%I for insert to authenticated with check (private.has_tenant_permission(tenant_id, %L))',
      v_table,
      'OPERATE'
    );
    execute format('drop policy if exists track_c_tenant_update on public.%I', v_table);
    execute format(
      'create policy track_c_tenant_update on public.%I for update to authenticated using (private.has_tenant_permission(tenant_id, %L)) with check (private.has_tenant_permission(tenant_id, %L))',
      v_table,
      'OPERATE',
      'OPERATE'
    );
    execute format('drop policy if exists track_c_tenant_delete on public.%I', v_table);
    execute format(
      'create policy track_c_tenant_delete on public.%I for delete to authenticated using (private.has_tenant_permission(tenant_id, %L))',
      v_table,
      'OPERATE'
    );
  end loop;
end;
$$;

-- The V4 application layer persists assignment on both sessions and jobs.
-- These columns are added here because the older V4 spine predates users and
-- tenant membership. Nullable values preserve historical rows.
do $$
declare
  v_table text;
  v_constraint text;
begin
  foreach v_table in array array['v4_recognition_sessions', 'v4_recognition_jobs'] loop
    if pg_catalog.to_regclass(format('public.%I', v_table)) is null then
      continue;
    end if;

    execute format(
      'alter table public.%I add column if not exists created_by_user_id text, add column if not exists assigned_to_user_id text',
      v_table
    );

    foreach v_constraint in array array['created_by_user_id', 'assigned_to_user_id'] loop
      if not exists (
        select 1
        from pg_catalog.pg_constraint constraint_row
        where constraint_row.conrelid = pg_catalog.to_regclass(format('public.%I', v_table))
          and constraint_row.conname = left(v_table || '_' || v_constraint || '_fkey', 63)
      ) then
        execute format(
          'alter table public.%I add constraint %I foreign key (%I) references public.users(id) on delete set null not valid',
          v_table,
          left(v_table || '_' || v_constraint || '_fkey', 63),
          v_constraint
        );
        execute format(
          'alter table public.%I validate constraint %I',
          v_table,
          left(v_table || '_' || v_constraint || '_fkey', 63)
        );
      end if;
    end loop;

    execute format(
      'create index if not exists %I on public.%I (tenant_id, assigned_to_user_id) where assigned_to_user_id is not null',
      left(v_table || '_tenant_assignee_idx', 63),
      v_table
    );
  end loop;
end;
$$;

create or replace function private.enforce_active_tenant_assignment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_column text := tg_argv[0];
  v_user_id text := nullif(btrim(to_jsonb(new) ->> v_user_column), '');
begin
  if v_user_id is null then
    return new;
  end if;
  if new.tenant_id is null or btrim(new.tenant_id) = '' then
    raise exception using
      errcode = '23514',
      message = 'track_c_assignment_tenant_required';
  end if;
  if not exists (
    select 1
    from public.tenant_members member
    join public.users app_user on app_user.id = member.user_id
    join public.tenants tenant on tenant.id = member.tenant_id
    where member.tenant_id = new.tenant_id
      and member.user_id = v_user_id
      and member.status = 'ACTIVE'
      and member.disabled_at is null
      and app_user.status = 'ACTIVE'
      and app_user.disabled_at is null
      and tenant.status = 'ACTIVE'
      and tenant.disabled_at is null
  ) then
    raise exception using
      errcode = '23514',
      message = format(
        'track_c_assignment_not_active_member:tenant=%s,user=%s',
        new.tenant_id,
        v_user_id
      );
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_active_tenant_assignment() from public, anon, authenticated;
grant execute on function private.enforce_active_tenant_assignment() to authenticated, service_role;

-- A writer task is one recognition session (one card), even when the pipeline
-- represents that task with paired L1/L2 jobs. Direct writes may not split the
-- session across assignees; assignment changes must use the transaction below.
create or replace function private.enforce_job_session_assignee()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session_assignee text;
begin
  if new.recognition_session_id is null then
    return new;
  end if;

  select sessions.assigned_to_user_id
  into v_session_assignee
  from public.v4_recognition_sessions sessions
  where sessions.tenant_id = new.tenant_id
    and sessions.id = new.recognition_session_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'track_c_assignment_session_missing';
  end if;
  if new.assigned_to_user_id is distinct from v_session_assignee then
    raise exception using
      errcode = '23514',
      message = 'track_c_job_session_assignee_mismatch';
  end if;
  return new;
end;
$$;

revoke all on function private.enforce_job_session_assignee() from public, anon, authenticated;
grant execute on function private.enforce_job_session_assignee() to service_role;

drop trigger if exists zzz_track_c_job_session_assignee
  on public.v4_recognition_jobs;
create trigger zzz_track_c_job_session_assignee
  before insert or update of tenant_id, recognition_session_id, assigned_to_user_id
  on public.v4_recognition_jobs
  for each row execute function private.enforce_job_session_assignee();

create or replace function private.validate_session_job_assignees()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.v4_recognition_jobs jobs
    where jobs.tenant_id = new.tenant_id
      and jobs.recognition_session_id = new.id
      and jobs.assigned_to_user_id is distinct from new.assigned_to_user_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'track_c_session_job_assignee_mismatch';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_session_job_assignees() from public, anon, authenticated;
grant execute on function private.validate_session_job_assignees() to service_role;

drop trigger if exists zzzz_track_c_session_job_assignees
  on public.v4_recognition_sessions;
create constraint trigger zzzz_track_c_session_job_assignees
  after insert or update
  on public.v4_recognition_sessions
  deferrable initially deferred
  for each row execute function private.validate_session_job_assignees();

do $$
declare
  v_table text;
  v_user_column text;
  v_trigger text;
begin
  foreach v_table in array array[
    'v4_recognition_batches',
    'v4_recognition_sessions',
    'v4_recognition_jobs'
  ] loop
    if pg_catalog.to_regclass(format('public.%I', v_table)) is null then
      continue;
    end if;
    foreach v_user_column in array array['created_by_user_id', 'assigned_to_user_id'] loop
      if not exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = v_table
          and column_name = v_user_column
      ) then
        continue;
      end if;
      v_trigger := left(
        'zz_track_c_' || v_table || '_' || v_user_column || '_member',
        63
      );
      execute format('drop trigger if exists %I on public.%I', v_trigger, v_table);
      execute format(
        'create trigger %I before insert or update of tenant_id, %I on public.%I for each row execute function private.enforce_active_tenant_assignment(%L)',
        v_trigger,
        v_user_column,
        v_table,
        v_user_column
      );
    end loop;
  end loop;
end;
$$;

-- Tenant-local pre-ingestion idempotency. Build the replacement indexes before
-- removing the legacy global keys so current rows remain protected throughout
-- the migration, while two tenants may safely reuse an asset id or job key.
do $$
begin
  if pg_catalog.to_regclass('public.preingestion_bundles') is not null then
    create unique index if not exists preingestion_bundles_tenant_asset_source_version_uidx
      on public.preingestion_bundles(tenant_id, asset_id, source, bundle_version);
    drop index if exists public.preingestion_bundles_asset_source_version_uidx;
  end if;

  if pg_catalog.to_regclass('public.preingestion_jobs') is not null then
    create unique index if not exists preingestion_jobs_tenant_job_key_uidx
      on public.preingestion_jobs(tenant_id, job_key);
    drop index if exists public.preingestion_jobs_job_key_uidx;
  end if;

  if pg_catalog.to_regclass('public.catalog_gap_queue') is not null then
    create index if not exists catalog_gap_queue_tenant_asset_status_idx
      on public.catalog_gap_queue(tenant_id, asset_id, status, created_at desc);
  end if;

  if pg_catalog.to_regclass('public.data_quality_findings') is not null then
    create unique index if not exists data_quality_findings_tenant_idempotency_uidx
      on public.data_quality_findings(tenant_id, idempotency_key)
      where idempotency_key is not null;
    drop index if exists public.data_quality_findings_idempotency_key_idx;
  end if;

  if pg_catalog.to_regclass('public.annotation_tasks') is not null then
    create unique index if not exists annotation_tasks_tenant_idempotency_uidx
      on public.annotation_tasks(tenant_id, idempotency_key)
      where idempotency_key is not null;
    drop index if exists public.annotation_tasks_idempotency_key_idx;
  end if;

  if pg_catalog.to_regclass('public.hard_negative_examples') is not null then
    create unique index if not exists hard_negative_examples_tenant_idempotency_uidx
      on public.hard_negative_examples(tenant_id, idempotency_key)
      where idempotency_key is not null;
    drop index if exists public.hard_negative_examples_idempotency_key_idx;
  end if;
end;
$$;

-- Preserve historical human identifiers as disabled principals. This supports
-- audit joins without granting any new login or tenant access.
do $$
declare
  v_source record;
begin
  for v_source in
    select *
    from (values
      ('listing_reviews', 'operator_id'),
      ('v4_recognition_sessions', 'operator_id'),
      ('v4_writer_feedback_events', 'operator_id'),
      ('v4_recognition_jobs', 'operator_id'),
      ('v4_writer_export_batches', 'exported_by')
    ) as sources(table_name, column_name)
  loop
    if pg_catalog.to_regclass(format('public.%I', v_source.table_name)) is null
       or not exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = v_source.table_name
           and column_name = v_source.column_name
       ) then
      continue;
    end if;

    execute format(
      $sql$
        insert into public.users (
          id,
          legacy_operator_id,
          status,
          session_version,
          disabled_at
        )
        select
          'user_legacy_' || substr(md5(btrim(source.%1$I)), 1, 24),
          btrim(source.%1$I),
          'DISABLED',
          1,
          clock_timestamp()
        from public.%2$I source
        where nullif(btrim(source.%1$I), '') is not null
          and btrim(source.%1$I) <> 'user_legacy'
        on conflict (legacy_operator_id) do nothing
      $sql$,
      v_source.column_name,
      v_source.table_name
    );
  end loop;

  insert into public.tenant_members (
    tenant_id,
    user_id,
    role,
    status,
    disabled_at
  )
  select
    'tenant_legacy',
    app_user.id,
    'WRITER',
    'DISABLED',
    coalesce(app_user.disabled_at, clock_timestamp())
  from public.users app_user
  where app_user.id like 'user_legacy_%'
    and app_user.id <> 'user_legacy'
  on conflict (tenant_id, user_id) do nothing;
end;
$$;

create index if not exists v4_recognition_batches_tenant_created_idx
  on public.v4_recognition_batches(tenant_id, created_at desc);

create unique index if not exists v4_recognition_batches_tenant_id_id_uidx
  on public.v4_recognition_batches(tenant_id, id);

do $$
begin
  if pg_catalog.to_regclass('public.v4_recognition_sessions') is not null then
    create unique index if not exists v4_recognition_sessions_tenant_id_id_uidx
      on public.v4_recognition_sessions(tenant_id, id);
  end if;

  if pg_catalog.to_regclass('public.v4_recognition_jobs') is not null then
    create unique index if not exists v4_recognition_jobs_tenant_id_id_uidx
      on public.v4_recognition_jobs(tenant_id, id);

    insert into public.v4_recognition_batches (
      id,
      tenant_id,
      status,
      item_count,
      completed_count,
      failed_count,
      metadata,
      created_at,
      updated_at
    )
    select
      jobs.batch_id,
      jobs.tenant_id,
      'LEGACY_IMPORTED',
      count(*)::integer,
      count(*) filter (where jobs.status in ('SUCCESS', 'L2_READY')),
      count(*) filter (where jobs.status in ('FAILED', 'FAILED_FINAL')),
      jsonb_build_object('backfill', 'track_c_tenant_foundation'),
      min(jobs.created_at),
      max(jobs.updated_at)
    from public.v4_recognition_jobs jobs
    where nullif(btrim(jobs.batch_id), '') is not null
    group by jobs.batch_id, jobs.tenant_id
    on conflict (id) do nothing;

    if not exists (
      select 1
      from pg_catalog.pg_constraint
      where conrelid = 'public.v4_recognition_jobs'::regclass
        and conname = 'v4_recognition_jobs_tenant_batch_fkey'
    ) then
      alter table public.v4_recognition_jobs
        add constraint v4_recognition_jobs_tenant_batch_fkey
        foreign key (tenant_id, batch_id)
        references public.v4_recognition_batches(tenant_id, id)
        on delete restrict
        not valid;
    end if;
    alter table public.v4_recognition_jobs
      validate constraint v4_recognition_jobs_tenant_batch_fkey;
  end if;
end;
$$;

do $$
begin
  if pg_catalog.to_regclass('public.v4_recognition_jobs') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'v4_recognition_jobs'
         and column_name = 'legacy_scheduler_scope_id'
     ) then
    create index if not exists v4_recognition_jobs_legacy_scheduler_scope_idx
      on public.v4_recognition_jobs(legacy_scheduler_scope_id)
      where legacy_scheduler_scope_id is not null;
  end if;
end;
$$;

-- Generic tenant-lineage guard. Child defaults are removed below so legacy
-- code that omits tenant_id inherits it from a parent instead of silently
-- landing in tenant_legacy. An explicit mismatch always fails closed.
create or replace function private.enforce_tenant_from_parent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_parent_table text := tg_argv[0];
  v_child_key text := tg_argv[1];
  v_parent_key text := tg_argv[2];
  v_child_value text;
  v_parent_tenant_id text;
begin
  v_child_value := nullif(btrim(to_jsonb(new) ->> v_child_key), '');
  if v_child_value is null then
    return new;
  end if;

  execute format(
    'select tenant_id from public.%I where %I::text = $1 limit 1',
    v_parent_table,
    v_parent_key
  )
  into v_parent_tenant_id
  using v_child_value;

  if v_parent_tenant_id is null then
    raise exception using
      errcode = '23503',
      message = format(
        'track_c_tenant_parent_missing:%s.%s=%s',
        v_parent_table,
        v_parent_key,
        v_child_value
      );
  end if;

  if new.tenant_id is null or btrim(new.tenant_id) = '' then
    new.tenant_id := v_parent_tenant_id;
  elsif new.tenant_id is distinct from v_parent_tenant_id then
    raise exception using
      errcode = '23514',
      message = format(
        'track_c_tenant_mismatch:child=%s,parent=%s',
        new.tenant_id,
        v_parent_tenant_id
      );
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_tenant_from_parent() from public, anon, authenticated;
grant execute on function private.enforce_tenant_from_parent() to authenticated, service_role;

do $$
declare
  v_lineage record;
  v_trigger_name text;
begin
  for v_lineage in
    select *
    from (values
      ('listing_analysis_runs', 'asset_id', 'listing_assets', 'id'),
      ('listing_reviews', 'analysis_run_id', 'listing_analysis_runs', 'id'),
      ('listing_reviews', 'asset_id', 'listing_assets', 'id'),
      ('listing_image_verifications', 'asset_id', 'listing_assets', 'id'),
      ('listing_publish_jobs', 'review_id', 'listing_reviews', 'id'),
      ('listing_publish_jobs', 'asset_id', 'listing_assets', 'id'),
      ('preingestion_bundles', 'asset_id', 'listing_assets', 'id'),
      ('preingestion_jobs', 'bundle_id', 'preingestion_bundles', 'bundle_id'),
      ('preingestion_jobs', 'asset_id', 'listing_assets', 'id'),
      ('image_derived_assets', 'asset_id', 'listing_assets', 'id'),
      ('preingestion_evidence_patches', 'bundle_id', 'preingestion_bundles', 'bundle_id'),
      ('preingestion_evidence_patches', 'asset_id', 'listing_assets', 'id'),
      ('v4_recognition_sessions', 'asset_id', 'listing_assets', 'id'),
      ('v4_recognition_sessions', 'preingestion_bundle_id', 'v4_preingestion_bundles', 'id'),
      ('v4_preingestion_bundles', 'asset_id', 'listing_assets', 'id'),
      ('v4_field_evidence', 'recognition_session_id', 'v4_recognition_sessions', 'id'),
      ('v4_candidate_traces', 'recognition_session_id', 'v4_recognition_sessions', 'id'),
      ('v4_writer_feedback_events', 'recognition_session_id', 'v4_recognition_sessions', 'id'),
      ('v4_learning_events', 'recognition_session_id', 'v4_recognition_sessions', 'id'),
      ('v4_production_quality_ledger', 'recognition_session_id', 'v4_recognition_sessions', 'id'),
      ('v4_catalog_gap_queue', 'recognition_session_id', 'v4_recognition_sessions', 'id'),
      ('v4_catalog_gap_queue', 'asset_id', 'listing_assets', 'id'),
      ('v4_recognition_jobs', 'batch_id', 'v4_recognition_batches', 'id'),
      ('v4_recognition_jobs', 'recognition_session_id', 'v4_recognition_sessions', 'id'),
      ('v4_recognition_jobs', 'asset_id', 'listing_assets', 'id'),
      ('v4_writer_export_items', 'export_batch_id', 'v4_writer_export_batches', 'id'),
      ('v4_writer_export_items', 'recognition_session_id', 'v4_recognition_sessions', 'id'),
      ('v4_writer_export_items', 'asset_id', 'listing_assets', 'id'),
      ('v4_fast_scout_cache', 'asset_id', 'listing_assets', 'id'),
      ('vector_query_logs', 'analysis_run_id', 'listing_analysis_runs', 'id'),
      ('vector_query_logs', 'asset_id', 'listing_assets', 'id'),
      ('vector_retrieval_runs', 'query_log_id', 'vector_query_logs', 'query_log_id'),
      ('vector_retrieval_runs', 'analysis_run_id', 'listing_analysis_runs', 'id'),
      ('vector_retrieval_candidates', 'retrieval_run_id', 'vector_retrieval_runs', 'retrieval_run_id'),
      ('reviewed_field_annotations', 'annotation_task_id', 'annotation_tasks', 'task_id'),
      ('crop_annotations', 'annotation_task_id', 'annotation_tasks', 'task_id')
    ) as lineage(child_table, child_key, parent_table, parent_key)
  loop
    if pg_catalog.to_regclass(format('public.%I', v_lineage.child_table)) is null
       or pg_catalog.to_regclass(format('public.%I', v_lineage.parent_table)) is null
       or not exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = v_lineage.child_table
           and column_name = v_lineage.child_key
       )
       or not exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = v_lineage.parent_table
           and column_name = v_lineage.parent_key
       ) then
      continue;
    end if;

    execute format(
      'alter table public.%I alter column tenant_id drop default',
      v_lineage.child_table
    );

    v_trigger_name := left(
      'track_c_tenant_lineage_' || v_lineage.child_key || '_' || v_lineage.parent_table,
      63
    );
    execute format(
      'drop trigger if exists %I on public.%I',
      v_trigger_name,
      v_lineage.child_table
    );
    execute format(
      'create trigger %I before insert or update of tenant_id, %I on public.%I for each row execute function private.enforce_tenant_from_parent(%L, %L, %L)',
      v_trigger_name,
      v_lineage.child_key,
      v_lineage.child_table,
      v_lineage.parent_table,
      v_lineage.child_key,
      v_lineage.parent_key
    );
  end loop;
end;
$$;

-- Existing single-column foreign keys preserve their historical delete
-- behavior but cannot prove that child and parent belong to the same tenant.
-- Pair each real tenant-scoped FK with a validated composite FK. SET NULL
-- relationships clear only the parent id; tenant_id remains immutable/not-null.
do $$
declare
  v_relation record;
  v_parent_index text;
  v_constraint text;
  v_delete_clause text;
begin
  for v_relation in
    select *
    from (values
      ('listing_analysis_runs', 'asset_id', 'listing_assets', 'id', 'CASCADE'),
      ('listing_reviews', 'asset_id', 'listing_assets', 'id', 'CASCADE'),
      ('listing_reviews', 'analysis_run_id', 'listing_analysis_runs', 'id', 'CASCADE'),
      ('listing_publish_jobs', 'asset_id', 'listing_assets', 'id', 'CASCADE'),
      ('listing_publish_jobs', 'review_id', 'listing_reviews', 'id', 'CASCADE'),
      ('preingestion_jobs', 'bundle_id', 'preingestion_bundles', 'bundle_id', 'CASCADE'),
      ('preingestion_evidence_patches', 'bundle_id', 'preingestion_bundles', 'bundle_id', 'CASCADE'),
      ('v4_field_evidence', 'recognition_session_id', 'v4_recognition_sessions', 'id', 'CASCADE'),
      ('v4_candidate_traces', 'recognition_session_id', 'v4_recognition_sessions', 'id', 'CASCADE'),
      ('v4_writer_feedback_events', 'recognition_session_id', 'v4_recognition_sessions', 'id', 'CASCADE'),
      ('v4_learning_events', 'recognition_session_id', 'v4_recognition_sessions', 'id', 'CASCADE'),
      ('v4_production_quality_ledger', 'recognition_session_id', 'v4_recognition_sessions', 'id', 'CASCADE'),
      ('v4_catalog_gap_queue', 'recognition_session_id', 'v4_recognition_sessions', 'id', 'SET NULL'),
      ('v4_recognition_jobs', 'recognition_session_id', 'v4_recognition_sessions', 'id', 'SET NULL'),
      ('v4_writer_export_items', 'export_batch_id', 'v4_writer_export_batches', 'id', 'CASCADE'),
      ('vector_retrieval_runs', 'query_log_id', 'vector_query_logs', 'query_log_id', 'SET NULL'),
      ('vector_retrieval_candidates', 'retrieval_run_id', 'vector_retrieval_runs', 'retrieval_run_id', 'CASCADE'),
      ('reviewed_field_annotations', 'annotation_task_id', 'annotation_tasks', 'task_id', 'SET NULL'),
      ('crop_annotations', 'annotation_task_id', 'annotation_tasks', 'task_id', 'SET NULL')
    ) as relation(child_table, child_key, parent_table, parent_key, delete_action)
  loop
    if pg_catalog.to_regclass(format('public.%I', v_relation.child_table)) is null
       or pg_catalog.to_regclass(format('public.%I', v_relation.parent_table)) is null
       or not exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = v_relation.child_table
           and column_name = v_relation.child_key
       ) then
      continue;
    end if;

    v_parent_index := left(
      v_relation.parent_table || '_tenant_' || v_relation.parent_key || '_uidx',
      63
    );
    execute format(
      'create unique index if not exists %I on public.%I (tenant_id, %I)',
      v_parent_index,
      v_relation.parent_table,
      v_relation.parent_key
    );

    v_constraint := left(
      'track_c_' || v_relation.child_table || '_tenant_' || v_relation.child_key || '_fkey',
      63
    );
    if v_relation.delete_action = 'SET NULL' then
      v_delete_clause := format('on delete set null (%I)', v_relation.child_key);
    else
      v_delete_clause := 'on delete cascade';
    end if;

    if not exists (
      select 1
      from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid = pg_catalog.to_regclass(format('public.%I', v_relation.child_table))
        and constraint_row.conname = v_constraint
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (tenant_id, %I) references public.%I(tenant_id, %I) %s not valid',
        v_relation.child_table,
        v_constraint,
        v_relation.child_key,
        v_relation.parent_table,
        v_relation.parent_key,
        v_delete_clause
      );
    end if;
    execute format(
      'alter table public.%I validate constraint %I',
      v_relation.child_table,
      v_constraint
    );
  end loop;
end;
$$;

do $$
begin
  if pg_catalog.to_regclass('public.listing_image_verifications') is not null then
    -- Storage-verification uniqueness is tenant-local even though the legacy
    -- object_path primary key remains intact during the expand phase.
    create unique index if not exists listing_image_verifications_tenant_object_path_uidx
      on public.listing_image_verifications(tenant_id, object_path);

    create index if not exists listing_image_verifications_tenant_asset_idx
      on public.listing_image_verifications(tenant_id, asset_id, verified_at desc);

    if not exists (
      select 1
      from pg_catalog.pg_constraint
      where conrelid = 'public.listing_image_verifications'::regclass
        and conname = 'listing_image_verifications_tenant_path_check'
    ) then
      alter table public.listing_image_verifications
        add constraint listing_image_verifications_tenant_path_check check (
          tenant_id = 'tenant_legacy'
          or (
            split_part(object_path, '/', 1) = 'tenants'
            and split_part(object_path, '/', 2) = tenant_id
            and split_part(object_path, '/', 3) = 'listing-assets'
          )
        ) not valid;
      alter table public.listing_image_verifications
        validate constraint listing_image_verifications_tenant_path_check;
    end if;
  end if;
end;
$$;

-- Browser roles never receive direct storage.objects access. Upload/read URLs
-- are minted by tenant- and assignment-aware backend APIs using service_role;
-- this prevents a Writer from bypassing task assignment with a direct Storage
-- API request. The exact tenants/{tenant_id}/listing-assets/... prefix remains
-- enforced on the durable verification records above.
do $$
begin
  if pg_catalog.to_regclass('storage.objects') is not null then
    revoke usage on schema storage from anon, authenticated;
    grant usage on schema storage to service_role;
    execute 'drop policy if exists listing_card_images_service_role_select on storage.objects';
    execute 'drop policy if exists listing_card_images_service_role_insert on storage.objects';
    execute 'drop policy if exists listing_card_images_service_role_update on storage.objects';
    execute 'drop policy if exists listing_card_images_service_role_delete on storage.objects';
    execute 'drop policy if exists track_c_listing_card_images_tenant_select on storage.objects';
    execute 'drop policy if exists track_c_listing_card_images_tenant_insert on storage.objects';
    execute 'drop policy if exists track_c_listing_card_images_tenant_update on storage.objects';
    execute 'drop policy if exists track_c_listing_card_images_tenant_delete on storage.objects';

    execute $policy$
      create policy listing_card_images_service_role_select
      on storage.objects for select to service_role
      using (bucket_id = 'listing-card-images')
    $policy$;
    execute $policy$
      create policy listing_card_images_service_role_insert
      on storage.objects for insert to service_role
      with check (bucket_id = 'listing-card-images')
    $policy$;
    execute $policy$
      create policy listing_card_images_service_role_update
      on storage.objects for update to service_role
      using (bucket_id = 'listing-card-images')
      with check (bucket_id = 'listing-card-images')
    $policy$;
    execute $policy$
      create policy listing_card_images_service_role_delete
      on storage.objects for delete to service_role
      using (bucket_id = 'listing-card-images')
    $policy$;

    execute 'revoke all on table storage.objects from public, anon, authenticated';
    execute 'grant select, insert, update, delete on table storage.objects to service_role';
  end if;
end;
$$;

create table if not exists public.request_logs (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  tenant_id text not null default 'tenant_legacy'
    references public.tenants(id) on delete restrict,
  user_id text references public.users(id) on delete set null,
  api text not null,
  method text,
  status_code integer,
  duration_ms bigint,
  metadata jsonb not null default '{}'::jsonb,
  "timestamp" timestamptz not null default clock_timestamp(),
  constraint request_logs_tenant_request_key unique (tenant_id, request_id),
  constraint request_logs_status_code_check check (
    status_code is null or status_code between 100 and 599
  ),
  constraint request_logs_duration_check check (duration_ms is null or duration_ms >= 0),
  constraint request_logs_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.job_attempt_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'tenant_legacy'
    references public.tenants(id) on delete restrict,
  request_id text,
  batch_id text,
  job_id text not null,
  session_id text,
  attempt_no integer not null default 0,
  event_type text not null,
  physical_status text,
  canonical_status text,
  retry_delay_ms bigint,
  duration_ms bigint,
  error_code text,
  recoverable boolean,
  provider text,
  model_version text,
  prompt_version text,
  input_tokens bigint,
  output_tokens bigint,
  estimated_cost_usd numeric(18, 6),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default clock_timestamp(),
  constraint job_attempt_events_attempt_check check (attempt_no >= 0),
  constraint job_attempt_events_retry_delay_check check (
    retry_delay_ms is null or retry_delay_ms >= 0
  ),
  constraint job_attempt_events_duration_check check (duration_ms is null or duration_ms >= 0),
  constraint job_attempt_events_input_tokens_check check (input_tokens is null or input_tokens >= 0),
  constraint job_attempt_events_output_tokens_check check (output_tokens is null or output_tokens >= 0),
  constraint job_attempt_events_cost_check check (
    estimated_cost_usd is null or estimated_cost_usd >= 0
  ),
  constraint job_attempt_events_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null default 'tenant_legacy'
    references public.tenants(id) on delete restrict,
  request_id text,
  user_id text references public.users(id) on delete set null,
  batch_id text,
  job_id text,
  session_id text,
  error_type text not null,
  message text,
  stack text,
  recoverable boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint error_logs_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.production_events (
  id uuid primary key default gen_random_uuid(),
  request_id text,
  tenant_id text not null default 'tenant_legacy'
    references public.tenants(id) on delete restrict,
  user_id text references public.users(id) on delete set null,
  batch_id text,
  job_id text,
  session_id text,
  event_type text not null,
  duration_ms bigint,
  model_version text,
  prompt_version text,
  route text,
  success boolean,
  provider_calls integer not null default 0,
  input_tokens bigint,
  output_tokens bigint,
  estimated_cost_usd numeric(18, 6),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  constraint production_events_event_type_check check (
    event_type in (
      'upload_started',
      'job_created',
      'recognition_started',
      'provider_called',
      'recognition_completed',
      'recognition_failed',
      'feedback_saved',
      'export_generated'
    )
  ),
  constraint production_events_duration_check check (duration_ms is null or duration_ms >= 0),
  constraint production_events_provider_calls_check check (provider_calls >= 0),
  constraint production_events_input_tokens_check check (input_tokens is null or input_tokens >= 0),
  constraint production_events_output_tokens_check check (output_tokens is null or output_tokens >= 0),
  constraint production_events_cost_check check (
    estimated_cost_usd is null or estimated_cost_usd >= 0
  ),
  constraint production_events_metadata_check check (jsonb_typeof(metadata) = 'object')
);

-- Authentication failures and internal maintenance requests legitimately have
-- no customer tenant yet. Authenticated customer flows still write a concrete
-- tenant_id, while unauthenticated request/error logs remain explicitly null.
alter table public.request_logs
  alter column tenant_id drop default,
  alter column tenant_id drop not null;
alter table public.error_logs
  alter column tenant_id drop default,
  alter column tenant_id drop not null;

-- Observability rows inherit ownership from durable work when a correlation
-- key is present. Events without a parent (for example upload_started) must
-- provide tenant_id explicitly.
do $$
declare
  v_lineage record;
  v_trigger_name text;
begin
  for v_lineage in
    select *
    from (values
      ('job_attempt_events', 'job_id', 'v4_recognition_jobs', 'id'),
      ('error_logs', 'job_id', 'v4_recognition_jobs', 'id'),
      ('error_logs', 'session_id', 'v4_recognition_sessions', 'id'),
      ('production_events', 'job_id', 'v4_recognition_jobs', 'id'),
      ('production_events', 'session_id', 'v4_recognition_sessions', 'id'),
      ('production_events', 'batch_id', 'v4_recognition_batches', 'id')
    ) as lineage(child_table, child_key, parent_table, parent_key)
  loop
    if pg_catalog.to_regclass(format('public.%I', v_lineage.parent_table)) is null then
      continue;
    end if;

    execute format(
      'alter table public.%I alter column tenant_id drop default',
      v_lineage.child_table
    );
    v_trigger_name := left(
      'track_c_tenant_lineage_' || v_lineage.child_key || '_' || v_lineage.parent_table,
      63
    );
    execute format(
      'drop trigger if exists %I on public.%I',
      v_trigger_name,
      v_lineage.child_table
    );
    execute format(
      'create trigger %I before insert or update of tenant_id, %I on public.%I for each row execute function private.enforce_tenant_from_parent(%L, %L, %L)',
      v_trigger_name,
      v_lineage.child_key,
      v_lineage.child_table,
      v_lineage.parent_table,
      v_lineage.child_key,
      v_lineage.parent_key
    );
  end loop;
end;
$$;

create index if not exists request_logs_tenant_timestamp_idx
  on public.request_logs(tenant_id, "timestamp" desc);
create index if not exists request_logs_tenant_user_timestamp_idx
  on public.request_logs(tenant_id, user_id, "timestamp" desc);
create index if not exists job_attempt_events_tenant_job_attempt_idx
  on public.job_attempt_events(tenant_id, job_id, attempt_no, occurred_at);
create index if not exists job_attempt_events_tenant_event_idx
  on public.job_attempt_events(tenant_id, event_type, occurred_at desc);
create index if not exists error_logs_tenant_created_idx
  on public.error_logs(tenant_id, created_at desc);
create index if not exists error_logs_tenant_session_idx
  on public.error_logs(tenant_id, session_id, created_at desc)
  where session_id is not null;
create index if not exists production_events_tenant_event_created_idx
  on public.production_events(tenant_id, event_type, created_at desc);
create index if not exists production_events_tenant_session_created_idx
  on public.production_events(tenant_id, session_id, created_at desc)
  where session_id is not null;
create index if not exists production_events_tenant_cost_created_idx
  on public.production_events(tenant_id, created_at desc)
  include (provider_calls, input_tokens, output_tokens, estimated_cost_usd);

alter table public.request_logs enable row level security;
alter table public.job_attempt_events enable row level security;
alter table public.error_logs enable row level security;
alter table public.production_events enable row level security;

revoke all on table public.request_logs from public, anon, authenticated;
revoke all on table public.job_attempt_events from public, anon, authenticated;
revoke all on table public.error_logs from public, anon, authenticated;
revoke all on table public.production_events from public, anon, authenticated;
revoke all on table public.request_logs from service_role;
revoke all on table public.job_attempt_events from service_role;
revoke all on table public.error_logs from service_role;
revoke all on table public.production_events from service_role;

-- These ledgers are append-only. Corrections are new events, never mutation of
-- historical evidence.
grant select, insert on table public.request_logs to service_role;
grant select, insert on table public.job_attempt_events to service_role;
grant select, insert on table public.error_logs to service_role;
grant select, insert on table public.production_events to service_role;
revoke all on table public.request_logs from authenticated;
revoke all on table public.job_attempt_events from authenticated;
revoke all on table public.error_logs from authenticated;
revoke all on table public.production_events from authenticated;

drop policy if exists track_c_request_logs_select on public.request_logs;
create policy track_c_request_logs_select
  on public.request_logs for select to authenticated
  using (private.has_tenant_permission(tenant_id, 'VIEW_ALL'));

drop policy if exists track_c_job_attempt_events_select on public.job_attempt_events;
create policy track_c_job_attempt_events_select
  on public.job_attempt_events for select to authenticated
  using (private.has_tenant_permission(tenant_id, 'VIEW_ALL'));

drop policy if exists track_c_error_logs_select on public.error_logs;
create policy track_c_error_logs_select
  on public.error_logs for select to authenticated
  using (private.has_tenant_permission(tenant_id, 'VIEW_ALL'));

drop policy if exists track_c_production_events_select on public.production_events;
create policy track_c_production_events_select
  on public.production_events for select to authenticated
  using (private.has_tenant_permission(tenant_id, 'VIEW_COSTS'));

comment on column public.request_logs.metadata is
  'Sanitized request metadata only. Never store auth tokens, API keys, signed URLs, or image payloads.';
comment on column public.job_attempt_events.metadata is
  'Sanitized attempt diagnostics only. Never store provider secrets, prompts with customer images, or signed URLs.';
comment on column public.error_logs.stack is
  'Server-side sanitized stack trace. Scrub secrets, credentials, URLs, and customer image payloads before insert.';
comment on column public.production_events.metadata is
  'Sanitized event metadata only. Never store secrets, credentials, signed URLs, or raw image payloads.';

-- Correlate quality, request, retry, and cost ledgers without changing the
-- existing persistence function's required column list.
do $$
begin
  if pg_catalog.to_regclass('public.v4_production_quality_ledger') is not null then
    alter table public.v4_production_quality_ledger
      add column if not exists request_id text,
      add column if not exists batch_id text,
      add column if not exists job_id text,
      add column if not exists user_id text,
      add column if not exists attempt_no integer,
      add column if not exists prompt_version text,
      add column if not exists model_version text,
      add column if not exists success boolean,
      add column if not exists provider_calls integer not null default 0,
      add column if not exists input_cost_usd numeric(18, 6),
      add column if not exists output_cost_usd numeric(18, 6),
      add column if not exists estimated_cost_usd numeric(18, 6),
      add column if not exists cost_currency text not null default 'USD';

    create index if not exists v4_quality_ledger_tenant_created_idx
      on public.v4_production_quality_ledger(tenant_id, created_at desc);
    create index if not exists v4_quality_ledger_tenant_request_idx
      on public.v4_production_quality_ledger(tenant_id, request_id)
      where request_id is not null;
    create index if not exists v4_quality_ledger_tenant_job_attempt_idx
      on public.v4_production_quality_ledger(tenant_id, job_id, attempt_no)
      where job_id is not null;

    revoke all on table public.v4_production_quality_ledger from authenticated;
    drop policy if exists track_c_tenant_select on public.v4_production_quality_ledger;
    drop policy if exists track_c_tenant_insert on public.v4_production_quality_ledger;
    drop policy if exists track_c_tenant_update on public.v4_production_quality_ledger;
    drop policy if exists track_c_tenant_delete on public.v4_production_quality_ledger;
    drop policy if exists track_c_quality_ledger_cost_select on public.v4_production_quality_ledger;
    create policy track_c_quality_ledger_cost_select
      on public.v4_production_quality_ledger
      for select
      to authenticated
      using (private.has_tenant_permission(tenant_id, 'VIEW_COSTS'));
  end if;
end;
$$;

-- Export generation is OWNER-only in v1; service_role retains the server path.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['v4_writer_export_batches', 'v4_writer_export_items'] loop
    if pg_catalog.to_regclass(format('public.%I', v_table)) is null then
      continue;
    end if;
    execute format('drop policy if exists track_c_tenant_insert on public.%I', v_table);
    execute format('drop policy if exists track_c_tenant_update on public.%I', v_table);
    execute format('drop policy if exists track_c_tenant_delete on public.%I', v_table);
    execute format(
      'create policy track_c_tenant_insert on public.%I for insert to authenticated with check (private.has_tenant_permission(tenant_id, %L))',
      v_table,
      'EXPORT'
    );
    execute format(
      'create policy track_c_tenant_update on public.%I for update to authenticated using (private.has_tenant_permission(tenant_id, %L)) with check (private.has_tenant_permission(tenant_id, %L))',
      v_table,
      'EXPORT',
      'EXPORT'
    );
    execute format(
      'create policy track_c_tenant_delete on public.%I for delete to authenticated using (private.has_tenant_permission(tenant_id, %L))',
      v_table,
      'EXPORT'
    );
  end loop;
end;
$$;

-- Writers can submit and view their own feedback records. Broader team reads
-- remain OWNER/MANAGER-only through the generic tenant policy.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['listing_reviews', 'v4_writer_feedback_events'] loop
    if pg_catalog.to_regclass(format('public.%I', v_table)) is null
       or not exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = v_table
           and column_name = 'operator_id'
       ) then
      continue;
    end if;

    execute format('drop policy if exists track_c_writer_feedback_select on public.%I', v_table);
    execute format(
      'create policy track_c_writer_feedback_select on public.%I for select to authenticated using (private.has_tenant_permission(tenant_id, %L) and private.current_user_matches_operator(operator_id))',
      v_table,
      'SUBMIT_FEEDBACK'
    );
    execute format('drop policy if exists track_c_writer_feedback_insert on public.%I', v_table);
    execute format(
      'create policy track_c_writer_feedback_insert on public.%I for insert to authenticated with check (private.has_tenant_permission(tenant_id, %L) and private.current_user_matches_operator(operator_id))',
      v_table,
      'SUBMIT_FEEDBACK'
    );
    execute format('drop policy if exists track_c_writer_feedback_update on public.%I', v_table);
    execute format(
      'create policy track_c_writer_feedback_update on public.%I for update to authenticated using (private.has_tenant_permission(tenant_id, %L) and private.current_user_matches_operator(operator_id)) with check (private.has_tenant_permission(tenant_id, %L) and private.current_user_matches_operator(operator_id))',
      v_table,
      'SUBMIT_FEEDBACK',
      'SUBMIT_FEEDBACK'
    );
  end loop;
end;
$$;

-- Tenant-aware writer feedback transaction. The legacy five-argument overload
-- remains service-role-only for rollout compatibility; customer APIs must use
-- this six-argument contract. Tenant/session/operator mismatches deliberately
-- return the same non-disclosing result.
create or replace function public.persist_v4_writer_feedback_transaction(
  p_tenant_id text,
  p_session_id text,
  p_operator_id text,
  p_session_status text,
  p_feedback_event jsonb,
  p_learning_event jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_session_writer_id text;
  v_operator_role text;
  v_feedback_id text := nullif(p_feedback_event ->> 'id', '');
  v_learning_id text := nullif(p_learning_event ->> 'id', '');
  v_writer_title text := nullif(p_feedback_event ->> 'writer_final_title', '');
  v_write_count integer := 0;
begin
  if nullif(btrim(p_tenant_id), '') is null
     or nullif(btrim(p_session_id), '') is null
     or nullif(btrim(p_operator_id), '') is null
     or v_feedback_id is null
     or v_learning_id is null
     or p_session_status not in ('ACCEPTED', 'EDITED', 'REJECTED')
     or p_feedback_event ->> 'recognition_session_id' is distinct from p_session_id
     or p_learning_event ->> 'recognition_session_id' is distinct from p_session_id
     or (
       nullif(p_feedback_event ->> 'tenant_id', '') is not null
       and p_feedback_event ->> 'tenant_id' is distinct from p_tenant_id
     )
     or (
       nullif(p_learning_event ->> 'tenant_id', '') is not null
       and p_learning_event ->> 'tenant_id' is distinct from p_tenant_id
     ) then
    return jsonb_build_object(
      'saved', false,
      'reason', 'not_found_or_not_owned'
    );
  end if;

  select coalesce(
    sessions.assigned_to_user_id,
    sessions.created_by_user_id,
    sessions.operator_id
  ), (
    select member.role
    from public.tenant_members member
    join public.users app_user on app_user.id = member.user_id
    join public.tenants tenant on tenant.id = member.tenant_id
    where member.tenant_id = p_tenant_id
      and member.user_id = p_operator_id
      and member.status = 'ACTIVE'
      and member.disabled_at is null
      and app_user.status = 'ACTIVE'
      and app_user.disabled_at is null
      and tenant.status = 'ACTIVE'
      and tenant.disabled_at is null
    limit 1
  )
  into v_session_writer_id, v_operator_role
  from public.v4_recognition_sessions sessions
  where sessions.id = p_session_id
    and sessions.tenant_id = p_tenant_id
  for update;

  if not found or (
    v_session_writer_id is distinct from p_operator_id
    and v_operator_role is distinct from 'OWNER'
  ) then
    return jsonb_build_object(
      'saved', false,
      'reason', 'not_found_or_not_owned'
    );
  end if;

  -- The exception block is a subtransaction: if either globally-unique event
  -- id belongs to another tenant, no partial feedback/learning write survives.
  begin
    insert into public.v4_writer_feedback_events (
      id,
      tenant_id,
      recognition_session_id,
      schema_version,
      action,
      generated_title,
      writer_final_title,
      title_diff,
      field_graph,
      correction_type,
      operator_id,
      created_at,
      sem_standard_version
    ) values (
      v_feedback_id,
      p_tenant_id,
      p_session_id,
      coalesce(nullif(p_feedback_event ->> 'schema_version', ''), 'v4-recognition-session-v1'),
      coalesce(nullif(p_feedback_event ->> 'action', ''), 'EDIT'),
      nullif(p_feedback_event ->> 'generated_title', ''),
      v_writer_title,
      coalesce(p_feedback_event -> 'title_diff', '{}'::jsonb),
      coalesce(p_feedback_event -> 'field_graph', '{}'::jsonb),
      nullif(p_feedback_event ->> 'correction_type', ''),
      p_operator_id,
      coalesce(nullif(p_feedback_event ->> 'created_at', '')::timestamptz, clock_timestamp()),
      coalesce(nullif(p_feedback_event ->> 'sem_standard_version', ''), 'linear-cos-10-23-v25')
    )
    on conflict (id) do update
    set action = excluded.action,
        generated_title = excluded.generated_title,
        writer_final_title = excluded.writer_final_title,
        title_diff = excluded.title_diff,
        field_graph = excluded.field_graph,
        correction_type = excluded.correction_type,
        operator_id = excluded.operator_id,
        sem_standard_version = excluded.sem_standard_version
    where v4_writer_feedback_events.tenant_id = p_tenant_id
      and v4_writer_feedback_events.recognition_session_id = p_session_id;

    get diagnostics v_write_count = row_count;
    if v_write_count <> 1 then
      raise exception 'track_c_feedback_tenant_conflict';
    end if;

    insert into public.v4_learning_events (
      id,
      tenant_id,
      recognition_session_id,
      schema_version,
      event_type,
      generated_title,
      writer_final_title,
      field_level_ground_truth,
      candidate_reranker_dataset,
      hard_negative_samples,
      training_eligible,
      created_at,
      feedback_training_event,
      field_level_diff,
      candidate_changes,
      sem_standard_version,
      feedback_layer,
      semantic_learning_status,
      semantic_truth,
      writer_semantic_label_required
    ) values (
      v_learning_id,
      p_tenant_id,
      p_session_id,
      coalesce(nullif(p_learning_event ->> 'schema_version', ''), 'v4-recognition-session-v1'),
      coalesce(nullif(p_learning_event ->> 'event_type', ''), 'WRITER_EDIT'),
      nullif(p_learning_event ->> 'generated_title', ''),
      nullif(p_learning_event ->> 'writer_final_title', ''),
      coalesce(p_learning_event -> 'field_level_ground_truth', '[]'::jsonb),
      coalesce(p_learning_event -> 'candidate_reranker_dataset', '[]'::jsonb),
      coalesce(p_learning_event -> 'hard_negative_samples', '[]'::jsonb),
      coalesce((p_learning_event ->> 'training_eligible')::boolean, false),
      coalesce(nullif(p_learning_event ->> 'created_at', '')::timestamptz, clock_timestamp()),
      coalesce(p_learning_event -> 'feedback_training_event', '{}'::jsonb),
      coalesce(p_learning_event -> 'field_level_diff', '[]'::jsonb),
      coalesce(p_learning_event -> 'candidate_changes', '{}'::jsonb),
      coalesce(nullif(p_learning_event ->> 'sem_standard_version', ''), 'linear-cos-10-23-v25'),
      coalesce(nullif(p_learning_event ->> 'feedback_layer', ''), 'COMMERCIAL_FEEDBACK'),
      coalesce(nullif(p_learning_event ->> 'semantic_learning_status', ''), 'TRAINING_CANDIDATE_FROM_WRITER_TITLE'),
      coalesce((p_learning_event ->> 'semantic_truth')::boolean, false),
      coalesce((p_learning_event ->> 'writer_semantic_label_required')::boolean, false)
    )
    on conflict (id) do update
    set event_type = excluded.event_type,
        generated_title = excluded.generated_title,
        writer_final_title = excluded.writer_final_title,
        field_level_ground_truth = excluded.field_level_ground_truth,
        candidate_reranker_dataset = excluded.candidate_reranker_dataset,
        hard_negative_samples = excluded.hard_negative_samples,
        training_eligible = excluded.training_eligible,
        feedback_training_event = excluded.feedback_training_event,
        field_level_diff = excluded.field_level_diff,
        candidate_changes = excluded.candidate_changes,
        sem_standard_version = excluded.sem_standard_version,
        feedback_layer = excluded.feedback_layer,
        semantic_learning_status = excluded.semantic_learning_status,
        semantic_truth = excluded.semantic_truth,
        writer_semantic_label_required = excluded.writer_semantic_label_required
    where v4_learning_events.tenant_id = p_tenant_id
      and v4_learning_events.recognition_session_id = p_session_id;

    get diagnostics v_write_count = row_count;
    if v_write_count <> 1 then
      raise exception 'track_c_learning_tenant_conflict';
    end if;

    update public.v4_recognition_sessions sessions
    set status = p_session_status,
        writer_final_title = v_writer_title,
        writer_feedback_event_id = v_feedback_id,
        learning_event_id = v_learning_id,
        updated_at = clock_timestamp()
    where sessions.id = p_session_id
      and sessions.tenant_id = p_tenant_id
      and (
        coalesce(
          sessions.assigned_to_user_id,
          sessions.created_by_user_id,
          sessions.operator_id
        ) = p_operator_id
        or v_operator_role = 'OWNER'
      );

    get diagnostics v_write_count = row_count;
    if v_write_count <> 1 then
      raise exception 'track_c_session_tenant_conflict';
    end if;
  exception
    when raise_exception then
      if sqlerrm in (
        'track_c_feedback_tenant_conflict',
        'track_c_learning_tenant_conflict',
        'track_c_session_tenant_conflict'
      ) then
        return jsonb_build_object(
          'saved', false,
          'reason', 'not_found_or_not_owned'
        );
      end if;
      raise;
  end;

  return jsonb_build_object(
    'saved', true,
    'tenant_id', p_tenant_id,
    'recognition_session_id', p_session_id,
    'status', p_session_status,
    'feedback_event_id', v_feedback_id,
    'learning_event_id', v_learning_id
  );
end;
$$;

revoke all on function public.persist_v4_writer_feedback_transaction(
  text, text, text, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.persist_v4_writer_feedback_transaction(
  text, text, text, text, jsonb, jsonb
) to service_role;

-- Assignment is one service-role transaction scoped to a recognition session
-- (one writer-visible card). Paired L1/L2 jobs move together; a batch can hold
-- many independently assigned cards and is therefore not an assignment unit.
-- Creator/operator attribution remains immutable audit history.
create or replace function public.assign_v4_recognition_job(
  p_tenant_id text,
  p_job_id text,
  p_assigned_to_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.v4_recognition_jobs%rowtype;
  v_batch_id text;
  v_session_id text;
  v_write_count integer := 0;
begin
  if nullif(btrim(p_tenant_id), '') is null
     or nullif(btrim(p_job_id), '') is null
     or nullif(btrim(p_assigned_to_user_id), '') is null then
    return jsonb_build_object('saved', false, 'reason', 'invalid_request');
  end if;

  if not exists (
    select 1
    from public.tenant_members member
    join public.users app_user on app_user.id = member.user_id
    join public.tenants tenant on tenant.id = member.tenant_id
    where member.tenant_id = p_tenant_id
      and member.user_id = p_assigned_to_user_id
      and member.status = 'ACTIVE'
      and member.disabled_at is null
      and app_user.status = 'ACTIVE'
      and app_user.disabled_at is null
      and tenant.status = 'ACTIVE'
      and tenant.disabled_at is null
  ) then
    return jsonb_build_object('saved', false, 'reason', 'assignee_not_active_member');
  end if;

  select jobs.*
  into v_job
  from public.v4_recognition_jobs jobs
  where jobs.tenant_id = p_tenant_id
    and jobs.id = p_job_id;

  if not found then
    return jsonb_build_object('saved', false, 'reason', 'not_found_or_not_owned');
  end if;

  v_batch_id := v_job.batch_id;
  v_session_id := v_job.recognition_session_id;

  if v_batch_id is null then
    return jsonb_build_object('saved', false, 'reason', 'related_batch_missing');
  end if;
  if v_session_id is null then
    return jsonb_build_object('saved', false, 'reason', 'related_session_missing');
  end if;

  perform 1
  from public.v4_recognition_batches batches
  where batches.tenant_id = p_tenant_id
    and batches.id = v_batch_id;
  if not found then
    return jsonb_build_object('saved', false, 'reason', 'related_batch_missing');
  end if;

  -- Lock the session before any job in it. Concurrent assignments through two
  -- paired job IDs then serialize on the same row instead of deadlocking.
  perform 1
  from public.v4_recognition_sessions sessions
  where sessions.tenant_id = p_tenant_id
    and sessions.id = v_session_id
  for update;
  if not found then
    return jsonb_build_object('saved', false, 'reason', 'related_session_missing');
  end if;

  perform 1
  from public.v4_recognition_jobs jobs
  where jobs.tenant_id = p_tenant_id
    and jobs.recognition_session_id = v_session_id
  order by jobs.id
  for update;

  -- Recheck the addressed row after acquiring the canonical session/job lock
  -- set in case an older writer changed its relationship during the first read.
  select jobs.*
  into v_job
  from public.v4_recognition_jobs jobs
  where jobs.tenant_id = p_tenant_id
    and jobs.id = p_job_id
    and jobs.batch_id = v_batch_id
    and jobs.recognition_session_id = v_session_id
  for update;
  if not found then
    return jsonb_build_object('saved', false, 'reason', 'assignment_state_changed');
  end if;

  update public.v4_recognition_sessions sessions
  set assigned_to_user_id = p_assigned_to_user_id,
      updated_at = clock_timestamp()
  where sessions.tenant_id = p_tenant_id
    and sessions.id = v_session_id;
  get diagnostics v_write_count = row_count;
  if v_write_count <> 1 then raise exception 'track_c_assignment_state_changed'; end if;

  update public.v4_recognition_jobs jobs
  set assigned_to_user_id = p_assigned_to_user_id,
      updated_at = clock_timestamp()
  where jobs.tenant_id = p_tenant_id
    and jobs.recognition_session_id = v_session_id;
  get diagnostics v_write_count = row_count;
  if v_write_count < 1 then raise exception 'track_c_assignment_state_changed'; end if;

  return jsonb_build_object(
    'saved', true,
    'job_id', v_job.id,
    'batch_id', v_batch_id,
    'recognition_session_id', v_session_id,
    'assigned_to_user_id', p_assigned_to_user_id,
    'assigned_job_count', v_write_count
  );
end;
$$;

revoke all on function public.assign_v4_recognition_job(text, text, text)
  from public, anon, authenticated;
grant execute on function public.assign_v4_recognition_job(text, text, text)
  to service_role;

create or replace function public.track_c_ops_snapshot(
  p_tenant_id text default null,
  p_since timestamptz default date_trunc('day', clock_timestamp())
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_since timestamptz := coalesce(p_since, date_trunc('day', clock_timestamp()));
  v_generated_at timestamptz := clock_timestamp();
  v_queued bigint := 0;
  v_interactive_queued bigint := 0;
  v_background_queued bigint := 0;
  v_running bigint := 0;
  v_completed bigint := 0;
  v_retryable_failed bigint := 0;
  v_failed_final bigint := 0;
  v_retry_count bigint := 0;
  v_average_wait_ms double precision := 0;
  v_p50_wait_ms double precision := 0;
  v_p95_wait_ms double precision := 0;
  v_p50_writer_visible_latency_ms double precision := 0;
  v_p95_writer_visible_latency_ms double precision := 0;
  v_recognition_volume bigint := 0;
  v_recognition_success bigint := 0;
  v_recognition_failed bigint := 0;
  v_feedback_count bigint := 0;
  v_accept_count bigint := 0;
  v_edit_count bigint := 0;
  v_reject_count bigint := 0;
  v_provider_calls bigint := 0;
  v_provider_call_event_count bigint := 0;
  v_priced_call_event_count bigint := 0;
  v_input_tokens bigint := 0;
  v_output_tokens bigint := 0;
  v_estimated_cost_usd numeric := 0;
  v_lane_expression text := '''background''::text';
begin
  if pg_catalog.to_regclass('public.v4_recognition_jobs') is not null then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'v4_recognition_jobs'
        and column_name = 'lane'
    ) then
      v_lane_expression := 'jobs.lane';
    end if;

    execute replace($query$
      select
        count(*) filter (where status in ('QUEUED', 'RETRYING')),
        count(*) filter (where status in ('QUEUED', 'RETRYING') and __lane__ = 'interactive'),
        count(*) filter (where status in ('QUEUED', 'RETRYING') and __lane__ = 'background'),
        count(*) filter (where status = 'RUNNING' and lease_expires_at > $3),
        count(*) filter (
          where status in ('L1_READY', 'L2_READY')
            and completed_at >= $2
        ),
        count(*) filter (where status = 'RETRYING'),
        count(*) filter (
          where status in ('FAILED', 'CANCELLED')
            and coalesce(completed_at, updated_at) >= $2
        ),
        coalesce(avg(
          greatest(0, extract(epoch from (started_at - created_at)) * 1000)
        ) filter (where started_at >= $2), 0),
        coalesce(percentile_cont(0.50) within group (
          order by greatest(0, extract(epoch from (started_at - created_at)) * 1000)
        ) filter (where started_at >= $2), 0),
        coalesce(percentile_cont(0.95) within group (
          order by greatest(0, extract(epoch from (started_at - created_at)) * 1000)
        ) filter (where started_at >= $2), 0)
      from public.v4_recognition_jobs jobs
      where ($1 is null or tenant_id = $1)
    $query$, '__lane__', v_lane_expression)
    into
      v_queued,
      v_interactive_queued,
      v_background_queued,
      v_running,
      v_completed,
      v_retryable_failed,
      v_failed_final,
      v_average_wait_ms,
      v_p50_wait_ms,
      v_p95_wait_ms
    using p_tenant_id, v_since, v_generated_at;

    -- L1 and L2 can both complete for one recognition session. Writer-visible
    -- latency is the first successful completion per card, not an average of
    -- both pipeline jobs.
    execute $query$
      with writer_ready_cards as (
        select
          coalesce(nullif(recognition_session_id, ''), id) as card_key,
          min(created_at) as card_created_at,
          min(completed_at) as writer_ready_at
        from public.v4_recognition_jobs
        where ($1 is null or tenant_id = $1)
          and status in ('L1_READY', 'L2_READY')
          and completed_at is not null
        group by coalesce(nullif(recognition_session_id, ''), id)
      )
      select
        coalesce(percentile_cont(0.50) within group (
          order by greatest(0, extract(epoch from (writer_ready_at - card_created_at)) * 1000)
        ), 0),
        coalesce(percentile_cont(0.95) within group (
          order by greatest(0, extract(epoch from (writer_ready_at - card_created_at)) * 1000)
        ), 0)
      from writer_ready_cards
      where writer_ready_at >= $2
    $query$
    into
      v_p50_writer_visible_latency_ms,
      v_p95_writer_visible_latency_ms
    using p_tenant_id, v_since;
  end if;

  select count(*)
  into v_retry_count
  from public.job_attempt_events
  where (p_tenant_id is null or tenant_id = p_tenant_id)
    and occurred_at >= v_since
    and event_type = 'ATTEMPT_STARTED'
    and attempt_no > 1;

  -- A card can emit several failed-attempt events before succeeding. Count
  -- the latest terminal outcome per session (or job when no session exists),
  -- and exclude retryable failures from the card-level denominator.
  with terminal_outcomes as (
    select
      coalesce(nullif(session_id, ''), nullif(job_id, ''), id::text) as card_key,
      event_type,
      success,
      created_at,
      id
    from public.production_events
    where (p_tenant_id is null or tenant_id = p_tenant_id)
      and created_at >= v_since
      and (
        event_type = 'recognition_completed'
        or (
          event_type = 'recognition_failed'
          and lower(coalesce(metadata ->> 'recoverable', 'false')) <> 'true'
        )
      )
  ), latest_terminal_outcomes as (
    select distinct on (card_key)
      card_key,
      event_type,
      success
    from terminal_outcomes
    order by card_key, created_at desc, id desc
  )
  select
    count(*),
    count(*) filter (
      where event_type = 'recognition_completed'
        and coalesce(success, true)
    ),
    count(*) filter (
      where event_type = 'recognition_failed'
        or (event_type = 'recognition_completed' and success is false)
    )
  into
    v_recognition_volume,
    v_recognition_success,
    v_recognition_failed
  from latest_terminal_outcomes;

  with feedback_outcomes as (
    select
      coalesce(nullif(session_id, ''), nullif(job_id, ''), id::text) as card_key,
      upper(coalesce(
        metadata ->> 'action',
        metadata ->> 'feedback_status',
        metadata ->> 'review_outcome',
        ''
      )) as outcome,
      created_at,
      id
    from public.production_events
    where (p_tenant_id is null or tenant_id = p_tenant_id)
      and created_at >= v_since
      and event_type = 'feedback_saved'
  ), latest_feedback_outcomes as (
    select distinct on (card_key)
      card_key,
      outcome
    from feedback_outcomes
    order by card_key, created_at desc, id desc
  )
  select
    count(*) filter (where outcome in ('ACCEPT', 'ACCEPTED', 'ACCEPTED_UNCHANGED')),
    count(*) filter (
      where outcome in (
        'EDIT', 'EDITED', 'CORRECTED_TITLE', 'CORRECTED_FIELDS', 'TITLE_ONLY_OVERRIDE'
      )
    ),
    count(*) filter (where outcome in ('REJECT', 'REJECTED'))
  into
    v_accept_count,
    v_edit_count,
    v_reject_count
  from latest_feedback_outcomes;

  v_feedback_count := v_accept_count + v_edit_count + v_reject_count;

  select
    coalesce(sum(
      case
        when event_type = 'provider_called' then greatest(provider_calls, 1)
        else 0
      end
    ), 0),
    count(*) filter (where event_type = 'provider_called'),
    count(*) filter (
      where event_type = 'provider_called'
        and estimated_cost_usd is not null
    ),
    coalesce(sum(input_tokens) filter (where event_type = 'provider_called'), 0),
    coalesce(sum(output_tokens) filter (where event_type = 'provider_called'), 0),
    sum(estimated_cost_usd) filter (
      where event_type = 'provider_called'
        and estimated_cost_usd is not null
    )
  into
    v_provider_calls,
    v_provider_call_event_count,
    v_priced_call_event_count,
    v_input_tokens,
    v_output_tokens,
    v_estimated_cost_usd
  from public.production_events
  where (p_tenant_id is null or tenant_id = p_tenant_id)
    and created_at >= v_since;

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'generated_at', v_generated_at,
    'window', jsonb_build_object(
      'since', v_since,
      'until', v_generated_at
    ),
    'queue', jsonb_build_object(
      'queued', v_queued,
      'interactive_queued', v_interactive_queued,
      'background_queued', v_background_queued,
      'running', v_running,
      'completed', v_completed,
      'retryable_failed', v_retryable_failed,
      'failed_final', v_failed_final,
      'retry_count', v_retry_count,
      'average_wait_ms', v_average_wait_ms,
      'p50_wait_ms', v_p50_wait_ms,
      'p95_wait_ms', v_p95_wait_ms,
      'p50_writer_visible_latency_ms', v_p50_writer_visible_latency_ms,
      'p95_writer_visible_latency_ms', v_p95_writer_visible_latency_ms
    ),
    'ai', jsonb_build_object(
      'recognition_count', v_recognition_volume,
      'success_count', v_recognition_success,
      'failed_count', v_recognition_failed,
      'success_rate', case
        when v_recognition_volume = 0 then null
        else v_recognition_success::numeric / v_recognition_volume
      end
    ),
    'feedback', jsonb_build_object(
      'feedback_count', v_feedback_count,
      'accept_count', v_accept_count,
      'edit_count', v_edit_count,
      'reject_count', v_reject_count,
      'accept_rate', case
        when v_feedback_count = 0 then null
        else v_accept_count::numeric / v_feedback_count
      end,
      'edit_rate', case
        when v_feedback_count = 0 then null
        else v_edit_count::numeric / v_feedback_count
      end,
      'reject_rate', case
        when v_feedback_count = 0 then null
        else v_reject_count::numeric / v_feedback_count
      end
    ),
    'cost', jsonb_build_object(
      'provider_calls', v_provider_calls,
      'provider_call_events', v_provider_call_event_count,
      'priced_call_events', v_priced_call_event_count,
      'input_tokens', v_input_tokens,
      'output_tokens', v_output_tokens,
      'total_tokens', v_input_tokens + v_output_tokens,
      'estimated_cost_usd', v_estimated_cost_usd,
      'average_cost_per_successful_card_usd', case
        when v_provider_call_event_count = 0
          or v_priced_call_event_count <> v_provider_call_event_count
          or v_recognition_success = 0
          then null
        else v_estimated_cost_usd / v_recognition_success
      end,
      'cost_configured', v_provider_call_event_count > 0
        and v_priced_call_event_count = v_provider_call_event_count
    ),
    'coverage', jsonb_build_object(
      'feedback_rate', case
        when v_recognition_success = 0 then null
        else least(1::numeric, v_feedback_count::numeric / v_recognition_success)
      end,
      'pricing_rate', case
        when v_provider_call_event_count = 0 then null
        else v_priced_call_event_count::numeric / v_provider_call_event_count
      end
    )
  );
end;
$$;

revoke all on function public.track_c_ops_snapshot(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.track_c_ops_snapshot(text, timestamptz)
  to service_role;

-- A later security-definer function was created after the repository-wide
-- search_path hardening migration. Its body already schema-qualifies tables,
-- so an empty path is both compatible and safer.
do $$
begin
  if pg_catalog.to_regprocedure(
    'public.persist_v4_noncritical_artifacts(text,jsonb,jsonb,jsonb,jsonb)'
  ) is not null then
    alter function public.persist_v4_noncritical_artifacts(text, jsonb, jsonb, jsonb, jsonb)
      set search_path = '';
  end if;
end;
$$;

notify pgrst, 'reload schema';
