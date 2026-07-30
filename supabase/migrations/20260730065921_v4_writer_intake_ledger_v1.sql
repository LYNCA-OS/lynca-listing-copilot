set lock_timeout = '5s';
set statement_timeout = '5min';

alter table public.listing_assets
  add column if not exists image_set_finalized_at timestamptz;

-- Existing canonical assets predate the transition clock. Do not stamp them at
-- migration time: the last server-side verification of the complete canonical
-- original set is the earliest durable completion fact already owned by the
-- database. The migration fails closed if any FINALIZED asset cannot prove it.
with canonical_completion as (
  select
    verifications.tenant_id,
    verifications.asset_id,
    pg_catalog.max(verifications.verified_at) as verified_at,
    pg_catalog.count(*) as original_count,
    pg_catalog.count(distinct verifications.storage_role) as original_role_count
  from public.listing_image_verifications verifications
  where verifications.canonical_eligible is true
    and verifications.image_generation_id = verifications.asset_id
    and verifications.storage_role in (
      'image_1_original', 'front_original', 'image_2_original', 'back_original'
    )
  group by verifications.tenant_id, verifications.asset_id
)
update public.listing_assets assets
set image_set_finalized_at = completion.verified_at
from canonical_completion completion
where assets.image_set_state = 'FINALIZED'
  and assets.image_set_finalized_at is null
  and assets.tenant_id = completion.tenant_id
  and assets.id = completion.asset_id
  and assets.image_generation_id = assets.id
  and assets.image_set_sha256 ~ '^[0-9a-f]{64}$'
  and assets.expected_original_count = completion.original_count
  and assets.expected_original_count = completion.original_role_count;

