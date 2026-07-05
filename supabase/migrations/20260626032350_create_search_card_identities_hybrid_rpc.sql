create extension if not exists pg_trgm with schema extensions;

create or replace function public.search_card_identities_hybrid(
  search_text text default null,
  exact_checklist_code text default null,
  exact_collector_number text default null,
  exact_subject text default null,
  exact_year text default null,
  exact_product text default null,
  match_count integer default 30
)
returns table (
  identity_id uuid,
  identity_key text,
  canonical_title text,
  category text,
  fields jsonb,
  retrieval_status text,
  channel_id text,
  raw_score double precision,
  normalized_score double precision,
  supporting_fields text[]
)
language sql
stable
as $$
  with input as (
    select
      lower(trim(coalesce(search_text, ''))) as q,
      lower(trim(coalesce(exact_checklist_code, ''))) as checklist_code,
      lower(regexp_replace(trim(coalesce(exact_collector_number, '')), '^#\s*', '')) as collector_number,
      lower(trim(coalesce(exact_subject, ''))) as subject,
      lower(trim(coalesce(exact_year, ''))) as year_text,
      lower(trim(coalesce(exact_product, ''))) as product
  ),
  candidate_text as (
    select
      ci.identity_id,
      ci.identity_key,
      ci.canonical_title,
      ci.category,
      ci.fields,
      ci.retrieval_status,
      lower(concat_ws(
        ' ',
        ci.identity_key,
        ci.canonical_title,
        ci.category,
        ci.fields->>'year',
        ci.fields->>'brand',
        ci.fields->>'manufacturer',
        ci.fields->>'product',
        ci.fields->>'set',
        ci.fields->>'player',
        ci.fields->>'character',
        ci.fields->>'collector_number',
        ci.fields->>'checklist_code',
        ci.fields->>'parallel_exact',
        ci.fields->>'parallel'
      )) as blob
    from public.card_identities ci
    where ci.retrieval_enabled is true
      and ci.retrieval_status in ('approved', 'reviewed', 'registry')
  ),
  scored as (
    select
      c.*,
      (
        case when i.checklist_code <> '' and lower(coalesce(c.fields->>'checklist_code', '')) = i.checklist_code then 3.0 else 0 end
        + case when i.collector_number <> '' and lower(regexp_replace(coalesce(c.fields->>'collector_number', ''), '^#\s*', '')) = i.collector_number then 1.4 else 0 end
        + case when i.subject <> '' and c.blob like '%' || i.subject || '%' then 1.0 else 0 end
        + case when i.year_text <> '' and lower(coalesce(c.fields->>'year', '')) = i.year_text then 0.8 else 0 end
        + case when i.product <> '' and (
            lower(coalesce(c.fields->>'product', '')) like '%' || i.product || '%'
            or lower(coalesce(c.fields->>'set', '')) like '%' || i.product || '%'
            or c.blob like '%' || i.product || '%'
          ) then 0.8 else 0 end
        + case when i.q <> '' then least(1.0, greatest(extensions.similarity(c.blob, i.q), 0)) else 0 end
        + case when i.q <> ''
            and to_tsvector('simple', c.blob) @@ websearch_to_tsquery('simple', i.q)
          then ts_rank_cd(to_tsvector('simple', c.blob), websearch_to_tsquery('simple', i.q))
          else 0
          end
      ) as raw_score,
      array_remove(array[
        case when i.checklist_code <> '' and lower(coalesce(c.fields->>'checklist_code', '')) = i.checklist_code then 'checklist_code' end,
        case when i.collector_number <> '' and lower(regexp_replace(coalesce(c.fields->>'collector_number', ''), '^#\s*', '')) = i.collector_number then 'collector_number' end,
        case when i.subject <> '' and c.blob like '%' || i.subject || '%' then 'subjects' end,
        case when i.year_text <> '' and lower(coalesce(c.fields->>'year', '')) = i.year_text then 'year' end,
        case when i.product <> '' and c.blob like '%' || i.product || '%' then 'product' end,
        case when i.q <> ''
            and to_tsvector('simple', c.blob) @@ websearch_to_tsquery('simple', i.q)
          then 'full_text'
          end,
        case when i.q <> '' and extensions.similarity(c.blob, i.q) > 0 then 'trigram'
          end
      ], null)::text[] as supporting_fields
    from candidate_text c
    cross join input i
    where i.q <> ''
      or i.checklist_code <> ''
      or i.collector_number <> ''
      or i.subject <> ''
      or i.year_text <> ''
      or i.product <> ''
  )
  select
    s.identity_id,
    s.identity_key,
    s.canonical_title,
    s.category,
    s.fields,
    s.retrieval_status,
    case
      when 'checklist_code' = any(s.supporting_fields) or 'collector_number' = any(s.supporting_fields) then 'ocr_exact_code'
      when 'full_text' = any(s.supporting_fields) or 'trigram' = any(s.supporting_fields) then 'postgres_full_text'
      else 'structured_metadata'
    end as channel_id,
    s.raw_score,
    least(1.0, s.raw_score / 5.5) as normalized_score,
    s.supporting_fields
  from scored s
  where s.raw_score > 0
  order by s.raw_score desc, s.identity_key asc
  limit least(greatest(coalesce(match_count, 30), 1), 50);
$$;

revoke all on function public.search_card_identities_hybrid(
  text,
  text,
  text,
  text,
  text,
  text,
  integer
) from public, anon, authenticated;

grant execute on function public.search_card_identities_hybrid(
  text,
  text,
  text,
  text,
  text,
  text,
  integer
) to service_role;

comment on function public.search_card_identities_hybrid(
  text,
  text,
  text,
  text,
  text,
  text,
  integer
) is
  'Hybrid identity candidate recall from approved card_identities using exact fields, metadata, full-text, and trigram signals. Corrected titles and hidden ground truth are prohibited for query inputs.';
