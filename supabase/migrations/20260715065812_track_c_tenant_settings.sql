begin;

alter table public.tenants
  add column if not exists settings jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.tenants'::regclass
      and conname = 'tenants_settings_object_check'
  ) then
    alter table public.tenants
      add constraint tenants_settings_object_check
      check (jsonb_typeof(settings) = 'object') not valid;
  end if;
end $$;

alter table public.tenants
  validate constraint tenants_settings_object_check;

commit;
