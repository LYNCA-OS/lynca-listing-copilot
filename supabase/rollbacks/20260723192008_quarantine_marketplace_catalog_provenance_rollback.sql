alter table public.catalog_parallels
  drop constraint if exists catalog_parallels_source_id_fkey;
alter table public.catalog_parallels
  alter column source_id drop not null;
alter table public.catalog_parallels
  add constraint catalog_parallels_source_id_fkey
  foreign key (source_id) references public.catalog_sources(id) on delete set null;

alter table public.catalog_cards
  drop constraint if exists catalog_cards_source_id_fkey;
alter table public.catalog_cards
  alter column source_id drop not null;
alter table public.catalog_cards
  add constraint catalog_cards_source_id_fkey
  foreign key (source_id) references public.catalog_sources(id) on delete set null;

alter table public.catalog_sets
  drop constraint if exists catalog_sets_source_id_fkey;
alter table public.catalog_sets
  alter column source_id drop not null;
alter table public.catalog_sets
  add constraint catalog_sets_source_id_fkey
  foreign key (source_id) references public.catalog_sources(id) on delete set null;

alter table public.catalog_products
  drop constraint if exists catalog_products_source_id_fkey;
alter table public.catalog_products
  alter column source_id drop not null;
alter table public.catalog_products
  add constraint catalog_products_source_id_fkey
  foreign key (source_id) references public.catalog_sources(id) on delete set null;

-- Preserve the marketplace source and reclassified rows: provenance is useful
-- even when the database constraint is rolled back.
