-- Durable, thin-CSM-only provider admission authority.
--
-- This deliberately does not reference any v4 queue/capacity table.  Every
-- physical Luna attempt is enqueued before a provider call and must win an
-- atomic, scope-wide claim before that call may start.  The scope row is the
-- serialization point for the hard count/token invariants.

create table public.csm_thin_provider_scopes (
  provider text not null,
  account_scope text not null,
  model text not null,
  max_active integer not null default 120,
  max_active_tokens integer not null default 440000,
  effective_max_active integer not null default 120,
  effective_max_active_tokens integer not null default 440000,
  retry_fraction numeric(6,5) not null default 0.20000,
  rolling_window_seconds integer not null default 60,
  request_window_target integer not null default 4500,
  request_window_hard_limit integer not null default 5000,
  token_window_target integer not null default 3600000,
  token_window_hard_limit integer not null default 4000000,
  aimd_cooldown_until timestamptz,
  aimd_last_increase_at timestamptz,
  aimd_last_decrease_at timestamptz,
  active_count integer not null default 0,
  active_tokens integer not null default 0,
  active_retry_count integer not null default 0,
  active_retry_tokens integer not null default 0,
  virtual_time numeric(30,15) not null default 0,
  scheduling_epoch bigint not null default 1,
  reservation_tenant_id text,
  reservation_operation_key text,
  reservation_attempt_no integer,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (provider, account_scope, model),
  constraint csm_thin_provider_scope_identity_nonempty check (
    pg_catalog.btrim(provider) <> ''
    and pg_catalog.btrim(account_scope) <> ''
    and pg_catalog.btrim(model) <> ''
  ),
  constraint csm_thin_provider_scope_hard_ceiling check (
    max_active between 1 and 120
    and max_active_tokens between 1 and 440000
    and effective_max_active between 1 and max_active
    and effective_max_active_tokens between 1 and max_active_tokens
  ),
  constraint csm_thin_provider_scope_retry_fraction check (
    retry_fraction > 0 and retry_fraction <= 0.20000
  ),
  constraint csm_thin_provider_scope_live_counters check (
    active_count between 0 and max_active
    and active_tokens between 0 and max_active_tokens
    and active_retry_count between 0 and active_count
    and active_retry_tokens between 0 and active_tokens
  ),
  constraint csm_thin_provider_scope_rolling_window check (
    rolling_window_seconds = 60
    and request_window_target between 1 and request_window_hard_limit
    and request_window_hard_limit <= 5000
    and token_window_target between 1 and token_window_hard_limit
    and token_window_hard_limit <= 4000000
  ),
  constraint csm_thin_provider_scope_reservation_shape check (
    (reservation_tenant_id is null
      and reservation_operation_key is null
      and reservation_attempt_no is null)
    or
    (reservation_tenant_id is not null
      and reservation_operation_key is not null
      and reservation_attempt_no is not null)
  )
);
create table public.csm_thin_provider_operations (
  tenant_id text not null,
  operation_key text not null,
  payload_sha256 text not null,
  provider text not null,
  account_scope text not null,
  model text not null,
  estimated_tokens integer not null,
  status text not null default 'QUEUED',
  cancel_requested_at timestamptz,
  terminal_result jsonb,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (tenant_id, operation_key),
  foreign key (provider, account_scope, model)
    references public.csm_thin_provider_scopes(provider, account_scope, model),
  constraint csm_thin_provider_operation_identity_nonempty check (
    pg_catalog.btrim(tenant_id) <> ''
    and pg_catalog.btrim(operation_key) <> ''
    and pg_catalog.char_length(operation_key) <= 256
  ),
  constraint csm_thin_provider_operation_payload_hash check (
    payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint csm_thin_provider_operation_token_bound check (
    estimated_tokens between 1 and 440000
  ),
  constraint csm_thin_provider_operation_status check (
    status in (
      'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'AMBIGUOUS',
      'CANCEL_REQUESTED', 'CANCELLED'
    )
  )
);
create table public.csm_thin_provider_attempts (
  tenant_id text not null,
  operation_key text not null,
  attempt_no integer not null,
  provider text not null,
  account_scope text not null,
  model text not null,
  attempt_class text not null,
  estimated_tokens integer not null,
  tenant_weight numeric(12,6) not null,
  dominant_share numeric(30,15) not null,
  finish_tag numeric(30,15) not null,
  scheduling_epoch bigint not null,
  bypass_count integer not null default 0,
  state text not null default 'QUEUED',
  queue_owner text not null,
  queue_ttl_seconds integer not null,
  queue_expires_at timestamptz not null,
  not_before timestamptz not null default pg_catalog.clock_timestamp(),
  enqueued_at timestamptz not null default pg_catalog.clock_timestamp(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  settled_at timestamptz,
  lease_owner text,
  lease_fence bigint not null default 0,
  lease_expires_at timestamptz,
  charged_tokens integer,
  actual_tokens integer,
  attempt_result jsonb,
  primary key (tenant_id, operation_key, attempt_no),
  foreign key (tenant_id, operation_key)
    references public.csm_thin_provider_operations(tenant_id, operation_key),
  foreign key (provider, account_scope, model)
    references public.csm_thin_provider_scopes(provider, account_scope, model),
  constraint csm_thin_provider_attempt_number check (attempt_no >= 1),
  constraint csm_thin_provider_attempt_class check (attempt_class in ('FRESH', 'RETRY')),
  constraint csm_thin_provider_attempt_token_bound check (
    estimated_tokens between 1 and 440000
  ),
  constraint csm_thin_provider_attempt_weight check (tenant_weight > 0),
  constraint csm_thin_provider_attempt_share check (dominant_share > 0),
  constraint csm_thin_provider_attempt_finish check (finish_tag >= 0),
  constraint csm_thin_provider_attempt_bypass check (bypass_count >= 0),
  constraint csm_thin_provider_attempt_queue_lease check (
    pg_catalog.btrim(queue_owner) <> ''
    and queue_ttl_seconds between 30 and 900
  ),
  constraint csm_thin_provider_attempt_charged_tokens check (
    (charged_tokens is null and started_at is null)
    or (charged_tokens is not null and charged_tokens >= 0 and started_at is not null)
  ),
  constraint csm_thin_provider_attempt_actual_tokens check (
    actual_tokens is null or actual_tokens >= 0
  ),
  constraint csm_thin_provider_attempt_state check (
    state in (
      'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'AMBIGUOUS',
      'LEASE_EXPIRED', 'CANCELLED'
    )
  ),
  constraint csm_thin_provider_attempt_lease_shape check (
    (state = 'RUNNING'
      and lease_owner is not null
      and lease_expires_at is not null
      and started_at is not null)
    or state <> 'RUNNING'
  )
);
alter table public.csm_thin_provider_scopes
  add constraint csm_thin_provider_scope_reservation_fk
  foreign key (
    reservation_tenant_id,
    reservation_operation_key,
    reservation_attempt_no
  ) references public.csm_thin_provider_attempts(
    tenant_id,
    operation_key,
    attempt_no
  );
create index csm_thin_provider_attempts_ready_idx
  on public.csm_thin_provider_attempts (
    provider, account_scope, model, attempt_class,
    finish_tag, enqueued_at, tenant_id, operation_key, attempt_no
  )
  where state = 'QUEUED';
create index csm_thin_provider_attempts_lease_idx
  on public.csm_thin_provider_attempts (
    provider, account_scope, model, lease_expires_at
  )
  where state = 'RUNNING';
create index csm_thin_provider_attempts_rolling_window_idx
  on public.csm_thin_provider_attempts (
    provider, account_scope, model, started_at, charged_tokens
  )
  where started_at is not null;
create index csm_thin_provider_operations_scope_status_idx
  on public.csm_thin_provider_operations (
    provider, account_scope, model, status, updated_at
  );
alter table public.csm_thin_provider_scopes enable row level security;
alter table public.csm_thin_provider_scopes force row level security;
alter table public.csm_thin_provider_operations enable row level security;
alter table public.csm_thin_provider_operations force row level security;
alter table public.csm_thin_provider_attempts enable row level security;
alter table public.csm_thin_provider_attempts force row level security;
revoke all on table public.csm_thin_provider_scopes
  from public, anon, authenticated, service_role;
revoke all on table public.csm_thin_provider_operations
  from public, anon, authenticated, service_role;
revoke all on table public.csm_thin_provider_attempts
  from public, anon, authenticated, service_role;
insert into public.csm_thin_provider_scopes (
  provider, account_scope, model,
  max_active, max_active_tokens,
  effective_max_active, effective_max_active_tokens,
  retry_fraction,
  rolling_window_seconds,
  request_window_target, request_window_hard_limit,
  token_window_target, token_window_hard_limit
) values (
  'openai', 'lynca-primary', 'gpt-5.6-luna',
  120, 440000, 120, 440000, 0.20000,
  60, 4500, 5000, 3600000, 4000000
)
on conflict (provider, account_scope, model) do nothing;
do $csm_thin_provider_scope_contract$
begin
  if not exists (
    select 1
    from public.csm_thin_provider_scopes
    where provider = 'openai'
      and account_scope = 'lynca-primary'
      and model = 'gpt-5.6-luna'
      and max_active = 120
      and max_active_tokens = 440000
      and effective_max_active = 120
      and effective_max_active_tokens = 440000
      and retry_fraction = 0.20000
      and rolling_window_seconds = 60
      and request_window_target = 4500
      and request_window_hard_limit = 5000
      and token_window_target = 3600000
      and token_window_hard_limit = 4000000
  ) then
    raise exception using
      errcode = '55000',
      message = 'csm_thin_provider_scope_contract_mismatch';
  end if;
end;
$csm_thin_provider_scope_contract$;
create or replace function public.enqueue_csm_thin_provider_attempt_v1(
  p_tenant_id text,
  p_operation_key text,
  p_payload_sha256 text,
  p_provider text,
  p_account_scope text,
  p_model text,
  p_attempt_no integer,
  p_attempt_class text,
  p_estimated_tokens integer,
  p_tenant_weight numeric,
  p_not_before timestamptz,
  p_queue_owner text,
  p_queue_ttl_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $csm_thin_enqueue$
declare
  scope_row public.csm_thin_provider_scopes%rowtype;
  operation_row public.csm_thin_provider_operations%rowtype;
  attempt_row public.csm_thin_provider_attempts%rowtype;
  previous_attempt public.csm_thin_provider_attempts%rowtype;
  last_finish numeric(30,15) := 0;
  start_tag numeric(30,15);
  share numeric(30,15);
  finish numeric(30,15);
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  p_tenant_id := pg_catalog.btrim(p_tenant_id);
  p_operation_key := pg_catalog.btrim(p_operation_key);
  p_provider := pg_catalog.btrim(p_provider);
  p_account_scope := pg_catalog.btrim(p_account_scope);
  p_model := pg_catalog.btrim(p_model);
  p_attempt_class := pg_catalog.upper(pg_catalog.btrim(p_attempt_class));
  p_queue_owner := pg_catalog.btrim(p_queue_owner);

  if p_tenant_id is null or p_tenant_id = ''
     or p_operation_key is null or p_operation_key = ''
     or pg_catalog.char_length(p_operation_key) > 256
     or p_payload_sha256 is null or p_payload_sha256 !~ '^[0-9a-f]{64}$'
     or p_provider is null or p_provider = ''
     or p_account_scope is null or p_account_scope = ''
     or p_model is null or p_model = ''
     or p_attempt_no is null or p_attempt_no < 1
     or p_attempt_class not in ('FRESH', 'RETRY')
     or p_estimated_tokens is null or p_estimated_tokens < 1
     or p_tenant_weight is null or p_tenant_weight <= 0
     or p_queue_owner is null or p_queue_owner = ''
     or p_queue_ttl_seconds is null or p_queue_ttl_seconds not between 30 and 900 then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'invalid_provider_attempt', 'status_code', 400
    );
  end if;

  select * into scope_row
  from public.csm_thin_provider_scopes
  where provider = p_provider
    and account_scope = p_account_scope
    and model = p_model
  for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'provider_scope_not_configured', 'status_code', 503
    );
  end if;
  if p_estimated_tokens > scope_row.max_active_tokens then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'estimated_tokens_exceed_scope', 'status_code', 422
    );
  end if;

  select * into operation_row
  from public.csm_thin_provider_operations
  where tenant_id = p_tenant_id and operation_key = p_operation_key
  for update;

  if found then
    if operation_row.payload_sha256 is distinct from p_payload_sha256 then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'code', 'operation_payload_conflict', 'status_code', 409
      );
    end if;
    if operation_row.provider is distinct from p_provider
       or operation_row.account_scope is distinct from p_account_scope
       or operation_row.model is distinct from p_model then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'code', 'operation_scope_conflict', 'status_code', 409
      );
    end if;

    select * into attempt_row
    from public.csm_thin_provider_attempts
    where tenant_id = p_tenant_id
      and operation_key = p_operation_key
      and attempt_no = p_attempt_no;
    if found then
      if attempt_row.attempt_class is distinct from p_attempt_class
         or attempt_row.estimated_tokens is distinct from p_estimated_tokens
         or attempt_row.tenant_weight is distinct from p_tenant_weight then
        return pg_catalog.jsonb_build_object(
          'ok', false, 'code', 'attempt_replay_conflict', 'status_code', 409
        );
      end if;
      return pg_catalog.jsonb_build_object(
        'ok', true, 'code', 'exact_replay', 'status_code', 200,
        'replayed', true,
        'operation_status', operation_row.status,
        'attempt_state', attempt_row.state,
        'attempt', p_attempt_no,
        'queue_owner', attempt_row.queue_owner,
        'latest_attempt_no', p_attempt_no,
        'latest_attempt_state', attempt_row.state,
        'result', operation_row.terminal_result
      );
    end if;

    if operation_row.status in ('SUCCEEDED', 'AMBIGUOUS', 'CANCEL_REQUESTED', 'CANCELLED') then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'code', 'operation_terminal', 'status_code', 409,
        'operation_status', operation_row.status
      );
    end if;

    select * into previous_attempt
    from public.csm_thin_provider_attempts
    where tenant_id = p_tenant_id and operation_key = p_operation_key
    order by attempt_no desc
    limit 1
    for update;
    if not found
       or p_attempt_class <> 'RETRY'
       or p_attempt_no <> previous_attempt.attempt_no + 1
       or previous_attempt.state <> 'FAILED' then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'code', 'retry_predecessor_not_safe', 'status_code', 409
      );
    end if;
  else
    if p_attempt_no <> 1 or p_attempt_class <> 'FRESH' then
      return pg_catalog.jsonb_build_object(
        'ok', false, 'code', 'first_attempt_must_be_fresh', 'status_code', 409
      );
    end if;
    insert into public.csm_thin_provider_operations (
      tenant_id, operation_key, payload_sha256,
      provider, account_scope, model, estimated_tokens
    ) values (
      p_tenant_id, p_operation_key, p_payload_sha256,
      p_provider, p_account_scope, p_model, p_estimated_tokens
    ) returning * into operation_row;
  end if;

  if scope_row.active_count = 0 and not exists (
    select 1 from public.csm_thin_provider_attempts
    where provider = p_provider
      and account_scope = p_account_scope
      and model = p_model
      and state = 'QUEUED'
  ) then
    scope_row.scheduling_epoch := scope_row.scheduling_epoch + 1;
    scope_row.virtual_time := 0;
    update public.csm_thin_provider_scopes
    set scheduling_epoch = scope_row.scheduling_epoch,
        virtual_time = 0,
        reservation_tenant_id = null,
        reservation_operation_key = null,
        reservation_attempt_no = null,
        updated_at = now_at
    where provider = p_provider
      and account_scope = p_account_scope
      and model = p_model;
  end if;

  select coalesce(pg_catalog.max(finish_tag), 0)
    into last_finish
  from public.csm_thin_provider_attempts
  where provider = p_provider
    and account_scope = p_account_scope
    and model = p_model
    and tenant_id = p_tenant_id
    and scheduling_epoch = scope_row.scheduling_epoch;

  share := greatest(
    1::numeric / scope_row.max_active,
    p_estimated_tokens::numeric / scope_row.max_active_tokens
  );
  start_tag := greatest(scope_row.virtual_time, last_finish);
  finish := start_tag + (share / p_tenant_weight);

  insert into public.csm_thin_provider_attempts (
    tenant_id, operation_key, attempt_no,
    provider, account_scope, model, attempt_class,
    estimated_tokens, tenant_weight, dominant_share,
    finish_tag, scheduling_epoch,
    queue_owner, queue_ttl_seconds, queue_expires_at, not_before
  ) values (
    p_tenant_id, p_operation_key, p_attempt_no,
    p_provider, p_account_scope, p_model, p_attempt_class,
    p_estimated_tokens, p_tenant_weight, share,
    finish, scope_row.scheduling_epoch,
    p_queue_owner, p_queue_ttl_seconds,
    now_at + pg_catalog.make_interval(secs => p_queue_ttl_seconds),
    coalesce(p_not_before, now_at)
  ) returning * into attempt_row;

  update public.csm_thin_provider_operations
  set status = 'QUEUED', updated_at = now_at
  where tenant_id = p_tenant_id and operation_key = p_operation_key;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'code', 'enqueued', 'status_code', 201,
    'replayed', false,
    'tenant_id', p_tenant_id,
    'operation_key', p_operation_key,
    'attempt', p_attempt_no,
    'attempt_class', p_attempt_class,
    'estimated_tokens', p_estimated_tokens,
    'finish_tag', attempt_row.finish_tag,
    'scheduling_epoch', attempt_row.scheduling_epoch
  );
