-- Star Dish MVP - Add restaurant coordinates to dish_rankings
-- Store lat/lng for each OSM ID to identify restaurant locations on the map

-- Add lat and lng columns to dish_rankings table
ALTER TABLE public.dish_rankings
ADD COLUMN IF NOT EXISTS restaurant_lat double precision,
ADD COLUMN IF NOT EXISTS restaurant_lng double precision;

-- Add constraints to ensure valid coordinates (drop first if they exist)
DO $$
BEGIN
  -- Drop constraints if they exist
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'dish_rankings_lat_range' 
    AND conrelid = 'public.dish_rankings'::regclass
  ) THEN
    ALTER TABLE public.dish_rankings DROP CONSTRAINT dish_rankings_lat_range;
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'dish_rankings_lng_range' 
    AND conrelid = 'public.dish_rankings'::regclass
  ) THEN
    ALTER TABLE public.dish_rankings DROP CONSTRAINT dish_rankings_lng_range;
  END IF;
END $$;

-- Add constraints
ALTER TABLE public.dish_rankings
ADD CONSTRAINT dish_rankings_lat_range 
  CHECK (restaurant_lat IS NULL OR (restaurant_lat >= -90 AND restaurant_lat <= 90));

ALTER TABLE public.dish_rankings
ADD CONSTRAINT dish_rankings_lng_range 
  CHECK (restaurant_lng IS NULL OR (restaurant_lng >= -180 AND restaurant_lng <= 180));

-- Create index for coordinate lookups
CREATE INDEX IF NOT EXISTS idx_dish_rankings_coordinates 
ON public.dish_rankings(osm_id, restaurant_lat, restaurant_lng) 
WHERE restaurant_lat IS NOT NULL AND restaurant_lng IS NOT NULL;

-- Add comments
COMMENT ON COLUMN public.dish_rankings.restaurant_lat IS 
'Latitude of the restaurant location. NULL if coordinates not yet fetched from Mapbox.';

COMMENT ON COLUMN public.dish_rankings.restaurant_lng IS 
'Longitude of the restaurant location. NULL if coordinates not yet fetched from Mapbox.';

-- Update get_top_picks function to include coordinates
-- Drop the function first to allow changing return type
DROP FUNCTION IF EXISTS public.get_top_picks(int);

CREATE FUNCTION public.get_top_picks(limit_count int DEFAULT 10)
RETURNS TABLE (
  osm_id text,
  restaurant_name text,
  avg_score numeric,
  review_count bigint,
  lat double precision,
  lng double precision
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
    HAVING COUNT(*) >= 1  -- Minimum 1 review for top picks
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
  ),
  restaurant_coordinates AS (
    SELECT 
      osm_id,
      (array_agg(restaurant_lat ORDER BY created_at DESC))[1] as lat,
      (array_agg(restaurant_lng ORDER BY created_at DESC))[1] as lng
    FROM public.dish_rankings
    WHERE restaurant_lat IS NOT NULL AND restaurant_lng IS NOT NULL
    GROUP BY osm_id
  )
  SELECT 
    rs.osm_id,
    COALESCE(rn.restaurant_name, 'Restaurant') as restaurant_name,
    rs.avg_score,
    rs.review_count,
    rc.lat,
    rc.lng
  FROM restaurant_stats rs
  LEFT JOIN restaurant_names rn ON rs.osm_id = rn.osm_id
  LEFT JOIN restaurant_coordinates rc ON rs.osm_id = rc.osm_id
  ORDER BY rs.avg_score DESC, rs.review_count DESC
  LIMIT limit_count;
$$;
