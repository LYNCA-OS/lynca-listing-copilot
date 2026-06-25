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

drop table if exists public.card_image_embeddings;
drop table if exists public.card_reference_images;
drop table if exists public.card_identities;
