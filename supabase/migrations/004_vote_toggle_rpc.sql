-- Star Dish MVP - Atomic vote toggle RPC

create or replace function public.toggle_platillo_vote(
  platillo_id uuid,
  vote_type public.vote_type
)
returns void
language plpgsql
volatile
as $$
declare
  uid uuid := auth.uid();
  existing public.votes%rowtype;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select *
  into existing
  from public.votes v
  where v.user_id = uid
    and v.platillo_id = toggle_platillo_vote.platillo_id;

  if not found then
    insert into public.votes (user_id, platillo_id, vote_type)
    values (uid, toggle_platillo_vote.platillo_id, toggle_platillo_vote.vote_type);
    return;
  end if;

  if existing.vote_type = toggle_platillo_vote.vote_type then
    delete from public.votes
    where id = existing.id;
    return;
  end if;

  update public.votes
  set vote_type = toggle_platillo_vote.vote_type
  where id = existing.id;
end;
$$;

grant execute on function public.toggle_platillo_vote(uuid, public.vote_type) to authenticated;
revoke execute on function public.toggle_platillo_vote(uuid, public.vote_type) from anon;




