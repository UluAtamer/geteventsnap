create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 100),
  event_date date not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  cover_image_url text,
  welcome_message text not null default '' check (char_length(welcome_message) <= 500),
  dating_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.events enable row level security;

create policy "Owners can read their own events"
  on public.events for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy "Owners can create their own events"
  on public.events for insert
  to authenticated
  with check ((select auth.uid()) = owner_id);

create policy "Owners can update their own events"
  on public.events for update
  to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

create policy "Owners can delete their own events"
  on public.events for delete
  to authenticated
  using ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.events to authenticated;
