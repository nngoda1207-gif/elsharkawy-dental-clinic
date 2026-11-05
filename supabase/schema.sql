-- Clinic shared state: only the Edge Function (service role) accesses this table.
create table if not exists public.clinic_sync_state (
  id text primary key check (id = 'main'),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.clinic_sync_state enable row level security;
revoke all on public.clinic_sync_state from anon, authenticated;
