alter table if exists public.v4_production_quality_ledger
  add column if not exists provider_diagnostics jsonb not null default '{}'::jsonb,
  add column if not exists pipeline_node_ledger jsonb not null default '{}'::jsonb;

comment on column public.v4_production_quality_ledger.provider_diagnostics is
  'Sanitized provider runtime diagnostics. Never store API keys, signed URLs, image payloads, or marketplace answer labels.';

comment on column public.v4_production_quality_ledger.pipeline_node_ledger is
  'Per-node production observability ledger with safe counts, timings, statuses, field-flow checks, and reconciliation anomalies.';
