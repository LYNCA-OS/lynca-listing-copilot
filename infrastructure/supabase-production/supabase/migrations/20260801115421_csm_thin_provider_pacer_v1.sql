-- Additive pacing layer for the durable CSM thin provider authority.
--
-- The applied 20260801101152 migration is immutable. This migration adds only
-- scope state and replaces the existing claim/settle bodies with the same RPC
-- signatures. It keeps the absolute 120-count / 440k-token authority walls,
-- bounds the normal working window at 43 active attempts, and serializes starts
-- at 60,000 estimated tokens per second on the already-authoritative scope row.
-- A 65,200-token bucket is the minimum lossless size for the current one-second
-- poll and 5,300-token reservation quantum: 60,000 + 5,300 - gcd(60,000, 5,300).
-- It preserves the sub-quantum carry, converges to exactly 60,000 tokens/second
-- over the 53-tick cycle, and still permits at most twelve starts in one tick.
--
-- Rollback is a future additive migration that restores the prior two function
-- bodies, drops the two constraints below, and then drops these five columns.
-- No operation or attempt rows are deleted or rewritten here.

alter table public.csm_thin_provider_scopes
  add column baseline_working_max_active integer,
  add column pacer_tokens_per_second integer,
  add column pacer_burst_tokens integer,
  add column pacer_available_tokens numeric(20,6),
  add column pacer_refilled_at timestamptz;
update public.csm_thin_provider_scopes
set baseline_working_max_active = least(43, max_active),
    pacer_tokens_per_second = 60000,
    pacer_burst_tokens = 65200,
    pacer_available_tokens = 65200,
    pacer_refilled_at = pg_catalog.clock_timestamp(),
    effective_max_active = least(effective_max_active, 43, max_active);
alter table public.csm_thin_provider_scopes
  alter column baseline_working_max_active set default 43,
  alter column baseline_working_max_active set not null,
  alter column pacer_tokens_per_second set default 60000,
  alter column pacer_tokens_per_second set not null,
  alter column pacer_burst_tokens set default 65200,
  alter column pacer_burst_tokens set not null,
  alter column pacer_available_tokens set default 65200,
  alter column pacer_available_tokens set not null,
  alter column pacer_refilled_at set default pg_catalog.clock_timestamp(),
  alter column pacer_refilled_at set not null,
  add constraint csm_thin_provider_scope_working_cap check (
    baseline_working_max_active between 1 and max_active
    and effective_max_active between 1 and baseline_working_max_active
  ),
  add constraint csm_thin_provider_scope_pacer check (
    pacer_tokens_per_second > 0
    and pacer_burst_tokens between 1 and max_active_tokens
    and pacer_available_tokens between pacer_burst_tokens - max_active_tokens
      and pacer_burst_tokens
    and pacer_tokens_per_second * rolling_window_seconds <= token_window_target
  );
comment on column public.csm_thin_provider_scopes.baseline_working_max_active is
  'AIMD recovery ceiling. Absolute provider count authority remains max_active.';
comment on column public.csm_thin_provider_scopes.pacer_tokens_per_second is
  'Token-bucket estimated-token refill rate, serialized by the scope row.';
comment on column public.csm_thin_provider_scopes.pacer_burst_tokens is
  'Temporal microburst only; independent of the 440k active-token hard wall.';
comment on column public.csm_thin_provider_scopes.pacer_available_tokens is
  'Current token-bucket balance; a single oversized attempt may create bounded debt.';
comment on column public.csm_thin_provider_scopes.pacer_refilled_at is
  'Clock timestamp used for atomic token-bucket refill.';
do $csm_thin_provider_pacer_contract$
begin
  if not exists (
    select 1
    from public.csm_thin_provider_scopes
    where provider = 'openai'
      and account_scope = 'lynca-primary'
      and model = 'gpt-5.6-luna'
      and max_active = 120
      and max_active_tokens = 440000
      and baseline_working_max_active = 43
      and effective_max_active between 1 and 43
      and pacer_tokens_per_second = 60000
      and pacer_burst_tokens = 65200
      and pacer_available_tokens = 65200
      and token_window_target = 3600000
      and token_window_hard_limit = 4000000
  ) then
    raise exception using
      errcode = '55000',
      message = 'csm_thin_provider_pacer_contract_mismatch';
  end if;
