import { supabase } from '../lib/supabase';
import type { RestaurantWithRanking } from '../types/database';
import { searchRestaurantsInArea } from './mapService';
import type { ViewportBounds } from '../types/database';

// Track restaurant view
export async function trackRestaurantView(osmId: string, restaurantName: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return; // Only track for authenticated users

  // Upsert: increment view count or create new entry
  const { error } = await supabase.rpc('upsert_restaurant_view', {
    user_id_param: user.id,
    osm_id_param: osmId,
    restaurant_name_param: restaurantName,
  });

  if (error && __DEV__) {
    console.warn('Failed to track restaurant view:', error);
  }
}

// Extract OSM ID from restaurant ID format "osm:node:123" or "osm:way:456"
export function extractOsmId(restaurantId: string): string | null {
  const match = restaurantId.match(/^osm:(?:node|way|relation):(\d+)$/);
  return match ? match[1] : null;
}

// Get recently viewed restaurants
// Note: Returns OSM IDs and names, but we need to fetch full restaurant data
// For now, we'll return empty array and let the caller handle fetching
export async function getRecentlyViewedRestaurants(limit = 10): Promise<Array<{ osmId: string; restaurantName: string; viewedAt: string; viewCount: number }>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase.rpc('get_recently_viewed_restaurants', {
    user_id_param: user.id,
    limit_count: limit,
  });

  if (error) {
    if (__DEV__) console.warn('Failed to get recently viewed:', error);
    return [];
  }

  if (!data || !Array.isArray(data)) return [];

  return data.map((row: any) => ({
    osmId: row.osm_id,
    restaurantName: row.restaurant_name,
    viewedAt: row.viewed_at,
    viewCount: row.view_count,
  }));
}

// Get top picks
export async function getTopPicks(limit = 10): Promise<Array<{ osmId: string; restaurantName: string; avgScore: number; reviewCount: number; lat?: number; lng?: number }>> {
  const { data, error } = await supabase.rpc('get_top_picks', {
    limit_count: limit,
  });

  if (error) {
    if (__DEV__) console.warn('Failed to get top picks:', error);
    return [];
  }

  if (!data || !Array.isArray(data)) return [];

  // Deduplicate by OSM ID in case database returns duplicates
  // Normalize OSM IDs to handle cases like "123" vs "0123"
  const seenOsmIds = new Set<string>();
  const uniquePicks: Array<{ osmId: string; restaurantName: string; avgScore: number; reviewCount: number; lat?: number; lng?: number }> = [];
  
  for (const row of data) {
    // Normalize OSM ID by removing leading zeros and trimming
    const rawOsmId = String(row.osm_id || '').trim();
    const osmId = rawOsmId ? String(Number(rawOsmId) || rawOsmId) : '';
    
    if (osmId && !seenOsmIds.has(osmId)) {
      seenOsmIds.add(osmId);
      uniquePicks.push({
        osmId,
        restaurantName: row.restaurant_name || 'Restaurant',
        avgScore: Number(row.avg_score) || 0,
        reviewCount: Number(row.review_count) || 0,
        lat: row.lat != null ? Number(row.lat) : undefined,
        lng: row.lng != null ? Number(row.lng) : undefined,
      });
    } else if (__DEV__ && osmId) {
      console.warn(`[getTopPicks] Duplicate OSM ID detected: ${osmId} (${row.restaurant_name})`);
    }
  }
  
  if (__DEV__) {
    console.log(`[getTopPicks] Returning ${uniquePicks.length} unique picks from ${data.length} database results`);
  }

  return uniquePicks;
}

// Get best rated
export async function getBestRated(limit = 10): Promise<Array<{ osmId: string; restaurantName: string; avgScore: number; totalReviews: number }>> {
  const { data, error } = await supabase.rpc('get_best_rated', {
    limit_count: limit,
  });

  if (error) {
    if (__DEV__) console.warn('Failed to get best rated:', error);
    return [];
  }

  if (!data || !Array.isArray(data)) return [];

  return data.map((row: any) => ({
    osmId: row.osm_id,
    restaurantName: row.restaurant_name,
    avgScore: Number(row.avg_score) || 0,
    totalReviews: Number(row.total_reviews) || 0,
  }));
}

// Fetch full restaurant data for recommendation OSM IDs
// This searches for restaurants by name to get full data (lat, lng, etc.)
export async function fetchRestaurantsForRecommendations(
  recommendations: Array<{ osmId: string; restaurantName: string }>,
  viewport: ViewportBounds
): Promise<RestaurantWithRanking[]> {
  if (recommendations.length === 0) return [];

  // Search for each restaurant by name
  // We'll search for all of them and match by OSM ID
  const allResults: RestaurantWithRanking[] = [];
  
  // Group by name to reduce API calls
  const nameMap = new Map<string, string[]>();
  for (const rec of recommendations) {
    const name = rec.restaurantName.toLowerCase().trim();
    if (!nameMap.has(name)) {
      nameMap.set(name, []);
    }
    nameMap.get(name)!.push(rec.osmId);
  }

  // Search for each unique name
  for (const [name, osmIds] of nameMap.entries()) {
    try {
      const results = await searchRestaurantsInArea(viewport, name);
      // Filter to only include restaurants matching our OSM IDs
      const matching = results.filter(r => {
        const rOsmId = extractOsmId(r.id);
        return rOsmId && osmIds.includes(rOsmId);
      });
      allResults.push(...matching);
    } catch (error) {
      if (__DEV__) {
        console.warn(`Failed to fetch restaurant data for "${name}":`, error);
      }
    }
  }

  return allResults;
}

