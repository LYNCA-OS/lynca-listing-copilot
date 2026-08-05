-- `value_kind` / `selected_kind` plus `empty_reason` carry the CSM empty
-- semantics. Use SQL NULL for that empty payload so PostgREST can bulk insert
-- VALUE and EMPTY rows with one stable object shape.

alter table public.csm_bracket_candidates
  drop constraint if exists csm_candidate_value_check;
alter table public.csm_bracket_candidates
  alter column canonical_value drop not null,
  alter column canonical_value drop default;
alter table public.csm_bracket_candidates
  add constraint csm_candidate_value_check check (
    (value_kind = 'VALUE' and canonical_value is not null
      and canonical_value <> 'null'::jsonb and empty_reason is null)
    or (value_kind = 'EMPTY' and canonical_value is null
      and empty_reason in ('ABSENT', 'INSUFFICIENT_EVIDENCE'))
  ) not valid;
alter table public.csm_bracket_candidates
  validate constraint csm_candidate_value_check;

alter table public.csm_resolved_brackets
  drop constraint if exists csm_resolved_bracket_value_check;
alter table public.csm_resolved_brackets
  alter column canonical_value drop not null,
  alter column canonical_value drop default;
alter table public.csm_resolved_brackets
  add constraint csm_resolved_bracket_value_check check (
    (selected_kind = 'VALUE' and canonical_value is not null
      and canonical_value <> 'null'::jsonb and empty_reason is null
      and selected_candidate_id is not null)
    or (selected_kind = 'EMPTY' and canonical_value is null
      and empty_reason in ('ABSENT', 'INSUFFICIENT_EVIDENCE')
      and selected_candidate_id is null)
  ) not valid;
alter table public.csm_resolved_brackets
  validate constraint csm_resolved_bracket_value_check;
;