end;
$csm_thin_enqueue$;
create or replace function public.claim_csm_thin_provider_attempt_v1(
  p_provider text,
  p_account_scope text,
  p_model text,
  p_tenant_id text,
  p_operation_key text,
  p_attempt_no integer,
  p_worker_id text,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $csm_thin_claim$
declare
  scope_row public.csm_thin_provider_scopes%rowtype;
  expired_row public.csm_thin_provider_attempts%rowtype;
  queued_row public.csm_thin_provider_attempts%rowtype;
  target_row public.csm_thin_provider_attempts%rowtype;
  fair_row public.csm_thin_provider_attempts%rowtype;
  selected_row public.csm_thin_provider_attempts%rowtype;
  operation_row public.csm_thin_provider_operations%rowtype;
  now_at timestamptz := pg_catalog.clock_timestamp();
  fresh_backlog boolean := false;
  retry_count_limit integer;
  retry_token_limit integer;
  reservation_valid boolean := false;
  fair_fits boolean := false;
  selected_found boolean := false;
  effective_count_limit integer;
  effective_token_limit integer;
  window_request_count integer := 0;
  window_charged_tokens bigint := 0;
  earliest_window_expiry timestamptz;
  window_retry_after_ms integer := 25;
begin
  p_provider := pg_catalog.btrim(p_provider);
  p_account_scope := pg_catalog.btrim(p_account_scope);
  p_model := pg_catalog.btrim(p_model);
  p_tenant_id := pg_catalog.btrim(p_tenant_id);
  p_operation_key := pg_catalog.btrim(p_operation_key);
  p_worker_id := pg_catalog.btrim(p_worker_id);
  if p_provider is null or p_provider = ''
     or p_account_scope is null or p_account_scope = ''
     or p_model is null or p_model = ''
     or p_tenant_id is null or p_tenant_id = ''
     or p_operation_key is null or p_operation_key = ''
     or p_attempt_no is null or p_attempt_no < 1
     or p_worker_id is null or p_worker_id = ''
     or p_lease_seconds is null or p_lease_seconds not between 5 and 300 then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'invalid_provider_claim', 'status_code', 400
    );
  end if;

  select * into scope_row
  from public.csm_thin_provider_scopes
  where provider = p_provider
    and account_scope = p_account_scope
    and model = p_model
  for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'provider_scope_not_configured', 'status_code', 503
    );
  end if;

  -- A queued row has no provider-side ambiguity.  Its originating waiter must
  -- renew this short ownership lease while polling; a dead serverless request
  -- therefore becomes a safe FAILED predecessor instead of a permanent head.
  for queued_row in
    select *
    from public.csm_thin_provider_attempts
    where provider = p_provider
      and account_scope = p_account_scope
      and model = p_model
      and state = 'QUEUED'
      and queue_expires_at <= now_at
    for update
  loop
    update public.csm_thin_provider_attempts
    set state = 'FAILED', settled_at = now_at,
        attempt_result = pg_catalog.jsonb_build_object('code', 'queue_owner_expired')
    where tenant_id = queued_row.tenant_id
      and operation_key = queued_row.operation_key
      and attempt_no = queued_row.attempt_no;
    update public.csm_thin_provider_operations
    set status = 'FAILED',
        terminal_result = pg_catalog.jsonb_build_object('code', 'queue_owner_expired'),
        updated_at = now_at
    where tenant_id = queued_row.tenant_id
      and operation_key = queued_row.operation_key
      and status = 'QUEUED';
  end loop;

  -- Expiry is fail-closed: it frees authority capacity but never creates an
  -- automatic retry because the external provider result may be ambiguous.
  for expired_row in
    select *
    from public.csm_thin_provider_attempts
    where provider = p_provider
      and account_scope = p_account_scope
      and model = p_model
      and state = 'RUNNING'
      and lease_expires_at <= now_at
    for update
  loop
    if scope_row.active_count < 1
       or scope_row.active_tokens < expired_row.estimated_tokens
       or (expired_row.attempt_class = 'RETRY' and (
         scope_row.active_retry_count < 1
         or scope_row.active_retry_tokens < expired_row.estimated_tokens
       )) then
      raise exception using
        errcode = '55000',
        message = 'csm_thin_provider_counter_drift';
    end if;
    scope_row.active_count := scope_row.active_count - 1;
    scope_row.active_tokens := scope_row.active_tokens - expired_row.estimated_tokens;
    if expired_row.attempt_class = 'RETRY' then
      scope_row.active_retry_count := scope_row.active_retry_count - 1;
      scope_row.active_retry_tokens := scope_row.active_retry_tokens - expired_row.estimated_tokens;
    end if;
    update public.csm_thin_provider_attempts
    set state = 'LEASE_EXPIRED', settled_at = now_at,
        attempt_result = pg_catalog.jsonb_build_object('code', 'lease_expired')
    where tenant_id = expired_row.tenant_id
      and operation_key = expired_row.operation_key
      and attempt_no = expired_row.attempt_no;
    update public.csm_thin_provider_operations
    set status = case when cancel_requested_at is null then 'AMBIGUOUS' else 'CANCELLED' end,
        updated_at = now_at
    where tenant_id = expired_row.tenant_id
      and operation_key = expired_row.operation_key;
  end loop;

  update public.csm_thin_provider_scopes
  set active_count = scope_row.active_count,
      active_tokens = scope_row.active_tokens,
      active_retry_count = scope_row.active_retry_count,
      active_retry_tokens = scope_row.active_retry_tokens,
      updated_at = now_at
  where provider = p_provider
    and account_scope = p_account_scope
    and model = p_model;

  select * into target_row
  from public.csm_thin_provider_attempts
  where tenant_id = p_tenant_id
    and operation_key = p_operation_key
    and attempt_no = p_attempt_no
    and provider = p_provider
    and account_scope = p_account_scope
    and model = p_model
  for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'attempt_not_found', 'status_code', 404
    );
  end if;
  -- A worker crosses the provider boundary only after receiving this fenced
  -- claim receipt. If the database commit succeeded but the HTTP response was
  -- lost, that exact worker may recover the receipt without incrementing any
  -- counter. A different worker never inherits permission for a second call.
  if target_row.state = 'RUNNING'
     and target_row.lease_owner is not distinct from p_worker_id
     and target_row.lease_expires_at > now_at then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'code', 'claim_receipt_replayed', 'status_code', 200,
      'admitted', true, 'replayed', true,
      'tenant_id', p_tenant_id,
      'operation_key', p_operation_key,
      'attempt', p_attempt_no,
      'attempt_class', target_row.attempt_class,
      'estimated_tokens', target_row.estimated_tokens,
      'worker_id', p_worker_id,
      'lease_fence', target_row.lease_fence,
      'lease_expires_at', target_row.lease_expires_at
    );
  end if;
  if target_row.state <> 'QUEUED' then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'code', case when target_row.attempt_result ->> 'code' = 'queue_owner_expired'
        then 'queued_attempt_expired' else 'attempt_not_queued' end,
      'status_code', 409,
      'attempt_state', target_row.state
    );
  end if;
  if target_row.queue_owner is distinct from p_worker_id then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'queue_owner_conflict', 'status_code', 409
    );
  end if;
  update public.csm_thin_provider_attempts
  set queue_expires_at = now_at
        + pg_catalog.make_interval(secs => target_row.queue_ttl_seconds)
  where tenant_id = p_tenant_id
    and operation_key = p_operation_key
    and attempt_no = p_attempt_no;

  effective_count_limit := least(
    scope_row.max_active, scope_row.effective_max_active
  );
  effective_token_limit := least(
    scope_row.max_active_tokens, scope_row.effective_max_active_tokens
  );
  select pg_catalog.count(*), coalesce(pg_catalog.sum(charged_tokens), 0),
      pg_catalog.min(started_at)
    into window_request_count, window_charged_tokens, earliest_window_expiry
  from public.csm_thin_provider_attempts
  where provider = p_provider
    and account_scope = p_account_scope
    and model = p_model
    and started_at > now_at
      - pg_catalog.make_interval(secs => scope_row.rolling_window_seconds);
  if earliest_window_expiry is not null then
    window_retry_after_ms := greatest(1, pg_catalog.ceil(
      extract(epoch from (
        earliest_window_expiry
        + pg_catalog.make_interval(secs => scope_row.rolling_window_seconds)
        - now_at
      )) * 1000
    )::integer);
  end if;

  if scope_row.aimd_cooldown_until is not null
     and scope_row.aimd_cooldown_until > now_at then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'code', 'aimd_cooldown', 'status_code', 202,
      'admitted', false,
      'retry_after_ms', greatest(1, pg_catalog.ceil(
        extract(epoch from (scope_row.aimd_cooldown_until - now_at)) * 1000
      )::integer)
    );
  end if;

  if scope_row.reservation_tenant_id is not null then
    select exists (
      select 1
      from public.csm_thin_provider_attempts attempt
      join public.csm_thin_provider_operations operation
        using (tenant_id, operation_key)
      where attempt.tenant_id = scope_row.reservation_tenant_id
        and attempt.operation_key = scope_row.reservation_operation_key
        and attempt.attempt_no = scope_row.reservation_attempt_no
        and attempt.state = 'QUEUED'
        and attempt.not_before <= now_at
        and operation.cancel_requested_at is null
    ) into reservation_valid;
    if not reservation_valid then
      scope_row.reservation_tenant_id := null;
      scope_row.reservation_operation_key := null;
      scope_row.reservation_attempt_no := null;
      update public.csm_thin_provider_scopes
      set reservation_tenant_id = null,
          reservation_operation_key = null,
          reservation_attempt_no = null,
          updated_at = now_at
      where provider = p_provider
        and account_scope = p_account_scope
        and model = p_model;
    end if;
  end if;

  select exists (
    select 1
    from public.csm_thin_provider_attempts attempt
    join public.csm_thin_provider_operations operation
      using (tenant_id, operation_key)
    where attempt.provider = p_provider
      and attempt.account_scope = p_account_scope
      and attempt.model = p_model
      and attempt.state = 'QUEUED'
      and attempt.attempt_class = 'FRESH'
      and attempt.not_before <= now_at
      and operation.cancel_requested_at is null
  ) into fresh_backlog;
  retry_count_limit := pg_catalog.floor(effective_count_limit * scope_row.retry_fraction);
  retry_token_limit := pg_catalog.floor(effective_token_limit * scope_row.retry_fraction);

  if reservation_valid then
    select attempt.* into fair_row
    from public.csm_thin_provider_attempts attempt
    where attempt.tenant_id = scope_row.reservation_tenant_id
      and attempt.operation_key = scope_row.reservation_operation_key
      and attempt.attempt_no = scope_row.reservation_attempt_no;
    if fair_row.attempt_class = 'RETRY' and fresh_backlog and (
      scope_row.active_retry_count + 1 > retry_count_limit
      or scope_row.active_retry_tokens + fair_row.estimated_tokens > retry_token_limit
    ) then
      reservation_valid := false;
      update public.csm_thin_provider_scopes
      set reservation_tenant_id = null,
          reservation_operation_key = null,
          reservation_attempt_no = null,
          updated_at = now_at
      where provider = p_provider
        and account_scope = p_account_scope
        and model = p_model;
    end if;
  end if;

  if not reservation_valid then
    with eligible as (
      select attempt.tenant_id, attempt.operation_key, attempt.attempt_no,
        attempt.finish_tag, attempt.enqueued_at
      from public.csm_thin_provider_attempts attempt
      join public.csm_thin_provider_operations operation
        using (tenant_id, operation_key)
      where attempt.provider = p_provider
        and attempt.account_scope = p_account_scope
        and attempt.model = p_model
        and attempt.state = 'QUEUED'
        and attempt.not_before <= now_at
        and operation.cancel_requested_at is null
        and (
          attempt.attempt_class = 'FRESH'
          or not fresh_backlog
          or (
            scope_row.active_retry_count + 1 <= retry_count_limit
            and scope_row.active_retry_tokens + attempt.estimated_tokens <= retry_token_limit
          )
        )
    ), ranked as (
      select eligible.*,
        pg_catalog.row_number() over (
          partition by eligible.tenant_id
          order by eligible.finish_tag, eligible.enqueued_at,
            eligible.operation_key, eligible.attempt_no
        ) as tenant_head
      from eligible
    )
    select attempt.*
    into fair_row
    from ranked
    join public.csm_thin_provider_attempts attempt
      using (tenant_id, operation_key, attempt_no)
    where ranked.tenant_head = 1
    order by ranked.finish_tag, ranked.enqueued_at,
      ranked.tenant_id, ranked.operation_key, ranked.attempt_no
    limit 1;
  end if;

  if fair_row.operation_key is null then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'code', 'no_ready_attempt', 'status_code', 202,
      'admitted', false, 'retry_after_ms', 50
    );
  end if;

  fair_fits := scope_row.active_count + 1 <= effective_count_limit
    and (
      scope_row.active_tokens + fair_row.estimated_tokens <= effective_token_limit
      or (scope_row.active_count = 0
        and fair_row.estimated_tokens <= scope_row.max_active_tokens)
    )
    and window_request_count + 1 <= scope_row.request_window_target
    and window_charged_tokens + fair_row.estimated_tokens <= scope_row.token_window_target;

  if reservation_valid and not fair_fits then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'code', 'capacity_reserved', 'status_code', 202,
      'admitted', false,
      'retry_after_ms', case when
        window_request_count + 1 > scope_row.request_window_target
        or window_charged_tokens + fair_row.estimated_tokens > scope_row.token_window_target
        then window_retry_after_ms else 50 end
    );
  end if;

  if fair_fits then
    selected_row := fair_row;
    selected_found := true;
  else
    with eligible as (
      select attempt.tenant_id, attempt.operation_key, attempt.attempt_no,
        attempt.finish_tag, attempt.enqueued_at, attempt.estimated_tokens
      from public.csm_thin_provider_attempts attempt
      join public.csm_thin_provider_operations operation
        using (tenant_id, operation_key)
      where attempt.provider = p_provider
        and attempt.account_scope = p_account_scope
        and attempt.model = p_model
        and attempt.state = 'QUEUED'
        and attempt.not_before <= now_at
        and operation.cancel_requested_at is null
        and (
          attempt.attempt_class = 'FRESH'
          or not fresh_backlog
          or (
            scope_row.active_retry_count + 1 <= retry_count_limit
            and scope_row.active_retry_tokens + attempt.estimated_tokens <= retry_token_limit
          )
        )
    ), ranked as (
      select eligible.*,
        pg_catalog.row_number() over (
          partition by eligible.tenant_id
          order by eligible.finish_tag, eligible.enqueued_at,
            eligible.operation_key, eligible.attempt_no
        ) as tenant_head
      from eligible
    )
    select attempt.*
    into selected_row
    from ranked
    join public.csm_thin_provider_attempts attempt
      using (tenant_id, operation_key, attempt_no)
    where ranked.tenant_head = 1
      and scope_row.active_count + 1 <= effective_count_limit
      and (
        scope_row.active_tokens + ranked.estimated_tokens <= effective_token_limit
        or (scope_row.active_count = 0
          and ranked.estimated_tokens <= scope_row.max_active_tokens)
      )
      and window_request_count + 1 <= scope_row.request_window_target
      and window_charged_tokens + ranked.estimated_tokens <= scope_row.token_window_target
    order by ranked.finish_tag, ranked.enqueued_at,
      ranked.tenant_id, ranked.operation_key, ranked.attempt_no
    limit 1;
    selected_found := selected_row.operation_key is not null;
  end if;

  if not selected_found then
    if now_at - fair_row.enqueued_at >= interval '30 seconds'
       or fair_row.bypass_count >= 8 then
      update public.csm_thin_provider_scopes
      set reservation_tenant_id = fair_row.tenant_id,
          reservation_operation_key = fair_row.operation_key,
          reservation_attempt_no = fair_row.attempt_no,
          updated_at = now_at
      where provider = p_provider
        and account_scope = p_account_scope
        and model = p_model;
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'code', case when
        window_request_count + 1 > scope_row.request_window_target
        or window_charged_tokens + fair_row.estimated_tokens > scope_row.token_window_target
        then 'rolling_window_limited' else 'capacity_full' end,
      'status_code', 202,
      'admitted', false,
      'retry_after_ms', case when
        window_request_count + 1 > scope_row.request_window_target
        or window_charged_tokens + fair_row.estimated_tokens > scope_row.token_window_target
        then window_retry_after_ms else 50 end
    );
  end if;

  if selected_row.tenant_id is distinct from p_tenant_id
     or selected_row.operation_key is distinct from p_operation_key
     or selected_row.attempt_no is distinct from p_attempt_no then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'code', 'not_scheduler_turn', 'status_code', 202,
      'admitted', false, 'retry_after_ms', 25
    );
  end if;

  if not fair_fits and (
    fair_row.tenant_id is distinct from selected_row.tenant_id
    or fair_row.operation_key is distinct from selected_row.operation_key
    or fair_row.attempt_no is distinct from selected_row.attempt_no
  ) then
    if now_at - fair_row.enqueued_at >= interval '30 seconds'
       or fair_row.bypass_count + 1 >= 8 then
      update public.csm_thin_provider_scopes
      set reservation_tenant_id = fair_row.tenant_id,
          reservation_operation_key = fair_row.operation_key,
          reservation_attempt_no = fair_row.attempt_no,
          updated_at = now_at
      where provider = p_provider
        and account_scope = p_account_scope
        and model = p_model;
      return pg_catalog.jsonb_build_object(
        'ok', true, 'code', 'capacity_reserved', 'status_code', 202,
        'admitted', false,
        'retry_after_ms', case when
          window_request_count + 1 > scope_row.request_window_target
          or window_charged_tokens + fair_row.estimated_tokens > scope_row.token_window_target
          then window_retry_after_ms else 50 end
      );
    end if;
    update public.csm_thin_provider_attempts
    set bypass_count = bypass_count + 1
    where tenant_id = fair_row.tenant_id
      and operation_key = fair_row.operation_key
      and attempt_no = fair_row.attempt_no;
  end if;

  select * into selected_row
  from public.csm_thin_provider_attempts
  where tenant_id = p_tenant_id
    and operation_key = p_operation_key
    and attempt_no = p_attempt_no
  for update;
  if selected_row.state <> 'QUEUED' then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'code', 'attempt_no_longer_queued', 'status_code', 202,
      'admitted', false, 'retry_after_ms', 25
    );
  end if;

  select * into operation_row
  from public.csm_thin_provider_operations
  where tenant_id = p_tenant_id and operation_key = p_operation_key
  for update;
  if operation_row.cancel_requested_at is not null then
    update public.csm_thin_provider_attempts
    set state = 'CANCELLED', settled_at = now_at
    where tenant_id = p_tenant_id
      and operation_key = p_operation_key
      and attempt_no = p_attempt_no;
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'operation_cancelled', 'status_code', 409
    );
  end if;

  selected_row.lease_fence := selected_row.lease_fence + 1;
  update public.csm_thin_provider_attempts
  set state = 'RUNNING',
      started_at = coalesce(started_at, now_at),
      charged_tokens = selected_row.estimated_tokens,
      heartbeat_at = now_at,
      lease_owner = p_worker_id,
      lease_fence = selected_row.lease_fence,
      lease_expires_at = now_at + pg_catalog.make_interval(secs => p_lease_seconds)
  where tenant_id = p_tenant_id
    and operation_key = p_operation_key
    and attempt_no = p_attempt_no;

  update public.csm_thin_provider_operations
  set status = 'RUNNING', updated_at = now_at
  where tenant_id = p_tenant_id and operation_key = p_operation_key;

  update public.csm_thin_provider_scopes
  set active_count = active_count + 1,
      active_tokens = active_tokens + selected_row.estimated_tokens,
      active_retry_count = active_retry_count
        + case when selected_row.attempt_class = 'RETRY' then 1 else 0 end,
      active_retry_tokens = active_retry_tokens
        + case when selected_row.attempt_class = 'RETRY' then selected_row.estimated_tokens else 0 end,
      virtual_time = greatest(virtual_time, selected_row.finish_tag),
      reservation_tenant_id = null,
      reservation_operation_key = null,
      reservation_attempt_no = null,
      updated_at = now_at
  where provider = p_provider
    and account_scope = p_account_scope
    and model = p_model;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'code', 'admitted', 'status_code', 200,
    'admitted', true,
    'tenant_id', p_tenant_id,
    'operation_key', p_operation_key,
    'attempt', p_attempt_no,
    'attempt_class', selected_row.attempt_class,
    'estimated_tokens', selected_row.estimated_tokens,
    'worker_id', p_worker_id,
    'lease_fence', selected_row.lease_fence,
    'lease_expires_at', now_at + pg_catalog.make_interval(secs => p_lease_seconds)
  );
