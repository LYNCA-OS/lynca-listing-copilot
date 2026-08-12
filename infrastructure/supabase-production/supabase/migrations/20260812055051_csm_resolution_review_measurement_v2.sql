-- COS-42 additive forward-reader bridge. Historical v1 reviews remain intact;
-- only v2 field reviews carry a frozen denominator and hash binding.
set lock_timeout = '5s';
set statement_timeout = '60s';

alter table public.csm_resolution_reviews
  add column if not exists measurement_basis text,
  add column if not exists measurement_snapshot jsonb,
  add column if not exists measurement_snapshot_sha256 text;

create schema if not exists private;

create or replace function private.validate_csm_review_measurement_snapshot_v1(
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
as $csm_review_measurement_validator$
declare
  composer jsonb;
  bracket_row jsonb;
  canonical_field jsonb;
  key_count integer;
  seen_brackets text[] := array[]::text[];
  seen_fields text[];
  bracket_name text;
  field_name text;
  allowed_fields text[];
  expected_brackets text[];
  coverage jsonb;
  published_count integer;
  suppressed_count integer;
  dropped_count integer;
  deduped_count integer;
  truncated_count integer;
  withheld_count integer;
begin
  if coalesce(pg_catalog.jsonb_typeof(snapshot), '') <> 'object' then
    return false;
  end if;
  select pg_catalog.count(*) into key_count
    from pg_catalog.jsonb_object_keys(snapshot);
  if key_count <> 8
     or not snapshot ?& array[
       'schema_version', 'measurement_basis', 'asset_id',
       'recognition_session_id', 'view_version', 'grammar',
       'composer', 'brackets'
     ]
     or snapshot ->> 'schema_version' <> 'csm-review-measurement-snapshot-v1'
     or snapshot ->> 'measurement_basis' <> 'FIELD_REVIEWED'
     or coalesce(pg_catalog.jsonb_typeof(snapshot -> 'schema_version'), '') <> 'string'
     or coalesce(pg_catalog.jsonb_typeof(snapshot -> 'measurement_basis'), '') <> 'string'
     or coalesce(pg_catalog.jsonb_typeof(snapshot -> 'asset_id'), '') <> 'string'
     or coalesce(snapshot ->> 'asset_id', '') = ''
     or snapshot ->> 'asset_id' <> expected_asset_id
     or coalesce(pg_catalog.jsonb_typeof(
       snapshot -> 'recognition_session_id'
     ), '') <> 'string'
     or coalesce(snapshot ->> 'recognition_session_id', '') = ''
     or snapshot ->> 'recognition_session_id' <> expected_recognition_session_id
     or coalesce(pg_catalog.jsonb_typeof(snapshot -> 'view_version'), '') <> 'string'
     or coalesce(snapshot ->> 'view_version', '') = ''
     or snapshot ->> 'view_version' <> expected_view_version
     or coalesce(pg_catalog.jsonb_typeof(snapshot -> 'grammar'), '') <> 'string'
     or coalesce(snapshot ->> 'grammar', '') not in ('standard', 'tcg', 'lot') then
    return false;
  end if;

  composer := snapshot -> 'composer';
  if coalesce(pg_catalog.jsonb_typeof(composer), '') <> 'object'
     or coalesce(pg_catalog.jsonb_typeof(snapshot -> 'brackets'), '') <> 'array'
     or pg_catalog.jsonb_array_length(snapshot -> 'brackets') = 0 then
    return false;
  end if;
  select pg_catalog.count(*) into key_count
    from pg_catalog.jsonb_object_keys(composer);
  if key_count <> 6
     or not composer ?& array[
       'composer_version', 'marketplace_profile_version', 'title_sha256',
       'character_budget', 'rendered_length', 'truncated'
     ]
     or coalesce(pg_catalog.jsonb_typeof(composer -> 'composer_version'), '') <> 'string'
     or coalesce(composer ->> 'composer_version', '') = ''
     or composer ->> 'composer_version' <> expected_composer_version
     or coalesce(pg_catalog.jsonb_typeof(composer -> 'title_sha256'), '') <> 'string'
     or coalesce(composer ->> 'title_sha256', '')
       !~ '^[0-9a-f]{64}$'
     or pg_catalog.jsonb_typeof(composer -> 'truncated') <> 'boolean'
     or coalesce(pg_catalog.jsonb_typeof(
       composer -> 'marketplace_profile_version'
     ), '') not in ('null', 'string')
     or (pg_catalog.jsonb_typeof(composer -> 'marketplace_profile_version') = 'string'
       and coalesce(composer ->> 'marketplace_profile_version', '') = '')
     or coalesce(pg_catalog.jsonb_typeof(
       composer -> 'character_budget'
     ), '') not in ('null', 'number')
     or (pg_catalog.jsonb_typeof(composer -> 'character_budget') = 'number'
       and ((composer ->> 'character_budget')::numeric < 0
         or pg_catalog.trunc((composer ->> 'character_budget')::numeric)
           <> (composer ->> 'character_budget')::numeric))
     or coalesce(pg_catalog.jsonb_typeof(
       composer -> 'rendered_length'
     ), '') not in ('null', 'number')
     or (pg_catalog.jsonb_typeof(composer -> 'rendered_length') = 'number'
       and ((composer ->> 'rendered_length')::numeric < 0
         or pg_catalog.trunc((composer ->> 'rendered_length')::numeric)
           <> (composer ->> 'rendered_length')::numeric))
     or (pg_catalog.jsonb_typeof(composer -> 'character_budget') = 'number'
       and pg_catalog.jsonb_typeof(composer -> 'rendered_length') = 'number'
       and (composer ->> 'rendered_length')::numeric
         > (composer ->> 'character_budget')::numeric) then
    return false;
  end if;

  for bracket_row in
    select value from pg_catalog.jsonb_array_elements(snapshot -> 'brackets')
  loop
    if coalesce(pg_catalog.jsonb_typeof(bracket_row), '') <> 'object' then
      return false;
    end if;
    select pg_catalog.count(*) into key_count
      from pg_catalog.jsonb_object_keys(bracket_row);
    if key_count <> 8
       or not bracket_row ?& array[
         'bracket', 'state', 'canonical_fields', 'composer_disposition',
         'rendered_text_present', 'partially_published', 'outside_contract_order',
         'publication_coverage'
       ]
       or coalesce(pg_catalog.jsonb_typeof(bracket_row -> 'bracket'), '') <> 'string'
       or coalesce(bracket_row ->> 'bracket', '') = ''
       or coalesce(pg_catalog.jsonb_typeof(bracket_row -> 'state'), '') <> 'string'
       or coalesce(bracket_row ->> 'state', '') not in (
         'VALUE', 'ABSENT', 'INSUFFICIENT_EVIDENCE'
       )
       or coalesce(pg_catalog.jsonb_typeof(
         bracket_row -> 'composer_disposition'
       ), '') <> 'string'
       or coalesce(bracket_row ->> 'composer_disposition', '') not in (
         'INCLUDED', 'SUPPRESSED_BY_PROFILE', 'DROPPED_FOR_BUDGET',
         'RESTORED', 'NORMALIZED', 'DEDUPED_COVERED',
         'WITHHELD_BY_CONTRACT', 'NOT_APPLICABLE'
       )
       or coalesce(pg_catalog.jsonb_typeof(
         bracket_row -> 'canonical_fields'
       ), '') <> 'array'
       or pg_catalog.jsonb_typeof(bracket_row -> 'rendered_text_present') <> 'boolean'
       or pg_catalog.jsonb_typeof(bracket_row -> 'partially_published') <> 'boolean'
       or pg_catalog.jsonb_typeof(bracket_row -> 'outside_contract_order') <> 'boolean' then
      return false;
    end if;
    if pg_catalog.jsonb_array_length(bracket_row -> 'canonical_fields') = 0 then
      return false;
    end if;

    bracket_name := bracket_row ->> 'bracket';
    allowed_fields := case bracket_name
      when 'lot' then array['lot_count']
      when 'subject' then array['subjects']
      when 'numerical_rarity' then array['serial']
      when 'grading_info' then array['grading_info']
      when 'search_optimization' then array['components', 'search_optimization', 'team']
      when 'manufacturer_product_set' then array['manufacturer', 'product', 'set']
      when 'ip' then array['ip']
      when 'year' then array['year']
      when 'language' then array['language']
      when 'manufacturer' then array['manufacturer']
      when 'product' then array['product']
      when 'set' then array['set']
      when 'card_name' then array['card_name']
      when 'release_variant' then array['release_variant']
      when 'print_finish' then array['print_finish']
      when 'descriptive_rarity' then array['descriptive_rarity']
      when 'card_number' then array['card_number']
      when 'special_stamp' then array['special_stamp']
      when 'description' then array['description']
      else null
    end;
    if allowed_fields is null then return false; end if;
    if bracket_name = any(seen_brackets) then return false; end if;
    seen_brackets := pg_catalog.array_append(seen_brackets, bracket_name);
    seen_fields := array[]::text[];
    for canonical_field in
      select value from pg_catalog.jsonb_array_elements(bracket_row -> 'canonical_fields')
    loop
      if pg_catalog.jsonb_typeof(canonical_field) <> 'string'
         or coalesce(canonical_field #>> '{}', '') = '' then
        return false;
      end if;
      field_name := canonical_field #>> '{}';
      if not field_name = any(allowed_fields) then return false; end if;
      if field_name = any(seen_fields) then return false; end if;
      seen_fields := pg_catalog.array_append(seen_fields, field_name);
    end loop;
    if seen_fields is distinct from allowed_fields then return false; end if;

    coverage := bracket_row -> 'publication_coverage';
    select pg_catalog.count(*) into key_count
      from pg_catalog.jsonb_object_keys(coverage);
    if coalesce(pg_catalog.jsonb_typeof(coverage), '') <> 'object'
       or key_count <> 8
       or not coverage ?& array[
         'schema_version', 'atoms_sha256', 'published',
         'suppressed_by_profile', 'dropped_for_budget', 'deduped_covered',
         'truncated_loss', 'withheld_by_contract'
       ]
       or coverage ->> 'schema_version'
         is distinct from 'csm-publication-coverage-summary-v1'
       or coalesce(pg_catalog.jsonb_typeof(coverage -> 'atoms_sha256'), '') <> 'string'
       or coalesce(coverage ->> 'atoms_sha256', '') !~ '^[0-9a-f]{64}$' then
      return false;
    end if;
    if exists (
      select 1 from pg_catalog.jsonb_each(coverage) as entry(key, value)
      where entry.key not in ('schema_version', 'atoms_sha256')
        and (pg_catalog.jsonb_typeof(entry.value) <> 'number'
          or (entry.value #>> '{}')::numeric < 0
          or pg_catalog.trunc((entry.value #>> '{}')::numeric)
            <> (entry.value #>> '{}')::numeric)
    ) then return false; end if;
    published_count := (coverage ->> 'published')::integer;
    suppressed_count := (coverage ->> 'suppressed_by_profile')::integer;
    dropped_count := (coverage ->> 'dropped_for_budget')::integer;
    deduped_count := (coverage ->> 'deduped_covered')::integer;
    truncated_count := (coverage ->> 'truncated_loss')::integer;
    withheld_count := (coverage ->> 'withheld_by_contract')::integer;

    if (bracket_row ->> 'state') <> 'VALUE' and (
         (bracket_row ->> 'composer_disposition') <> 'NOT_APPLICABLE'
         or (bracket_row ->> 'rendered_text_present')::boolean
         or (bracket_row ->> 'partially_published')::boolean
         or published_count + suppressed_count + dropped_count + deduped_count
           + truncated_count + withheld_count <> 0
       ) then
      return false;
    end if;
    if (bracket_row ->> 'state') = 'VALUE' and (
      ((bracket_row ->> 'composer_disposition') in (
        'INCLUDED', 'RESTORED', 'NORMALIZED'
      ) and not (bracket_row ->> 'rendered_text_present')::boolean)
      or ((bracket_row ->> 'composer_disposition') in (
        'SUPPRESSED_BY_PROFILE', 'DROPPED_FOR_BUDGET',
        'DEDUPED_COVERED', 'WITHHELD_BY_CONTRACT', 'NOT_APPLICABLE'
      ) and (bracket_row ->> 'rendered_text_present')::boolean)
      or ((bracket_row ->> 'rendered_text_present')::boolean <> (published_count > 0))
      or ((bracket_row ->> 'partially_published')::boolean <>
        ((published_count + deduped_count > 0)
          and (suppressed_count + dropped_count + truncated_count + withheld_count > 0)))
      or ((bracket_row ->> 'composer_disposition') = 'SUPPRESSED_BY_PROFILE'
        and (suppressed_count = 0 or published_count + deduped_count <> 0))
      or ((bracket_row ->> 'composer_disposition') = 'DROPPED_FOR_BUDGET'
        and (dropped_count + truncated_count = 0 or published_count + deduped_count <> 0))
      or ((bracket_row ->> 'composer_disposition') = 'DEDUPED_COVERED'
        and (deduped_count = 0 or published_count <> 0))
      or ((bracket_row ->> 'composer_disposition') = 'WITHHELD_BY_CONTRACT'
        and (withheld_count = 0 or published_count + deduped_count <> 0))
      or ((bracket_row ->> 'composer_disposition') in (
        'INCLUDED', 'RESTORED', 'NORMALIZED'
      ) and published_count = 0)
    ) then
      return false;
    end if;
  end loop;
  expected_brackets := case snapshot ->> 'grammar'
    when 'standard' then array[
      'year', 'manufacturer', 'product', 'set', 'subject', 'card_name',
      'release_variant', 'print_finish', 'numerical_rarity',
      'descriptive_rarity', 'card_number', 'search_optimization', 'grading_info'
    ]
    when 'tcg' then array[
      'year', 'ip', 'language', 'manufacturer', 'product', 'set', 'subject',
      'card_name', 'card_number', 'descriptive_rarity', 'numerical_rarity',
      'release_variant', 'print_finish', 'special_stamp', 'grading_info',
      'description', 'search_optimization'
    ]
    when 'lot' then array[
      'lot', 'year', 'manufacturer_product_set', 'subject', 'card_name',
      'print_finish', 'numerical_rarity', 'search_optimization'
    ]
  end;
  if seen_brackets is distinct from expected_brackets then return false; end if;
  return true;
end;
$csm_review_measurement_validator$;

revoke all on function private.validate_csm_review_measurement_snapshot_v1(
  jsonb, text, text, text, text
) from public, anon, authenticated;
grant execute on function private.validate_csm_review_measurement_snapshot_v1(
  jsonb, text, text, text, text
) to service_role;

alter table public.csm_resolution_reviews
  add constraint csm_review_v2_measurement_complete check (
    schema_version <> 'csm-resolution-review-v2'
    or (
      measurement_basis is not null
      and measurement_snapshot is not null
      and measurement_snapshot_sha256 is not null
      and measurement_basis = 'FIELD_REVIEWED'
      and private.validate_csm_review_measurement_snapshot_v1(
        measurement_snapshot,
        asset_id,
        recognition_session_id,
        view_version,
        composer_version
      )
      and measurement_snapshot_sha256 ~ '^[0-9a-f]{64}$'
    )
  ) not valid;

alter table public.csm_resolution_reviews
  validate constraint csm_review_v2_measurement_complete;

create index if not exists csm_resolution_reviews_field_metrics_v2_idx
  on public.csm_resolution_reviews (tenant_id, measurement_basis, reviewed_at)
  where excluded_from_metrics = false
    and schema_version = 'csm-resolution-review-v2';

comment on column public.csm_resolution_reviews.measurement_basis is
  'FIELD_REVIEWED is trusted structured semantic review. TITLE_DERIVED is kept outside semantic accuracy projections.';
comment on column public.csm_resolution_reviews.measurement_snapshot is
  'Server-built immutable full bracket and Composer measurement denominator for one review.';
comment on column public.csm_resolution_reviews.measurement_snapshot_sha256 is
  'SHA-256 binding the immutable server-built measurement snapshot into revision_sha256.';
