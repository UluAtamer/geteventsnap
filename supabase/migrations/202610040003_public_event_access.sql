drop policy if exists "Guests can read an event by its public slug" on public.events;
revoke select on public.events from anon;

create or replace function public.get_public_event(event_slug text)
returns table (
  title text,
  event_date date,
  welcome_message text,
  cover_image_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.title, e.event_date, e.welcome_message, e.cover_image_url
  from public.events as e
  where e.slug = event_slug
  limit 1;
$$;

revoke all on function public.get_public_event(text) from public;
grant execute on function public.get_public_event(text) to anon, authenticated;
