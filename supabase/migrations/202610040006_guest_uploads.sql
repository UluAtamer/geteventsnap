create table if not exists public.uploads_meta (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  drive_file_id text not null unique,
  file_size bigint not null check (file_size > 0),
  mime_type text not null,
  uploaded_at timestamptz not null default now()
);

create index if not exists uploads_meta_event_id_uploaded_at_idx
  on public.uploads_meta (event_id, uploaded_at desc);

grant select on table public.events to service_role;

alter table public.uploads_meta enable row level security;

revoke all on table public.uploads_meta from public, anon, authenticated;
grant select on table public.uploads_meta to authenticated;
grant all on table public.uploads_meta to service_role;

drop policy if exists "Owners can read their event upload summaries" on public.uploads_meta;
create policy "Owners can read their event upload summaries"
  on public.uploads_meta for select
  to authenticated
  using (
    exists (
      select 1
      from public.events as event
      where event.id = uploads_meta.event_id
        and event.owner_id = (select auth.uid())
    )
  );

create table if not exists public.guest_upload_rate_limits (
  bucket_hash text primary key check (bucket_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now()
);

alter table public.guest_upload_rate_limits enable row level security;
revoke all on table public.guest_upload_rate_limits from public, anon, authenticated;
grant all on table public.guest_upload_rate_limits to service_role;

create or replace function public.consume_guest_upload_rate_limit(
  p_bucket_hash text,
  p_max_requests integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_count integer;
  current_window timestamptz;
begin
  if p_bucket_hash !~ '^[0-9a-f]{64}$'
    or p_max_requests < 1
    or p_max_requests > 1000 then
    raise exception 'Invalid guest upload rate-limit parameters';
  end if;

  current_window := to_timestamp(floor(extract(epoch from clock_timestamp()) / 60) * 60);

  insert into public.guest_upload_rate_limits (
    bucket_hash,
    window_started_at,
    request_count,
    updated_at
  )
  values (p_bucket_hash, current_window, 1, clock_timestamp())
  on conflict (bucket_hash) do update
  set window_started_at = excluded.window_started_at,
      request_count = case
        when public.guest_upload_rate_limits.window_started_at = excluded.window_started_at
          then public.guest_upload_rate_limits.request_count + 1
        else 1
      end,
      updated_at = clock_timestamp()
  returning request_count into current_count;

  delete from public.guest_upload_rate_limits
  where updated_at < clock_timestamp() - interval '1 day';

  return current_count <= p_max_requests;
end;
$$;

revoke all on function public.consume_guest_upload_rate_limit(text, integer) from public, anon, authenticated;
grant execute on function public.consume_guest_upload_rate_limit(text, integer) to service_role;

create table if not exists public.event_upload_csv_locks (
  event_id uuid primary key references public.events (id) on delete cascade,
  lock_token uuid not null,
  locked_until timestamptz not null
);

alter table public.event_upload_csv_locks enable row level security;
revoke all on table public.event_upload_csv_locks from public, anon, authenticated;
grant all on table public.event_upload_csv_locks to service_role;

create or replace function public.acquire_event_upload_csv_lock(
  p_event_id uuid,
  p_lock_token uuid,
  p_lease_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_seconds < 1 or p_lease_seconds > 300 then
    raise exception 'Invalid upload CSV lock duration';
  end if;

  insert into public.event_upload_csv_locks (event_id, lock_token, locked_until)
  values (p_event_id, p_lock_token, clock_timestamp() + make_interval(secs => p_lease_seconds))
  on conflict (event_id) do update
  set lock_token = excluded.lock_token,
      locked_until = excluded.locked_until
  where public.event_upload_csv_locks.locked_until < clock_timestamp();

  return found;
end;
$$;

revoke all on function public.acquire_event_upload_csv_lock(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.acquire_event_upload_csv_lock(uuid, uuid, integer) to service_role;

create or replace function public.release_event_upload_csv_lock(
  p_event_id uuid,
  p_lock_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.event_upload_csv_locks
  set locked_until = clock_timestamp(),
      lock_token = p_lock_token
  where event_id = p_event_id
    and lock_token = p_lock_token;

  return found;
end;
$$;

revoke all on function public.release_event_upload_csv_lock(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_event_upload_csv_lock(uuid, uuid) to service_role;
