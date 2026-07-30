-- Read-only B6 catalog-gap audit. This query never updates the gap queue and
-- never promotes catalog data. Run against the same catalog snapshot as the
-- report. The companion script can verify any separately exported row-level
-- version of the same three predicates.
begin transaction read only;

with
params as (
  select 2093::bigint as expected_coverage_rows
),
normalised_gap as (
  select
    gap.id,
    substring(trim(coalesce(gap.observed_fields->>'year', gap.observed_fields->>'season_year', '')) from '(19[0-9]{2}|20[0-9]{2})') as observed_year,
    lower(trim(coalesce(gap.observed_fields->>'product', ''))) as observed_product,
    lower(trim(coalesce(gap.observed_fields->>'set', gap.observed_fields->>'card_name', ''))) as observed_set
  from public.v4_catalog_gap_queue gap
  where gap.status = 'OPEN'
    and gap.gap_type = 'CATALOG_COVERAGE_GAP'
),
normalised_product as (
  select distinct
    substring(trim(coalesce(product.season_year, '')) from '(19[0-9]{2}|20[0-9]{2})') as catalog_year,
    lower(trim(product.product)) as catalog_product
  from public.catalog_products product
  where trim(coalesce(product.product, '')) <> ''
),
row_predicates as (
  select
    gap.id,
    exists (
      select 1 from normalised_product product
      where product.catalog_product = gap.observed_product
        and product.catalog_year = gap.observed_year
        and gap.observed_product <> ''
        and gap.observed_year <> ''
    ) as product_year_present,
    exists (
      select 1 from normalised_product product
      where product.catalog_product = gap.observed_set
        and gap.observed_set <> ''
    ) as set_matches_catalog_product,
    exists (
      select 1 from normalised_product product
      where product.catalog_product = gap.observed_product
        and gap.observed_product <> ''
    ) as product_seen_any_year
  from normalised_gap gap
),
classified as (
  select *,
    not product_seen_any_year as product_absent,
    case
      when product_year_present then 'NO_BACKFILL_PRODUCT_YEAR_PRESENT'
      when set_matches_catalog_product then 'SET_AS_PRODUCT_CANDIDATE'
      when not product_seen_any_year then 'PRODUCT_NAME_ABSENT_FROM_CATALOG'
      else 'UNCLASSIFIED'
    end as disposition
  from row_predicates
),
summary as (
  select
    count(*)::bigint as total,
    count(*) filter (where product_year_present)::bigint as product_year_present,
    count(*) filter (where set_matches_catalog_product)::bigint as set_matches_catalog_product,
    count(*) filter (where not product_seen_any_year)::bigint as product_name_absent_from_catalog,
    count(*) filter (where disposition = 'NO_BACKFILL_PRODUCT_YEAR_PRESENT')::bigint as no_backfill_product_year_present,
    count(*) filter (where disposition = 'SET_AS_PRODUCT_CANDIDATE')::bigint as set_as_product_candidate,
    count(*) filter (where disposition = 'PRODUCT_NAME_ABSENT_FROM_CATALOG')::bigint as product_name_absent_exclusive,
    count(*) filter (where disposition = 'UNCLASSIFIED')::bigint as unclassified,
    jsonb_agg(jsonb_build_object(
      'id', id,
      'product_year_present', product_year_present,
      'set_matches_catalog_product', set_matches_catalog_product,
      'product_seen_any_year', product_seen_any_year,
      'product_absent', product_absent,
      'disposition', disposition
    ) order by id) as row_predicates
  from classified
)
select
  summary.*,
  summary.total = params.expected_coverage_rows as expected_total_matches,
  summary.total = summary.no_backfill_product_year_present
    + summary.set_as_product_candidate
    + summary.product_name_absent_exclusive
    + summary.unclassified as mutually_exclusive_total_matches,
  summary.product_year_present = 985
    and summary.set_matches_catalog_product = 242
    and summary.product_name_absent_from_catalog = 808
    and summary.no_backfill_product_year_present = 985
    and summary.set_as_product_candidate = 73
    and summary.product_name_absent_exclusive = 762
    and summary.unclassified = 273 as frozen_breakdown_matches,
  false as catalog_write_allowed
from summary cross join params;

rollback;
