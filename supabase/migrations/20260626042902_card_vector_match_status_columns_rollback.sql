drop function if exists public.match_card_image_embeddings(
  extensions.vector(768),
  text,
  text,
  text,
  text,
  integer,
  double precision,
  boolean
);

create or replace function public.match_card_image_embeddings(
  query_embedding extensions.vector(768),
  match_model_id text,
  match_model_revision text default null,
  match_embedding_role text default null,
  match_category text default null,
  match_count integer default 10,
  match_threshold double precision default 0,
  include_candidate_identities boolean default false
)
returns table (
  identity_id uuid,
  reference_image_id uuid,
  embedding_id uuid,
  image_role text,
  embedding_role text,
  model_id text,
  model_revision text,
  preprocessing_version text,
  similarity double precision,
  distance double precision,
  identity_key text,
  canonical_title text,
  category text,
  fields jsonb,
  reference_metadata jsonb,
  embedding_metadata jsonb
)
language sql
stable
as $$
  select
    ci.identity_id,
    cri.reference_image_id,
    cie.embedding_id,
    cri.image_role,
    cie.embedding_role,
    cie.model_id,
    cie.model_revision,
    cie.preprocessing_version,
    1 - (cie.embedding <=> query_embedding) as similarity,
    cie.embedding <=> query_embedding as distance,
    ci.identity_key,
    ci.canonical_title,
    ci.category,
    ci.fields,
    cri.metadata as reference_metadata,
    cie.metadata as embedding_metadata
  from public.card_image_embeddings cie
  join public.card_reference_images cri
    on cri.reference_image_id = cie.reference_image_id
   and cri.identity_id = cie.identity_id
  join public.card_identities ci
    on ci.identity_id = cie.identity_id
  where ci.retrieval_enabled is true
    and (
      ci.retrieval_status in ('approved', 'reviewed', 'registry')
      or (include_candidate_identities is true and ci.retrieval_status = 'candidate')
    )
    and cri.approved_for_retrieval is true
    and cie.model_id = match_model_id
    and (match_model_revision is null or cie.model_revision = match_model_revision)
    and (match_embedding_role is null or cie.embedding_role = match_embedding_role)
    and (match_category is null or ci.category = match_category)
    and (1 - (cie.embedding <=> query_embedding)) >= coalesce(match_threshold, 0)
  order by cie.embedding <=> query_embedding
  limit least(greatest(coalesce(match_count, 10), 1), 50);
$$;

revoke all on function public.match_card_image_embeddings(
  extensions.vector(768),
  text,
  text,
  text,
  text,
  integer,
  double precision,
  boolean
) from public, anon, authenticated;

grant execute on function public.match_card_image_embeddings(
  extensions.vector(768),
  text,
  text,
  text,
  text,
  integer,
  double precision,
  boolean
) to service_role;
