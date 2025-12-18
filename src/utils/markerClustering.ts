import Supercluster from 'supercluster';
import type { RestaurantWithRanking } from '../types/database';

/**
 * GeoJSON Feature type for Supercluster
 */
type GeoJSONFeature = {
  type: 'Feature';
  properties: { restaurant: RestaurantWithRanking };
  geometry: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
};

/**
 * Cluster point returned by Supercluster
 */
export type ClusterPoint = {
  type: 'Feature';
  properties: {
    cluster: boolean;
    cluster_id: number;
    point_count: number;
    point_count_abbreviated: string;
  };
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
};

/**
 * Individual marker point (not clustered)
 */
export type MarkerPoint = {
  type: 'Feature';
  properties: { restaurant: RestaurantWithRanking };
  geometry: {
    type: 'Point';
    coordinates: [number, number];
  };
};

/**
 * Union type for clustered data
 */
export type ClusteredPoint = ClusterPoint | MarkerPoint;

/**
 * Check if a point is a cluster
 */
export function isCluster(point: ClusteredPoint): point is ClusterPoint {
  return 'cluster' in point.properties && (point.properties as any).cluster === true;
}

/**
 * Supercluster instance type
 */
export type SuperClusterInstance = Supercluster<GeoJSONFeature['properties'], GeoJSONFeature['geometry']>;

/**
 * Create a Supercluster instance from restaurant data
 */
export function createClusterer(restaurants: RestaurantWithRanking[]): SuperClusterInstance {
  // Convert restaurants to GeoJSON format required by Supercluster
  const features: GeoJSONFeature[] = restaurants
    .filter((r) => r && typeof r.lat === 'number' && typeof r.lng === 'number')
    .map((r) => ({
      type: 'Feature' as const,
      properties: { restaurant: r },
      geometry: {
        type: 'Point' as const,
        coordinates: [r.lng, r.lat], // Supercluster expects [lng, lat]
      },
    }));

  // Create and configure Supercluster instance
  // Match web version settings for consistent behavior
  const clusterer = new Supercluster<GeoJSONFeature['properties'], GeoJSONFeature['geometry']>({
    radius: 60, // pixels - distance threshold for clustering
    maxZoom: 18, // don't cluster above this zoom level
    minZoom: 0, // cluster at all zoom levels below maxZoom
    minPoints: 2, // minimum points to form a cluster - lower value means more clusters visible at initial zoom
  });

  // Load features into clusterer
  clusterer.load(features);

  return clusterer;
}

/**
 * Get clustered markers for the current viewport
 * @param clusterer - Supercluster instance
 * @param viewport - Current map viewport bounds
 * @param zoom - Current zoom level (calculated from latitudeDelta)
 */
export function getClusteredMarkers(
  clusterer: SuperClusterInstance,
  viewport: {
    northEastLat: number;
    southWestLat: number;
    northEastLng: number;
    southWestLng: number;
  },
  zoom: number
): ClusteredPoint[] {
  // Add padding to viewport to prevent markers from disappearing at edges when panning/zooming
  // This ensures markers stay visible during map operations (like Google Maps)
  // Increased padding to 2.0 (200%) to ensure pins never disappear when zooming/panning
  const latSpan = viewport.northEastLat - viewport.southWestLat;
  const lngSpan = viewport.northEastLng - viewport.southWestLng;
  const padding = 2.0; // 200% padding on all sides - ensures pins stay visible during all zoom/pan operations
  const latPadding = latSpan * padding;
  const lngPadding = lngSpan * padding;
  
  // Convert viewport to bounding box [west, south, east, north] with padding
  const bbox: [number, number, number, number] = [
    viewport.southWestLng - lngPadding, // west (extended)
    viewport.southWestLat - latPadding, // south (extended)
    viewport.northEastLng + lngPadding, // east (extended)
    viewport.northEastLat + latPadding, // north (extended)
  ];

  // Get clusters for the current viewport and zoom level
  const clusters = clusterer.getClusters(bbox, Math.floor(zoom));

  // Transform Supercluster output to match our type
  return clusters.map((cluster) => {
    // Type guard: check if it's a cluster by checking for cluster property
    const isCluster = 'cluster' in cluster.properties && cluster.properties.cluster === true;
    
    if (isCluster) {
      // It's a cluster
      const clusterProps = cluster.properties as any;
      return {
        type: 'Feature' as const,
        properties: {
          cluster: true,
          cluster_id: clusterProps.cluster_id,
          point_count: clusterProps.point_count,
          point_count_abbreviated: clusterProps.point_count_abbreviated || clusterProps.point_count.toString(),
        },
        geometry: {
          type: 'Point' as const,
          coordinates: cluster.geometry.coordinates,
        },
      } as ClusterPoint;
    } else {
      // It's an individual point
      const pointProps = cluster.properties as any;
      return {
        type: 'Feature' as const,
        properties: {
          restaurant: pointProps.restaurant as RestaurantWithRanking,
        },
        geometry: {
          type: 'Point' as const,
          coordinates: cluster.geometry.coordinates,
        },
      } as MarkerPoint;
    }
  });
}

/**
 * Calculate zoom level from latitudeDelta
 * This is an approximation - actual zoom calculation depends on map projection
 */
export function calculateZoomFromLatitudeDelta(latitudeDelta: number): number {
  // Approximate formula: zoom = log2(360 / latitudeDelta)
  // This gives reasonable results for most use cases
  const zoom = Math.log2(360 / latitudeDelta);
  // Clamp to reasonable zoom range (0-20)
  return Math.max(0, Math.min(20, zoom));
}
