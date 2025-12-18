-- Star Dish MVP - Update Top Picks Minimum Reviews and Fix Duplicates
-- Lower the minimum review count from 3 to 1 so high-rated restaurants
-- can appear in top restaurants even with fewer reviews
-- Group by osm_id only (not restaurant_name) to prevent duplicates

CREATE OR REPLACE FUNCTION public.get_top_picks(limit_count int DEFAULT 10)
RETURNS TABLE (
  osm_id text,
  restaurant_name text,
  avg_score numeric,
  review_count bigint
)
LANGUAGE sql
STABLE
AS $$
  WITH restaurant_stats AS (
    SELECT 
      dr.osm_id,
      ROUND(AVG(dr.score)::numeric, 1) as avg_score,
      COUNT(*)::bigint as review_count
    FROM public.dish_rankings dr
    GROUP BY dr.osm_id
    HAVING COUNT(*) >= 1  -- Minimum 1 review for top picks (lowered from 3)
  ),
  restaurant_names AS (
    SELECT 
      osm_id,
      (array_agg(restaurant_name ORDER BY cnt DESC, restaurant_name))[1] as restaurant_name
    FROM (
      SELECT 
        osm_id,
        restaurant_name,
        COUNT(*) as cnt
      FROM public.dish_rankings
      GROUP BY osm_id, restaurant_name
    ) name_counts
    GROUP BY osm_id
  )
  SELECT 
    rs.osm_id,
    COALESCE(rn.restaurant_name, 'Restaurant') as restaurant_name,
    rs.avg_score,
    rs.review_count
  FROM restaurant_stats rs
  LEFT JOIN restaurant_names rn ON rs.osm_id = rn.osm_id
  ORDER BY rs.avg_score DESC, rs.review_count DESC
  LIMIT limit_count;
$$;
