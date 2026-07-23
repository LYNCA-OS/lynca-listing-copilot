create index if not exists v4_provider_capacity_expired_asset_idx
  on public.v4_provider_capacity_leases (lease_expires_at)
  where pg_catalog.left(provider_id, pg_catalog.length('stage:paddle_ocr:asset:')) = 'stage:paddle_ocr:asset:'
    and job_id is not null;

delete from public.v4_provider_capacity_leases leases
where pg_catalog.left(leases.provider_id, pg_catalog.length('stage:paddle_ocr:asset:')) = 'stage:paddle_ocr:asset:'
  and leases.lease_expires_at < pg_catalog.clock_timestamp() - interval '10 minutes';
