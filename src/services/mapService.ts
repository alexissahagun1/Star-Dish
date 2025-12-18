import { supabase } from '../lib/supabase';
import type { RestaurantWithRanking, ViewportBounds } from '../types/database';

/**
 * Enrich restaurants with rankings calculated from dish_rankings.
 * Fetches rankings in batch for efficiency.
 */
export async function enrichRestaurantsWithRankings(
  restaurants: RestaurantWithRanking[]
): Promise<RestaurantWithRanking[]> {
  const perfStart = performance.now();
  if (restaurants.length === 0) return restaurants;

  // Separate restaurants into OSM and Mapbox restaurants
  const extractStart = performance.now();
  const osmRestaurants: Array<{ restaurant: RestaurantWithRanking; osmId: string }> = [];
  const mapboxRestaurants: Array<{ restaurant: RestaurantWithRanking; mapboxId: string }> = [];
  
  for (const r of restaurants) {
    // Extract OSM ID from restaurant ID (format: "osm:node:123" or "osm:way:456")
    const osmMatch = r.id.match(/^osm:(?:node|way|relation):(\d+)$/);
    if (osmMatch) {
      osmRestaurants.push({ restaurant: r, osmId: osmMatch[1] });
      continue;
    }
    
    // Extract mapbox_id from various formats
    let mapboxId: string | null = null;
    const mapboxMatch1 = r.id.match(/^mapbox:(.+)$/);
    if (mapboxMatch1) {
      mapboxId = mapboxMatch1[1];
    } else {
      // Handle incorrect format: osm:node:mapbox:xxx
      const mapboxMatch2 = r.id.match(/^osm:(?:node|way|relation):mapbox:(.+)$/);
      if (mapboxMatch2) {
        mapboxId = mapboxMatch2[1];
      }
    }
    
    if (mapboxId) {
      mapboxRestaurants.push({ restaurant: r, mapboxId });
    } else if (__DEV__) {
      console.log(`[enrichRestaurantsWithRankings] Could not extract OSM ID or mapbox_id from restaurant ID: ${r.id}`);
    }
  }
  
  const osmIds = osmRestaurants.map(item => item.osmId);
  const mapboxIds = mapboxRestaurants.map(item => item.mapboxId);
  const extractTime = performance.now() - extractStart;

  if (__DEV__) {
    console.log(`[PERF] enrichRestaurantsWithRankings: Extracted ${osmIds.length} OSM IDs in ${extractTime.toFixed(2)}ms from ${restaurants.length} restaurants`);
  }

  if (osmIds.length === 0 && mapboxIds.length === 0) {
    if (__DEV__) {
      console.log(`[PERF] enrichRestaurantsWithRankings: No OSM IDs or mapbox_ids to enrich, returning early`);
    }
    return restaurants;
  }

  try {
    // Fetch rankings for OSM restaurants
    const osmRankingMap = new Map<string, number>();
    let rpcTime = 0; // Initialize to avoid reference error
    if (osmIds.length > 0) {
      const rpcStart = performance.now();
      const { data: rankingsData, error } = await supabase.rpc('get_restaurant_rankings_batch', {
        osm_ids: osmIds,
      });
      rpcTime = performance.now() - rpcStart;
      
      if (__DEV__) {
        console.log(`[PERF] enrichRestaurantsWithRankings: OSM RPC call took ${rpcTime.toFixed(2)}ms, returned ${rankingsData?.length || 0} rankings`);
      }

      if (error && error.code !== 'PGRST202') {
        // Function might not exist if migration hasn't been applied yet
        if (__DEV__) {
          console.warn('Failed to fetch OSM restaurant rankings:', error);
        }
      } else if (rankingsData && Array.isArray(rankingsData)) {
        for (const row of rankingsData) {
          if (row && typeof row.osm_id === 'string' && typeof row.ranking === 'number') {
            const normalizedOsmId = String(row.osm_id).trim();
            osmRankingMap.set(normalizedOsmId, Number(row.ranking));
            
            if (__DEV__) {
              console.log(`[enrichRestaurantsWithRankings] Found ranking for OSM ID: ${normalizedOsmId}, ranking: ${row.ranking}`);
            }
          }
        }
      }
    }

    // Fetch rankings for Mapbox restaurants
    const mapboxRankingMap = new Map<string, number>();
    if (mapboxIds.length > 0) {
      const mapboxStart = performance.now();
      try {
        // Query dish_rankings by mapbox_id
        const { data: mapboxRankingsData, error: mapboxError } = await supabase
          .from('dish_rankings')
          .select('mapbox_id, score')
          .in('mapbox_id', mapboxIds)
          .not('mapbox_id', 'is', null);
        
        const mapboxTime = performance.now() - mapboxStart;
        
        if (__DEV__) {
          console.log(`[PERF] enrichRestaurantsWithRankings: Mapbox query took ${mapboxTime.toFixed(2)}ms, returned ${mapboxRankingsData?.length || 0} rankings`);
        }

        if (mapboxError) {
          if (__DEV__) {
            console.warn('Failed to fetch Mapbox restaurant rankings:', mapboxError);
          }
        } else if (mapboxRankingsData && Array.isArray(mapboxRankingsData)) {
          // Group by mapbox_id and calculate average score
          const scoreMap = new Map<string, number[]>();
          for (const row of mapboxRankingsData) {
            if (row && row.mapbox_id && typeof row.score === 'number') {
              const mapboxId = String(row.mapbox_id).trim();
              if (!scoreMap.has(mapboxId)) {
                scoreMap.set(mapboxId, []);
              }
              scoreMap.get(mapboxId)!.push(row.score);
            }
          }
          
          // Calculate average for each mapbox_id
          for (const [mapboxId, scores] of scoreMap.entries()) {
            const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
            mapboxRankingMap.set(mapboxId, Math.round(avgScore * 10) / 10);
            
            if (__DEV__) {
              console.log(`[enrichRestaurantsWithRankings] Found ranking for mapbox_id: ${mapboxId}, ranking: ${avgScore.toFixed(1)}`);
            }
          }
        }
      } catch (err) {
        if (__DEV__) {
          console.warn('Error fetching Mapbox rankings:', err);
        }
      }
    }

    // Merge rankings into restaurants
    const mergeStart = performance.now();
    const enriched = restaurants.map((r) => {
      // Try to find in OSM restaurants
      const osmItem = osmRestaurants.find(item => item.restaurant.id === r.id);
      if (osmItem) {
        const normalizedOsmId = String(osmItem.osmId).trim();
        const fetchedRanking = osmRankingMap.get(normalizedOsmId);
        const ranking = fetchedRanking !== undefined ? fetchedRanking : (r.top_dish_net_score || 0);
        
        if (__DEV__ && fetchedRanking !== undefined) {
          console.log(`[enrichRestaurantsWithRankings] Found OSM ranking ${fetchedRanking} for ${r.name}`);
        }
        
        return { ...r, top_dish_net_score: ranking };
      }
      
      // Try to find in Mapbox restaurants
      const mapboxItem = mapboxRestaurants.find(item => item.restaurant.id === r.id);
      if (mapboxItem) {
        const normalizedMapboxId = String(mapboxItem.mapboxId).trim();
        const fetchedRanking = mapboxRankingMap.get(normalizedMapboxId);
        const ranking = fetchedRanking !== undefined ? fetchedRanking : (r.top_dish_net_score || 0);
        
        if (__DEV__ && fetchedRanking !== undefined) {
          console.log(`[enrichRestaurantsWithRankings] Found Mapbox ranking ${fetchedRanking} for ${r.name} (mapbox_id: ${normalizedMapboxId})`);
        } else if (__DEV__ && ranking === 0) {
          console.log(`[enrichRestaurantsWithRankings] No ranking found for mapbox_id: ${normalizedMapboxId}, restaurant: ${r.name}`);
        }
        
        return { ...r, top_dish_net_score: ranking };
      }
      
      // Preserve existing ranking if restaurant wasn't in either list
      return { ...r, top_dish_net_score: r.top_dish_net_score || 0 };
    });
    const mergeTime = performance.now() - mergeStart;
    const totalTime = performance.now() - perfStart;
    
    if (__DEV__) {
      console.log(`[PERF] enrichRestaurantsWithRankings: Total ${totalTime.toFixed(2)}ms (Extract: ${extractTime.toFixed(2)}ms, RPC: ${rpcTime.toFixed(2)}ms, Merge: ${mergeTime.toFixed(2)}ms)`);
    }
    
    return enriched;
  } catch (error) {
    const totalTime = performance.now() - perfStart;
    if (__DEV__) {
      console.warn(`[PERF] enrichRestaurantsWithRankings: FAILED after ${totalTime.toFixed(2)}ms:`, error);
    }
    return restaurants;
  }
}

