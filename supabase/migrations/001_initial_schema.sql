-- Star Dish MVP - Initial Schema

create extension if not exists "pgcrypto";
create extension if not exists "postgis";

do $$
begin
  create type public.vote_type as enum ('UP', 'DOWN');
exception
  when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create table if not exists public.restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  lat double precision not null,
  lng double precision not null,
  location geography(point, 4326)
    generated always as (ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint restaurants_lat_range check (lat >= -90 and lat <= 90),
  constraint restaurants_lng_range check (lng >= -180 and lng <= 180)
);

create index if not exists restaurants_location_gix on public.restaurants using gist (location);

drop trigger if exists set_restaurants_updated_at on public.restaurants;
create trigger set_restaurants_updated_at
before update on public.restaurants
for each row
execute function public.set_updated_at();

create table if not exists public.platillos (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platillos_restaurant_id_idx on public.platillos (restaurant_id);

drop trigger if exists set_platillos_updated_at on public.platillos;
create trigger set_platillos_updated_at
before update on public.platillos
for each row
execute function public.set_updated_at();

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  rating int not null,
  content text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviews_rating_range check (rating between 1 and 5)
);

create index if not exists reviews_restaurant_id_idx on public.reviews (restaurant_id);
create index if not exists reviews_user_id_idx on public.reviews (user_id);

drop trigger if exists set_reviews_updated_at on public.reviews;
create trigger set_reviews_updated_at
before update on public.reviews
for each row
execute function public.set_updated_at();

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platillo_id uuid not null references public.platillos(id) on delete cascade,
  vote_type public.vote_type not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint votes_user_platillo_unique unique (user_id, platillo_id)
);

create index if not exists votes_platillo_id_idx on public.votes (platillo_id);
create index if not exists votes_user_id_idx on public.votes (user_id);

drop trigger if exists set_votes_updated_at on public.votes;
create trigger set_votes_updated_at
before update on public.votes
for each row
execute function public.set_updated_at();




