-- OCS cognition loop health, as a read-only view.
--
-- The OCS contract defines one loop:
--   Operational Reality -> Evidence -> Organizational Memory -> Reasoning
--   -> Decision Proposal -> Authorized Decision -> Implementation
--   -> Outcome -> Learning
--
-- Every stage already has a table. What did not exist was a way to see whether
-- the loop is actually turning, and the first audit found it is not: evidence
-- and reasoning accumulate in the thousands while Authorized Decision and
-- Learning sit at 28 rows each and SEM validation at zero. 3,090 proposals
-- against 28 authorisations is a 110x attenuation at one step.
--
-- This is a view and not a restructuring, deliberately. The attenuation is an
-- operating problem -- the tables exist, are writable, and are simply not being
-- written -- so no schema change fixes it. What a schema change can do is stop
-- the measurement being a one-off number somebody has to remember to take.
--
-- Reversible with DROP VIEW. No existing table is altered and no row is moved.
create or replace view ocs_cognition_loop_health as
with stages as (
  select 1 as stage_no, 'EVIDENCE' as stage, 'v4_field_evidence' as source_table,
         (select count(*) from v4_field_evidence) as row_count
  union all select 1, 'EVIDENCE', 'listing_image_verifications',
         (select count(*) from listing_image_verifications where object_verified)
  union all select 2, 'MEMORY', 'catalog_cards', (select count(*) from catalog_cards)
  union all select 2, 'MEMORY', 'card_identity_prototypes', (select count(*) from card_identity_prototypes)
  union all select 3, 'REASONING', 'v4_recognition_sessions', (select count(*) from v4_recognition_sessions)
  union all select 3, 'REASONING', 'v4_candidate_traces', (select count(*) from v4_candidate_traces)
  union all select 4, 'DECISION_PROPOSAL', 'v4_catalog_gap_queue', (select count(*) from v4_catalog_gap_queue)
  union all select 5, 'AUTHORIZED_DECISION', 'v4_writer_feedback_events', (select count(*) from v4_writer_feedback_events)
  union all select 6, 'OUTCOME', 'v4_production_quality_ledger', (select count(*) from v4_production_quality_ledger)
  union all select 7, 'LEARNING', 'v4_learning_events', (select count(*) from v4_learning_events)
  union all select 7, 'LEARNING', 'v4_sem_validation_events', (select count(*) from v4_sem_validation_events)
)
select
  stage_no,
  stage,
  source_table,
  row_count,
  -- A stage whose tables are all empty is not "small", it is not running. The
  -- distinction matters: the OCS contract treats an unpopulated stage as a
  -- broken loop rather than a low-traffic one.
  case when row_count = 0 then 'NOT_RUNNING' else 'POPULATED' end as stage_state,
  sum(row_count) over (partition by stage) as stage_total
from stages
order by stage_no, row_count desc;

comment on view ocs_cognition_loop_health is
  'OCS cognition loop health. One row per backing table, grouped by loop stage. A stage whose tables are all empty is NOT_RUNNING, not merely quiet. Read-only; drop freely.';;