type FetchOptions = {
  signal?: AbortSignal;
};

/**
 * Minimal client-side in-memory cache for search results.
 * Optimized for search-first architecture - small cache, short TTL.
 */
const cache = new Map<string, { expiresAt: number; payload: RestaurantWithRanking[] }>();
const inFlight = new Map<string, Promise<RestaurantWithRanking[]>>();
const CLIENT_CACHE_TTL_MS = 600_000; // 10 minutes - short-lived for instant search results
const CLIENT_CACHE_MAX_ENTRIES = 25; // Small cache - just for recent searches

function stableViewportKey(viewport: ViewportBounds) {
  // Round to ~100m precision for cache hits
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return `${round(viewport.southWestLat)},${round(viewport.southWestLng)},${round(viewport.northEastLat)},${round(viewport.northEastLng)}`;
}

function takeFromCache(key: string): RestaurantWithRanking[] | null {
  const hit = cache.get(key);
  const now = Date.now();
  if (!hit) return null;
  // Only return if not expired
  if (hit.expiresAt <= now) {
    cache.delete(key);
    return null;
  }
  // LRU bump
  cache.delete(key);
  cache.set(key, hit);
  return hit.payload;
}

function putInCache(key: string, payload: RestaurantWithRanking[]) {
  cache.set(key, { expiresAt: Date.now() + CLIENT_CACHE_TTL_MS, payload });
  // Simple LRU eviction - keep memory cache small
  while (cache.size > CLIENT_CACHE_MAX_ENTRIES) {
    const firstKey = cache.keys().next().value as string | undefined;
    if (!firstKey) break;
    cache.delete(firstKey);
  }
}