end;
$csm_thin_claim$;
create or replace function public.heartbeat_csm_thin_provider_attempt_v1(
  p_tenant_id text,
  p_operation_key text,
  p_attempt_no integer,
  p_worker_id text,
  p_lease_fence bigint,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $csm_thin_heartbeat$
declare
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_lease_seconds is null or p_lease_seconds not between 5 and 300 then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'invalid_heartbeat_lease', 'status_code', 400
    );
  end if;
  update public.csm_thin_provider_attempts
  set heartbeat_at = now_at,
      lease_expires_at = now_at + pg_catalog.make_interval(secs => p_lease_seconds)
  where tenant_id = pg_catalog.btrim(p_tenant_id)
    and operation_key = pg_catalog.btrim(p_operation_key)
    and attempt_no = p_attempt_no
    and state = 'RUNNING'
    and lease_owner = pg_catalog.btrim(p_worker_id)
    and lease_fence = p_lease_fence
    and lease_expires_at > now_at;
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'lease_lost', 'status_code', 409
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'ok', true, 'code', 'heartbeat', 'status_code', 200,
    'lease_expires_at', now_at + pg_catalog.make_interval(secs => p_lease_seconds)
  );
end;
$csm_thin_heartbeat$;
create or replace function public.settle_csm_thin_provider_attempt_v1(
  p_provider text,
  p_account_scope text,
  p_model text,
  p_tenant_id text,
  p_operation_key text,
  p_attempt_no integer,
  p_worker_id text,
  p_lease_fence bigint,
  p_outcome text,
  p_result jsonb,
  p_actual_tokens integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $csm_thin_settle$
declare
  scope_row public.csm_thin_provider_scopes%rowtype;
  attempt_row public.csm_thin_provider_attempts%rowtype;
  operation_row public.csm_thin_provider_operations%rowtype;
  target_state text;
  operation_state text;
  rate_limit_retry_ms integer := 1000;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  p_provider := pg_catalog.btrim(p_provider);
  p_account_scope := pg_catalog.btrim(p_account_scope);
  p_model := pg_catalog.btrim(p_model);
  p_tenant_id := pg_catalog.btrim(p_tenant_id);
  p_operation_key := pg_catalog.btrim(p_operation_key);
  p_worker_id := pg_catalog.btrim(p_worker_id);
  p_outcome := pg_catalog.upper(pg_catalog.btrim(p_outcome));
  if p_outcome not in ('SUCCEEDED', 'FAILED', 'AMBIGUOUS', 'RATE_LIMITED')
     or (p_actual_tokens is not null and (
       p_actual_tokens < 0 or p_actual_tokens > 4000000
     )) then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'invalid_settle_outcome', 'status_code', 400
    );
  end if;
  target_state := case when p_outcome = 'RATE_LIMITED' then 'FAILED' else p_outcome end;
  if p_outcome = 'RATE_LIMITED'
     and pg_catalog.jsonb_typeof(p_result) = 'object'
     and coalesce(p_result ->> 'retry_after_ms', '') ~ '^[0-9]+$' then
    rate_limit_retry_ms := least(
      300000, greatest(1000, (p_result ->> 'retry_after_ms')::integer)
    );
  end if;

  select * into scope_row
  from public.csm_thin_provider_scopes
  where provider = p_provider
    and account_scope = p_account_scope
    and model = p_model
  for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'provider_scope_not_configured', 'status_code', 503
    );
  end if;

  select * into attempt_row
  from public.csm_thin_provider_attempts
  where tenant_id = p_tenant_id
    and operation_key = p_operation_key
    and attempt_no = p_attempt_no
    and provider = p_provider
    and account_scope = p_account_scope
    and model = p_model
  for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'attempt_not_found', 'status_code', 404
    );
  end if;

  if attempt_row.state = target_state
     and attempt_row.lease_owner is not distinct from p_worker_id
     and attempt_row.lease_fence is not distinct from p_lease_fence
     and attempt_row.actual_tokens is not distinct from p_actual_tokens
     and attempt_row.attempt_result is not distinct from p_result then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'code', 'exact_replay', 'status_code', 200,
      'replayed', true, 'operation_status', target_state
    );
  end if;

  if attempt_row.state <> 'RUNNING'
     or attempt_row.lease_owner is distinct from p_worker_id
     or attempt_row.lease_fence is distinct from p_lease_fence then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'lease_fence_conflict', 'status_code', 409
    );
  end if;
  if scope_row.active_count < 1
     or scope_row.active_tokens < attempt_row.estimated_tokens
     or (attempt_row.attempt_class = 'RETRY' and (
       scope_row.active_retry_count < 1
       or scope_row.active_retry_tokens < attempt_row.estimated_tokens
     )) then
    raise exception using
      errcode = '55000',
      message = 'csm_thin_provider_counter_drift';
  end if;

  select * into operation_row
  from public.csm_thin_provider_operations
  where tenant_id = p_tenant_id and operation_key = p_operation_key
  for update;
  operation_state := case
    when operation_row.cancel_requested_at is not null then 'CANCELLED'
    else target_state
  end;

  update public.csm_thin_provider_attempts
  set state = target_state,
      settled_at = now_at,
      heartbeat_at = now_at,
      lease_expires_at = null,
      actual_tokens = p_actual_tokens,
      charged_tokens = coalesce(p_actual_tokens, charged_tokens),
      attempt_result = p_result
  where tenant_id = p_tenant_id
    and operation_key = p_operation_key
    and attempt_no = p_attempt_no;

  update public.csm_thin_provider_operations
  set status = operation_state,
      terminal_result = p_result,
      updated_at = now_at
  where tenant_id = p_tenant_id and operation_key = p_operation_key;

  update public.csm_thin_provider_scopes
  set active_count = active_count - 1,
      active_tokens = active_tokens - attempt_row.estimated_tokens,
      active_retry_count = active_retry_count
        - case when attempt_row.attempt_class = 'RETRY' then 1 else 0 end,
      active_retry_tokens = active_retry_tokens
        - case when attempt_row.attempt_class = 'RETRY' then attempt_row.estimated_tokens else 0 end,
      updated_at = now_at
  where provider = p_provider
    and account_scope = p_account_scope
    and model = p_model;

  if p_outcome = 'RATE_LIMITED' then
    update public.csm_thin_provider_scopes
    set effective_max_active = case
          when aimd_cooldown_until is null or aimd_cooldown_until <= now_at
            then greatest(1, pg_catalog.floor(effective_max_active / 2.0)::integer)
          else effective_max_active
        end,
        effective_max_active_tokens = case
          when aimd_cooldown_until is null or aimd_cooldown_until <= now_at
            then greatest(1, pg_catalog.floor(effective_max_active_tokens / 2.0)::integer)
          else effective_max_active_tokens
        end,
        aimd_cooldown_until = greatest(
          coalesce(aimd_cooldown_until, '-infinity'::timestamptz),
          now_at + pg_catalog.make_interval(secs => rate_limit_retry_ms / 1000.0)
        ),
        aimd_last_decrease_at = case
          when aimd_cooldown_until is null or aimd_cooldown_until <= now_at
            then now_at
          else aimd_last_decrease_at
        end,
        updated_at = now_at
    where provider = p_provider
      and account_scope = p_account_scope
      and model = p_model;
  elsif p_outcome = 'SUCCEEDED'
        and (scope_row.aimd_cooldown_until is null
          or scope_row.aimd_cooldown_until <= now_at)
        and (scope_row.aimd_last_increase_at is null
          or scope_row.aimd_last_increase_at <= now_at - interval '1 second') then
    update public.csm_thin_provider_scopes
    set effective_max_active = least(
          max_active, effective_max_active + 1
        ),
        effective_max_active_tokens = least(
          max_active_tokens, effective_max_active_tokens + 11000
        ),
        aimd_last_increase_at = now_at,
        updated_at = now_at
    where provider = p_provider
      and account_scope = p_account_scope
      and model = p_model;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'code', 'settled', 'status_code', 200,
    'replayed', false,
    'attempt_state', target_state,
    'operation_status', operation_state,
    'charged_tokens', coalesce(p_actual_tokens, attempt_row.charged_tokens)
  );
