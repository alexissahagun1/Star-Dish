import { SearchBoxCore, SessionToken, type SearchBoxSuggestion } from '@mapbox/search-js-core';
import type { MapboxSuggestion, MapboxFeature } from '../types/database';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

if (!MAPBOX_TOKEN) {
  console.warn('EXPO_PUBLIC_MAPBOX_TOKEN is not set. Mapbox Search will not work.');
}

// Initialize SearchBoxCore instance
let searchInstance: SearchBoxCore | null = null;

export interface SearchAutocompleteOptions {
  proximity?: { latitude: number; longitude: number };
  limit?: number;
}

/**
 * Result type that includes both the transformed suggestion and the original SearchBoxSuggestion
 * so we can pass the original to retrieve() for proper session tracking.
 */
export interface SearchAutocompleteResult {
  suggestion: MapboxSuggestion;
  original: SearchBoxSuggestion;
}

/**
 * Client-side in-memory cache for Mapbox autocomplete API calls.
 * Reduces API calls and improves response time for repeated queries.
 */
const autocompleteCache = new Map<string, { expiresAt: number; payload: SearchAutocompleteResult[] }>();
const autocompleteInFlight = new Map<string, Promise<{ results: SearchAutocompleteResult[]; sessionToken: SessionToken }>>();
const AUTOCOMPLETE_CACHE_TTL_MS = 600_000; // 10 minutes - same as restaurant search cache
const AUTOCOMPLETE_CACHE_MAX_ENTRIES = 50; // Larger cache for autocomplete (more queries expected)

function createCacheKey(query: string, proximity?: { latitude: number; longitude: number }): string {
  const trimmedQuery = query.trim().toLowerCase();
  if (proximity) {
    // Round proximity to ~100m precision for cache hits
    const round = (n: number) => Math.round(n * 1000) / 1000;
    return `autocomplete:${trimmedQuery}:${round(proximity.latitude)},${round(proximity.longitude)}`;
  }
  return `autocomplete:${trimmedQuery}`;
}

function takeFromAutocompleteCache(key: string): SearchAutocompleteResult[] | null {
  const hit = autocompleteCache.get(key);
  const now = Date.now();
  if (!hit) return null;
  // Only return if not expired
  if (hit.expiresAt <= now) {
    autocompleteCache.delete(key);
    return null;
  }
  // LRU bump
  autocompleteCache.delete(key);
  autocompleteCache.set(key, hit);
  return hit.payload;
}

function putInAutocompleteCache(key: string, payload: SearchAutocompleteResult[]) {
  autocompleteCache.set(key, { expiresAt: Date.now() + AUTOCOMPLETE_CACHE_TTL_MS, payload });
  // Simple LRU eviction - keep memory cache manageable
  while (autocompleteCache.size > AUTOCOMPLETE_CACHE_MAX_ENTRIES) {
    const firstKey = autocompleteCache.keys().next().value as string | undefined;
    if (!firstKey) break;
    autocompleteCache.delete(firstKey);
  }
}

function getSearchInstance(): SearchBoxCore {
  if (!MAPBOX_TOKEN) {
    throw new Error('Mapbox token is not configured. Set EXPO_PUBLIC_MAPBOX_TOKEN.');
  }

  if (!searchInstance) {
    searchInstance = new SearchBoxCore({
      accessToken: MAPBOX_TOKEN,
    });
  }

  return searchInstance;
}

/**
 * Search for restaurant suggestions using Mapbox Autocomplete API.
 * Configured for POI types in Mexico with Spanish language.
 * Returns both transformed suggestions and original SearchBoxSuggestion objects for retrieve().
 * 
 * Flow:
 * 1. Check client cache → return instantly if hit
 * 2. Check in-flight requests → return existing promise if found
 * 3. Call Mapbox Autocomplete API
 * 4. Store result in client cache
 * 
 * @param sessionToken Optional session token. If not provided, a new one will be created.
 *                     For proper billing, use the same token for both suggest() and retrieve().
 */
