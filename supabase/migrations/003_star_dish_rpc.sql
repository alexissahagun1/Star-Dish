-- Star Dish MVP - RPCs

create or replace function public.get_star_dish(restaurant_id uuid)
returns uuid
language sql
stable
as $$
  with scores as (
    select
      p.id as platillo_id,
      count(*) filter (where v.vote_type = 'UP')   as up_votes,
      count(*) filter (where v.vote_type = 'DOWN') as down_votes,
      max(v.created_at) as last_vote_at
    from public.platillos p
    left join public.votes v on v.platillo_id = p.id
    where p.restaurant_id = get_star_dish.restaurant_id
    group by p.id
  )
  select s.platillo_id
  from scores s
  order by (s.up_votes - s.down_votes) desc, s.up_votes desc, s.last_vote_at desc nulls last
  limit 1;
$$;

grant execute on function public.get_star_dish(uuid) to anon, authenticated;

-- Optional: top 3 ranking, authenticated-only
create or replace function public.get_dish_ranking_for_restaurant(restaurant_id uuid)
returns setof jsonb
language plpgsql
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  return query
  select jsonb_build_object(
    'platillo_id', p.id,
    'name', p.name,
    'net_score', (
      count(*) filter (where v.vote_type = 'UP') -
      count(*) filter (where v.vote_type = 'DOWN')
    )
  )
  from public.platillos p
  left join public.votes v on v.platillo_id = p.id
  where p.restaurant_id = get_dish_ranking_for_restaurant.restaurant_id
  group by p.id, p.name
  order by (
    count(*) filter (where v.vote_type = 'UP') -
    count(*) filter (where v.vote_type = 'DOWN')
  ) desc
  limit 3;
end;
$$;

grant execute on function public.get_dish_ranking_for_restaurant(uuid) to authenticated;
revoke execute on function public.get_dish_ranking_for_restaurant(uuid) from anon;




