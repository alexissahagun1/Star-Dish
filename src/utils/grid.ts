import type { ViewportBounds } from '../types/database';

/**
 * Calculate zoom level from viewport bounds.
 * Uses the latitude span to determine approximate zoom level.
 */
export function calculateZoomFromViewport(viewport: ViewportBounds): number {
  const latSpan = viewport.northEastLat - viewport.southWestLat;
  // Formula: zoom = log2(360 / latSpan)
  // Clamp to reasonable zoom levels (0-20)
  return Math.max(0, Math.min(20, Math.floor(Math.log2(360 / latSpan))));
}

/**
 * Create a grid-based cache key for location-based caching.
 * Uses adaptive grid sizes based on zoom level to ensure proper coverage.
 * 
 * Grid sizes:
 * - Zoom 0-12: 20km grid (city view) - covers entire visible area
 * - Zoom 13-15: 5km grid (neighborhood view) - covers neighborhood
 * - Zoom 16+: 1km grid (street view) - covers blocks
 * 
 * @param lat - Latitude of viewport center
 * @param lng - Longitude of viewport center
 * @param zoom - Zoom level (0-20)
 * @returns Object with cache key and buffer radius in meters
 */
export function createGridCacheKey(
  lat: number,
  lng: number,
  zoom: number
): { key: string; bufferRadius: number } {
  let gridSize: number;
  let keyZoom: number;

  // Adaptive grid based on zoom level
  if (zoom <= 12) {
    // City view: 20km grid covers entire visible area (~40km x 40km at zoom 10)
    gridSize = 0.20; // ~22km
    keyZoom = 10; // Bucket all "City" views together
  } else if (zoom <= 15) {
    // Neighborhood view: 5km grid covers neighborhood
    gridSize = 0.05; // ~5.5km
    keyZoom = 13; // Bucket "Neighborhood" views
  } else {
    // Street view: 1km grid covers blocks
    gridSize = 0.01; // ~1.1km
    keyZoom = 16; // Bucket "Street" views
  }

  // Round to the nearest grid line
  const gridLat = Math.round(lat / gridSize) * gridSize;
  const gridLng = Math.round(lng / gridSize) * gridSize;

  // Buffer is 40% larger than the grid cell to catch edges
  // Convert degrees to meters: 1 degree ≈ 111km
  // For 40% larger: gridSize * 1.4, then divide by 2 for half-radius
  const bufferRadius = (gridSize * 111000 * 1.4) / 2;

  const result = {
    key: `${gridLat.toFixed(3)}:${gridLng.toFixed(3)}:z${keyZoom}`,
    bufferRadius: Math.round(bufferRadius),
  };

  // Debug logging in development
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.log(`[GRID] Cache key created:`, {
      input: { lat: lat.toFixed(4), lng: lng.toFixed(4), zoom },
      grid: { gridLat: gridLat.toFixed(3), gridLng: gridLng.toFixed(3), gridSize: gridSize.toFixed(3), keyZoom },
      output: { key: result.key, bufferRadius: result.bufferRadius },
    });
  }

  return result;
}

/**
 * Expand viewport by buffer radius to ensure edge users see nearby pins.
 * 
 * @param viewport - Original viewport bounds
 * @param bufferRadiusMeters - Buffer radius in meters
 * @returns Expanded viewport bounds
 */
export function expandViewportWithBuffer(
  viewport: ViewportBounds,
  bufferRadiusMeters: number
): ViewportBounds {
  // Convert meters to degrees: 1 degree ≈ 111km
  const bufferDeg = bufferRadiusMeters / 111000;

  // Calculate center
  const centerLat = (viewport.northEastLat + viewport.southWestLat) / 2;
  const centerLng = (viewport.northEastLng + viewport.southWestLng) / 2;

  // Expand viewport by buffer
  return {
    northEastLat: centerLat + bufferDeg,
    southWestLat: centerLat - bufferDeg,
    northEastLng: centerLng + bufferDeg,
    southWestLng: centerLng - bufferDeg,
  };
}
