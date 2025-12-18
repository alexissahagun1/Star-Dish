-- Star Dish MVP - User Restaurant History & Recommendations

-- Track user's recently viewed restaurants
CREATE TABLE IF NOT EXISTS public.user_restaurant_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  osm_id text NOT NULL,
  restaurant_name text NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  view_count int NOT NULL DEFAULT 1,
  UNIQUE(user_id, osm_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_restaurant_views_user_id ON public.user_restaurant_views(user_id, viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_restaurant_views_osm_id ON public.user_restaurant_views(osm_id);

-- RLS
ALTER TABLE public.user_restaurant_views ENABLE ROW LEVEL SECURITY;

-- Users can read their own history
CREATE POLICY "Users can read own history"
  ON public.user_restaurant_views FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own views
CREATE POLICY "Users can insert own views"
  ON public.user_restaurant_views FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own views
CREATE POLICY "Users can update own views"
  ON public.user_restaurant_views FOR UPDATE
  USING (auth.uid() = user_id);

-- Function to upsert restaurant view (increment count or create new)
CREATE OR REPLACE FUNCTION public.upsert_restaurant_view(
  user_id_param uuid,
  osm_id_param text,
  restaurant_name_param text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.user_restaurant_views (user_id, osm_id, restaurant_name, viewed_at, view_count)
  VALUES (user_id_param, osm_id_param, restaurant_name_param, now(), 1)
  ON CONFLICT (user_id, osm_id)
  DO UPDATE SET
    viewed_at = now(),
    view_count = user_restaurant_views.view_count + 1,
    restaurant_name = EXCLUDED.restaurant_name;
END;
$$;

-- Function to get recently viewed restaurants
CREATE OR REPLACE FUNCTION public.get_recently_viewed_restaurants(user_id_param uuid, limit_count int DEFAULT 10)
RETURNS TABLE (
  osm_id text,
  restaurant_name text,
  viewed_at timestamptz,
  view_count int
)
LANGUAGE sql
STABLE
AS $$
  SELECT 
    urv.osm_id,
    urv.restaurant_name,
    urv.viewed_at,
    urv.view_count
  FROM public.user_restaurant_views urv
  WHERE urv.user_id = user_id_param
  ORDER BY urv.viewed_at DESC
  LIMIT limit_count;
$$;

-- Function to get top picks (highest rated restaurants)
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
  SELECT 
    dr.osm_id,
    dr.restaurant_name,
    ROUND(AVG(dr.score)::numeric, 1) as avg_score,
    COUNT(*)::bigint as review_count
  FROM public.dish_rankings dr
  GROUP BY dr.osm_id, dr.restaurant_name
  HAVING COUNT(*) >= 3  -- Minimum reviews for top picks
  ORDER BY avg_score DESC, review_count DESC
  LIMIT limit_count;
$$;

-- Function to get best rated (by dish scores, with minimum threshold)
CREATE OR REPLACE FUNCTION public.get_best_rated(limit_count int DEFAULT 10)
RETURNS TABLE (
  osm_id text,
  restaurant_name text,
  avg_score numeric,
  total_reviews bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT 
    dr.osm_id,
    dr.restaurant_name,
    ROUND(AVG(dr.score)::numeric, 1) as avg_score,
    COUNT(*)::bigint as total_reviews
  FROM public.dish_rankings dr
  GROUP BY dr.osm_id, dr.restaurant_name
  HAVING AVG(dr.score) >= 7.0 AND COUNT(*) >= 2  -- High score + minimum reviews
  ORDER BY avg_score DESC, total_reviews DESC
  LIMIT limit_count;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_restaurant_view(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_recently_viewed_restaurants(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_top_picks(int) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_best_rated(int) TO anon, authenticated;
