-- Private Supabase Storage bucket for Listing Copilot card images.
-- The application generates signed upload/read URLs with the server-side
-- service role key; browser clients should not receive Supabase credentials.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'listing-card-images',
  'listing-card-images',
  false,
  26214400,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif'
  ]
)
on conflict (id) do update
set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Keep direct object access private. The service_role key bypasses RLS for the
-- app server path that creates signed upload/read URLs. These policies are only
-- here to make the intended boundary explicit if RLS policies are audited.
drop policy if exists "listing_card_images_service_role_select"
  on storage.objects;
drop policy if exists "listing_card_images_service_role_insert"
  on storage.objects;
drop policy if exists "listing_card_images_service_role_update"
  on storage.objects;
drop policy if exists "listing_card_images_service_role_delete"
  on storage.objects;

create policy "listing_card_images_service_role_select"
  on storage.objects
  for select
  using (
    bucket_id = 'listing-card-images'
    and auth.role() = 'service_role'
  );

create policy "listing_card_images_service_role_insert"
  on storage.objects
  for insert
  with check (
    bucket_id = 'listing-card-images'
    and auth.role() = 'service_role'
  );

create policy "listing_card_images_service_role_update"
  on storage.objects
  for update
  using (
    bucket_id = 'listing-card-images'
    and auth.role() = 'service_role'
  )
  with check (
    bucket_id = 'listing-card-images'
    and auth.role() = 'service_role'
  );

create policy "listing_card_images_service_role_delete"
  on storage.objects
  for delete
  using (
    bucket_id = 'listing-card-images'
    and auth.role() = 'service_role'
  );
