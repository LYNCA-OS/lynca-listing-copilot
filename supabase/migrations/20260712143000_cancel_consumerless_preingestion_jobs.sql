-- Pre-ingestion is explicitly created by /api/v4/listing-preingest. The legacy
-- verification trigger and the non-OCR job types have no production consumer,
-- so leaving them queued creates false backlog and obscures real OCR health.

drop trigger if exists listing_image_verifications_enqueue_preingestion_job
  on public.listing_image_verifications;

update public.preingestion_jobs
set status = 'cancelled',
    last_error = case
      when job_type = 'ocr_crop_verification'
        then 'cancelled_stale_ocr_job_version'
      else 'cancelled_no_production_consumer'
    end,
    updated_at = now()
where status in ('queued', 'running')
  and (
    job_type in (
      'build_bundle',
      'visual_embedding',
      'surface_crop_analysis',
      'image_quality_deep_analysis'
    )
    or (
      job_type = 'ocr_crop_verification'
      and job_key not like 'ocr:ocr-crop-v5:%'
    )
  );
