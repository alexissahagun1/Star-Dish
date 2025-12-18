-- Star Dish MVP - RLS & Policies

alter table public.profiles enable row level security;
alter table public.restaurants enable row level security;
alter table public.platillos enable row level security;
alter table public.reviews enable row level security;
alter table public.votes enable row level security;

-- PROFILES
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
on public.profiles
for select
to authenticated
using (true);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- RESTAURANTS (public read)
drop policy if exists "restaurants_public_read" on public.restaurants;
create policy "restaurants_public_read"
on public.restaurants
for select
to anon, authenticated
using (true);

-- PLATILLOS (public read)
drop policy if exists "platillos_public_read" on public.platillos;
create policy "platillos_public_read"
on public.platillos
for select
to anon, authenticated
using (true);

-- REVIEWS (public read, owner write)
drop policy if exists "reviews_public_read" on public.reviews;
create policy "reviews_public_read"
on public.reviews
for select
to anon, authenticated
using (true);

drop policy if exists "reviews_insert_own" on public.reviews;
create policy "reviews_insert_own"
on public.reviews
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "reviews_update_own" on public.reviews;
create policy "reviews_update_own"
on public.reviews
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "reviews_delete_own" on public.reviews;
create policy "reviews_delete_own"
on public.reviews
for delete
to authenticated
using (auth.uid() = user_id);

-- VOTES (public read, owner write)
drop policy if exists "votes_public_read" on public.votes;
create policy "votes_public_read"
on public.votes
for select
to anon, authenticated
using (true);

drop policy if exists "votes_insert_own" on public.votes;
create policy "votes_insert_own"
on public.votes
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "votes_update_own" on public.votes;
create policy "votes_update_own"
on public.votes
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "votes_delete_own" on public.votes;
create policy "votes_delete_own"
on public.votes
for delete
to authenticated
using (auth.uid() = user_id);




