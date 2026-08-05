create index if not exists preingestion_jobs_tenant_bundle_type_status_priority_idx
  on public.preingestion_jobs (
    tenant_id,
    bundle_id,
    job_type,
    status,
    priority,
    created_at
  );

comment on index public.preingestion_jobs_tenant_bundle_type_status_priority_idx is
  'Bounds tenant-scoped OCR rendezvous and queued/failed job hydration by immutable bundle identity.';;
