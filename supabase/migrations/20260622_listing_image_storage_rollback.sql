-- Rollback for 20260622_listing_image_storage.sql.
-- Run only after exporting or deleting any Storage objects that must be kept.

drop policy if exists "listing_card_images_service_role_select"
  on storage.objects;
drop policy if exists "listing_card_images_service_role_insert"
  on storage.objects;
drop policy if exists "listing_card_images_service_role_update"
  on storage.objects;
drop policy if exists "listing_card_images_service_role_delete"
  on storage.objects;

delete from storage.buckets
where id = 'listing-card-images';