do $$
begin
  if exists (
    select 1
    from public.listing_assets assets
    where assets.image_set_state = 'FINALIZED'
      and assets.image_set_finalized_at is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'listing_asset_finalized_clock_source_missing';
  end if;
end;
$$;

comment on column public.listing_assets.image_set_finalized_at is
  'Canonical durability clock. Existing rows use max canonical-original verified_at; new rows use the FINALIZED state transition clock.';

create or replace function public.stamp_listing_asset_image_set_finalized_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.image_set_state = 'FINALIZED' then
      new.image_set_finalized_at := pg_catalog.clock_timestamp();
    elsif new.image_set_finalized_at is not null then
      raise exception using errcode = '23514', message = 'listing_asset_finalized_clock_requires_finalized_state';
    end if;
    return new;
  end if;

  if old.image_set_state is distinct from 'FINALIZED'
     and new.image_set_state = 'FINALIZED' then
    new.image_set_finalized_at := pg_catalog.clock_timestamp();
  elsif new.image_set_finalized_at is distinct from old.image_set_finalized_at then
    raise exception using errcode = '23514', message = 'listing_asset_finalized_clock_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists zz_listing_assets_image_set_finalized_clock on public.listing_assets;
create trigger zz_listing_assets_image_set_finalized_clock
before insert or update on public.listing_assets
for each row execute function public.stamp_listing_asset_image_set_finalized_at();

revoke all on function public.stamp_listing_asset_image_set_finalized_at()
  from public, anon, authenticated;

-- Durable recognition intent for progressive uploads. This ledger is
-- operational state only: it never owns assets, queue admission, identity,
-- titles, catalog facts, or learning truth.
create table if not exists public.v4_writer_intake_batches (
  id text primary key,
  tenant_id text not null,
  operator_id text not null,
  idempotency_key_sha256 text not null,
  expected_item_count integer not null,
  status text not null default 'COMMITTED',
  committed_at timestamptz not null default clock_timestamp(),
  intake_closed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint v4_writer_intake_batches_id_check
    check (id ~ '^intake_[0-9a-f]{32}$'),
  constraint v4_writer_intake_batches_idempotency_check
    check (idempotency_key_sha256 ~ '^[0-9a-f]{64}$'),
  constraint v4_writer_intake_batches_expected_count_check
    check (expected_item_count between 1 and 1000),
  constraint v4_writer_intake_batches_status_check
    check (status in ('COMMITTED', 'INTAKE_CLOSED', 'CANCELLED')),
  constraint v4_writer_intake_batches_closed_state_check
    check (
      (status = 'COMMITTED' and intake_closed_at is null)
      or (status in ('INTAKE_CLOSED', 'CANCELLED') and intake_closed_at is not null)
    ),
  constraint v4_writer_intake_batches_membership_fkey
    foreign key (tenant_id, operator_id)
    references public.tenant_members(tenant_id, user_id)
    on delete restrict,
  constraint v4_writer_intake_batches_idempotency_key
    unique (tenant_id, operator_id, idempotency_key_sha256),
  constraint v4_writer_intake_batches_tenant_identity_key
    unique (tenant_id, id, operator_id)
);

create table if not exists public.v4_writer_intake_items (
  id text primary key,
  tenant_id text not null,
  batch_id text not null,
  operator_id text not null,
  client_item_ref_sha256 text not null,
  item_position integer not null,
  status text not null default 'DECLARED',
  durability_status text not null default 'PENDING',
  asset_id text,
  queue_job_id text,
  recognition_session_id text,
  pending_queue_job_id text,
  pending_predecessor_queue_job_id text,
  appended_at timestamptz not null default clock_timestamp(),
  asset_admitted_at timestamptz,
  queue_admitted_at timestamptz,
  writer_ready_at timestamptz,
  writer_completed_at timestamptz,
  asset_durable_at timestamptz,
  last_error_code text,
  training_eligible boolean not null default false,
  catalog_promotion_eligible boolean not null default false,
  identity_truth boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint v4_writer_intake_items_id_check
    check (id ~ '^intake_item_[0-9a-f]{32}$'),
  constraint v4_writer_intake_items_ref_check
    check (client_item_ref_sha256 ~ '^[0-9a-f]{64}$'),
  constraint v4_writer_intake_items_position_check
    check (item_position between 1 and 1000),
  constraint v4_writer_intake_items_status_check
    check (status in (
      'DECLARED',
      'ASSET_ADMITTED',
      'QUEUE_ADMITTED',
      'WRITER_TITLE_READY',
      'WRITER_COMPLETED',
      'FAILED_RETRYABLE',
      'FAILED_TERMINAL',
      'CANCELLED'
    )),
  constraint v4_writer_intake_items_durability_status_check
    check (durability_status in ('PENDING', 'DURABLE', 'FAILED_RETRYABLE', 'FAILED_TERMINAL')),
  constraint v4_writer_intake_items_truth_boundary_check
    check (not training_eligible and not catalog_promotion_eligible and not identity_truth),
  constraint v4_writer_intake_items_asset_state_check
    check (
      (asset_id is null and asset_admitted_at is null)
      or (asset_id is not null and asset_admitted_at is not null)
    ),
  constraint v4_writer_intake_items_queue_state_check
    check (
      (queue_job_id is null and queue_admitted_at is null)
      or (queue_job_id is not null and queue_admitted_at is not null and asset_id is not null)
    ),
  constraint v4_writer_intake_items_pending_queue_id_check
    check (
      pending_queue_job_id is null
      or pending_queue_job_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$'
    ),
  constraint v4_writer_intake_items_pending_predecessor_id_check
    check (
      pending_predecessor_queue_job_id is null
      or pending_predecessor_queue_job_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$'
    ),
  constraint v4_writer_intake_items_writer_clock_check
    check (
      (writer_completed_at is null or writer_ready_at is not null)
      and (asset_durable_at is null or durability_status = 'DURABLE')
    ),
  constraint v4_writer_intake_items_lifecycle_state_check
    check (
      (status = 'DECLARED' and asset_id is null and queue_job_id is null)
      or (status = 'ASSET_ADMITTED' and asset_id is not null and queue_job_id is null)
      or (status = 'QUEUE_ADMITTED' and queue_job_id is not null)
      or (status = 'WRITER_TITLE_READY' and queue_job_id is not null and writer_ready_at is not null)
      or (
        status = 'WRITER_COMPLETED'
        and queue_job_id is not null
        and writer_ready_at is not null
        and writer_completed_at is not null
      )
      or status in ('FAILED_RETRYABLE', 'FAILED_TERMINAL', 'CANCELLED')
    ),
  constraint v4_writer_intake_items_batch_fkey
    foreign key (tenant_id, batch_id, operator_id)
    references public.v4_writer_intake_batches(tenant_id, id, operator_id)
    on delete restrict,
  constraint v4_writer_intake_items_identity_key
    unique (tenant_id, batch_id, client_item_ref_sha256),
  constraint v4_writer_intake_items_position_key
    unique (tenant_id, batch_id, item_position)
);

create unique index if not exists listing_assets_tenant_id_id_uidx
  on public.listing_assets(tenant_id, id);

alter table public.v4_writer_intake_items
  add constraint v4_writer_intake_items_asset_fkey
  foreign key (tenant_id, asset_id)
  references public.listing_assets(tenant_id, id)
  on delete restrict;

alter table public.v4_writer_intake_items
  add constraint v4_writer_intake_items_queue_job_fkey
  foreign key (tenant_id, queue_job_id)
  references public.v4_recognition_jobs(tenant_id, id)
  on delete restrict;

alter table public.v4_writer_intake_items
  add constraint v4_writer_intake_items_pending_predecessor_fkey
  foreign key (tenant_id, pending_predecessor_queue_job_id)
  references public.v4_recognition_jobs(tenant_id, id)
  on delete restrict;

alter table public.v4_writer_intake_items
  add constraint v4_writer_intake_items_session_fkey
  foreign key (tenant_id, recognition_session_id)
  references public.v4_recognition_sessions(tenant_id, id)
  on delete restrict;

create index if not exists v4_writer_intake_batches_operator_recent_idx
  on public.v4_writer_intake_batches(tenant_id, operator_id, updated_at desc);

create index if not exists v4_writer_intake_batches_commit_rate_idx
  on public.v4_writer_intake_batches(tenant_id, operator_id, committed_at desc);

create index if not exists v4_writer_intake_items_batch_position_idx
  on public.v4_writer_intake_items(tenant_id, batch_id, item_position);

create unique index if not exists v4_writer_intake_items_queue_job_uidx
  on public.v4_writer_intake_items(tenant_id, queue_job_id)
  where queue_job_id is not null;

create unique index if not exists v4_writer_intake_items_pending_queue_job_uidx
  on public.v4_writer_intake_items(tenant_id, pending_queue_job_id)
  where pending_queue_job_id is not null;

create unique index if not exists v4_writer_intake_items_session_uidx
  on public.v4_writer_intake_items(tenant_id, recognition_session_id)
  where recognition_session_id is not null;

create index if not exists v4_recognition_jobs_writer_intake_batch_idx
  on public.v4_recognition_jobs(
    tenant_id,
    operator_id,
    (queue_tags ->> 'writer_intake_batch_id'),
    created_at
  )
  where job_type = 'FINAL_ASSISTED_TITLE'
    and queue_tags ? 'writer_intake_batch_id';

comment on table public.v4_writer_intake_batches is
  'Operational writer recognition intent. Not identity truth, catalog authority, or training data.';
comment on table public.v4_writer_intake_items is
  'Operational progressive-upload ledger. Canonical asset and queue rows remain authoritative.';

-- One transaction freezes the batch denominator and creates every position.
-- A browser crash can therefore lose File objects, but it cannot erase the
-- writer's already-committed intent or leave an undeclared ghost position.
create or replace function public.commit_v4_writer_intake_batch(
  p_tenant_id text,
  p_operator_id text,
  p_batch_id text,
  p_idempotency_key_sha256 text,
  p_expected_item_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  committed public.v4_writer_intake_batches%rowtype;
  item_count integer;
  invalid_item_count integer;
  recent_batch_count integer;
  recent_item_count bigint;
begin
  if p_tenant_id is null
     or p_operator_id is null
     or p_batch_id !~ '^intake_[0-9a-f]{32}$'
     or p_idempotency_key_sha256 !~ '^[0-9a-f]{64}$'
     or p_expected_item_count not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'writer_intake_commit_contract_invalid';
  end if;

  -- The API's process-local limiter is only a first-line shedder. Serialize
  -- new batch creation per authenticated principal so concurrent Vercel
  -- instances cannot each admit another 12 row-amplifying transactions.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_tenant_id || pg_catalog.chr(31) || p_operator_id,
    0
  ));
  select batches.* into committed
  from public.v4_writer_intake_batches batches
  where batches.tenant_id = p_tenant_id
    and batches.operator_id = p_operator_id
    and batches.idempotency_key_sha256 = p_idempotency_key_sha256
  for update;

  -- A lost response may replay the same idempotency key indefinitely without
  -- consuming another quota unit. Only a genuinely new batch is rate-limited.
  if committed.id is null then
    select
      pg_catalog.count(*),
      coalesce(pg_catalog.sum(batches.expected_item_count), 0)
    into recent_batch_count, recent_item_count
    from public.v4_writer_intake_batches batches
    where batches.tenant_id = p_tenant_id
      and batches.operator_id = p_operator_id
      and batches.committed_at >= pg_catalog.clock_timestamp() - interval '60 seconds';

    if recent_batch_count >= 12
       or recent_item_count + p_expected_item_count > 2000 then
      raise exception using errcode = 'P0001', message = 'writer_intake_commit_rate_limited';
    end if;

    insert into public.v4_writer_intake_batches (
      id, tenant_id, operator_id, idempotency_key_sha256,
      expected_item_count, status, intake_closed_at
    ) values (
      p_batch_id, p_tenant_id, p_operator_id, p_idempotency_key_sha256,
      p_expected_item_count, 'INTAKE_CLOSED', pg_catalog.clock_timestamp()
    );

    select batches.* into committed
    from public.v4_writer_intake_batches batches
    where batches.tenant_id = p_tenant_id
      and batches.operator_id = p_operator_id
      and batches.idempotency_key_sha256 = p_idempotency_key_sha256
    for update;
  end if;

  if committed.id is null
     or committed.id is distinct from p_batch_id
     or committed.expected_item_count is distinct from p_expected_item_count then
    raise exception using errcode = '23505', message = 'writer_intake_idempotency_conflict';
  end if;

  insert into public.v4_writer_intake_items (
    id, tenant_id, batch_id, operator_id, client_item_ref_sha256,
    item_position, status, durability_status,
    training_eligible, catalog_promotion_eligible, identity_truth
  )
  select
    'intake_item_' || pg_catalog.substr(pg_catalog.encode(extensions.digest(
      p_batch_id || pg_catalog.chr(31) || 'card-' || positions.position::text,
      'sha256'
    ), 'hex'), 1, 32),
    p_tenant_id,
    p_batch_id,
    p_operator_id,
    pg_catalog.encode(extensions.digest('card-' || positions.position::text, 'sha256'), 'hex'),
    positions.position,
    'DECLARED',
    'PENDING',
    false,
    false,
    false
  from pg_catalog.generate_series(1, p_expected_item_count) positions(position)
  on conflict (tenant_id, batch_id, item_position) do nothing;

  select pg_catalog.count(*) into item_count
  from public.v4_writer_intake_items items
  where items.tenant_id = p_tenant_id
    and items.operator_id = p_operator_id
    and items.batch_id = p_batch_id;

  select pg_catalog.count(*) into invalid_item_count
  from pg_catalog.generate_series(1, p_expected_item_count) positions(position)
  left join public.v4_writer_intake_items items
    on items.tenant_id = p_tenant_id
   and items.operator_id = p_operator_id
   and items.batch_id = p_batch_id
   and items.item_position = positions.position
  where items.id is distinct from (
      'intake_item_' || pg_catalog.substr(pg_catalog.encode(extensions.digest(
        p_batch_id || pg_catalog.chr(31) || 'card-' || positions.position::text,
        'sha256'
      ), 'hex'), 1, 32)
    )
    or items.client_item_ref_sha256 is distinct from pg_catalog.encode(
      extensions.digest('card-' || positions.position::text, 'sha256'),
      'hex'
    );

  if item_count is distinct from p_expected_item_count or invalid_item_count <> 0 then
    raise exception using errcode = '23505', message = 'writer_intake_item_set_conflict';
  end if;

  update public.v4_writer_intake_batches batches
  set status = 'INTAKE_CLOSED',
      intake_closed_at = coalesce(batches.intake_closed_at, pg_catalog.clock_timestamp()),
      updated_at = pg_catalog.clock_timestamp()
  where batches.id = p_batch_id
    and batches.tenant_id = p_tenant_id
    and batches.operator_id = p_operator_id;

  return pg_catalog.jsonb_build_object(
    'saved', true,
    'batch_id', p_batch_id,
    'expected_item_count', p_expected_item_count,
    'item_count', item_count
  );
