import { supabase } from '../lib/supabase';
import type { DishRanking, DishRankingInput } from '../types/database';

/**
 * Submit a new dish ranking for a restaurant.
 * Requires the user to be authenticated; throws if not.
 */
export async function submitDishRanking(input: DishRankingInput): Promise<DishRanking> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error('Not authenticated');
  }

  // Ensure profile exists (should be auto-created by trigger, but handle edge case)
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .single();

  if (!profile) {
    // Profile doesn't exist, create it
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({ id: user.id });

    if (profileError) {
      throw new Error(`Failed to create profile: ${profileError.message}`);
    }
  }

  const { data, error } = await supabase
    .from('dish_rankings')
    .insert({
      user_id: user.id,
      osm_id: input.osm_id,
      restaurant_name: input.restaurant_name,
      dish_name: input.dish_name,
      price_cents: input.price_cents ?? null,
      ingredients: input.ingredients ?? null,
      score: input.score,
      image_url: input.image_url ?? null,
      mapbox_id: input.mapbox_id ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data as DishRanking;
}

/**
 * Fetch all dish rankings for a given OSM restaurant ID.
 * Also supports querying by mapbox_id if provided.
 * 
 * @param osmId - OSM ID string (can be numeric OSM ID or mapbox:xxx format for Mapbox restaurants)
 * @param mapboxId - Optional mapbox_id for more specific querying
 */
export async function getDishRankingsForRestaurant(osmId: string | null, mapboxId?: string | null): Promise<DishRanking[]> {
  let query = supabase
    .from('dish_rankings')
    .select('*');
  
  // If we have a mapbox_id, try querying by that first (more specific and accurate)
  if (mapboxId) {
    query = query.eq('mapbox_id', mapboxId);
    
    if (__DEV__) {
      console.log(`[getDishRankingsForRestaurant] Querying by mapbox_id: ${mapboxId}`);
    }
  } else if (osmId) {
    // Query by osm_id
    // Handle both numeric OSM IDs and mapbox:xxx format
    if (osmId.startsWith('mapbox:')) {
      // If osmId is in mapbox:xxx format, extract the mapbox_id part
      const extractedMapboxId = osmId.replace(/^mapbox:/, '');
      query = query.eq('mapbox_id', extractedMapboxId);
      
      if (__DEV__) {
        console.log(`[getDishRankingsForRestaurant] Extracted mapbox_id from osmId: ${extractedMapboxId}`);
      }
    } else {
      // Regular numeric OSM ID
      query = query.eq('osm_id', osmId);
      
      if (__DEV__) {
        console.log(`[getDishRankingsForRestaurant] Querying by osm_id: ${osmId}`);
      }
    }
  } else {
    // No valid identifier
    if (__DEV__) {
      console.warn('[getDishRankingsForRestaurant] No valid osmId or mapboxId provided');
    }
    return [];
  }
  
  const { data, error } = await query.order('created_at', { ascending: false });

  if (error) {
    if (__DEV__) {
      console.error('[getDishRankingsForRestaurant] Query error:', error);
    }
    throw error;
  }
  
  if (__DEV__) {
    console.log(`[getDishRankingsForRestaurant] Found ${data?.length || 0} rankings`);
  }
  
  return (data ?? []) as DishRanking[];
}