end;
$csm_thin_settle$;
create or replace function public.cancel_csm_thin_provider_operation_v1(
  p_provider text,
  p_account_scope text,
  p_model text,
  p_tenant_id text,
  p_operation_key text,
  p_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $csm_thin_cancel$
declare
  scope_row public.csm_thin_provider_scopes%rowtype;
  operation_row public.csm_thin_provider_operations%rowtype;
  running_count integer;
  now_at timestamptz := pg_catalog.clock_timestamp();
begin
  p_provider := pg_catalog.btrim(p_provider);
  p_account_scope := pg_catalog.btrim(p_account_scope);
  p_model := pg_catalog.btrim(p_model);
  p_tenant_id := pg_catalog.btrim(p_tenant_id);
  p_operation_key := pg_catalog.btrim(p_operation_key);

  select * into scope_row
  from public.csm_thin_provider_scopes
  where provider = p_provider
    and account_scope = p_account_scope
    and model = p_model
  for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'provider_scope_not_configured', 'status_code', 503
    );
  end if;

  select * into operation_row
  from public.csm_thin_provider_operations
  where tenant_id = p_tenant_id and operation_key = p_operation_key
  for update;
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'operation_not_found', 'status_code', 404
    );
  end if;
  if operation_row.provider is distinct from p_provider
     or operation_row.account_scope is distinct from p_account_scope
     or operation_row.model is distinct from p_model
     or operation_row.payload_sha256 is distinct from p_payload_sha256 then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'operation_cancel_conflict', 'status_code', 409
    );
  end if;
  if operation_row.status in ('SUCCEEDED', 'CANCELLED') then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'code', 'exact_terminal', 'status_code', 200,
      'replayed', true, 'operation_status', operation_row.status
    );
  end if;

  update public.csm_thin_provider_attempts
  set state = 'CANCELLED', settled_at = now_at
  where tenant_id = p_tenant_id
    and operation_key = p_operation_key
    and state = 'QUEUED';
  select pg_catalog.count(*) into running_count
  from public.csm_thin_provider_attempts
  where tenant_id = p_tenant_id
    and operation_key = p_operation_key
    and state = 'RUNNING';

  update public.csm_thin_provider_operations
  set cancel_requested_at = coalesce(cancel_requested_at, now_at),
      status = case when running_count > 0 then 'CANCEL_REQUESTED' else 'CANCELLED' end,
      updated_at = now_at
  where tenant_id = p_tenant_id and operation_key = p_operation_key;

  if scope_row.reservation_tenant_id = p_tenant_id
     and scope_row.reservation_operation_key = p_operation_key then
    update public.csm_thin_provider_scopes
    set reservation_tenant_id = null,
        reservation_operation_key = null,
        reservation_attempt_no = null,
        updated_at = now_at
    where provider = p_provider
      and account_scope = p_account_scope
      and model = p_model;
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true, 'code', 'cancel_requested', 'status_code', 200,
    'running_attempts', running_count,
    'operation_status', case when running_count > 0 then 'CANCEL_REQUESTED' else 'CANCELLED' end
  );
