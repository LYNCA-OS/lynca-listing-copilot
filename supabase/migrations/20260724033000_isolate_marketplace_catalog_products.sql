-- Marketplace evidence must remain a self-contained diagnostic graph.
--
-- The legacy quarantine assigned marketplace provenance to cards, but four
-- cards still referenced products owned by writer-reviewed sources. Clone
-- only those products into the marketplace source and repoint the diagnostic
-- cards. No decision-active catalog row or title field is changed.

do $$
declare
  v_pair record;
  v_isolated_product_id uuid;
begin
  for v_pair in
    select distinct
      c.source_id as marketplace_source_id,
      c.product_id as original_product_id
    from public.catalog_cards c
    join public.catalog_sources card_source on card_source.id = c.source_id
    join public.catalog_products product on product.id = c.product_id
    where card_source.source_type = 'MARKETPLACE_REFERENCE'
      and c.source_id is distinct from product.source_id
  loop
    select id
      into v_isolated_product_id
    from public.catalog_products
    where source_id = v_pair.marketplace_source_id
      and metadata ->> 'provenance_clone_of_product_id' = v_pair.original_product_id::text
    order by created_at asc
    limit 1;

    if v_isolated_product_id is null then
      insert into public.catalog_products (
        sport,
        league,
        season_year,
        manufacturer,
        brand,
        product,
        source_id,
        source_status,
        review_status,
        metadata
      )
      select
        original.sport,
        original.league,
        original.season_year,
        original.manufacturer,
        original.brand,
        original.product,
        v_pair.marketplace_source_id,
        'REVIEW_REQUIRED',
        'REVIEW_REQUIRED',
        coalesce(original.metadata, '{}'::jsonb) || jsonb_build_object(
          'provenance_clone_of_product_id', original.id,
          'provenance_policy', 'marketplace_diagnostic_only_v1',
          'decision_eligible', false,
          'provenance_isolated_at', clock_timestamp()
        )
      from public.catalog_products original
      where original.id = v_pair.original_product_id
      returning id into v_isolated_product_id;
    end if;

    update public.catalog_cards
    set product_id = v_isolated_product_id,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'previous_product_id', v_pair.original_product_id,
          'provenance_policy', 'marketplace_diagnostic_only_v1',
          'decision_eligible', false,
          'provenance_isolated_at', clock_timestamp()
        ),
        updated_at = clock_timestamp()
    where source_id = v_pair.marketplace_source_id
      and product_id = v_pair.original_product_id;
  end loop;

  if exists (
    select 1
    from public.catalog_cards c
    join public.catalog_sources card_source on card_source.id = c.source_id
    join public.catalog_products product on product.id = c.product_id
    where card_source.source_type = 'MARKETPLACE_REFERENCE'
      and c.source_id is distinct from product.source_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'marketplace_catalog_product_isolation_incomplete';
  end if;
end
$$;

comment on table public.catalog_products is
  'Canonical product candidates. Diagnostic marketplace cards must reference products owned by the same marketplace source.';
