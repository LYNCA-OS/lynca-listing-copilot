create table if not exists public.tenant_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null,
  auth_user_id text,
  destination_hmac text not null,
  destination_hmac_key_version text not null default 'v1',
  idempotency_key text not null,
  role text not null default 'WRITER',
  status text not null default 'PROVISIONING',
  expires_at timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_invitations_role_chk
    check (role in ('OWNER', 'MANAGER', 'WRITER')),
  constraint tenant_invitations_status_chk
    check (status in ('PROVISIONING', 'PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED', 'FAILED'))
);

create unique index if not exists tenant_invitations_idempotency_uidx
  on public.tenant_invitations(idempotency_key);
create unique index if not exists tenant_invitations_live_destination_uidx
  on public.tenant_invitations(destination_hmac)
  where status in ('PROVISIONING', 'PENDING');
create index if not exists tenant_invitations_status_idx
  on public.tenant_invitations(status, expires_at);

alter table public.tenant_invitations enable row level security;

create table if not exists public.auth_otp_replay (
  replay_digest text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes'
);
create index if not exists auth_otp_replay_expiry_idx
  on public.auth_otp_replay(expires_at);
alter table public.auth_otp_replay enable row level security;

create table if not exists public.auth_otp_counter (
  bucket_key text primary key,
  window_end timestamptz not null,
  count integer not null default 0,
  updated_at timestamptz not null default now()
);
create index if not exists auth_otp_counter_window_idx
  on public.auth_otp_counter(window_end);
alter table public.auth_otp_counter enable row level security;

create or replace function public.auth_otp_request_admit(
  p_destination_hmac text,
  p_ip_hmac text,
  p_device_hmac text,
  p_replay_digest text,
  p_eligible boolean,
  p_dest_minute_limit integer default 1,
  p_dest_hour_limit integer default 5,
  p_ip_hour_limit integer default 30,
  p_device_hour_limit integer default 10,
  p_global_hour_limit integer default 5000,
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minute_end timestamptz := date_trunc('minute', p_now) + interval '1 minute';
  v_hour_end   timestamptz := date_trunc('hour', p_now) + interval '1 hour';
  v_over boolean := false;
begin
  begin
    insert into public.auth_otp_replay(replay_digest, created_at, expires_at)
    values (p_replay_digest, p_now, p_now + interval '15 minutes');
  exception when unique_violation then
    return jsonb_build_object('admitted', false, 'reason', 'replay');
  end;

  with buckets(k, w, lim) as (
    values
      ('d1:' || coalesce(p_destination_hmac, ''), v_minute_end, p_dest_minute_limit),
      ('dh:' || coalesce(p_destination_hmac, ''), v_hour_end,   p_dest_hour_limit),
      ('ih:' || coalesce(p_ip_hmac, ''),          v_hour_end,   p_ip_hour_limit),
      ('vh:' || coalesce(p_device_hmac, ''),      v_hour_end,   p_device_hour_limit),
      ('gh',                                       v_hour_end,   p_global_hour_limit)
  ),
  upserted as (
    insert into public.auth_otp_counter as c (bucket_key, window_end, count, updated_at)
    select b.k, b.w, 1, p_now from buckets b
    on conflict (bucket_key) do update
      set count = case when c.window_end <= p_now then 1 else c.count + 1 end,
          window_end = case when c.window_end <= p_now then excluded.window_end else c.window_end end,
          updated_at = p_now
    returning bucket_key, count,
      (select lim from buckets b where b.k = c.bucket_key) as lim
  )
  select bool_or(count > lim) into v_over from upserted;

  if v_over then
    return jsonb_build_object('admitted', false, 'reason', 'rate_limited');
  end if;
  if not coalesce(p_eligible, false) then
    return jsonb_build_object('admitted', false, 'reason', 'not_eligible');
  end if;

  return jsonb_build_object('admitted', true, 'reason', 'ok');
end;
$$;

revoke all on function public.auth_otp_request_admit(
  text, text, text, text, boolean, integer, integer, integer, integer, integer, timestamptz
) from public, anon, authenticated;

create or replace function public.auth_otp_gc(p_now timestamptz default now())
returns void language sql security definer set search_path = public as $$
  delete from public.auth_otp_replay where expires_at < p_now;
  delete from public.auth_otp_counter where window_end < p_now - interval '2 hours';
$$;
revoke all on function public.auth_otp_gc(timestamptz) from public, anon, authenticated;;