end;
$csm_thin_provider_pacer_contract$;
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
  refilled_pacer_tokens numeric(20,6);
  pacer_required_tokens numeric(20,6);
  pacer_retry_after_ms integer := 1;
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
  -- clock_timestamp() is refreshed after the scope-row lock. Concurrent claim
  -- transactions may have waited on that lock and must not pace against a stale
  -- pre-lock timestamp.
  now_at := pg_catalog.clock_timestamp();

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
    scope_row.max_active,
    scope_row.baseline_working_max_active,
    scope_row.effective_max_active
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

  refilled_pacer_tokens := least(
    scope_row.pacer_burst_tokens::numeric,
    scope_row.pacer_available_tokens + greatest(
      0::numeric,
      extract(epoch from (now_at - scope_row.pacer_refilled_at))
        * scope_row.pacer_tokens_per_second
    )
  );
  -- A request larger than the temporal bucket may start only from a full
  -- bucket, then carries bounded debt. This preserves the old authority's
  -- support for estimates up to 440k without letting smaller work jump ahead.
  pacer_required_tokens := least(
    target_row.estimated_tokens::numeric,
    scope_row.pacer_burst_tokens::numeric
  );
  if refilled_pacer_tokens < pacer_required_tokens then
    pacer_retry_after_ms := greatest(1, pg_catalog.ceil(
      (pacer_required_tokens - refilled_pacer_tokens)
        / scope_row.pacer_tokens_per_second * 1000
    )::integer);
    update public.csm_thin_provider_scopes
    set pacer_available_tokens = refilled_pacer_tokens,
        pacer_refilled_at = now_at,
        updated_at = now_at
    where provider = p_provider
      and account_scope = p_account_scope
      and model = p_model;
    return pg_catalog.jsonb_build_object(
      'ok', true, 'code', 'pacer_limited', 'status_code', 202,
      'admitted', false, 'retry_after_ms', pacer_retry_after_ms
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
      pacer_available_tokens = refilled_pacer_tokens - selected_row.estimated_tokens,
      pacer_refilled_at = now_at,
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
    'lease_expires_at', now_at + pg_catalog.make_interval(secs => p_lease_seconds),
    'pacer_available_tokens', refilled_pacer_tokens - selected_row.estimated_tokens
  );
end;
$csm_thin_claim$;
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
  now_at := pg_catalog.clock_timestamp();

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
          max_active, baseline_working_max_active, effective_max_active + 1
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
create or replace function public.check_csm_thin_provider_pacer_v1(
  p_provider text,
  p_account_scope text,
  p_model text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $csm_thin_pacer_readiness$
declare
  scope_row public.csm_thin_provider_scopes%rowtype;
begin
  select * into scope_row
  from public.csm_thin_provider_scopes
  where provider = pg_catalog.btrim(p_provider)
    and account_scope = pg_catalog.btrim(p_account_scope)
    and model = pg_catalog.btrim(p_model);
  if not found then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'code', 'provider_scope_not_configured', 'status_code', 503
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'ok', true, 'code', 'pacer_ready', 'status_code', 200,
    'max_active', scope_row.max_active,
    'max_active_tokens', scope_row.max_active_tokens,
    'baseline_working_max_active', scope_row.baseline_working_max_active,
    'effective_max_active', scope_row.effective_max_active,
    'pacer_tokens_per_second', scope_row.pacer_tokens_per_second,
    'pacer_burst_tokens', scope_row.pacer_burst_tokens,
    'token_window_target', scope_row.token_window_target,
    'token_window_hard_limit', scope_row.token_window_hard_limit
  );
end;
$csm_thin_pacer_readiness$;
revoke all on function public.claim_csm_thin_provider_attempt_v1(
  text, text, text, text, text, integer, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_csm_thin_provider_attempt_v1(
  text, text, text, text, text, integer, text, integer
) to service_role;
revoke all on function public.settle_csm_thin_provider_attempt_v1(
  text, text, text, text, text, integer, text, bigint, text, jsonb, integer
) from public, anon, authenticated, service_role;
grant execute on function public.settle_csm_thin_provider_attempt_v1(
  text, text, text, text, text, integer, text, bigint, text, jsonb, integer
) to service_role;
revoke all on function public.check_csm_thin_provider_pacer_v1(
  text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.check_csm_thin_provider_pacer_v1(
  text, text, text
) to service_role;
