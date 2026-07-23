-- Bound deployment-affine queue admission to the small active set. The claim
-- RPC filters on these expressions before applying its fairness window; without
-- matching indexes, every Preview wake scans historical jobs from every
-- deployment and turns a transient outage into a control-plane backlog.

set lock_timeout = '5s';
set statement_timeout = '2min';

create index if not exists v4_recognition_jobs_ready_affinity_claim_idx
on public.v4_recognition_jobs (
  (coalesce(queue_tags ->> 'deployment_affinity', '')),
  lane,
  (coalesce(nullif(provider_id, ''), 'openai_legacy')),
  not_before,
  priority,
  created_at
)
include (id, tenant_id, batch_id)
where status in ('QUEUED', 'RETRYING')
  and attempt_count < max_attempts;

create index if not exists v4_recognition_jobs_stale_affinity_claim_idx
on public.v4_recognition_jobs (
  (coalesce(queue_tags ->> 'deployment_affinity', '')),
  lane,
  (coalesce(nullif(provider_id, ''), 'openai_legacy')),
  lease_expires_at,
  priority,
  created_at
)
include (id, tenant_id, batch_id)
where status = 'RUNNING'
  and attempt_count < max_attempts;

create index if not exists v4_recognition_jobs_exhausted_lease_idx
on public.v4_recognition_jobs (lease_expires_at, created_at)
include (id)
where status = 'RUNNING'
  and attempt_count >= max_attempts;

analyze public.v4_recognition_jobs;
