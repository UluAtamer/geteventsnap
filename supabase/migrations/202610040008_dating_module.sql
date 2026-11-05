create or replace function public.get_public_event_with_dating(event_slug text)
returns table (
  title text,
  event_date date,
  welcome_message text,
  cover_image_url text,
  event_type text,
  dating_enabled boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.title, e.event_date, e.welcome_message, e.cover_image_url, e.event_type, e.dating_enabled
  from public.events as e
  where e.slug = event_slug
  limit 1;
$$;

revoke all on function public.get_public_event_with_dating(text) from public;
grant execute on function public.get_public_event_with_dating(text) to anon, authenticated;

create table if not exists public.guest_profiles (
  id uuid primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  guest_token_hash text not null check (guest_token_hash ~ '^[0-9a-f]{64}$'),
  first_name text not null check (char_length(first_name) between 1 and 40),
  last_name text not null check (char_length(last_name) between 1 and 40),
  age smallint not null check (age between 18 and 120),
  photo_path text not null,
  bio text not null default '' check (char_length(bio) <= 240),
  contact_type text check (contact_type in ('instagram', 'phone')),
  contact_value text check (contact_value is null or char_length(contact_value) <= 80),
  consented_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (event_id, guest_token_hash),
  check ((contact_type is null) = (contact_value is null))
);

create table if not exists public.dating_likes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  liker_profile_id uuid not null references public.guest_profiles (id) on delete cascade,
  liked_profile_id uuid not null references public.guest_profiles (id) on delete cascade,
  liked boolean not null,
  created_at timestamptz not null default now(),
  unique (event_id, liker_profile_id, liked_profile_id),
  check (liker_profile_id <> liked_profile_id)
);

create table if not exists public.dating_matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  profile_a uuid not null references public.guest_profiles (id) on delete cascade,
  profile_b uuid not null references public.guest_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, profile_a, profile_b),
  check (profile_a < profile_b)
);

create table if not exists public.dating_reports (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  reporter_profile_id uuid references public.guest_profiles (id) on delete set null,
  reported_profile_id uuid references public.guest_profiles (id) on delete set null,
  reason text not null check (char_length(reason) between 1 and 300),
  status text not null default 'pending' check (status in ('pending', 'reviewed', 'removed')),
  created_at timestamptz not null default now()
);

create table if not exists public.dating_blocks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  blocker_profile_id uuid not null references public.guest_profiles (id) on delete cascade,
  blocked_profile_id uuid not null references public.guest_profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (event_id, blocker_profile_id, blocked_profile_id),
  check (blocker_profile_id <> blocked_profile_id)
);

create index if not exists guest_profiles_event_idx on public.guest_profiles (event_id);
create index if not exists dating_likes_target_idx
  on public.dating_likes (event_id, liked_profile_id, liked);
create index if not exists dating_reports_owner_idx
  on public.dating_reports (event_id, status, created_at desc);
create index if not exists dating_matches_event_idx
  on public.dating_matches (event_id, created_at desc);

alter table public.guest_profiles enable row level security;
alter table public.dating_likes enable row level security;
alter table public.dating_matches enable row level security;
alter table public.dating_reports enable row level security;
alter table public.dating_blocks enable row level security;

revoke all on public.guest_profiles, public.dating_likes, public.dating_matches,
  public.dating_reports, public.dating_blocks from anon, authenticated;

grant select, insert, update, delete on public.guest_profiles, public.dating_likes,
  public.dating_matches, public.dating_reports, public.dating_blocks to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dating-photos',
  'dating-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
