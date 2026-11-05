alter table public.events
  add column if not exists event_address text
    check (event_address is null or char_length(event_address) <= 300),
  add column if not exists event_time time;

create or replace function public.get_public_event_details(event_slug text)
returns table (
  title text,
  event_date date,
  welcome_message text,
  cover_image_url text,
  event_type text,
  dating_enabled boolean,
  event_address text,
  event_time time
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.title,
    e.event_date,
    e.welcome_message,
    e.cover_image_url,
    e.event_type,
    e.dating_enabled,
    e.event_address,
    e.event_time
  from public.events as e
  where e.slug = event_slug
  limit 1;
$$;

revoke all on function public.get_public_event_details(text) from public;
grant execute on function public.get_public_event_details(text) to anon, authenticated;
