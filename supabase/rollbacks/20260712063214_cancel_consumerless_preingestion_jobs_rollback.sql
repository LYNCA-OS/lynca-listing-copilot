-- Re-enable only the legacy bundle trigger. Cancelled jobs remain historical
-- audit records and are intentionally not re-queued by rollback.

drop trigger if exists listing_image_verifications_enqueue_preingestion_job
  on public.listing_image_verifications;

create trigger listing_image_verifications_enqueue_preingestion_job
after insert or update of object_verified, storage_role, asset_id, object_path
on public.listing_image_verifications
for each row execute function public.enqueue_preingestion_bundle_job_from_verified_image();