export async function searchAutocomplete(
  query: string,
  options?: SearchAutocompleteOptions,
  sessionToken?: SessionToken
): Promise<{ results: SearchAutocompleteResult[]; sessionToken: SessionToken }> {
  if (!query || query.trim().length < 2) {
    // For empty queries, reuse provided token or return empty (don't create new token)
    const token = sessionToken || new SessionToken();
    return { results: [], sessionToken: token };
  }

  const perfStart = performance.now();
  const cacheKey = createCacheKey(query, options?.proximity);

  // Check cache first for instant results
  const cacheCheckStart = performance.now();
  const cached = takeFromAutocompleteCache(cacheKey);
  const cacheCheckTime = performance.now() - cacheCheckStart;
  if (cached) {
    // For cached results, reuse provided token (don't create new one - this prevents unnecessary sessions)
    // If no token provided, we still need to return one, but this shouldn't count as a session
    const token = sessionToken || new SessionToken();
    const totalTime = performance.now() - perfStart;
    if (__DEV__) {
      console.log(`[PERF] searchAutocomplete: CACHE HIT in ${cacheCheckTime.toFixed(2)}ms (total: ${totalTime.toFixed(2)}ms), query: "${query.trim()}"`);
    }
    return { results: cached, sessionToken: token };
  }

  // Check for in-flight request (deduplication)
  const existing = autocompleteInFlight.get(cacheKey);
  if (existing) {
    if (__DEV__) {
      console.log(`[PERF] searchAutocomplete: IN-FLIGHT REQUEST (cache check: ${cacheCheckTime.toFixed(2)}ms), query: "${query.trim()}"`);
    }
    return existing;
  }

  const promise = (async () => {
    try {
      const search = getSearchInstance();
      const trimmedQuery = query.trim();

      // Use provided session token or create a new one (required for billing)
      const token = sessionToken || new SessionToken();

      // Build proximity parameter if provided (format: [lng, lat])
      const proximity = options?.proximity
        ? [options.proximity.longitude, options.proximity.latitude]
        : undefined;

      // Call Mapbox Autocomplete API
      const apiStart = performance.now();
      const response = await search.suggest(trimmedQuery, {
        sessionToken: token,
        proximity,
        types: 'poi', // Point of Interest only (string, not array)
        country: 'mx', // Mexico only (string, not array)
        language: 'es', // Spanish - ensures "Ciudad de México" instead of "Mexico City"
        limit: options?.limit ?? 10,
      });
      const apiTime = performance.now() - apiStart;

      if (!response || !response.suggestions) {
        const result = { results: [], sessionToken: token };
        // Cache empty results too (short-lived)
        putInAutocompleteCache(cacheKey, []);
        return result;
      }

      // Transform Mapbox suggestions to our format while preserving originals
      const results = response.suggestions.map((originalSuggestion) => {
        // Extract neighborhood/context from suggestion
        // Context is an object with keys like 'neighborhood', 'place', etc.
        // Each value is a ContextEntry with { id, name }
        const context: Array<{ id: string; text: string; short_code?: string }> = [];
        if (originalSuggestion.context) {
          if (originalSuggestion.context.neighborhood) {
            context.push({
              id: 'neighborhood',
              text: originalSuggestion.context.neighborhood.name || '',
            });
          }
          if (originalSuggestion.context.place) {
            context.push({
              id: 'place',
              text: originalSuggestion.context.place.name || '',
            });
          }
          if (originalSuggestion.context.locality) {
            context.push({
              id: 'locality',
              text: originalSuggestion.context.locality.name || '',
            });
          }
          if (originalSuggestion.context.district) {
            context.push({
              id: 'district',
              text: originalSuggestion.context.district.name || '',
            });
          }
          if (originalSuggestion.context.region) {
            context.push({
              id: 'region',
              text: originalSuggestion.context.region.name || '',
              short_code: originalSuggestion.context.region.region_code,
            });
          }
          if (originalSuggestion.context.country) {
            context.push({
              id: 'country',
              text: originalSuggestion.context.country.name || '',
              short_code: originalSuggestion.context.country.country_code,
            });
          }
        }

        // Build full address from place_formatted or full_address
        const fullAddress = originalSuggestion.full_address || originalSuggestion.place_formatted || '';

        const transformed: MapboxSuggestion = {
          mapbox_id: originalSuggestion.mapbox_id || '',
          name: originalSuggestion.name || '',
          full_address: fullAddress,
          place_name: originalSuggestion.place_formatted || fullAddress,
          context,
        };

        return {
          suggestion: transformed,
          original: originalSuggestion,
        };
      });

      // Cache result
      const cacheStart = performance.now();
      putInAutocompleteCache(cacheKey, results);
      const cacheTime = performance.now() - cacheStart;

      const totalTime = performance.now() - perfStart;
      if (__DEV__) {
        console.log(`[PERF] searchAutocomplete: Total ${totalTime.toFixed(2)}ms (Cache check: ${cacheCheckTime.toFixed(2)}ms, API: ${apiTime.toFixed(2)}ms, Cache write: ${cacheTime.toFixed(2)}ms), query: "${trimmedQuery}", results: ${results.length}`);
      }

      return { results, sessionToken: token };
    } catch (error) {
      if (__DEV__) {
        console.error('[mapboxSearchService] Autocomplete error:', error);
      }
      throw error;
    } finally {
      autocompleteInFlight.delete(cacheKey);
    }
  })();

  autocompleteInFlight.set(cacheKey, promise);
  return promise;
}

