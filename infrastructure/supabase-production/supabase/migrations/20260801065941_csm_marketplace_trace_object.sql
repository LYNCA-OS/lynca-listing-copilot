-- Marketplace composition has four distinct outcomes: budget drops, profile
-- suppression, restoration, and final truncation.  An array cannot preserve
-- which decision produced a missing bracket, so the replay ledger is an
-- object keyed by outcome rather than a flat list.

alter table public.csm_marketplace_outputs
  alter column dropped_trace set default '{}'::jsonb;

alter table public.csm_marketplace_outputs
  drop constraint if exists csm_marketplace_dropped_check;

alter table public.csm_marketplace_outputs
  add constraint csm_marketplace_dropped_check
  check (jsonb_typeof(dropped_trace) = 'object') not valid;

alter table public.csm_marketplace_outputs
  validate constraint csm_marketplace_dropped_check;
;
