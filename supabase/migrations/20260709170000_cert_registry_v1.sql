-- Anchor-first recognition path v1: internal grading-cert registry.
--
-- A slab cert number is an INSTANCE anchor on the physical card; resolving it
-- against a registry upgrades it into an identity candidate. This table is the
-- internal registry: rows accumulate from writer-confirmed recognitions (the
-- flywheel) and, later, from vetted external sources. Lookup results are
-- candidates only — the L1 finalize lane still requires current-image visual
-- agreement (subject/year, zero contradictions) before any writer-visible
-- title, and conflicts surface as REVIEW_REQUIRED instead of finalizing.
-- External graders' own lookups (PSA etc.) are adapter-pluggable but disabled
-- by default: automated/commercial access needs licensing review first.

create table if not exists public.cert_registry (
  id uuid primary key default gen_random_uuid(),
  grader text not null,
  cert_number text not null,
  identity jsonb not null default '{}'::jsonb,
  grade text,
  auto_grade text,
  canonical_title text,
  source text not null default 'recognition_confirmed',
  review_status text not null default 'REVIEW_REQUIRED',
  asset_id text,
  session_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cert_registry_grader_chk
    check (grader in ('PSA', 'BGS', 'SGC', 'CGC', 'PSA/DNA', 'JSA', 'OTHER')),
  constraint cert_registry_source_chk
    check (source in ('writer_feedback', 'recognition_confirmed', 'manual', 'external_registry')),
  constraint cert_registry_review_chk
    check (review_status in ('REVIEW_REQUIRED', 'REVIEWED_INTERNAL', 'REJECTED'))
);

create unique index if not exists cert_registry_grader_cert_uidx
  on public.cert_registry (grader, cert_number);

create index if not exists cert_registry_cert_idx
  on public.cert_registry (cert_number);

alter table public.cert_registry enable row level security;

drop trigger if exists cert_registry_touch_updated_at on public.cert_registry;
create or replace function public.cert_registry_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger cert_registry_touch_updated_at
before update on public.cert_registry
for each row execute function public.cert_registry_touch();