/**
 * Retrieve full feature details including coordinates for a selected suggestion.
 * Requires the original SearchBoxSuggestion object for proper session tracking.
 */
export async function retrieveFeature(
  originalSuggestion: SearchBoxSuggestion,
  sessionToken?: SessionToken
): Promise<MapboxFeature | null> {
  if (!originalSuggestion) {
    return null;
  }

  try {
    const search = getSearchInstance();

    // Create session token if not provided (for backward compatibility)
    const token = sessionToken || new SessionToken();

    // Call Mapbox Retrieve API - requires the original SearchBoxSuggestion object
    const response = await search.retrieve(originalSuggestion, {
      sessionToken: token,
      language: 'es', // Spanish language for addresses
    });

    if (!response || !response.features || response.features.length === 0) {
      return null;
    }

    const feature = response.features[0];

    // Extract coordinates (Mapbox uses [lng, lat] format)
    const coordinates = feature.geometry?.coordinates || [];
    if (coordinates.length < 2) {
      return null;
    }

    return {
      mapbox_id: originalSuggestion.mapbox_id,
      type: feature.type || 'Feature',
      geometry: {
        type: feature.geometry?.type || 'Point',
        coordinates: [coordinates[0], coordinates[1]], // [lng, lat]
      },
      properties: {
        name: feature.properties?.name || originalSuggestion.name || '',
        address: feature.properties?.address || feature.properties?.full_address || '',
        category: feature.properties?.poi_category?.[0] || '',
        maki: feature.properties?.maki || originalSuggestion.maki || '',
        ...feature.properties,
      },
      place_name: feature.properties?.place_formatted || feature.properties?.full_address || originalSuggestion.place_formatted || '',
    };
  } catch (error) {
    if (__DEV__) {
      console.error('[mapboxSearchService] Retrieve error:', error);
    }
    throw error;
  }
}

/**
 * Client-side in-memory cache for reverse geocoding API calls.
 * Reduces API calls and improves response time for repeated coordinates.
 */
const reverseGeocodeCache = new Map<string, { expiresAt: number; payload: string | null }>();
const reverseGeocodeInFlight = new Map<string, Promise<string | null>>();
const REVERSE_GEOCODE_CACHE_TTL_MS = 600_000; // 10 minutes - same as autocomplete cache
const REVERSE_GEOCODE_CACHE_MAX_ENTRIES = 50;

function createReverseGeocodeCacheKey(lat: number, lng: number): string {
  // Round coordinates to ~100m precision for cache hits (same as autocomplete proximity rounding)
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return `reverse:${round(lat)},${round(lng)}`;
}

function takeFromReverseGeocodeCache(key: string): string | null | undefined {
  const hit = reverseGeocodeCache.get(key);
  const now = Date.now();
  if (!hit) return undefined;
  // Only return if not expired
  if (hit.expiresAt <= now) {
    reverseGeocodeCache.delete(key);
    return undefined;
  }
  // LRU bump
  reverseGeocodeCache.delete(key);
  reverseGeocodeCache.set(key, hit);
  return hit.payload;
}

function putInReverseGeocodeCache(key: string, payload: string | null) {
  reverseGeocodeCache.set(key, { expiresAt: Date.now() + REVERSE_GEOCODE_CACHE_TTL_MS, payload });
  // Simple LRU eviction - keep memory cache manageable
  while (reverseGeocodeCache.size > REVERSE_GEOCODE_CACHE_MAX_ENTRIES) {
    const firstKey = reverseGeocodeCache.keys().next().value as string | undefined;
    if (!firstKey) break;
    reverseGeocodeCache.delete(firstKey);
  }
}

