-- Star Dish MVP - Dish Rankings Table

create table if not exists public.dish_rankings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  osm_id text not null,              -- OSM node/way ID (no FK to restaurants)
  restaurant_name text not null,     -- denormalized for display
  dish_name text not null,
  price_cents int,
  ingredients text,
  score int not null check (score between 0 and 10),
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes
create index if not exists dish_rankings_user_id_idx on public.dish_rankings (user_id);
create index if not exists dish_rankings_osm_id_idx on public.dish_rankings (osm_id);

-- Updated at trigger
drop trigger if exists set_dish_rankings_updated_at on public.dish_rankings;
create trigger set_dish_rankings_updated_at
before update on public.dish_rankings
for each row
execute function public.set_updated_at();

-- RLS
alter table public.dish_rankings enable row level security;

-- Public read
create policy "Anyone can read dish_rankings"
  on public.dish_rankings for select using (true);

-- Authenticated insert (owner)
create policy "Authenticated users can insert own rankings"
  on public.dish_rankings for insert
  with check (auth.uid() = user_id);

-- Owner update
create policy "Users can update own rankings"
  on public.dish_rankings for update using (auth.uid() = user_id);

-- Owner delete
create policy "Users can delete own rankings"
  on public.dish_rankings for delete using (auth.uid() = user_id);

