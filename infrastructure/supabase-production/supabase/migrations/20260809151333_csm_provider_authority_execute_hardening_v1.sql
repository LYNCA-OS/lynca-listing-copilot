begin;

-- Provider admission is a server-only spend boundary. Supabase's public API
-- roles must never enqueue, claim, settle, cancel, or read paid operations.
revoke all on function public.enqueue_csm_thin_provider_attempt_v1(
  text, text, text, text, text, text, integer, text, integer, numeric,
  timestamptz, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.enqueue_csm_thin_provider_attempt_v1(
  text, text, text, text, text, text, integer, text, integer, numeric,
  timestamptz, text, integer
) to service_role;

revoke all on function public.claim_csm_thin_provider_attempt_v1(
  text, text, text, text, text, integer, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.claim_csm_thin_provider_attempt_v1(
  text, text, text, text, text, integer, text, integer
) to service_role;

revoke all on function public.heartbeat_csm_thin_provider_attempt_v1(
  text, text, integer, text, bigint, integer
) from public, anon, authenticated, service_role;
grant execute on function public.heartbeat_csm_thin_provider_attempt_v1(
  text, text, integer, text, bigint, integer
) to service_role;

revoke all on function public.settle_csm_thin_provider_attempt_v1(
  text, text, text, text, text, integer, text, bigint, text, jsonb, integer
) from public, anon, authenticated, service_role;
grant execute on function public.settle_csm_thin_provider_attempt_v1(
  text, text, text, text, text, integer, text, bigint, text, jsonb, integer
) to service_role;

revoke all on function public.cancel_csm_thin_provider_operation_v1(
  text, text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.cancel_csm_thin_provider_operation_v1(
  text, text, text, text, text, text
) to service_role;

revoke all on function public.lookup_csm_thin_provider_operation_v1(
  text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.lookup_csm_thin_provider_operation_v1(
  text, text, text
) to service_role;

revoke all on function public.lookup_csm_thin_provider_operation_by_key_v1(
  text, text
) from public, anon, authenticated, service_role;
grant execute on function public.lookup_csm_thin_provider_operation_by_key_v1(
  text, text
) to service_role;

revoke all on function public.check_csm_thin_provider_pacer_v1(
  text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.check_csm_thin_provider_pacer_v1(
  text, text, text
) to service_role;

-- Make the same boundary the default for future postgres-owned functions.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

commit;
