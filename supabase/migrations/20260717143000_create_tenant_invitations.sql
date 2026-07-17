create table if not exists public.tenant_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  inviter_user_id text not null,
  email text not null,
  role text not null,
  status text not null default 'PENDING',
  token_hash text not null,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_invitations_status_chk
    check (status in ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
  constraint tenant_invitations_role_chk
    check (role in ('OWNER', 'MANAGER', 'WRITER')),
  constraint tenant_invitations_token_hash_chk
    check (char_length(token_hash) = 64)
);

create unique index if not exists tenant_invitations_token_hash_uidx
  on public.tenant_invitations (token_hash);

create index if not exists tenant_invitations_tenant_status_idx
  on public.tenant_invitations (tenant_id, status, created_at desc);

create index if not exists tenant_invitations_tenant_email_status_idx
  on public.tenant_invitations (tenant_id, email, status, created_at desc);

create index if not exists tenant_invitations_expiring_idx
  on public.tenant_invitations (tenant_id, expires_at)
  where expires_at is not null;

alter table public.tenant_invitations enable row level security;

revoke all on table public.tenant_invitations from public, anon, authenticated;
grant select, insert, update, delete on table public.tenant_invitations to service_role;