end;
$$;

-- Explicitly abandon only positions that still have no canonical queue owner.
-- An ASSET_ADMITTED row may be left behind when the canonical queue commit
-- accepts zero jobs or the HTTP process dies between asset admission and queue
-- commit. Preserve its durable asset provenance while moving the position to a
-- retry-safe terminal state. A tagged queue job committed concurrently may
-- later override this operational cancellation through canonical
-- reconciliation; browser state never outranks a persisted queue row.
create or replace function public.abandon_v4_writer_intake_batch(
  p_tenant_id text,
  p_operator_id text,
  p_batch_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cancelled_count integer;
begin
  perform 1
  from public.v4_writer_intake_batches batches
  where batches.id = p_batch_id
    and batches.tenant_id = p_tenant_id
    and batches.operator_id = p_operator_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'writer_intake_batch_not_found';
  end if;

  update public.v4_writer_intake_items items
  set status = 'CANCELLED',
      last_error_code = 'OPERATOR_ABANDONED_INPUT',
      updated_at = pg_catalog.clock_timestamp()
  where items.tenant_id = p_tenant_id
    and items.operator_id = p_operator_id
    and items.batch_id = p_batch_id
    and items.queue_job_id is null
    and items.recognition_session_id is null
    and items.status in ('DECLARED', 'ASSET_ADMITTED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL');
  get diagnostics cancelled_count = row_count;

  return pg_catalog.jsonb_build_object(
    'saved', true,
    'batch_id', p_batch_id,
    'cancelled_item_count', cancelled_count
  );
end;
$$;

alter table public.v4_writer_intake_batches enable row level security;
alter table public.v4_writer_intake_items enable row level security;

revoke all on table public.v4_writer_intake_batches from public, anon, authenticated, service_role;
revoke all on table public.v4_writer_intake_items from public, anon, authenticated, service_role;

-- Authenticated users may resume only their own intake. All mutations remain
-- behind the server API and its current tenant membership/RBAC check.
grant select on table public.v4_writer_intake_batches to authenticated, service_role;
grant select on table public.v4_writer_intake_items to authenticated, service_role;
grant insert, update on table public.v4_writer_intake_batches to service_role;
grant insert, update on table public.v4_writer_intake_items to service_role;

revoke all on function public.commit_v4_writer_intake_batch(text, text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.commit_v4_writer_intake_batch(text, text, text, text, integer)
  to service_role;

revoke all on function public.abandon_v4_writer_intake_batch(text, text, text)
  from public, anon, authenticated;
grant execute on function public.abandon_v4_writer_intake_batch(text, text, text)
  to service_role;

drop policy if exists v4_writer_intake_batches_operator_select on public.v4_writer_intake_batches;
create policy v4_writer_intake_batches_operator_select
  on public.v4_writer_intake_batches
  for select
  to authenticated
  using (
    private.is_tenant_member(tenant_id)
    and private.current_user_matches_operator(operator_id)
  );

drop policy if exists v4_writer_intake_items_operator_select on public.v4_writer_intake_items;
create policy v4_writer_intake_items_operator_select
  on public.v4_writer_intake_items
  for select
  to authenticated
  using (
    private.is_tenant_member(tenant_id)
    and private.current_user_matches_operator(operator_id)
  );
