-- Catalog provenance is an invariant, not optional metadata.
--
-- Fifteen legacy cards and their eleven products were written by the retired
-- dual_agreement_auto_v1 eBay image-only pump without a catalog source. Keep
-- the evidence, but reclassify it as diagnostic-only marketplace material.
-- It must never become catalog truth or a retrieval candidate.

do $$
declare
  v_marketplace_source_id uuid;
begin
  select id
    into v_marketplace_source_id
  from public.catalog_sources
  where source_type = 'MARKETPLACE_REFERENCE'
    and source_metadata ->> 'provenance_policy' = 'legacy_ebay_diagnostic_only_v1'
  order by created_at asc
  limit 1;

  if v_marketplace_source_id is null then
    insert into public.catalog_sources (
      source_type,
      source_status,
      source_name,
      source_metadata,
      source_trust,
      source_scope,
      parser_version
    ) values (
      'MARKETPLACE_REFERENCE',
      'REVIEW_REQUIRED',
      'Legacy eBay Image-Only Diagnostic Evidence',
      jsonb_build_object(
        'provenance_policy', 'legacy_ebay_diagnostic_only_v1',
        'decision_eligible', false,
        'title_truth', false,
        'original_promotion', 'dual_agreement_auto_v1'
      ),
      'MARKETPLACE_REFERENCE',
      'DIAGNOSTIC_ONLY',
      'legacy-dual-agreement-auto-v1-quarantine'
    )
    returning id into v_marketplace_source_id;
  end if;

  update public.catalog_products
  set source_id = v_marketplace_source_id,
      source_status = 'REVIEW_REQUIRED',
      review_status = 'REVIEW_REQUIRED',
      metadata = metadata || jsonb_build_object(
        'previous_source_status', source_status,
        'provenance_policy', 'marketplace_diagnostic_only_v1',
        'decision_eligible', false,
        'provenance_reclassified_at', clock_timestamp()
      ),
      updated_at = clock_timestamp()
  where source_id is null
    and metadata ->> 'promotion' = 'dual_agreement_auto_v1';

  update public.catalog_cards
  set source_id = v_marketplace_source_id,
      source_status = 'REVIEW_REQUIRED',
      review_status = 'REVIEW_REQUIRED',
      metadata = metadata || jsonb_build_object(
        'previous_source_status', source_status,
        'provenance_policy', 'marketplace_diagnostic_only_v1',
        'decision_eligible', false,
        'provenance_reclassified_at', clock_timestamp()
      ),
      updated_at = clock_timestamp()
  where source_id is null
    and metadata ->> 'promotion' = 'dual_agreement_auto_v1'
    and metadata ->> 'source_asset_id' like 'ebay_image_only_%';

  if exists (select 1 from public.catalog_products where source_id is null)
    or exists (select 1 from public.catalog_sets where source_id is null)
    or exists (select 1 from public.catalog_cards where source_id is null)
    or exists (select 1 from public.catalog_parallels where source_id is null) then
    raise exception using
      errcode = '23502',
      message = 'catalog_provenance_backfill_incomplete',
      detail = 'Every catalog product, set, card, and parallel must have an attributable source before provenance constraints can be enabled.';
  end if;
end
$$;

alter table public.catalog_products
  drop constraint if exists catalog_products_source_id_fkey;
alter table public.catalog_products
  alter column source_id set not null;
alter table public.catalog_products
  add constraint catalog_products_source_id_fkey
  foreign key (source_id) references public.catalog_sources(id) on delete restrict;

alter table public.catalog_sets
  drop constraint if exists catalog_sets_source_id_fkey;
alter table public.catalog_sets
  alter column source_id set not null;
alter table public.catalog_sets
  add constraint catalog_sets_source_id_fkey
  foreign key (source_id) references public.catalog_sources(id) on delete restrict;

alter table public.catalog_cards
  drop constraint if exists catalog_cards_source_id_fkey;
alter table public.catalog_cards
  alter column source_id set not null;
alter table public.catalog_cards
  add constraint catalog_cards_source_id_fkey
  foreign key (source_id) references public.catalog_sources(id) on delete restrict;

alter table public.catalog_parallels
  drop constraint if exists catalog_parallels_source_id_fkey;
alter table public.catalog_parallels
  alter column source_id set not null;
alter table public.catalog_parallels
  add constraint catalog_parallels_source_id_fkey
  foreign key (source_id) references public.catalog_sources(id) on delete restrict;

comment on column public.catalog_products.source_id is
  'Required provenance owner. Source deletion is restricted so catalog products cannot become unattributed.';
comment on column public.catalog_sets.source_id is
  'Required provenance owner. Source deletion is restricted so catalog sets cannot become unattributed.';
comment on column public.catalog_cards.source_id is
  'Required provenance owner. Source deletion is restricted so catalog cards cannot become unattributed.';
comment on column public.catalog_parallels.source_id is
  'Required provenance owner. Source deletion is restricted so catalog parallels cannot become unattributed.';
