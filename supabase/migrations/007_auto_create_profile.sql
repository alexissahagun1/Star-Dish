-- Star Dish MVP - Auto-create profile on user signup

-- Function to handle new user creation
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Trigger to call the function when a new user is created
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- For existing users who don't have profiles yet, create them
-- This is a one-time fix for users who signed up before this migration
insert into public.profiles (id)
select id from auth.users
where id not in (select id from public.profiles)
on conflict (id) do nothing;