// Get top-ranked restaurants for "Popular this week" section
// Uses get_top_picks which returns restaurants with highest average scores and review counts
// Uses Mapbox search to get coordinates for each restaurant
export async function getTopRankedRestaurants(
  limit = 6,
  proximity?: { latitude: number; longitude: number }
): Promise<RestaurantWithRanking[]> {
  try {
    // Get top picks from database
    const topPicks = await getTopPicks(limit);
    
    if (topPicks.length === 0) return [];

    // Import Mapbox search service
    const { searchAutocomplete, retrieveFeature } = await import('./mapboxSearchService');
    const { SessionToken } = await import('@mapbox/search-js-core');

    // Search Mapbox for each restaurant to get coordinates
    const restaurants: RestaurantWithRanking[] = [];
    const seenOsmIds = new Set<string>(); // Track OSM IDs to prevent duplicates
    
    for (const pick of topPicks) {
      // Normalize OSM ID to handle leading zeros
      const normalizedOsmId = String(Number(pick.osmId) || pick.osmId);
      
      // Skip if we've already processed this OSM ID
      if (seenOsmIds.has(normalizedOsmId)) {
        if (__DEV__) {
          console.warn(`[getTopRankedRestaurants] Skipping duplicate OSM ID: ${normalizedOsmId} (${pick.restaurantName})`);
        }
        continue;
      }
      seenOsmIds.add(normalizedOsmId);
      try {
        // Check if we already have coordinates from the database
        let lat = pick.lat;
        let lng = pick.lng;
        let feature: any = null;
        
        // If coordinates are missing, fetch from Mapbox
        if (!lat || !lng || lat === 0 || lng === 0) {
          // Search for restaurant by name - use first result with proximity if available
          const sessionToken = new SessionToken();
          const { results } = await searchAutocomplete(pick.restaurantName, {
            proximity,
            limit: 1,
          }, sessionToken);

          if (results.length > 0) {
            // Retrieve full feature details to get coordinates
            feature = await retrieveFeature(results[0].original, sessionToken);
            
            if (feature) {
              [lng, lat] = feature.geometry.coordinates;
              
              // Store coordinates in database for future use (async, don't wait)
              supabase
                .from('dish_rankings')
                .update({
                  restaurant_lat: lat,
                  restaurant_lng: lng,
                })
                .eq('osm_id', normalizedOsmId)
                .then(({ error }) => {
                  if (error && __DEV__) {
                    console.warn(`[getTopRankedRestaurants] Failed to store coordinates for ${pick.restaurantName}:`, error);
                  } else if (__DEV__) {
                    console.log(`[getTopRankedRestaurants] Stored coordinates for ${pick.restaurantName}: ${lat}, ${lng}`);
                  }
                });
            }
          }
        } else if (__DEV__) {
          console.log(`[getTopRankedRestaurants] Using stored coordinates for ${pick.restaurantName}: ${lat}, ${lng}`);
        }

        // Construct restaurant ID: prefer Mapbox ID if available, otherwise use OSM ID
        let restaurantId: string;
        if (feature?.mapbox_id) {
          // Use Mapbox ID format: mapbox:poi.xxx
          restaurantId = `mapbox:${feature.mapbox_id}`;
          if (__DEV__) {
            console.log(`[getTopRankedRestaurants] Using Mapbox ID for ${pick.restaurantName}: ${restaurantId}`);
          }
        } else if (normalizedOsmId.includes(':') || normalizedOsmId.includes('mapbox')) {
          // OSM ID is already formatted or is a mapbox ID - use as-is
          restaurantId = normalizedOsmId;
        } else {
          // Numeric OSM ID - format it properly
          restaurantId = `osm:node:${normalizedOsmId}`;
        }
        
        // Add restaurant with coordinates (use 0,0 if coordinates not available)
        restaurants.push({
          id: restaurantId,
          name: pick.restaurantName,
          address: feature?.properties?.address || feature?.place_name || null,
          lat: lat && lat !== 0 ? lat : 0,
          lng: lng && lng !== 0 ? lng : 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          top_dish_net_score: pick.avgScore,
          establishment_type: feature?.properties?.category || null,
        });
      } catch (error) {
        // If Mapbox search fails for one restaurant, still add it
        if (__DEV__) {
          console.warn(`Failed to find coordinates for "${pick.restaurantName}":`, error);
        }
        // Construct restaurant ID from OSM ID
        let restaurantId: string;
        if (normalizedOsmId.includes(':') || normalizedOsmId.includes('mapbox')) {
          restaurantId = normalizedOsmId;
        } else {
          restaurantId = `osm:node:${normalizedOsmId}`;
        }
        
        // Still add restaurant without coordinates (user can search for it)
        restaurants.push({
          id: restaurantId,
          name: pick.restaurantName,
          address: null,
          lat: 0,
          lng: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          top_dish_net_score: pick.avgScore,
        });
      }
    }

    // Final deduplication: by ID, by OSM ID, and by normalized name
    // This catches cases where Mapbox returns different POI IDs for the same restaurant
    const uniqueRestaurants = new Map<string, RestaurantWithRanking>();
    const seenOsmIdsInResults = new Set<string>(); // Track OSM IDs from results
    const seenNames = new Map<string, RestaurantWithRanking>(); // Track by normalized name
    
    // Helper to normalize restaurant name for comparison
    const normalizeName = (name: string): string => {
      return name.toLowerCase().trim().replace(/\s+/g, ' ');
    };
    
    for (const restaurant of restaurants) {
      const restaurantOsmId = extractOsmId(restaurant.id);
      const normalizedName = normalizeName(restaurant.name);
      const key = restaurant.id;
      
      // Check for duplicate by ID
      if (uniqueRestaurants.has(key)) {
        if (__DEV__) {
          console.warn(`[getTopRankedRestaurants] Duplicate ID detected: ${restaurant.id}, name: ${restaurant.name}, existing: ${uniqueRestaurants.get(key)?.name}`);
        }
        // Prefer the one with coordinates if current has better data
        const existing = uniqueRestaurants.get(key)!;
        if (restaurant.lat !== 0 && restaurant.lng !== 0 && 
            (existing.lat === 0 || existing.lng === 0)) {
          uniqueRestaurants.set(key, restaurant);
        }
        continue;
      }
      
      // Check for duplicate by OSM ID (if this restaurant has an OSM ID)
      if (restaurantOsmId) {
        if (seenOsmIdsInResults.has(restaurantOsmId)) {
          if (__DEV__) {
            console.warn(`[getTopRankedRestaurants] Duplicate OSM ID detected: ${restaurantOsmId}, name: ${restaurant.name}, ID: ${restaurant.id}`);
          }
          // Prefer the one with coordinates
          const existingByName = seenNames.get(normalizedName);
          if (existingByName && 
              restaurant.lat !== 0 && restaurant.lng !== 0 && 
              (existingByName.lat === 0 || existingByName.lng === 0)) {
            // Replace the existing one with better data
            uniqueRestaurants.delete(existingByName.id);
            uniqueRestaurants.set(key, restaurant);
            seenNames.set(normalizedName, restaurant);
          }
          continue;
        }
        seenOsmIdsInResults.add(restaurantOsmId);
      }
      
      // Check for duplicate by normalized name (catches same restaurant with different Mapbox IDs)
      if (seenNames.has(normalizedName)) {
        const existing = seenNames.get(normalizedName)!;
        if (__DEV__) {
          console.warn(`[getTopRankedRestaurants] Duplicate name detected: "${restaurant.name}" (normalized: "${normalizedName}"), existing ID: ${existing.id}, new ID: ${restaurant.id}`);
        }
        // Prefer the one with coordinates and better data
        const existingHasCoords = existing.lat !== 0 && existing.lng !== 0;
        const currentHasCoords = restaurant.lat !== 0 && restaurant.lng !== 0;
        
        if (currentHasCoords && !existingHasCoords) {
          // Current has coordinates, existing doesn't - replace
          uniqueRestaurants.delete(existing.id);
          uniqueRestaurants.set(key, restaurant);
          seenNames.set(normalizedName, restaurant);
        } else if (currentHasCoords && existingHasCoords) {
          // Both have coordinates - prefer the one with OSM ID, or keep existing
          const existingOsmId = extractOsmId(existing.id);
          if (restaurantOsmId && !existingOsmId) {
            // Current has OSM ID, existing doesn't - replace
            uniqueRestaurants.delete(existing.id);
            uniqueRestaurants.set(key, restaurant);
            seenNames.set(normalizedName, restaurant);
          }
          // Otherwise keep existing
        }
        // If current has no coordinates and existing does, skip current
        continue;
      }
      
      // No duplicates found - add restaurant
      uniqueRestaurants.set(key, restaurant);
      seenNames.set(normalizedName, restaurant);
    }

    if (__DEV__) {
      console.log(`[getTopRankedRestaurants] Returning ${uniqueRestaurants.size} unique restaurants from ${restaurants.length} total`);
    }

    return Array.from(uniqueRestaurants.values());
  } catch (error) {
    if (__DEV__) {
      console.warn('Failed to get top-ranked restaurants:', error);
    }
    return [];
  }
}