end;
$csm_thin_cancel$;
create or replace function public.lookup_csm_thin_provider_operation_v1(
  p_tenant_id text,
  p_operation_key text,
  p_payload_sha256 text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $csm_thin_lookup$
declare
  operation_row public.csm_thin_provider_operations%rowtype;
  latest_attempt public.csm_thin_provider_attempts%rowtype;
begin
  select * into operation_row
  from public.csm_thin_provider_operations
  where tenant_id = pg_catalog.btrim(p_tenant_id)
    and operation_key = pg_catalog.btrim(p_operation_key);
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', true, 'code', 'not_found', 'status_code', 200,
      'found', false
    );
  end if;
  if operation_row.payload_sha256 is distinct from p_payload_sha256 then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'operation_payload_conflict', 'status_code', 409
    );
  end if;
  select * into latest_attempt
  from public.csm_thin_provider_attempts
  where tenant_id = operation_row.tenant_id
    and operation_key = operation_row.operation_key
  order by attempt_no desc
  limit 1;
  return pg_catalog.jsonb_build_object(
    'ok', true, 'code', 'found', 'status_code', 200,
    'found', true,
    'operation_status', operation_row.status,
    'latest_attempt_no', latest_attempt.attempt_no,
    'latest_attempt_state', latest_attempt.state,
    'result', operation_row.terminal_result
  );