/**
 * Search for restaurants by name in a given area.
 * This is the primary function for the search-first architecture.
 * 
 * Flow:
 * 1. Check client cache → return instantly if hit
 * 2. Check in-flight requests → return existing promise if found
 * 3. Call Edge Function (which checks server cache)
 * 4. Store result in client cache
 * 5. Enrich with rankings in background
 */
export async function searchRestaurantsInArea(
  viewport: ViewportBounds,
  nameQuery: string,
  options?: FetchOptions
): Promise<RestaurantWithRanking[]> {
  const perfStart = performance.now();
  const q = nameQuery.trim().toLowerCase();
  const key = `search:${stableViewportKey(viewport)}:${q.slice(0, 80)}`;
  
  // Check cache first for instant results
  const cacheCheckStart = performance.now();
  const cached = takeFromCache(key);
  const cacheCheckTime = performance.now() - cacheCheckStart;
  if (cached) {
    const totalTime = performance.now() - perfStart;
    if (__DEV__) {
      console.log(`[PERF] searchRestaurantsInArea: CACHE HIT in ${cacheCheckTime.toFixed(2)}ms (total: ${totalTime.toFixed(2)}ms), query: "${q}"`);
    }
    return cached;
  }

  // Check for in-flight request (deduplication)
  const existing = inFlight.get(key);
  if (existing) {
    if (__DEV__) {
      console.log(`[PERF] searchRestaurantsInArea: IN-FLIGHT REQUEST (cache check: ${cacheCheckTime.toFixed(2)}ms), query: "${q}"`);
    }
    return existing;
  }

  const promise = (async () => {
    try {
      // Overpass has been removed - return empty array
      const result: RestaurantWithRanking[] = [];
      
      // Cache result
      const cacheStart = performance.now();
      putInCache(key, result);
      const cacheTime = performance.now() - cacheStart;
      
      const totalTime = performance.now() - perfStart;
      
      if (__DEV__) {
        console.log(`[PERF] searchRestaurantsInArea: Total ${totalTime.toFixed(2)}ms (Cache check: ${cacheCheckTime.toFixed(2)}ms, Cache write: ${cacheTime.toFixed(2)}ms), query: "${q}", results: ${result.length}`);
      }

      return result;
    } catch (error) {
      // AbortErrors are expected during cleanup - don't log them as errors
      const isAbort = error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'));
      if (__DEV__ && !isAbort) {
        console.warn('[mapService] Search failed:', error);
      }
      throw error;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/**
 * Find restaurants by Mapbox ID (exact match).
 * This is the primary matching strategy for Mapbox search results.
 */
export async function findRestaurantByMapboxId(
  mapboxId: string
): Promise<RestaurantWithRanking[]> {
  if (!mapboxId) {
    return [];
  }

  try {
    // Query dish_rankings table for records with matching mapbox_id
    const { data, error } = await supabase
      .from('dish_rankings')
      .select('osm_id, restaurant_name')
      .eq('mapbox_id', mapboxId)
      .limit(1);

    if (error) {
      if (__DEV__) {
        console.warn('[mapService] Error finding restaurant by mapbox_id:', error);
      }
      return [];
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Extract OSM ID from the first match
    const firstMatch = data[0];
    const osmId = firstMatch.osm_id;

    // Convert OSM ID to restaurant ID format (osm:node:123)
    // We need to determine the type (node/way/relation) - for now, try node first
    const restaurantId = `osm:node:${osmId}`;

    // Create a minimal restaurant object from the dish_rankings data
    // In a full implementation, you might want to fetch full restaurant details
    // For MVP, we'll return a basic structure that can be enriched later
    const restaurant: RestaurantWithRanking = {
      id: restaurantId,
      name: firstMatch.restaurant_name,
      address: null,
      lat: 0, // Will be populated from Mapbox feature
      lng: 0, // Will be populated from Mapbox feature
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      top_dish_net_score: 0, // Will be enriched
    };

    return [restaurant];
  } catch (error) {
    if (__DEV__) {
      console.error('[mapService] Error in findRestaurantByMapboxId:', error);
    }
    return [];
  }
}

/**
 * Simple haversine distance calculation (in kilometers).
 */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

/**
 * Find restaurants by coordinate proximity (fallback matching).
 * Overpass has been removed - this function now returns an empty array.
 */
export async function findRestaurantByCoordinates(
  lat: number,
  lng: number,
  mapboxId: string,
  radiusMeters: number = 50
): Promise<RestaurantWithRanking[]> {
  if (!lat || !lng || !mapboxId) {
    return [];
  }

  // Overpass has been removed - return empty array
  return [];
}

/**
 * Update dish_rankings records with mapbox_id (self-healing).
 */
export async function updateDishRankingsWithMapboxId(
  osmIds: string[],
  mapboxId: string
): Promise<void> {
  if (!osmIds || osmIds.length === 0 || !mapboxId) {
    return;
  }

  try {
    // Update all dish_rankings records matching the OSM IDs
    // Only update records where mapbox_id IS NULL to avoid overwriting existing mappings
    const { error } = await supabase
      .from('dish_rankings')
      .update({ mapbox_id: mapboxId })
      .in('osm_id', osmIds)
      .is('mapbox_id', null);

    if (error) {
      if (__DEV__) {
        console.warn('[mapService] Error updating dish_rankings with mapbox_id:', error);
      }
      return;
    }

    if (__DEV__) {
      console.log(`[mapService] Updated ${osmIds.length} dish_rankings records with mapbox_id: ${mapboxId}`);
    }
  } catch (error) {
    if (__DEV__) {
      console.error('[mapService] Error in updateDishRankingsWithMapboxId:', error);
    }
  }
}

/**
 * DEPRECATED: This function is kept for backward compatibility.
 * Search for restaurants using Mapbox Search Box.
 */
export async function searchRestaurantsWithMapbox(
  query: string,
  proximity?: { latitude: number; longitude: number }
): Promise<RestaurantWithRanking[]> {
  // This function is a placeholder for future Mapbox search integration
  // The actual search is handled by mapboxSearchService and SearchHeader component
  // This function exists for API compatibility
  if (__DEV__) {
    console.warn('[mapService] searchRestaurantsWithMapbox is deprecated. Use mapboxSearchService directly.');
  }
  return [];
}

/**
 * DEPRECATED: Viewport-based fetching is no longer the primary interaction.
 * This function is kept for backward compatibility and recommendation fetching.
 * 
 * For new code, use searchRestaurantsInArea() instead.
 */
export async function fetchRestaurantsInViewport(
  viewport: ViewportBounds,
  options?: FetchOptions
): Promise<RestaurantWithRanking[]> {
  const perfStart = performance.now();
  const key = `browse:${stableViewportKey(viewport)}`;
  
  if (__DEV__) {
    console.log(`[CACHE] fetchRestaurantsInViewport:`, {
      viewport: {
        north: viewport.northEastLat.toFixed(4),
        south: viewport.southWestLat.toFixed(4),
        east: viewport.northEastLng.toFixed(4),
        west: viewport.southWestLng.toFixed(4),
      },
      cacheKey: key,
    });
  }
  
  // Check cache
  const cacheCheckStart = performance.now();
  const cached = takeFromCache(key);
  const cacheCheckTime = performance.now() - cacheCheckStart;
  if (cached) {
    const totalTime = performance.now() - perfStart;
    if (__DEV__) {
      console.log(`[PERF] fetchRestaurantsInViewport: MEMORY CACHE HIT in ${cacheCheckTime.toFixed(2)}ms (total: ${totalTime.toFixed(2)}ms)`);
    }
    return cached;
  }

  // Check for in-flight request
  const existing = inFlight.get(key);
  if (existing) {
    if (__DEV__) {
      console.log(`[PERF] fetchRestaurantsInViewport: IN-FLIGHT REQUEST (cache check: ${cacheCheckTime.toFixed(2)}ms)`);
    }
    return existing;
  }

  const promise = (async () => {
    try {
      // Overpass has been removed - return empty array
      const result: RestaurantWithRanking[] = [];

      // Cache result
      const cacheStart = performance.now();
      putInCache(key, result);
      const cacheTime = performance.now() - cacheStart;
      
      const totalTime = performance.now() - perfStart;
      
      if (__DEV__) {
        console.log(`[PERF] fetchRestaurantsInViewport: Total time ${totalTime.toFixed(2)}ms (Cache write: ${cacheTime.toFixed(2)}ms)`);
      }

      return result;
    } catch (error) {
      const totalTime = performance.now() - perfStart;
      // AbortErrors are expected during cleanup - don't log them as errors
      const isAbort = error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'));
      if (__DEV__ && !isAbort) {
        console.error(`[PERF] fetchRestaurantsInViewport: FAILED after ${totalTime.toFixed(2)}ms:`, error);
      }
      throw error;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}