/**
 * Reverse geocode coordinates to get address/city information using Mapbox Geocoding API.
 * Includes caching and deduplication to reduce API calls.
 * @param lat Latitude
 * @param lng Longitude
 * @returns City/address label or null if geocoding fails
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<string | null> {
  if (!MAPBOX_TOKEN) {
    if (__DEV__) {
      console.warn('[mapboxSearchService] Mapbox token not configured. Reverse geocoding unavailable.');
    }
    return null;
  }

  const cacheKey = createReverseGeocodeCacheKey(lat, lng);

  // Check cache first for instant results
  const cached = takeFromReverseGeocodeCache(cacheKey);
  if (cached !== undefined) {
    if (__DEV__) {
      console.log(`[PERF] reverseGeocode: CACHE HIT, lat: ${lat}, lng: ${lng}`);
    }
    return cached;
  }

  // Check for in-flight request (deduplication)
  const existing = reverseGeocodeInFlight.get(cacheKey);
  if (existing) {
    if (__DEV__) {
      console.log(`[PERF] reverseGeocode: IN-FLIGHT REQUEST, lat: ${lat}, lng: ${lng}`);
    }
    return existing;
  }

  const promise = (async () => {
    try {
      // Mapbox Geocoding API reverse endpoint: https://api.mapbox.com/geocoding/v5/{endpoint}/{longitude},{latitude}.json
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&language=es&types=place,locality,neighborhood&limit=1`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        if (__DEV__) {
          console.warn(`[mapboxSearchService] Reverse geocoding failed: ${response.status} ${response.statusText}`);
        }
        const result = null;
        // Cache null results too (short-lived)
        putInReverseGeocodeCache(cacheKey, result);
        return result;
      }

      const data = await response.json();
      
      if (!data.features || data.features.length === 0) {
        const result = null;
        putInReverseGeocodeCache(cacheKey, result);
        return result;
      }

      const feature = data.features[0];
      const context = feature.context || [];
      
      // Extract city/place information from context
      // Mapbox context structure: [{ id: 'place.123', text: 'City Name' }, ...]
      const place = context.find((c: any) => c.id?.startsWith('place.'));
      const locality = context.find((c: any) => c.id?.startsWith('locality.'));
      const region = context.find((c: any) => c.id?.startsWith('region.'));
      
      const city = place?.text || locality?.text || feature.text;
      const state = region?.text;
      
      let result: string | null = null;
      if (city && state) {
        result = `${city}, ${state}`;
      } else if (city) {
        result = city;
      } else if (state) {
        result = state;
      } else {
        // Fallback to place_name if available
        result = feature.place_name || null;
      }

      // Cache result
      putInReverseGeocodeCache(cacheKey, result);
      
      if (__DEV__) {
        console.log(`[PERF] reverseGeocode: API CALL, lat: ${lat}, lng: ${lng}, result: ${result}`);
      }

      return result;
    } catch (error) {
      if (__DEV__) {
        console.error('[mapboxSearchService] Reverse geocoding error:', error);
      }
      // Cache null on error too
      putInReverseGeocodeCache(cacheKey, null);
      return null;
    } finally {
      reverseGeocodeInFlight.delete(cacheKey);
    }
  })();

  reverseGeocodeInFlight.set(cacheKey, promise);
  return promise;
}

/**
 * Client-side in-memory cache for forward geocoding API calls.
 * Reduces API calls for repeated city/place queries.
 */
const forwardGeocodeCache = new Map<string, { expiresAt: number; payload: { bbox: { southWestLat: number; northEastLat: number; southWestLng: number; northEastLng: number }; displayName: string } | null }>();
const forwardGeocodeInFlight = new Map<string, Promise<{ bbox: { southWestLat: number; northEastLat: number; southWestLng: number; northEastLng: number }; displayName: string } | null>>();
const FORWARD_GEOCODE_CACHE_TTL_MS = 600_000; // 10 minutes - same as other caches
const FORWARD_GEOCODE_CACHE_MAX_ENTRIES = 50;

function createForwardGeocodeCacheKey(query: string): string {
  return `forward:${query.trim().toLowerCase()}`;
}

function takeFromForwardGeocodeCache(key: string): { bbox: { southWestLat: number; northEastLat: number; southWestLng: number; northEastLng: number }; displayName: string } | null | undefined {
  const hit = forwardGeocodeCache.get(key);
  const now = Date.now();
  if (!hit) return undefined;
  // Only return if not expired
  if (hit.expiresAt <= now) {
    forwardGeocodeCache.delete(key);
    return undefined;
  }
  // LRU bump
  forwardGeocodeCache.delete(key);
  forwardGeocodeCache.set(key, hit);
  return hit.payload;
}

