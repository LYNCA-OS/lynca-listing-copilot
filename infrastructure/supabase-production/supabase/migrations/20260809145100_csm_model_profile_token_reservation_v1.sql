-- Align the serialized CSM provider pacer with the active model profile's
-- 6,500-token p95 reservation. For a one-second 60,000-token refill, the
-- minimum lossless bucket is:
--
--   60,000 + 6,500 - gcd(60,000, 6,500) = 66,000
--
-- This does not change the 43-attempt working cap, 120-attempt absolute cap,
-- 440k active-token wall, rolling-window limits, attempts, or operations.

begin;

alter table public.csm_thin_provider_scopes
  alter column pacer_burst_tokens set default 66000,
  alter column pacer_available_tokens set default 66000;

do $csm_model_profile_token_reservation$
declare
  changed_rows integer;
begin
  update public.csm_thin_provider_scopes
  set pacer_burst_tokens = 66000,
      -- Preserve the live balance. Raising the ceiling must not mint a burst
      -- of capacity during deployment.
      pacer_available_tokens = least(pacer_available_tokens, 66000)
  where provider = 'openai'
    and account_scope = 'lynca-primary'
    and model = 'gpt-5.6-luna'
    and max_active = 120
    and max_active_tokens = 440000
    and baseline_working_max_active = 43
    and pacer_tokens_per_second = 60000
    and pacer_burst_tokens = 65200
    and token_window_target = 3600000
    and token_window_hard_limit = 4000000;

  get diagnostics changed_rows = row_count;
  if changed_rows <> 1 then
    raise exception using
      errcode = '55000',
      message = 'csm_model_profile_token_reservation_scope_mismatch';
  end if;
end;
$csm_model_profile_token_reservation$;

commit;
