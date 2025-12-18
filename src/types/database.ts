export type UUID = string;
export type IsoDateTime = string;

export type VoteType = 'UP' | 'DOWN';

export interface Profile {
  id: UUID;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface Restaurant {
  id: UUID;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;

  /**
   * Optional metadata (typically sourced from OSM or a future POI provider).
   * These fields may be null/undefined depending on data availability.
   */
  establishment_type?: string | null; // e.g. restaurant, cafe, fast_food, bar, pub
  cuisine?: string | null; // OSM cuisine tag (often semicolon-separated)
  opening_hours?: string | null; // OSM opening_hours tag
  phone?: string | null;
  website?: string | null;

  // Structured address parts (OSM addr:* tags)
  address_housenumber?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_postcode?: string | null;
  address_country?: string | null;
}

export interface Platillo {
  id: UUID;
  restaurant_id: UUID;
  name: string;
  description: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface Review {
  id: UUID;
  user_id: UUID;
  restaurant_id: UUID;
  rating: number; // 1..5 (enforced in DB)
  content: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface Vote {
  id: UUID;
  user_id: UUID;
  platillo_id: UUID;
  vote_type: VoteType;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// Map query shapes
export type ViewportBounds = {
  northEastLat: number;
  northEastLng: number;
  southWestLat: number;
  southWestLng: number;
};

export type RestaurantWithRanking = Restaurant & {
  top_dish_net_score: number;
};

// RPC result shapes
// get_star_dish(restaurant_id) returns a single platillo UUID (or null if none).
export type GetStarDishResult = UUID | null;

// Optional: get_dish_ranking_for_restaurant returns SETOF jsonb.
export type DishRankingRow = {
  platillo_id: UUID;
  name: string;
  net_score: number;
};

// User-submitted dish ranking (stored in dish_rankings table).
export interface DishRanking {
  id: UUID;
  user_id: UUID;
  osm_id: string;
  restaurant_name: string;
  dish_name: string;
  price_cents: number | null;
  ingredients: string | null;
  score: number; // 0-10
  image_url: string | null;
  mapbox_id?: string | null; // Mapbox feature ID (e.g., poi.123456789) for exact matching
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// Input shape for submitting a new dish ranking (omits server-generated fields).
export type DishRankingInput = {
  osm_id: string;
  restaurant_name: string;
  dish_name: string;
  price_cents?: number | null;
  ingredients?: string | null;
  score: number;
  image_url?: string | null;
  mapbox_id?: string | null;
};

// Mapbox Search types
export interface MapboxSuggestion {
  mapbox_id: string; // Feature ID (e.g., "poi.123456789")
  name: string; // Restaurant name
  full_address: string; // Full address string
  place_name: string; // Formatted place name (e.g., "Restaurant Name, Neighborhood, City")
  context?: Array<{
    id: string;
    text: string;
    short_code?: string;
  }>; // Context array (neighborhood, city, etc.)
}

export interface MapboxFeature {
  mapbox_id: string; // Feature ID
  type: string; // Feature type (usually "Feature")
  geometry: {
    type: string; // Usually "Point"
    coordinates: [number, number]; // [longitude, latitude]
  };
  properties: {
    name: string;
    address?: string;
    category?: string;
    maki?: string; // Icon name
    [key: string]: unknown; // Other properties
  };
  place_name: string; // Full formatted place name
}