end;
$csm_thin_lookup$;
revoke all on function public.enqueue_csm_thin_provider_attempt_v1(
  text, text, text, text, text, text, integer, text, integer, numeric, timestamptz,
  text, integer
) from public, anon, authenticated;
grant execute on function public.enqueue_csm_thin_provider_attempt_v1(
  text, text, text, text, text, text, integer, text, integer, numeric, timestamptz,
  text, integer
) to service_role;
revoke all on function public.claim_csm_thin_provider_attempt_v1(
  text, text, text, text, text, integer, text, integer
) from public, anon, authenticated;
grant execute on function public.claim_csm_thin_provider_attempt_v1(
  text, text, text, text, text, integer, text, integer
) to service_role;
revoke all on function public.heartbeat_csm_thin_provider_attempt_v1(
  text, text, integer, text, bigint, integer
) from public, anon, authenticated;
grant execute on function public.heartbeat_csm_thin_provider_attempt_v1(
  text, text, integer, text, bigint, integer
) to service_role;
revoke all on function public.settle_csm_thin_provider_attempt_v1(
  text, text, text, text, text, integer, text, bigint, text, jsonb, integer
) from public, anon, authenticated;
grant execute on function public.settle_csm_thin_provider_attempt_v1(
  text, text, text, text, text, integer, text, bigint, text, jsonb, integer
) to service_role;
revoke all on function public.cancel_csm_thin_provider_operation_v1(
  text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.cancel_csm_thin_provider_operation_v1(
  text, text, text, text, text, text
) to service_role;
revoke all on function public.lookup_csm_thin_provider_operation_v1(
  text, text, text
) from public, anon, authenticated;
grant execute on function public.lookup_csm_thin_provider_operation_v1(
  text, text, text
) to service_role;
