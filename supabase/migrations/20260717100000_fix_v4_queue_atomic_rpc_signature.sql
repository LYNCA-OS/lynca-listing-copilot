-- Fix enqueue_v4_recognition_batch_atomic parameter contract for v4 queue rpc
-- without changing queue behavior. This keeps the production RPC implementation
-- identical while aligning the callable argument names/types.

DROP FUNCTION IF EXISTS public.enqueue_v4_recognition_batch_atomic(text, text, jsonb, jsonb, jsonb);
create or replace function public.enqueue_v4_recognition_batch_atomic(
  p_batch jsonb,
  p_jobs jsonb,
  p_operator_id text,
  p_sessions jsonb,
  p_tenant_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch_id text := nullif(pg_catalog.btrim(p_batch ->> 'id'), '');
  v_enqueue_identity text := nullif(p_batch -> 'metadata' ->> 'enqueue_identity_sha256', '');
  v_batch_item_count_text text := nullif(p_batch ->> 'item_count', '');
  v_job_count integer := case
    when pg_catalog.jsonb_typeof(p_jobs) = 'array' then pg_catalog.jsonb_array_length(p_jobs)
    else 0
  end;
  v_session_count integer := case
    when pg_catalog.jsonb_typeof(p_sessions) = 'array' then pg_catalog.jsonb_array_length(p_sessions)
    else 0
  end;
  v_distinct_count integer := 0;
  v_batch public.v4_recognition_batches%rowtype;
  v_session public.v4_recognition_sessions%rowtype;
  v_job public.v4_recognition_jobs%rowtype;
  v_asset public.listing_assets%rowtype;
  v_session_json jsonb;
  v_job_json jsonb;
  v_front_path text;
  v_back_path text;
  v_additional_paths jsonb;
  v_write_count integer := 0;
  v_session_inserted integer := 0;
  v_job_inserted integer := 0;
  v_accepted integer := 0;
  v_queued integer := 0;
  v_deduplicated integer := 0;
  v_results jsonb := '[]'::jsonb;
begin
  if nullif(pg_catalog.btrim(p_tenant_id), '') is null
     or nullif(pg_catalog.btrim(p_operator_id), '') is null
     or p_tenant_id !~ '^[A-Za-z0-9_-]{1,128}$'
     or v_batch_id is null
     or pg_catalog.jsonb_typeof(p_batch) <> 'object'
     or pg_catalog.jsonb_typeof(p_batch -> 'metadata') <> 'object'
     or v_enqueue_identity !~ '^[0-9a-f]{64}$'
     or coalesce(v_batch_item_count_text, '') !~ '^[0-9]{1,3}$'
     or pg_catalog.jsonb_typeof(p_sessions) <> 'array'
     or pg_catalog.jsonb_typeof(p_jobs) <> 'array'
     or v_session_count < 1
     or v_job_count < 1
     or v_session_count > 250
     or v_job_count > 500
     or nullif(p_batch ->> 'tenant_id', '') is distinct from p_tenant_id
     or nullif(p_batch ->> 'operator_id', '') is distinct from p_operator_id then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'invalid_atomic_enqueue_request');
  end if;

  if v_batch_item_count_text::integer <> v_job_count then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'invalid_atomic_enqueue_item_count');
  end if;

  if not exists (
    select 1
    from public.tenant_members member
    join public.users app_user on app_user.id = member.user_id
    join public.tenants tenant on tenant.id = member.tenant_id
    where member.tenant_id = p_tenant_id
      and member.user_id = p_operator_id
      and member.role in ('OWNER', 'MANAGER', 'WRITER')
      and member.status = 'ACTIVE'
      and member.disabled_at is null
      and app_user.status = 'ACTIVE'
      and app_user.disabled_at is null
      and tenant.status = 'ACTIVE'
      and tenant.disabled_at is null
  ) then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'operator_not_active_member');
  end if;

  select count(distinct session_item ->> 'id')::integer
  into v_distinct_count
  from pg_catalog.jsonb_array_elements(p_sessions) session_item;
  if v_distinct_count <> v_session_count then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'duplicate_session_id');
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_sessions) session_item
    where nullif(session_item ->> 'id', '') is null
       or coalesce(nullif(session_item ->> 'asset_id', ''), '')
          !~* '^asset_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or nullif(session_item ->> 'client_asset_ref', '') is null
       or pg_catalog.length(session_item ->> 'client_asset_ref') > 160
       or session_item ->> 'client_asset_ref' ~ '[[:cntrl:]]'
       or nullif(session_item ->> 'tenant_id', '') is distinct from p_tenant_id
       or nullif(session_item ->> 'operator_id', '') is distinct from p_operator_id
       or nullif(session_item ->> 'user_id', '') is distinct from p_operator_id
       or pg_catalog.jsonb_typeof(session_item -> 'identity_snapshot') <> 'object'
       or pg_catalog.jsonb_typeof(
            coalesce(session_item -> 'identity_snapshot' -> 'image_references', '[]'::jsonb)
          ) <> 'array'
       or nullif(session_item -> 'identity_snapshot' ->> 'tenant_id', '') is distinct from p_tenant_id
       or nullif(session_item -> 'identity_snapshot' ->> 'operator_id', '') is distinct from p_operator_id
       or nullif(session_item -> 'identity_snapshot' ->> 'user_id', '') is distinct from p_operator_id
       or nullif(session_item -> 'identity_snapshot' ->> 'asset_id', '')
          is distinct from nullif(session_item ->> 'asset_id', '')
       or nullif(session_item -> 'identity_snapshot' ->> 'client_asset_ref', '')
          is distinct from nullif(session_item ->> 'client_asset_ref', '')
       or nullif(session_item -> 'identity_snapshot' ->> 'stable_asset_id', '')
          is distinct from nullif(session_item ->> 'stable_asset_id', '')
       or nullif(session_item -> 'identity_snapshot' ->> 'asset_fingerprint', '')
          is distinct from nullif(session_item ->> 'asset_fingerprint', '')
       or (
         nullif(session_item ->> 'asset_fingerprint', '') is not null
         and nullif(session_item ->> 'asset_fingerprint', '') !~ '^[0-9a-f]{64}$'
       )
       or nullif(session_item ->> 'preingestion_bundle_id', '') is not null
       or nullif(session_item ->> 'preingestionBundleId', '') is not null
  ) then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'session_identity_invalid');
  end if;

  -- Storage paths are server-owned tenant/asset lineage. A queue caller may
  -- reference an already uploaded image, but it cannot point a canonical
  -- asset at another tenant's or another asset's object namespace.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_sessions) session_item
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(session_item -> 'identity_snapshot' -> 'image_references', '[]'::jsonb)
    ) image_ref
    where nullif(image_ref ->> 'object_path', '') is not null
      and (
        pg_catalog.length(image_ref ->> 'object_path') > 1024
        or pg_catalog.array_length(pg_catalog.string_to_array(image_ref ->> 'object_path', '/'), 1) <> 6
        or pg_catalog.split_part(image_ref ->> 'object_path', '/', 1) <> 'tenants'
        or pg_catalog.split_part(image_ref ->> 'object_path', '/', 2) <> p_tenant_id
        or pg_catalog.split_part(image_ref ->> 'object_path', '/', 3) <> 'listing-assets'
        or pg_catalog.split_part(image_ref ->> 'object_path', '/', 4) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or pg_catalog.split_part(image_ref ->> 'object_path', '/', 5) is distinct from pg_catalog.left(
          pg_catalog.btrim(
            pg_catalog.regexp_replace(
              pg_catalog.lower(session_item ->> 'asset_id'),
              '[^a-z0-9_-]+',
              '-',
              'g'
            ),
            '-'
          ),
          72
        )
        or nullif(pg_catalog.split_part(image_ref ->> 'object_path', '/', 6), '') is null
      )
  ) then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'session_image_object_path_out_of_scope');
  end if;

  select count(distinct job_item ->> 'id')::integer
  into v_distinct_count
  from pg_catalog.jsonb_array_elements(p_jobs) job_item;
  if v_distinct_count <> v_job_count then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'duplicate_job_id');
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_jobs) job_item
    where nullif(job_item ->> 'id', '') is null
       or nullif(job_item ->> 'asset_id', '') is null
       or nullif(job_item ->> 'recognition_session_id', '') is null
       or nullif(job_item ->> 'tenant_id', '') is distinct from p_tenant_id
       or nullif(job_item ->> 'operator_id', '') is distinct from p_operator_id
       or nullif(job_item ->> 'batch_id', '') is distinct from v_batch_id
       or pg_catalog.jsonb_typeof(job_item -> 'payload') <> 'object'
       or nullif(job_item -> 'payload' ->> 'recognition_session_id', '')
          is distinct from nullif(job_item ->> 'recognition_session_id', '')
       or nullif(job_item -> 'payload' ->> 'asset_id', '')
          is distinct from nullif(job_item ->> 'asset_id', '')
       or job_item -> 'payload' ? 'preingestion_bundle_id'
       or job_item -> 'payload' ? 'preingestionBundleId'
       or not exists (
         select 1
         from pg_catalog.jsonb_array_elements(p_sessions) session_item
         where session_item ->> 'id' = job_item ->> 'recognition_session_id'
           and session_item ->> 'asset_id' = job_item ->> 'asset_id'
       )
  ) then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'job_identity_invalid');
  end if;

  -- Validate every caller-supplied scalar before the first write. PostgreSQL
  -- casts must never turn malformed JSON into a partially persisted batch.
  for v_job_json in
    select job_item
    from pg_catalog.jsonb_array_elements(p_jobs) job_item
  loop
    if coalesce(nullif(v_job_json ->> 'priority', ''), '100') !~ '^[0-9]{1,5}$'
       or coalesce(nullif(v_job_json ->> 'max_attempts', ''), '2') !~ '^[0-9]{1,2}$' then
      return pg_catalog.jsonb_build_object('saved', false, 'reason', 'invalid_job_scalar');
    end if;
    if coalesce(nullif(v_job_json ->> 'priority', ''), '100')::integer not between 0 and 10000
       or coalesce(nullif(v_job_json ->> 'max_attempts', ''), '2')::integer not between 1 and 10 then
      return pg_catalog.jsonb_build_object('saved', false, 'reason', 'invalid_job_scalar');
    end if;
    begin
      perform coalesce(
        nullif(v_job_json ->> 'not_before', '')::timestamptz,
        pg_catalog.clock_timestamp()
      );
    exception
      when invalid_text_representation or datetime_field_overflow then
        return pg_catalog.jsonb_build_object('saved', false, 'reason', 'invalid_job_scalar');
    end;
  end loop;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_sessions) session_item
    group by session_item ->> 'asset_id'
    having count(distinct (session_item -> 'identity_snapshot')::text) > 1
  ) then
    return pg_catalog.jsonb_build_object('saved', false, 'reason', 'root_listing_asset_identity_conflict');
  end if;

  -- listing_assets is a server-created Track C tenant root. Queue submission
  -- may bind still-null immutable identity fields, but must never become a
  -- second asset-creation endpoint.
  for v_session_json in
    select distinct on (session_item ->> 'asset_id') session_item
    from pg_catalog.jsonb_array_elements(p_sessions) session_item
    order by session_item ->> 'asset_id', session_item ->> 'id'
  loop
    select nullif(image_ref ->> 'object_path', '')
    into v_front_path
    from pg_catalog.jsonb_array_elements(
      coalesce(v_session_json -> 'identity_snapshot' -> 'image_references', '[]'::jsonb)
    ) image_ref
    where image_ref ->> 'image_role' = 'front_original'
    order by image_ref ->> 'object_path'
    limit 1;

    select nullif(image_ref ->> 'object_path', '')
    into v_back_path
    from pg_catalog.jsonb_array_elements(
      coalesce(v_session_json -> 'identity_snapshot' -> 'image_references', '[]'::jsonb)
    ) image_ref
    where image_ref ->> 'image_role' = 'back_original'
    order by image_ref ->> 'object_path'
    limit 1;

    select coalesce(pg_catalog.jsonb_agg(image_ref order by image_ref ->> 'object_path'), '[]'::jsonb)
    into v_additional_paths
    from pg_catalog.jsonb_array_elements(
      coalesce(v_session_json -> 'identity_snapshot' -> 'image_references', '[]'::jsonb)
    ) image_ref
    where coalesce(image_ref ->> 'image_role', '') not in ('front_original', 'back_original');

    select assets.*
    into v_asset
    from public.listing_assets assets
    where assets.id = v_session_json ->> 'asset_id'
    for update;
    if not found
       or v_asset.tenant_id is distinct from p_tenant_id then
      raise exception using errcode = '23503', message = 'root_listing_asset_not_found';
    end if;

    if (v_asset.asset_fingerprint is not null
          and nullif(v_session_json ->> 'asset_fingerprint', '') is not null
          and v_asset.asset_fingerprint is distinct from nullif(v_session_json ->> 'asset_fingerprint', ''))
       or (v_asset.front_object_path is not null and v_front_path is not null
           and v_asset.front_object_path is distinct from v_front_path)
       or (v_asset.back_object_path is not null and v_back_path is not null
           and v_asset.back_object_path is distinct from v_back_path) then
      raise exception using errcode = '23505', message = 'root_listing_asset_identity_conflict';
    end if;

    update public.listing_assets assets
    set asset_fingerprint = coalesce(
          assets.asset_fingerprint,
          nullif(v_session_json ->> 'asset_fingerprint', '')
        ),
        front_object_path = coalesce(assets.front_object_path, v_front_path),
        back_object_path = coalesce(assets.back_object_path, v_back_path),
        additional_image_paths = case
          when assets.additional_image_paths = '[]'::jsonb and v_additional_paths <> '[]'::jsonb
            then v_additional_paths
          else assets.additional_image_paths
        end
    where assets.id = v_session_json ->> 'asset_id'
      and assets.tenant_id = p_tenant_id;
  end loop;

  insert into public.v4_recognition_batches (
    id, tenant_id, created_by_user_id, assigned_to_user_id, status,
    item_count, completed_count, failed_count, metadata, created_at, updated_at
  ) values (
    v_batch_id, p_tenant_id, p_operator_id, null, 'QUEUED',
    v_job_count, 0, 0, p_batch -> 'metadata',
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  )
  on conflict (id) do nothing;

  select batches.*
  into v_batch
  from public.v4_recognition_batches batches
  where batches.id = v_batch_id
  for update;
  if not found
     or v_batch.tenant_id is distinct from p_tenant_id
     or v_batch.created_by_user_id is distinct from p_operator_id
     or v_batch.item_count is distinct from v_job_count
     or nullif(v_batch.metadata ->> 'enqueue_identity_sha256', '') is distinct from v_enqueue_identity then
    raise exception using errcode = '23505', message = 'queue_batch_identity_conflict';
  end if;

  for v_session_json in
    select session_item
    from pg_catalog.jsonb_array_elements(p_sessions) session_item
    order by session_item ->> 'id'
  loop
    insert into public.v4_recognition_sessions (
      id, schema_version, status, asset_id, stable_asset_id, client_asset_ref,
      asset_fingerprint, tenant_id, user_id, identity_snapshot,
      preingestion_bundle_id, route, route_reason, route_plan, request_summary,
      operator_id, created_by_user_id, assigned_to_user_id, created_at, updated_at
    ) values (
      v_session_json ->> 'id',
      coalesce(nullif(v_session_json ->> 'schema_version', ''), 'v4-recognition-session-v1'),
      'CREATED',
      v_session_json ->> 'asset_id',
      nullif(v_session_json ->> 'stable_asset_id', ''),
      nullif(v_session_json ->> 'client_asset_ref', ''),
      nullif(v_session_json ->> 'asset_fingerprint', ''),
      p_tenant_id,
      p_operator_id,
      v_session_json -> 'identity_snapshot',
      null,
      nullif(v_session_json ->> 'route', ''),
      nullif(v_session_json ->> 'route_reason', ''),
      coalesce(v_session_json -> 'route_plan', '{}'::jsonb),
      coalesce(v_session_json -> 'request_summary', '{}'::jsonb),
      p_operator_id,
      p_operator_id,
      p_operator_id,
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()
    )
    on conflict (id) do nothing;
    get diagnostics v_write_count = row_count;
    v_session_inserted := v_session_inserted + v_write_count;

    select sessions.*
    into v_session
    from public.v4_recognition_sessions sessions
    where sessions.id = v_session_json ->> 'id'
    for update;
    if not found
       or v_session.tenant_id is distinct from p_tenant_id
       or v_session.operator_id is distinct from p_operator_id
       or v_session.user_id is distinct from p_operator_id
       or v_session.created_by_user_id is distinct from p_operator_id
       or v_session.asset_id is distinct from nullif(v_session_json ->> 'asset_id', '')
       or v_session.stable_asset_id is distinct from nullif(v_session_json ->> 'stable_asset_id', '')
       or v_session.client_asset_ref is distinct from nullif(v_session_json ->> 'client_asset_ref', '')
       or v_session.asset_fingerprint is distinct from nullif(v_session_json ->> 'asset_fingerprint', '')
       or v_session.identity_snapshot is distinct from v_session_json -> 'identity_snapshot' then
      raise exception using errcode = '23505', message = 'queue_session_identity_conflict';
    end if;
  end loop;

  for v_job_json in
    select job_item
    from pg_catalog.jsonb_array_elements(p_jobs) job_item
    order by job_item ->> 'id'
  loop
    insert into public.v4_recognition_jobs (
      id, schema_version, batch_id, tenant_id, operator_id,
      created_by_user_id, assigned_to_user_id, asset_id,
      recognition_session_id, job_type, provider_id, status, lane, priority,
      parent_job_id, paired_job_id, payload, result, error, timing, queue_tags,
      attempt_count, max_attempts, not_before, created_at, updated_at
    ) values (
      v_job_json ->> 'id',
      coalesce(nullif(v_job_json ->> 'schema_version', ''), 'v4-recognition-session-v1'),
      v_batch_id,
      p_tenant_id,
      p_operator_id,
      p_operator_id,
      p_operator_id,
      v_job_json ->> 'asset_id',
      v_job_json ->> 'recognition_session_id',
      coalesce(nullif(v_job_json ->> 'job_type', ''), 'FINAL_ASSISTED_TITLE'),
      coalesce(nullif(v_job_json ->> 'provider_id', ''), 'openai_legacy'),
      'QUEUED',
      coalesce(nullif(v_job_json ->> 'lane', ''), 'background'),
      coalesce((v_job_json ->> 'priority')::integer, 100),
      nullif(v_job_json ->> 'parent_job_id', ''),
      nullif(v_job_json ->> 'paired_job_id', ''),
      v_job_json -> 'payload',
      coalesce(v_job_json -> 'result', '{}'::jsonb),
      coalesce(v_job_json -> 'error', '{}'::jsonb),
      coalesce(v_job_json -> 'timing', '{}'::jsonb),
      coalesce(v_job_json -> 'queue_tags', '{}'::jsonb),
      0,
      coalesce((v_job_json ->> 'max_attempts')::integer, 2),
      coalesce(nullif(v_job_json ->> 'not_before', '')::timestamptz, pg_catalog.clock_timestamp()),
      pg_catalog.clock_timestamp(),
      pg_catalog.clock_timestamp()
    )
    on conflict (id) do nothing;
    get diagnostics v_write_count = row_count;
    v_job_inserted := v_job_inserted + v_write_count;

    select jobs.*
    into v_job
    from public.v4_recognition_jobs jobs
    where jobs.id = v_job_json ->> 'id'
    for update;
    if not found
       or v_job.tenant_id is distinct from p_tenant_id
       or v_job.operator_id is distinct from p_operator_id
       or v_job.created_by_user_id is distinct from p_operator_id
       or v_job.batch_id is distinct from v_batch_id
       or v_job.asset_id is distinct from nullif(v_job_json ->> 'asset_id', '')
       or v_job.recognition_session_id is distinct from nullif(v_job_json ->> 'recognition_session_id', '')
       or v_job.job_type is distinct from coalesce(
            nullif(v_job_json ->> 'job_type', ''),
            'FINAL_ASSISTED_TITLE'
          )
       or v_job.lane is distinct from coalesce(nullif(v_job_json ->> 'lane', ''), 'background')
       or v_job.parent_job_id is distinct from nullif(v_job_json ->> 'parent_job_id', '')
       or v_job.paired_job_id is distinct from nullif(v_job_json ->> 'paired_job_id', '')
       or v_job.provider_id is distinct from coalesce(
            nullif(v_job_json ->> 'provider_id', ''),
            'openai_legacy'
          )
       or v_job.payload is distinct from v_job_json -> 'payload' then
      raise exception using errcode = '23505', message = 'queue_job_identity_conflict';
    end if;

    if v_job.status in ('FAILED', 'CANCELLED') then
      v_results := v_results || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'saved', false,
        'row', pg_catalog.to_jsonb(v_job),
        'error', 'queue_job_terminal_retry_required',
        'retry_required', true,
        'deduplicated', true
      ));
      v_deduplicated := v_deduplicated + 1;
    else
      v_accepted := v_accepted + 1;
      if v_job.status in ('QUEUED', 'RETRYING', 'RUNNING') then
        v_queued := v_queued + 1;
      end if;
      if v_write_count = 0 then
        v_deduplicated := v_deduplicated + 1;
      end if;
      v_results := v_results || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'saved', true,
        'row', pg_catalog.to_jsonb(v_job),
        'error', null,
        'deduplicated', v_write_count = 0
      ));
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'saved', true,
    'batch_id', v_batch_id,
    'jobs', v_results,
    'accepted_count', v_accepted,
    'queued_count', v_queued,
    'inserted_count', v_job_inserted,
    'deduplicated_count', v_deduplicated,
    'session_rows_written', v_session_inserted,
    'job_rows_written', v_job_inserted
  );
end;
$$;

REVOKE ALL ON FUNCTION public.enqueue_v4_recognition_batch_atomic(jsonb, jsonb, text, jsonb, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_v4_recognition_batch_atomic(jsonb, jsonb, text, jsonb, text)
  TO service_role;
