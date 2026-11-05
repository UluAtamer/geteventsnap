alter table public.uploads_meta
  add column if not exists guest_hash text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'uploads_meta_guest_hash_format'
      and conrelid = 'public.uploads_meta'::regclass
  ) then
    alter table public.uploads_meta
      add constraint uploads_meta_guest_hash_format
      check (guest_hash is null or guest_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$$;

create index if not exists uploads_meta_event_guest_hash_idx
  on public.uploads_meta (event_id, guest_hash)
  where guest_hash is not null;

create or replace function public.get_owner_event_upload_stats()
returns table (
  event_id uuid,
  file_count bigint,
  guest_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    event.id,
    count(upload.id),
    count(distinct upload.guest_hash)
  from public.events as event
  left join public.uploads_meta as upload
    on upload.event_id = event.id
  where event.owner_id = (select auth.uid())
  group by event.id;
$$;

revoke all on function public.get_owner_event_upload_stats() from public, anon;
grant execute on function public.get_owner_event_upload_stats() to authenticated;