function putInForwardGeocodeCache(
  key: string,
  payload: { bbox: { southWestLat: number; northEastLat: number; southWestLng: number; northEastLng: number }; displayName: string } | null
) {
  forwardGeocodeCache.set(key, { expiresAt: Date.now() + FORWARD_GEOCODE_CACHE_TTL_MS, payload });
  // Simple LRU eviction - keep memory cache manageable
  while (forwardGeocodeCache.size > FORWARD_GEOCODE_CACHE_MAX_ENTRIES) {
    const firstKey = forwardGeocodeCache.keys().next().value as string | undefined;
    if (!firstKey) break;
    forwardGeocodeCache.delete(firstKey);
  }
}

/**
 * Forward geocode a query string to get bounding box using Mapbox Geocoding API.
 * Includes caching and deduplication to reduce API calls.
 * @param query Search query (e.g., city name)
 * @returns Bounding box and display name, or null if geocoding fails
 */
export async function forwardGeocode(
  query: string
): Promise<{ bbox: { southWestLat: number; northEastLat: number; southWestLng: number; northEastLng: number }; displayName: string } | null> {
  if (!MAPBOX_TOKEN) {
    if (__DEV__) {
      console.warn('[mapboxSearchService] Mapbox token not configured. Forward geocoding unavailable.');
    }
    return null;
  }

  const cacheKey = createForwardGeocodeCacheKey(query);

  // Check cache first for instant results
  const cached = takeFromForwardGeocodeCache(cacheKey);
  if (cached !== undefined) {
    if (__DEV__) {
      console.log(`[PERF] forwardGeocode: CACHE HIT, query: "${query}"`);
    }
    return cached;
  }

  // Check for in-flight request (deduplication)
  const existing = forwardGeocodeInFlight.get(cacheKey);
  if (existing) {
    if (__DEV__) {
      console.log(`[PERF] forwardGeocode: IN-FLIGHT REQUEST, query: "${query}"`);
    }
    return existing;
  }

  const promise = (async () => {
    try {
      // Mapbox Geocoding API forward endpoint: https://api.mapbox.com/geocoding/v5/{endpoint}/{search_text}.json
      const encodedQuery = encodeURIComponent(query.trim());
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedQuery}.json?access_token=${MAPBOX_TOKEN}&language=es&types=place,locality&limit=1`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        if (__DEV__) {
          console.warn(`[mapboxSearchService] Forward geocoding failed: ${response.status} ${response.statusText}`);
        }
        const result = null;
        // Cache null results too (short-lived)
        putInForwardGeocodeCache(cacheKey, result);
        return result;
      }

      const data = await response.json();
      
      if (!data.features || data.features.length === 0) {
        const result = null;
        putInForwardGeocodeCache(cacheKey, result);
        return result;
      }

      const feature = data.features[0];
      
      // Mapbox bbox format: [minLng, minLat, maxLng, maxLat]
      const bbox = feature.bbox;
      let result: { bbox: { southWestLat: number; northEastLat: number; southWestLng: number; northEastLng: number }; displayName: string } | null = null;
      
      if (!bbox || !Array.isArray(bbox) || bbox.length !== 4) {
        // Fallback: calculate bbox from geometry if available
        const geometry = feature.geometry;
        if (geometry && geometry.coordinates) {
          const [lng, lat] = geometry.coordinates;
          // Create a small bounding box around the point
          const delta = 0.1;
          result = {
            bbox: {
              southWestLat: lat - delta,
              northEastLat: lat + delta,
              southWestLng: lng - delta,
              northEastLng: lng + delta,
            },
            displayName: feature.place_name || feature.text || query,
          };
        } else {
          result = null;
        }
      } else {
        const [minLng, minLat, maxLng, maxLat] = bbox;
        result = {
          bbox: {
            southWestLat: minLat,
            northEastLat: maxLat,
            southWestLng: minLng,
            northEastLng: maxLng,
          },
          displayName: feature.place_name || feature.text || query,
        };
      }

      // Cache result
      putInForwardGeocodeCache(cacheKey, result);
      
      if (__DEV__) {
        console.log(`[PERF] forwardGeocode: API CALL, query: "${query}", result: ${result ? result.displayName : 'null'}`);
      }

      return result;
    } catch (error) {
      if (__DEV__) {
        console.error('[mapboxSearchService] Forward geocoding error:', error);
      }
      // Cache null on error too
      putInForwardGeocodeCache(cacheKey, null);
      return null;
    } finally {
      forwardGeocodeInFlight.delete(cacheKey);
    }
  })();

  forwardGeocodeInFlight.set(cacheKey, promise);
  return promise;
}
