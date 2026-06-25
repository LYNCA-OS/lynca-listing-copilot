create extension if not exists vector with schema extensions;

create table if not exists public.card_identities (
  identity_id uuid primary key default gen_random_uuid(),
  identity_key text not null unique,
  category text,
  retrieval_status text not null default 'candidate'
    check (retrieval_status in ('approved', 'reviewed', 'registry', 'candidate', 'disabled')),
  retrieval_enabled boolean not null default false,
  canonical_title text,
  fields jsonb not null default '{}'::jsonb,
  source_record jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.card_reference_images (
  reference_image_id uuid primary key default gen_random_uuid(),
  identity_id uuid not null references public.card_identities(identity_id) on delete cascade,
  reference_key text not null default gen_random_uuid()::text,
  image_role text not null
    check (image_role in ('front_original', 'back_original', 'front_alternate', 'back_alternate', 'surface_view', 'additional')),
  object_path text,
  image_url text,
  content_sha256 text,
  capture_source text,
  approved_for_retrieval boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint card_reference_images_reference_identity_unique unique (reference_image_id, identity_id)
);

alter table public.card_reference_images
  add column if not exists reference_key text;

update public.card_reference_images
set reference_key = coalesce(
  nullif(reference_key, ''),
  md5(concat_ws(':', coalesce(object_path, ''), coalesce(image_url, ''), image_role))
)
where reference_key is null or reference_key = '';

alter table public.card_reference_images
  alter column reference_key set not null,
  alter column reference_key set default gen_random_uuid()::text;

create table if not exists public.card_image_embeddings (
  embedding_id uuid primary key default gen_random_uuid(),
  reference_image_id uuid not null references public.card_reference_images(reference_image_id) on delete cascade,
  identity_id uuid not null references public.card_identities(identity_id) on delete cascade,
  embedding_role text not null
    check (embedding_role in ('front_global', 'back_global', 'full_card_global', 'subject_layout', 'parallel_surface')),
  model_id text not null,
  model_revision text not null default 'main',
  preprocessing_version text not null,
  dimensions integer not null default 768 check (dimensions = 768),
  embedding extensions.vector(768) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint card_image_embeddings_reference_identity_fk
    foreign key (reference_image_id, identity_id)
    references public.card_reference_images(reference_image_id, identity_id)
    on delete cascade
);

create unique index if not exists card_reference_images_identity_role_hash_uidx
  on public.card_reference_images(identity_id, image_role, content_sha256)
  where content_sha256 is not null;

create unique index if not exists card_reference_images_identity_role_key_uidx
  on public.card_reference_images(identity_id, image_role, reference_key);

create unique index if not exists card_image_embeddings_reference_model_uidx
  on public.card_image_embeddings(
    reference_image_id,
    embedding_role,
    model_id,
    model_revision,
    preprocessing_version
  );

create index if not exists card_identities_retrieval_enabled_idx
  on public.card_identities(retrieval_enabled, retrieval_status, category)
  where retrieval_enabled is true;

create index if not exists card_reference_images_identity_idx
  on public.card_reference_images(identity_id)
  where approved_for_retrieval is true;

create index if not exists card_image_embeddings_model_role_idx
  on public.card_image_embeddings(model_id, model_revision, embedding_role);

create index if not exists card_image_embeddings_hnsw_cosine_idx
  on public.card_image_embeddings
  using hnsw (embedding extensions.vector_cosine_ops)
  with (m = 16, ef_construction = 64);

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

alter table public.card_identities enable row level security;
alter table public.card_reference_images enable row level security;
alter table public.card_image_embeddings enable row level security;

revoke all on table public.card_identities from anon, authenticated;
revoke all on table public.card_reference_images from anon, authenticated;
revoke all on table public.card_image_embeddings from anon, authenticated;
grant select, insert, update, delete on table public.card_identities to service_role;
grant select, insert, update, delete on table public.card_reference_images to service_role;
grant select, insert, update, delete on table public.card_image_embeddings to service_role;

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

comment on table public.card_identities is
  'Known card identities eligible for candidate recall. This table supplies candidates only; it is not a final truth engine.';

comment on table public.card_reference_images is
  'Approved reference card images used for visual candidate recall. Store object paths or approved source descriptors, not signed URLs.';

comment on table public.card_image_embeddings is
  'Versioned visual embeddings for card identity candidate recall. Model id, revision, preprocessing, role, and dimensions are preserved to avoid mixing incompatible vectors.';

comment on function public.match_card_image_embeddings(
  extensions.vector(768),
  text,
  text,
  text,
  text,
  integer,
  double precision,
  boolean
) is
  'Returns top-K visually similar card identity candidates by cosine distance. Candidate identities are excluded unless include_candidate_identities is explicitly true. Results must be checked by the Identity Resolver before any field is trusted.';
