-- COS-42 additive measurement bridge. New field reviews freeze the confidence
-- band that the operator saw; historical v1 snapshots remain valid and are
-- projected into an explicit UNAVAILABLE calibration bucket.
set lock_timeout = '5s';
set statement_timeout = '60s';

create schema if not exists private;

create or replace function private.validate_csm_review_measurement_snapshot_v2(
  snapshot jsonb,
  expected_asset_id text,
  expected_recognition_session_id text,
  expected_view_version text,
  expected_composer_version text
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $csm_review_measurement_v2_validator$
declare
  bracket_row jsonb;
  key_count integer;
  stripped_brackets jsonb;
  captured_v1 jsonb;
begin
  if coalesce(pg_catalog.jsonb_typeof(snapshot), '') <> 'object'
     or snapshot ->> 'schema_version' <> 'csm-review-measurement-snapshot-v2'
     or coalesce(pg_catalog.jsonb_typeof(snapshot -> 'brackets'), '') <> 'array'
     or pg_catalog.jsonb_array_length(snapshot -> 'brackets') = 0 then
    return false;
  end if;

  select pg_catalog.count(*) into key_count
    from pg_catalog.jsonb_object_keys(snapshot);
  if key_count <> 8 then return false; end if;

  for bracket_row in
    select value from pg_catalog.jsonb_array_elements(snapshot -> 'brackets')
  loop
    if coalesce(pg_catalog.jsonb_typeof(bracket_row), '') <> 'object' then
      return false;
    end if;
    select pg_catalog.count(*) into key_count
      from pg_catalog.jsonb_object_keys(bracket_row);
    if key_count <> 9
       or not bracket_row ? 'semantic_confidence'
       or ((bracket_row ->> 'state') = 'VALUE' and (
         coalesce(pg_catalog.jsonb_typeof(
           bracket_row -> 'semantic_confidence'
         ), '') <> 'string'
         or coalesce(bracket_row ->> 'semantic_confidence', '') not in (
           'LOW', 'OBSERVED', 'VERIFIED_EXTERNAL'
         )
       ))
       or ((bracket_row ->> 'state') <> 'VALUE'
         and pg_catalog.jsonb_typeof(bracket_row -> 'semantic_confidence') <> 'null') then
      return false;
    end if;
  end loop;

  select pg_catalog.jsonb_agg(value - 'semantic_confidence' order by ordinality)
    into stripped_brackets
    from pg_catalog.jsonb_array_elements(snapshot -> 'brackets')
      with ordinality as rows(value, ordinality);
  captured_v1 := pg_catalog.jsonb_set(
    pg_catalog.jsonb_set(
      snapshot,
      '{schema_version}',
      pg_catalog.to_jsonb('csm-review-measurement-snapshot-v1'::text)
    ),
    '{brackets}',
    stripped_brackets
  );
  return private.validate_csm_review_measurement_snapshot_v1(
    captured_v1,
    expected_asset_id,
    expected_recognition_session_id,
    expected_view_version,
    expected_composer_version
  );
end;
$csm_review_measurement_v2_validator$;

revoke all on function private.validate_csm_review_measurement_snapshot_v2(
  jsonb, text, text, text, text
) from public, anon, authenticated;
grant execute on function private.validate_csm_review_measurement_snapshot_v2(
  jsonb, text, text, text, text
) to service_role;

alter table public.csm_resolution_reviews
  drop constraint if exists csm_review_v2_measurement_complete;

alter table public.csm_resolution_reviews
  add constraint csm_review_v2_measurement_complete check (
    schema_version <> 'csm-resolution-review-v2'
    or (
      measurement_basis is not null
      and measurement_basis = 'FIELD_REVIEWED'
      and measurement_snapshot is not null
      and measurement_snapshot_sha256 is not null
      and case measurement_snapshot ->> 'schema_version'
        when 'csm-review-measurement-snapshot-v1' then
          private.validate_csm_review_measurement_snapshot_v1(
            measurement_snapshot,
            asset_id,
            recognition_session_id,
            view_version,
            composer_version
          )
        when 'csm-review-measurement-snapshot-v2' then
          private.validate_csm_review_measurement_snapshot_v2(
            measurement_snapshot,
            asset_id,
            recognition_session_id,
            view_version,
            composer_version
          )
        else false
      end
      and measurement_snapshot_sha256 ~ '^[0-9a-f]{64}$'
    )
  ) not valid;

alter table public.csm_resolution_reviews
  validate constraint csm_review_v2_measurement_complete;
