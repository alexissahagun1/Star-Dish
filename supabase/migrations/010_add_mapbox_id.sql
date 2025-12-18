-- Star Dish MVP - Add Mapbox ID to dish_rankings for hybrid matching

-- Add mapbox_id column to dish_rankings table
ALTER TABLE public.dish_rankings
ADD COLUMN IF NOT EXISTS mapbox_id text;

-- Create index for fast lookups by mapbox_id
CREATE INDEX IF NOT EXISTS idx_dish_rankings_mapbox_id 
ON public.dish_rankings(mapbox_id) 
WHERE mapbox_id IS NOT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN public.dish_rankings.mapbox_id IS 
'Mapbox feature ID (e.g., poi.123456789) for exact matching. NULL for records without a Mapbox ID.';
