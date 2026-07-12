-- Persist the writer-visible L2 result and release the scarce provider slot in
-- one transaction. Resolver, renderer, queue completion, and learning writes
-- are local/post-provider work and must not keep provider capacity occupied.

create or replace function public.persist_v4_writer_ready_and_release_capacity(
  p_session_id text,
  p_session_patch jsonb,
  p_job_id text,
  p_worker_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session_count integer := 0;
  v_released_count integer := 0;
begin
  if coalesce(p_session_id, '') = '' then
    raise exception 'missing_session_id';
  end if;
  if coalesce(p_job_id, '') = '' then
    raise exception 'missing_job_id';
  end if;
  if jsonb_typeof(coalesce(p_session_patch, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_session_patch';
  end if;

  update public.v4_recognition_sessions sessions
  set status = case when p_session_patch ? 'status' then p_session_patch ->> 'status' else sessions.status end,
      field_states = case when p_session_patch ? 'field_states' then coalesce(p_session_patch -> 'field_states', '{}'::jsonb) else sessions.field_states end,
      route = case when p_session_patch ? 'route' then p_session_patch ->> 'route' else sessions.route end,
      route_plan = case when p_session_patch ? 'route_plan' then coalesce(p_session_patch -> 'route_plan', '{}'::jsonb) else sessions.route_plan end,
      candidate_control_plane_trace = case when p_session_patch ? 'candidate_control_plane_trace' then coalesce(p_session_patch -> 'candidate_control_plane_trace', '{}'::jsonb) else sessions.candidate_control_plane_trace end,
      provider_result_summary = case when p_session_patch ? 'provider_result_summary' then coalesce(p_session_patch -> 'provider_result_summary', '{}'::jsonb) else sessions.provider_result_summary end,
      final_title = case when p_session_patch ? 'final_title' then p_session_patch ->> 'final_title' else sessions.final_title end,
      l2_status = case when p_session_patch ? 'l2_status' then p_session_patch ->> 'l2_status' else sessions.l2_status end,
      l2_title = case when p_session_patch ? 'l2_title' then p_session_patch ->> 'l2_title' else sessions.l2_title end,
      l2_ready_at = case when p_session_patch ? 'l2_ready_at' then (p_session_patch ->> 'l2_ready_at')::timestamptz else sessions.l2_ready_at end,
      l2_route = case when p_session_patch ? 'l2_route' then p_session_patch ->> 'l2_route' else sessions.l2_route end,
      l2_timing = case when p_session_patch ? 'l2_timing' then coalesce(p_session_patch -> 'l2_timing', '{}'::jsonb) else sessions.l2_timing end,
      resolved_fields = case when p_session_patch ? 'resolved_fields' then coalesce(p_session_patch -> 'resolved_fields', '{}'::jsonb) else sessions.resolved_fields end,
      updated_at = clock_timestamp()
  where sessions.id = p_session_id;

  get diagnostics v_session_count = row_count;
  if v_session_count <> 1 then
    raise exception 'recognition_session_not_found:%', p_session_id;
  end if;

  update public.v4_provider_capacity_leases leases
  set job_id = null,
      lease_owner = null,
      lease_expires_at = null,
      updated_at = clock_timestamp()
  where leases.job_id = p_job_id
    and (p_worker_id is null or leases.lease_owner = p_worker_id);

  get diagnostics v_released_count = row_count;

  return jsonb_build_object(
    'session_saved', true,
    'session_count', v_session_count,
    'provider_capacity_released', v_released_count > 0,
    'provider_capacity_released_count', v_released_count,
    'release_boundary', 'writer_ready_atomic'
  );
end;
$$;

revoke all on function public.persist_v4_writer_ready_and_release_capacity(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.persist_v4_writer_ready_and_release_capacity(text, jsonb, text, text) to service_role;
