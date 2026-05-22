
create table if not exists public.client_error_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid,
  level text not null default 'error',
  source text not null default 'unknown',
  message text not null,
  stack text,
  url text,
  route text,
  user_agent text,
  context jsonb not null default '{}'::jsonb
);

create index if not exists client_error_logs_created_at_idx on public.client_error_logs (created_at desc);
create index if not exists client_error_logs_source_idx on public.client_error_logs (source);

alter table public.client_error_logs enable row level security;

create policy "cel_insert_any"
  on public.client_error_logs for insert
  to public
  with check (true);

create policy "cel_select_admin"
  on public.client_error_logs for select
  to public
  using (is_admin(auth.uid()));
