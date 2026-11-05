alter table public.events
  add column if not exists event_type text not null default 'dugun';

alter table public.events
  drop constraint if exists events_event_type_check;

alter table public.events
  add constraint events_event_type_check
  check (event_type in ('dugun', 'arkadas', 'parti', 'diger'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'event-covers',
  'event-covers',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Event owners can upload their covers" on storage.objects;
create policy "Event owners can upload their covers"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'event-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Event owners can view their covers" on storage.objects;
create policy "Event owners can view their covers"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'event-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Event owners can delete their covers" on storage.objects;
create policy "Event owners can delete their covers"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'event-covers'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop function if exists public.get_public_event(text);

create function public.get_public_event(event_slug text)
returns table (
  title text,
  event_date date,
  welcome_message text,
  cover_image_url text,
  event_type text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.title, e.event_date, e.welcome_message, e.cover_image_url, e.event_type
  from public.events as e
  where e.slug = event_slug
  limit 1;
$$;

revoke all on function public.get_public_event(text) from public;
grant execute on function public.get_public_event(text) to anon, authenticated;
