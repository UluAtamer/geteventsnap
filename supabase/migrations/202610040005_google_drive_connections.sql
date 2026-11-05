create table if not exists public.event_drive_connections (
  event_id uuid primary key references public.events (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  encrypted_refresh_token text not null,
  drive_folder_id text not null,
  drive_folder_url text not null,
  connection_status text not null default 'connected'
    check (connection_status in ('connected', 'reauth_required')),
  connected_at timestamptz not null default now(),
  last_error_at timestamptz
);

create index if not exists event_drive_connections_owner_id_idx
  on public.event_drive_connections (owner_id);

alter table public.event_drive_connections enable row level security;

revoke all on table public.event_drive_connections from public, anon, authenticated;
grant all on table public.event_drive_connections to service_role;
