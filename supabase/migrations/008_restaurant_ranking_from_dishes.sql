-- Star Dish MVP - Restaurant Ranking from Dish Rankings

-- Function to calculate restaurant ranking based on dish rankings
-- Returns the average score of all dish rankings for a given OSM restaurant ID
create or replace function public.get_restaurant_ranking_from_dishes(osm_id_param text)
returns numeric
language sql
stable
as $$
  select coalesce(
    round(avg(score)::numeric, 1),
    0
  )
  from public.dish_rankings
  where osm_id = osm_id_param;
$$;

grant execute on function public.get_restaurant_ranking_from_dishes(text) to anon, authenticated;

-- Function to get restaurant rankings for multiple OSM IDs at once (for batch processing)
create or replace function public.get_restaurant_rankings_batch(osm_ids text[])
returns table (osm_id text, ranking numeric)
language sql
stable
as $$
  select 
    dr.osm_id,
    round(avg(dr.score)::numeric, 1) as ranking
  from public.dish_rankings dr
  where dr.osm_id = any(osm_ids)
  group by dr.osm_id;
$$;

grant execute on function public.get_restaurant_rankings_batch(text[]) to anon, authenticated;

