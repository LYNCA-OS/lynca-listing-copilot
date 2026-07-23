-- Catalog provenance is a graph invariant: a card, its set, and its product
-- must be owned by the same source. Foreign keys guarantee attribution exists;
-- these triggers guarantee attribution cannot cross source boundaries.

create or replace function public.enforce_catalog_source_graph_consistency()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product_source_id uuid;
  v_set_source_id uuid;
  v_set_product_id uuid;
begin
  if tg_table_name = 'catalog_products' then
    if new.source_id is distinct from old.source_id and (
      exists (
        select 1
        from public.catalog_sets catalog_set
        where catalog_set.product_id = old.id
          and catalog_set.source_id is distinct from new.source_id
      )
      or exists (
        select 1
        from public.catalog_cards card
        where card.product_id = old.id
          and card.source_id is distinct from new.source_id
      )
    ) then
      raise exception using
        errcode = '23514',
        message = 'catalog_product_source_graph_conflict';
    end if;
    return new;
  end if;

  select product.source_id
    into v_product_source_id
  from public.catalog_products product
  where product.id = new.product_id;

  if v_product_source_id is null or v_product_source_id is distinct from new.source_id then
    raise exception using
      errcode = '23514',
      message = 'catalog_product_source_mismatch';
  end if;

  if tg_table_name = 'catalog_sets' then
    if tg_op = 'UPDATE'
      and (new.source_id is distinct from old.source_id or new.product_id is distinct from old.product_id)
      and exists (
        select 1
        from public.catalog_cards card
        where card.set_id = old.id
          and (
            card.source_id is distinct from new.source_id
            or card.product_id is distinct from new.product_id
          )
      ) then
      raise exception using
        errcode = '23514',
        message = 'catalog_set_source_graph_conflict';
    end if;
    return new;
  end if;

  if new.set_id is not null then
    select catalog_set.source_id, catalog_set.product_id
      into v_set_source_id, v_set_product_id
    from public.catalog_sets catalog_set
    where catalog_set.id = new.set_id;

    if v_set_source_id is null
      or v_set_source_id is distinct from new.source_id
      or v_set_product_id is distinct from new.product_id then
      raise exception using
        errcode = '23514',
        message = 'catalog_set_source_mismatch';
    end if;
  end if;

  return new;
end
$$;

drop trigger if exists catalog_products_source_graph_guard on public.catalog_products;
create trigger catalog_products_source_graph_guard
before update of source_id on public.catalog_products
for each row execute function public.enforce_catalog_source_graph_consistency();

drop trigger if exists catalog_sets_source_graph_guard on public.catalog_sets;
create trigger catalog_sets_source_graph_guard
before insert or update on public.catalog_sets
for each row execute function public.enforce_catalog_source_graph_consistency();

drop trigger if exists catalog_cards_source_graph_guard on public.catalog_cards;
create trigger catalog_cards_source_graph_guard
before insert or update on public.catalog_cards
for each row execute function public.enforce_catalog_source_graph_consistency();

comment on function public.enforce_catalog_source_graph_consistency() is
  'Fail-closed catalog provenance guard: cards, sets, and products must remain inside one source graph.';
