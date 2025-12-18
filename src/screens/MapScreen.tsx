// Native-only MapScreen using react-native-maps (Apple Maps on iOS, Google Maps on Android)
// Web version is in MapScreen.web.tsx using react-map-gl
import React, { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { ActivityIndicator, Alert, Image, Keyboard, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import MapView, { Marker, Region, Circle } from 'react-native-maps';

// Define ViewState type manually for TypeScript
interface ViewState {
  latitude: number;
  longitude: number;
  zoom: number;
  bearing?: number;
  pitch?: number;
  padding?: { top: number; bottom: number; left: number; right: number };
}
import BottomSheet, { BottomSheetBackdrop, BottomSheetFlatList, BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';

import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

import { Screen } from '../components/Screen';
import { AuthErrorModal, SDButton, SDText, SkeletonBlock } from '../components/ui';
import type { RootTabParamList } from '../navigation/RootTabs';
import { useDebounce } from '../hooks/useDebounce';
import { getUserLocationBestEffort } from '../lib/location';
import { lightHaptic } from '../lib/haptics';
import { supabase } from '../lib/supabase';
import { useMapFocus } from '../state/MapFocusContext';
import { useSearch } from '../state/SearchContext';
import { theme } from '../theme';
import { fetchRestaurantsInViewport, searchRestaurantsInArea, findRestaurantByMapboxId, findRestaurantByCoordinates, enrichRestaurantsWithRankings } from '../services/mapService';
import { trackRestaurantView, extractOsmId, getRecentlyViewedRestaurants, getTopPicks, getBestRated, fetchRestaurantsForRecommendations } from '../services/recommendationService';
import { RecommendationsList } from '../components/RecommendationsList';
import { SearchResultsList } from '../components/SearchResultsList';
import { RestaurantCardList } from '../components/RestaurantCardList';
import { SearchHeader } from '../components/SearchHeader';
import { DishImageCarousel } from '../components/DishImageCarousel';
import { submitDishRanking, getDishRankingsForRestaurant } from '../services/dishRankingService';
import { uploadDishPhoto } from '../services/storageService';
import type { RestaurantWithRanking, ViewportBounds, DishRanking, MapboxFeature } from '../types/database';
import {
  calculateZoomFromLatitudeDelta,
  createClusterer,
  getClusteredMarkers,
  isCluster,
  type ClusteredPoint,
} from '../utils/markerClustering';
import type { SuperClusterInstance } from '../utils/markerClustering';
import { ClusterMarker } from '../components/ClusterMarker';

// Conditional imports for web platform (react-map-gl)
let WebMap: any = null;
let WebMarker: any = null;
let WebMarkerComponent: any = null;
let WebClusterMarkerComponent: any = null;

if (Platform.OS === 'web') {
  try {
    // @ts-ignore - Metro bundler compatibility
    const { Map, Marker } = require('react-map-gl/mapbox');
    WebMap = Map;
    WebMarker = Marker;
    // Web marker components are defined inline in MapScreen.web.tsx
    // For native file, we'll use a simple fallback - these should not be used on native
    WebMarkerComponent = null;
    WebClusterMarkerComponent = null;
  } catch (e) {
    if (__DEV__) {
      console.warn('[MapScreen] Failed to load react-map-gl:', e);
    }
  }
}

// Native cluster marker component wrapper
const NativeClusterMarkerComponent = React.memo(function NativeClusterMarkerComponent({
  cluster,
  onPress,
}: {
  cluster: ClusteredPoint;
  onPress: (cluster: ClusteredPoint) => void;
}) {
  // Convert ClusteredPoint to ClusterPoint format expected by ClusterMarker
  const clusterPoint = cluster as any; // ClusterMarker expects ClusterPoint which is compatible
  return <ClusterMarker cluster={clusterPoint} onPress={onPress} />;
});

// Mapbox token is only required for:
// - Web map rendering (react-map-gl)
// - Mapbox search API calls (@mapbox/search-js-core)
// Native maps (react-native-maps) use Apple Maps (iOS) / Google Maps (Android) - no token needed
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

// Extract marker styles to constants to prevent re-creation on every render
const markerStyles = {
  container: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'white',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  inner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'white',
  },
};

function viewportBoundsToViewState(viewport: ViewportBounds): ViewState {
  const centerLat = (viewport.northEastLat + viewport.southWestLat) / 2;
  const centerLng = (viewport.northEastLng + viewport.southWestLng) / 2;
  const latDelta = viewport.northEastLat - viewport.southWestLat;
  const lngDelta = viewport.northEastLng - viewport.southWestLng;
  
  // Approximate zoom level from delta (rough calculation)
  const latZoom = Math.log2(360 / latDelta);
  const lngZoom = Math.log2(360 / lngDelta);
  const zoom = Math.min(latZoom, lngZoom);
  
  return {
    latitude: centerLat,
    longitude: centerLng,
    zoom: Math.max(10, Math.min(18, zoom)),
    bearing: 0,
    pitch: 0,
    padding: { top: 0, bottom: 0, left: 0, right: 0 },
  };
}

function viewStateToViewportBounds(viewState: ViewState): ViewportBounds {
  const lat = viewState.latitude;
  const lng = viewState.longitude;
  const zoom = viewState.zoom;
  
  // Calculate bounds from zoom level
  const latDelta = 360 / Math.pow(2, zoom);
  const lngDelta = 360 / Math.pow(2, zoom);
  
  return {
    northEastLat: lat + latDelta / 2,
    northEastLng: lng + lngDelta / 2,
    southWestLat: lat - latDelta / 2,
    southWestLng: lng - lngDelta / 2,
  };
}

type CuisineCategory = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

const CUISINE_CATEGORIES: CuisineCategory[] = [
  { id: 'all', label: 'All', icon: 'grid-outline' },
  { id: 'fast_food', label: 'Fast food', icon: 'fast-food-outline' },
  { id: 'mexican', label: 'Mexican', icon: 'restaurant-outline' },
  { id: 'seafood', label: 'Seafood', icon: 'fish-outline' },
  { id: 'italian', label: 'Italian', icon: 'pizza-outline' },
  { id: 'japanese', label: 'Japanese', icon: 'nutrition-outline' },
];

function bestCityLabel(places: Location.LocationGeocodedAddress[]) {
  const first = places[0];
  if (!first) return null;
  const city = first.city ?? first.subregion ?? first.district ?? null;
  const region = first.region ?? null;
  const country = first.country ?? null;
  return [city, region].filter(Boolean).join(', ') || country || null;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
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

// Helper function to convert region to viewport bounds
function regionToViewportBounds(region: Region): ViewportBounds {
  return {
    northEastLat: region.latitude + region.latitudeDelta / 2,
    northEastLng: region.longitude + region.longitudeDelta / 2,
    southWestLat: region.latitude - region.latitudeDelta / 2,
    southWestLng: region.longitude - region.longitudeDelta / 2,
  };
}

// Helper function to convert viewport bounds to region
function viewportBoundsToRegion(viewport: ViewportBounds): Region {
  const centerLat = (viewport.northEastLat + viewport.southWestLat) / 2;
  const centerLng = (viewport.northEastLng + viewport.southWestLng) / 2;
  const latDelta = viewport.northEastLat - viewport.southWestLat;
  const lngDelta = viewport.northEastLng - viewport.southWestLng;
  
  return {
    latitude: centerLat,
    longitude: centerLng,
    latitudeDelta: Math.max(0.01, latDelta),
    longitudeDelta: Math.max(0.01, lngDelta),
  };
}

// Helper function to convert zoom level to latitude/longitude delta
function zoomToDelta(zoom: number): { latitudeDelta: number; longitudeDelta: number } {
  const delta = 360 / Math.pow(2, zoom);
  return {
    latitudeDelta: delta,
    longitudeDelta: delta,
  };
}

// Rating bubble component for markers
const RatingBubble = React.memo(function RatingBubble({
  score,
}: {
  score: number;
}) {
  const displayScore = typeof score === 'number' ? score.toFixed(1) : '0.0';
  
  return (
    <View style={ratingBubbleStyles.container}>
      <SDText weight="bold" color="black" variant="caption" style={ratingBubbleStyles.text}>
        {displayScore}
      </SDText>
    </View>
  );
}, (prev, next) => prev.score === next.score);

const ratingBubbleStyles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
    minWidth: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 0, 0, 0.1)',
    ...(Platform.OS === 'web'
      ? {
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
        }
      : {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.15,
          shadowRadius: 4,
          elevation: 3,
        }),
  },
  text: {
    fontSize: 12,
  },
});

// Native marker component using react-native-maps
const NativeMarkerComponent = React.memo(function NativeMarkerComponent({
  restaurant,
  isSelected,
  onPress,
}: {
  restaurant: RestaurantWithRanking;
  isSelected: boolean;
  onPress: (id: string) => void;
}) {
  const lastClickTimeRef = React.useRef(0);
  
  const handleClick = React.useCallback((e?: any) => {
    // Prevent event from bubbling to map
    if (e) {
      e.originalEvent?.stopPropagation();
    }
    
    // Debounce rapid clicks (within 300ms)
    const now = Date.now();
    if (now - lastClickTimeRef.current < 300) {
      return;
    }
    lastClickTimeRef.current = now;
    
    if (__DEV__) console.log('[NativeMarker] Clicked marker for restaurant:', restaurant.id, restaurant.name);
    onPress(restaurant.id);
  }, [onPress, restaurant.id, restaurant.name]);

  // Memoize style object to prevent re-creation
  const markerContainerStyle = React.useMemo(
    () => ({
      ...markerStyles.container,
      backgroundColor: isSelected ? '#FFB020' : '#FF6A3D',
    }),
    [isSelected]
  );

  const score = typeof restaurant.top_dish_net_score === 'number' ? restaurant.top_dish_net_score : 0;

  return (
    <>
      <Marker
        coordinate={{ latitude: restaurant.lat, longitude: restaurant.lng }}
        onPress={handleClick}
        identifier={restaurant.id}
        anchor={{ x: 0.5, y: 1 }}
      >
        <View style={markerContainerStyle}>
          <View style={markerStyles.inner} />
        </View>
      </Marker>
      {/* Rating bubble above marker */}
      {score > 0 && (
        <Marker
          coordinate={{ latitude: restaurant.lat + 0.0001, longitude: restaurant.lng }}
          anchor={{ x: 0.5, y: 0 }}
          identifier={`${restaurant.id}-rating`}
        >
          <RatingBubble score={score} />
        </Marker>
      )}
    </>
  );
}, (prev, next) => {
  return (
    prev.restaurant.id === next.restaurant.id &&
    prev.restaurant.lat === next.restaurant.lat &&
    prev.restaurant.lng === next.restaurant.lng &&
    prev.isSelected === next.isSelected &&
    prev.restaurant.top_dish_net_score === next.restaurant.top_dish_net_score &&
    prev.onPress === next.onPress
  );
});

type NavigationProp = BottomTabNavigationProp<RootTabParamList>;

export function MapScreen() {
  const navigation = useNavigation<NavigationProp>();
  const { lastFocus } = useMapFocus();
  const { search, setSearch, clearSearch, recommendations, setRecommendations } = useSearch();
  const sheetRef = useRef<BottomSheet>(null);
  const filterSheetRef = useRef<BottomSheet>(null);
  const rankingSheetRef = useRef<BottomSheet>(null);
  const mapRef = useRef<any>(null);
  const requestIdRef = useRef(0);
  const inFlightAbortRef = useRef<AbortController | null>(null);
  const skipViewportSearchRef = useRef(false); // Skip viewport-based search when restaurants are set from Mapbox search
  const sheetInitializedRef = useRef(false);
  const hasSheetBeenOpenedRef = useRef(false);
  const hasSheetBeenPrimedRef = useRef(false);
  const isPrimingRef = useRef(false);
  const lastOpenTimeRef = useRef<number>(0);
  const isUserClosingRef = useRef(false);
  const lastFetchedViewportRef = useRef<string | null>(null);
  const isOpeningRankingFormRef = useRef(false);
  const ratingRestaurantIdRef = useRef<string | null>(null);
  const lastProcessedFocusRef = useRef<number | null>(null); // Track processed focus nonce to prevent duplicates

  // Zapopan, Jalisco, Mexico coordinates as default
  const ZAPOPAN_COORDS = { latitude: 20.7236, longitude: -103.3848 };

  const initialViewState: ViewState = useMemo(
    () => ({
      latitude: ZAPOPAN_COORDS.latitude,
      longitude: ZAPOPAN_COORDS.longitude,
      zoom: 13,
      bearing: 0,
      pitch: 0,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
    }),
    []
  );

  const viewStateRef = useRef<ViewState>(initialViewState);

  const [viewport, setViewport] = useState<ViewportBounds>(() => viewStateToViewportBounds(initialViewState));
  // Minimal debounce for data fetching - 50ms for instant feel
  const debouncedViewport = useDebounce(viewport, 50);
  const isInitialLoadRef = useRef(true);

  const [allRestaurants, setAllRestaurants] = useState<RestaurantWithRanking[]>([]);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string | null>(null);
  const [selectedRestaurantNameHint, setSelectedRestaurantNameHint] = useState<string | null>(null);
  const [sheetIndex, setSheetIndex] = useState<number>(-1);
  // Start with false to allow immediate rendering - data fetch will happen immediately
  const [isLoading, setIsLoading] = useState(false);
  const [isTopSearchLoading, setIsTopSearchLoading] = useState(false);
  const [isFetchingData, setIsFetchingData] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
  const [mapQuery, setMapQuery] = useState<string>('');
  const [cityLabel, setCityLabel] = useState<string>('—');
  const [selectedCuisineId, setSelectedCuisineId] = useState<string>(CUISINE_CATEGORIES[0]?.id ?? 'all');
  const [filterSheetIndex, setFilterSheetIndex] = useState<number>(-1);
  const [userCenter, setUserCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [maxDistanceKm, setMaxDistanceKm] = useState<number | null>(null);

  const prevSelectedCuisineIdRef = useRef(selectedCuisineId);

  // Dish ranking form state
  const [rankingSheetIndex, setRankingSheetIndex] = useState<number>(-1);
  const [rankingDishName, setRankingDishName] = useState('');
  const [rankingPrice, setRankingPrice] = useState('');
  const [rankingIngredients, setRankingIngredients] = useState('');
  const [rankingScore, setRankingScore] = useState<number>(5);
  const [rankingImageUri, setRankingImageUri] = useState<string | null>(null);
  const [isSubmittingRanking, setIsSubmittingRanking] = useState(false);
  const [isMainSheetClosing, setIsMainSheetClosing] = useState(false);
  const [showAuthErrorModal, setShowAuthErrorModal] = useState(false);
  const [ratingRestaurantName, setRatingRestaurantName] = useState<string | null>(null);
  
  // Dish rankings for selected restaurant
  const [dishRankings, setDishRankings] = useState<DishRanking[]>([]);
  const [isLoadingDishRankings, setIsLoadingDishRankings] = useState(false);
  const lastFetchedRestaurantIdRef = useRef<string | null>(null);
  const lastFetchedMapboxIdRef = useRef<string | null>(null);
  const lastFetchedOsmIdRef = useRef<string | null>(null);

  // Refs for bottom sheet scrollable content
  const listFlatListRef = useRef<any>(null);
  const rankingScrollViewRef = useRef<any>(null);
  const restaurantDetailsScrollViewRef = useRef<any>(null);
  const clustererRef = useRef<SuperClusterInstance | null>(null);

  const rankingSnapPoints = useMemo(() => ['92%'], []);

  // Optimized restaurant filtering with early returns and memoized helpers
  const restaurants = useMemo(() => {
    // Early return for empty list
    if (allRestaurants.length === 0) return [];
    
    // Memoize cuisine check function
    const cuisine = (r: RestaurantWithRanking) => (r.cuisine ?? '').toLowerCase();
    const hasCuisine = (r: RestaurantWithRanking, token: string) => cuisine(r).includes(token);
    
    // Pre-compute distance filter if needed (only calculate once per restaurant)
    const needsDistanceFilter = maxDistanceKm != null && userCenter;
    
    // Fast path for 'all' cuisine (most common case)
    if (selectedCuisineId === 'all' && !needsDistanceFilter) {
      // Just filter out invalid entries - fastest path
      return allRestaurants.filter((r) => r && typeof r === 'object' && typeof r.id === 'string');
    }

    // Filter with all conditions
    return allRestaurants.filter((r) => {
      // Early validation check
      if (!r || typeof r !== 'object' || typeof r.id !== 'string') return false;

      // Distance filter (only if needed)
      if (needsDistanceFilter) {
        const d = haversineKm(userCenter!, { lat: r.lat, lng: r.lng });
        if (d > maxDistanceKm!) return false;
      }

      // Cuisine filter (early return for 'all')
      if (selectedCuisineId === 'all') return true;
      if (selectedCuisineId === 'fast_food') return r.establishment_type === 'fast_food';
      if (selectedCuisineId === 'seafood') return hasCuisine(r, 'seafood') || hasCuisine(r, 'fish');
      if (selectedCuisineId === 'italian') return hasCuisine(r, 'italian');
      if (selectedCuisineId === 'japanese') return hasCuisine(r, 'japanese');
      if (selectedCuisineId === 'mexican') return hasCuisine(r, 'mexican') || hasCuisine(r, 'tacos');
      return true;
    });
  }, [allRestaurants, maxDistanceKm, selectedCuisineId, userCenter]);

  // Viewport-based marker filtering: only render markers visible in current viewport + 50% padding
  // Use viewport state directly (not viewStateRef) to avoid stale closures
  const visibleMarkers = useMemo(() => {
    if (restaurants.length === 0) return [];
    
    const north = viewport.northEastLat;
    const south = viewport.southWestLat;
    const east = viewport.northEastLng;
    const west = viewport.southWestLng;

    // Add 50% padding to prevent markers disappearing at edges
    const padding = 0.5;
    const latSpan = north - south;
    const lngSpan = east - west;
    const latPadding = latSpan * padding;
    const lngPadding = lngSpan * padding;

    // Pre-allocate array for better performance
    const filtered: RestaurantWithRanking[] = [];
    for (let i = 0; i < restaurants.length; i++) {
      const r = restaurants[i];
      if (
        r.lat >= south - latPadding &&
        r.lat <= north + latPadding &&
        r.lng >= west - lngPadding &&
        r.lng <= east + lngPadding
      ) {
        filtered.push(r);
      }
    }
    return filtered;
  }, [restaurants, viewport]);

  // Create clusterer from ALL restaurants (not just visible) for better performance
  // Clustering library handles viewport filtering internally
  useEffect(() => {
    if (restaurants.length > 0) {
      clustererRef.current = createClusterer(restaurants);
    } else {
      clustererRef.current = null;
    }
  }, [restaurants]);

  // Get clustered data for current viewport
  // Use viewport directly instead of viewStateRef for better performance
  // Throttle clustering updates to prevent excessive recalculations during panning
  const clusteredData = useMemo<ClusteredPoint[]>(() => {
    if (!clustererRef.current) return [];

    // Calculate zoom from viewport bounds for better accuracy
    const latSpan = viewport.northEastLat - viewport.southWestLat;
    const zoom = calculateZoomFromLatitudeDelta(latSpan);

    return getClusteredMarkers(clustererRef.current, viewport, zoom);
  }, [restaurants, viewport]); // Use restaurants instead of visibleMarkers since clusterer uses all restaurants

  const selectedRestaurant = useMemo(
    () => restaurants.find((r) => r.id === selectedRestaurantId) ?? null,
    [restaurants, selectedRestaurantId]
  );

  // Get restaurant for rating form - use selectedRestaurant if available, otherwise find from stored ID
  const ratingRestaurant = useMemo(() => {
    if (selectedRestaurant) return selectedRestaurant;
    if (ratingRestaurantIdRef.current) {
      return restaurants.find((r) => r.id === ratingRestaurantIdRef.current) ?? null;
    }
    return null;
  }, [selectedRestaurant, restaurants]);

  // Get restaurant name for rating form title - use state if available
  const ratingRestaurantNameForTitle = useMemo(() => {
    if (ratingRestaurant) return ratingRestaurant.name;
    return ratingRestaurantName;
  }, [ratingRestaurant, ratingRestaurantName]);

  const snapPoints = useMemo(() => (viewMode === 'list' ? ['25%', '55%', '90%'] : ['75%', '95%']), [viewMode]);
  const filterSnapPoints = useMemo(() => ['52%'], []);

  const isSearchMode = Boolean(search.active && search.viewport && search.query.trim().length > 0);

  useEffect(() => {
    if (prevSelectedCuisineIdRef.current === selectedCuisineId) return;
    prevSelectedCuisineIdRef.current = selectedCuisineId;

    setSelectedRestaurantId(null);
    setSelectedRestaurantNameHint(null);

    if (viewMode === 'map' && sheetIndex !== -1) {
      setSheetIndex(-1);
      sheetRef.current?.close();
    }
  }, [selectedCuisineId, sheetIndex, viewMode]);

  // Web-compatible reverse geocoding using Mapbox Geocoding API
  const reverseGeocodeWeb = useCallback(async (lat: number, lng: number): Promise<string | null> => {
    try {
      // Use Mapbox Geocoding API for reverse geocoding
      const { reverseGeocode } = await import('../services/mapboxSearchService');
      const label = await reverseGeocode(lat, lng);
      return label;
    } catch (error) {
      if (__DEV__) console.error('[MapScreen] Mapbox reverse geocoding failed:', error);
      return null;
    }
  }, []);

  // Increase debounce for city label to reduce API calls (less critical than pins)
  const debouncedCityViewport = useDebounce(viewport, 1000);
  useEffect(() => {
    let alive = true;
    if (isSearchMode) return;
    
    // Only update city label from viewport if we don't have a user location
    // This prevents showing incorrect location when user pans the map
    if (userCenter) {
      // User location is available, don't update from viewport
      return;
    }

    (async () => {
      try {
        const midLat = (debouncedCityViewport.northEastLat + debouncedCityViewport.southWestLat) / 2;
        const midLng = (debouncedCityViewport.northEastLng + debouncedCityViewport.southWestLng) / 2;
        
        // Try web-compatible geocoding first
        const webLabel = await reverseGeocodeWeb(midLat, midLng);
        if (!alive) return;
        
        if (webLabel) {
          setCityLabel(webLabel);
          if (__DEV__) console.log('[MapScreen] City label updated (Mapbox from viewport):', webLabel);
          return;
        }
        
        // Fallback to expo-location (may fail on web but try anyway)
        try {
          const places = await Location.reverseGeocodeAsync({ latitude: midLat, longitude: midLng });
          if (!alive) return;
          const label = bestCityLabel(places);
          if (label) {
            setCityLabel(label);
            if (__DEV__) console.log('[MapScreen] City label updated (expo-location from viewport):', label);
          }
        } catch (expoError) {
          // expo-location may fail on web, that's okay
          if (__DEV__) console.warn('[MapScreen.web] expo-location geocoding failed (expected on web):', expoError);
        }
      } catch (error) {
        if (__DEV__) console.error('[MapScreen] Reverse geocoding failed:', error);
      }
    })();

    return () => {
      alive = false;
    };
  }, [debouncedCityViewport, isSearchMode, reverseGeocodeWeb, userCenter]);

  // Sync search query to input field (optimized to avoid unnecessary updates)
  useEffect(() => {
    if (isSearchMode) {
      const q = search.query ?? '';
      // Only update if different to avoid unnecessary re-renders
      setMapQuery((prev) => (prev !== q ? q : prev));
    } else {
      // Only clear if there's something to clear
      setMapQuery((prev) => (prev.length > 0 ? '' : prev));
    }
  }, [isSearchMode, search.query]);

  const currentSheetIndexRef = useRef(sheetIndex);
  useEffect(() => {
    currentSheetIndexRef.current = sheetIndex;
  }, [sheetIndex]);

  const openSheetTo = useCallback((index: number) => {
    const wasClosed = currentSheetIndexRef.current === -1;
    
    if (index === -1) {
      isUserClosingRef.current = true;
      setSheetIndex(-1);
      if (sheetRef.current) {
        sheetRef.current.close();
      }
      return;
    }
    
    isUserClosingRef.current = false;
    lastOpenTimeRef.current = Date.now();
    
    setSheetIndex(index);
    
    // Open immediately - no retry delay for instant responsiveness
    if (wasClosed && sheetRef.current && sheetInitializedRef.current) {
      try {
        if (index === 0) {
          sheetRef.current.expand();
        } else {
          sheetRef.current.snapToIndex(index);
        }
      } catch (e) {
        // Silently fail - sheet will update via state change
        if (__DEV__) console.warn('[MapScreen] Sheet open failed (non-critical):', e);
      }
    }
  }, []);

  // Handle Mapbox search selection
  const onMapboxSearchSelect = useCallback(async (feature: MapboxFeature) => {
    await lightHaptic();
    Keyboard.dismiss();

    // Set flag early to prevent viewport-based search from overwriting our restaurants
    skipViewportSearchRef.current = true;

    setIsLoading(true);
    setIsTopSearchLoading(true);
    setSelectedRestaurantId(null);
    setSelectedRestaurantNameHint(null);
    // Don't set viewMode or open sheet yet - wait until we have the restaurant

    try {
      // Extract coordinates from Mapbox feature (format: [lng, lat])
      const [lng, lat] = feature.geometry.coordinates;
      
      // Primary: Try to find restaurant by mapbox_id (exact match)
      let matchingRestaurants = await findRestaurantByMapboxId(feature.mapbox_id);
      
      // Fallback: If no exact match, try coordinate proximity (with self-healing)
      if (matchingRestaurants.length === 0) {
        matchingRestaurants = await findRestaurantByCoordinates(lat, lng, feature.mapbox_id, 50);
      }

      // Convert Mapbox feature to RestaurantWithRanking format
      // Use proper mapbox: format for ID (not osm:node:mapbox:...)
      const restaurantId = matchingRestaurants.length > 0 
        ? matchingRestaurants[0].id 
        : `mapbox:${feature.mapbox_id}`; // Use proper format: mapbox:poi.xxx
      
      const restaurant: RestaurantWithRanking = {
        id: restaurantId,
        name: feature.properties.name || feature.place_name || 'Restaurant',
        address: feature.properties.address || feature.place_name || null,
        lat,
        lng,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        top_dish_net_score: matchingRestaurants.length > 0 ? matchingRestaurants[0].top_dish_net_score : 0,
        establishment_type: feature.properties.category || null,
      };

      // If we found a matching restaurant, use its data (but update coordinates from Mapbox)
      const finalRestaurant = matchingRestaurants.length > 0 
        ? { ...matchingRestaurants[0], lat, lng } // Use Mapbox coordinates for accurate location
        : restaurant;

      // Set restaurants first so the restaurant is available in state
      const restaurantsToShow = matchingRestaurants.length > 0 
        ? matchingRestaurants.map(r => ({ ...r, lat, lng })) // Update all with Mapbox coordinates
        : [finalRestaurant];
      setAllRestaurants(restaurantsToShow);

      // Navigate map to restaurant coordinates first
      if (mapRef.current) {
        const newViewState: ViewState = {
          latitude: lat,
          longitude: lng,
          zoom: 15,
        };
        
        viewStateRef.current = newViewState;
        setViewport(viewStateToViewportBounds(newViewState));
        
        if (Platform.OS === 'web') {
          if (mapRef.current?.flyTo && typeof mapRef.current.flyTo === 'function') {
            mapRef.current.flyTo({
              center: [lng, lat],
              zoom: 15,
              duration: 500,
            });
          }
        } else {
          // Native map (react-native-maps)
          const { latitudeDelta, longitudeDelta } = zoomToDelta(15);
          mapRef.current.animateToRegion({
            latitude: lat,
            longitude: lng,
            latitudeDelta,
            longitudeDelta,
          }, 500);
        }
      }

      // Update search state
      const currentViewport = viewStateToViewportBounds(viewStateRef.current);
      setSearch({ query: finalRestaurant.name, viewport: currentViewport });
      
      // Track restaurant view if we have an OSM ID or mapbox_id
      const osmId = extractOsmId(finalRestaurant.id);
      if (osmId) {
        await trackRestaurantView(osmId, finalRestaurant.name);
      } else {
        // For Mapbox restaurants, extract mapbox_id and use it for tracking
        const mapboxMatch = finalRestaurant.id.match(/^mapbox:(.+)$/);
        if (mapboxMatch) {
          // Use mapbox_id as a fallback identifier for tracking
          await trackRestaurantView(mapboxMatch[1], finalRestaurant.name);
        }
      }

      // Set the selected restaurant and show details modal
      setSelectedRestaurantId(finalRestaurant.id);
      setSelectedRestaurantNameHint(null);
      setViewMode('map');
      
      // Open restaurant details modal after a short delay to ensure restaurant is in state
      setTimeout(() => {
        openSheetTo(0);
      }, 100);

      setIsLoading(false);
      setIsTopSearchLoading(false);
    } catch (error) {
      if (__DEV__) {
        console.warn('[MapScreen.web] Mapbox search failed:', error);
      }
      setIsLoading(false);
      setIsTopSearchLoading(false);
    }
  }, [openSheetTo, setSearch]);

  // Legacy onSubmitTopSearch - kept for backward compatibility but deprecated
  const onSubmitTopSearch = useCallback(async () => {
    const q = mapQuery.trim();
    if (q.length < 2) return;

    await lightHaptic();
    Keyboard.dismiss();

    setSelectedRestaurantId(null);
    setSelectedRestaurantNameHint(null);
    setViewMode('list');
    openSheetTo(1);
    
    const currentViewport = viewStateToViewportBounds(viewStateRef.current);
    setSearch({ query: q, viewport: currentViewport });
    
    // Fetch search results
    try {
      const results = await searchRestaurantsInArea(currentViewport, q);
      
      // Animate map to show results
      if (results.length > 0 && mapRef.current) {
        const lats = results.map(r => r.lat);
        const lngs = results.map(r => r.lng);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        
        const centerLat = (minLat + maxLat) / 2;
        const centerLng = (minLng + maxLng) / 2;
        const latDelta = Math.max(0.01, (maxLat - minLat) * 1.5);
        const lngDelta = Math.max(0.01, (maxLng - minLng) * 1.5);
        
        const newViewState: ViewState = {
          latitude: centerLat,
          longitude: centerLng,
          zoom: Math.max(10, Math.min(18, Math.log2(360 / Math.max(latDelta, lngDelta)))),
        };
        
        viewStateRef.current = newViewState;
        setViewport(viewStateToViewportBounds(newViewState));
        if (Platform.OS === 'web') {
          if (mapRef.current?.flyTo && typeof mapRef.current.flyTo === 'function') {
            mapRef.current.flyTo({
              center: [centerLng, centerLat],
              zoom: newViewState.zoom,
              duration: 500,
            });
          }
        } else {
          // Native map (react-native-maps)
          const { latitudeDelta, longitudeDelta } = zoomToDelta(newViewState.zoom);
          if (mapRef.current?.animateToRegion && typeof mapRef.current.animateToRegion === 'function') {
            mapRef.current.animateToRegion({
              latitude: centerLat,
              longitude: centerLng,
              latitudeDelta,
              longitudeDelta,
            }, 500);
          }
        }
      }
      
      setAllRestaurants(results);
      setIsLoading(false);
      setIsTopSearchLoading(false);
    } catch (error) {
      if (__DEV__) {
        console.warn('[MapScreen] Search failed:', error);
      }
      setIsLoading(false);
      setIsTopSearchLoading(false);
    }
  }, [mapQuery, openSheetTo, setSearch]);

  const onClearOrCancelSearch = useCallback(async () => {
    await lightHaptic();
    Keyboard.dismiss();

    setMapQuery('');
    setIsTopSearchLoading(false);
    if (isSearchMode) {
      clearSearch();
      setAllRestaurants([]);
      setSelectedRestaurantId(null);
      setViewMode('map');
      // Load recommendations when clearing search
      loadRecommendations();
    }
  }, [clearSearch, isSearchMode]);

  const onOpenFilters = useCallback(async () => {
    await lightHaptic();
    Keyboard.dismiss();
    setFilterSheetIndex(0);
    requestAnimationFrame(() => filterSheetRef.current?.snapToIndex(0));
  }, []);

  const onCloseFilters = useCallback(() => {
    setFilterSheetIndex(-1);
  }, []);

  const onResetFilters = useCallback(async () => {
    await lightHaptic();
    setSelectedCuisineId('all');
    setMaxDistanceKm(null);
  }, []);

  const openExternalUrl = useCallback(async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      // ignore
    }
  }, []);

  const openDirections = useCallback(
    async (r: RestaurantWithRanking) => {
      await lightHaptic();
      const q = encodeURIComponent(`${r.lat},${r.lng}`);
      await openExternalUrl(`https://www.google.com/maps/search/?api=1&query=${q}`);
    },
    [openExternalUrl]
  );

  const bumpDistance = useCallback(
    async (delta: number) => {
      if (!userCenter || locationDenied) return;
      await lightHaptic();
      setMaxDistanceKm((prev) => {
        const cur = prev ?? 0;
        const next = Math.max(0, Math.min(25, cur + delta));
        return next <= 0 ? null : next;
      });
    },
    [locationDenied, userCenter]
  );

  const hasCenteredOnUserRef = useRef(false);

  // Load recommendations on mount (search-first architecture)
  const loadRecommendations = useCallback(async () => {
    setRecommendations({ ...recommendations, isLoading: true });
    
    try {
      const currentViewport = viewStateToViewportBounds(viewStateRef.current);
      
      // Fetch recommendation data
      const [recentlyViewedData, topPicksData, bestRatedData] = await Promise.all([
        getRecentlyViewedRestaurants(10),
        getTopPicks(10),
        getBestRated(10),
      ]);
      
      // Fetch full restaurant data for each recommendation
      const [recentlyViewed, topPicks, bestRated] = await Promise.all([
        fetchRestaurantsForRecommendations(recentlyViewedData, currentViewport),
        fetchRestaurantsForRecommendations(topPicksData, currentViewport),
        fetchRestaurantsForRecommendations(bestRatedData, currentViewport),
      ]);
      
      // Use startTransition for non-urgent state updates
      startTransition(() => {
        setRecommendations({
          recentlyViewed,
          topPicks,
          bestRated,
          isLoading: false,
        });
      });
    } catch (error) {
      if (__DEV__) {
        console.warn('[MapScreen] Failed to load recommendations:', error);
      }
      setRecommendations({ ...recommendations, isLoading: false });
    }
  }, [setRecommendations]);

  useEffect(() => {
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      loadRecommendations();
    }
  }, [loadRecommendations]);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Don't block on location - fetch in background
      // This allows pins to load immediately while location is being detected
      const locationPromise = getUserLocationBestEffort();
      
      // Start location detection but don't wait for it
      locationPromise.then(async (res) => {
        if (!alive) return;

      if (res.status === 'granted') {
        // Check if the location is accurate enough (accuracy < 10km)
        // If accuracy is too low, it's likely a default/mock location
        // Use browser geolocation API to check accuracy (web only)
        let useLocation = true;
        if (Platform.OS === 'web') {
          try {
            const browserPos = await new Promise<GeolocationPosition>((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 0
              });
            });
            
            // If accuracy is > 10km, it's likely inaccurate - use Zapopan instead
            if (browserPos.coords.accuracy > 10000) {
              if (__DEV__) console.warn('[MapScreen] Geolocation accuracy too low:', browserPos.coords.accuracy, 'm. Using Zapopan default.');
              useLocation = false;
            }
          } catch (e) {
            // If browser geolocation fails, use Zapopan default
            if (__DEV__) console.warn('[MapScreen] Browser geolocation check failed, using Zapopan default');
            useLocation = false;
          }
        }

        if (useLocation) {
          setUserCenter({ lat: res.location.latitude, lng: res.location.longitude });

          // Try to get city label immediately from user location using web-compatible method
          try {
            const webLabel = await reverseGeocodeWeb(res.location.latitude, res.location.longitude);
            if (webLabel) {
              setCityLabel(webLabel);
              if (__DEV__) console.log('[MapScreen] City label from user location (Mapbox):', webLabel);
            }
          } catch (error) {
            if (__DEV__) console.warn('[MapScreen.web] Failed to geocode user location:', error);
          }

          if (!hasCenteredOnUserRef.current) {
            hasCenteredOnUserRef.current = true;
            const nextViewState: ViewState = {
              latitude: res.location.latitude,
              longitude: res.location.longitude,
              zoom: 14,
              bearing: 0,
              pitch: 0,
              padding: { top: 0, bottom: 0, left: 0, right: 0 },
            };
            viewStateRef.current = nextViewState;
            setViewport(viewStateToViewportBounds(nextViewState));
            if (mapRef.current?.flyTo && typeof mapRef.current.flyTo === 'function') {
              mapRef.current.flyTo({
                center: [res.location.longitude, res.location.latitude],
                zoom: 14,
                duration: 200,
              });
            }
          }
        } else {
          // Use Zapopan as default location
          setUserCenter({ lat: ZAPOPAN_COORDS.latitude, lng: ZAPOPAN_COORDS.longitude });
          
          // Set city label to Zapopan
          setCityLabel('Zapopan, Jalisco');
          if (__DEV__) console.log('[MapScreen] Using Zapopan, Jalisco as default location');
          
          if (!hasCenteredOnUserRef.current) {
            hasCenteredOnUserRef.current = true;
            const nextViewState: ViewState = {
              latitude: ZAPOPAN_COORDS.latitude,
              longitude: ZAPOPAN_COORDS.longitude,
              zoom: 14,
              bearing: 0,
              pitch: 0,
              padding: { top: 0, bottom: 0, left: 0, right: 0 },
            };
            viewStateRef.current = nextViewState;
            setViewport(viewStateToViewportBounds(nextViewState));
            if (mapRef.current?.flyTo && typeof mapRef.current.flyTo === 'function') {
              mapRef.current.flyTo({
                center: [ZAPOPAN_COORDS.longitude, ZAPOPAN_COORDS.latitude],
                zoom: 14,
                duration: 200,
              });
            }
          }
        }
      } else if (res.status === 'denied') {
        setLocationDenied(true);
        // Use Zapopan as default when location is denied
        setUserCenter({ lat: ZAPOPAN_COORDS.latitude, lng: ZAPOPAN_COORDS.longitude });
        setCityLabel('Zapopan, Jalisco');
        if (__DEV__) console.log('[MapScreen] Location denied, using Zapopan, Jalisco as default');
      }
      }).catch((error) => {
        // Location detection errors are non-critical - just use default
        if (__DEV__) console.warn('[MapScreen] Location detection error (non-critical):', error);
        if (!alive) return;
        setUserCenter({ lat: ZAPOPAN_COORDS.latitude, lng: ZAPOPAN_COORDS.longitude });
        setCityLabel('Zapopan, Jalisco');
      });
    })(); // Close the async IIFE

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!isSearchMode || !search.viewport) return;
    const centerLat = (search.viewport.northEastLat + search.viewport.southWestLat) / 2;
    const centerLng = (search.viewport.northEastLng + search.viewport.southWestLng) / 2;
    const latDelta = Math.max(0.02, Math.abs(search.viewport.northEastLat - search.viewport.southWestLat) * 1.12);
    const lngDelta = Math.max(0.02, Math.abs(search.viewport.northEastLng - search.viewport.southWestLng) * 1.12);

    const nextViewState: ViewState = viewportBoundsToViewState(search.viewport);
    viewStateRef.current = nextViewState;
    setViewport(search.viewport);
    if (mapRef.current?.flyTo && typeof mapRef.current.flyTo === 'function') {
      mapRef.current.flyTo({
        center: [centerLng, centerLat],
        zoom: nextViewState.zoom,
          duration: 200,
      });
    }
    if (viewMode === 'list') openSheetTo(1);
  }, [isSearchMode, openSheetTo, search.viewport, viewMode]);

  // Client-side search function for instant filtering (fallback while API loads)
  const clientSideSearch = useCallback((query: string, restaurants: RestaurantWithRanking[]): RestaurantWithRanking[] => {
    if (!query || query.length < 2) return [];
    const q = query.trim().toLowerCase();
    return restaurants.filter((r) => {
      if (!r || typeof r !== 'object' || typeof r.id !== 'string') return false;
      const name = (r.name ?? '').toLowerCase();
      const address = (r.address ?? '').toLowerCase();
      return name.includes(q) || address.includes(q);
    });
  }, []);


  // Only fetch on search - no viewport-based fetching
  useEffect(() => {
    if (!isSearchMode || !search.query || search.query.trim().length < 2) {
      return;
    }
    
    // Skip viewport-based search if restaurants were just set from Mapbox search
    if (skipViewportSearchRef.current) {
      skipViewportSearchRef.current = false; // Reset flag for next time
      return;
    }
    
    const requestId = ++requestIdRef.current;
    inFlightAbortRef.current?.abort();
    const controller = new AbortController();
    inFlightAbortRef.current = controller;
    
    setIsLoading(true);
    setIsTopSearchLoading(true);
    
    (async () => {
      try {
        const data = await searchRestaurantsInArea(search.viewport!, search.query, { signal: controller.signal });
        
        if (requestId !== requestIdRef.current) return;
        
        // Use startTransition for non-urgent state updates to prevent stuttering
        startTransition(() => {
          setAllRestaurants(data);
        });
        setIsLoading(false);
        setIsTopSearchLoading(false);
        
        if (__DEV__) {
          console.log(`[MapScreen.web] Search complete: ${data.length} results for "${search.query}"`);
        }
      } catch (e) {
        const isAbort = controller.signal.aborted || (e instanceof Error && e.name === 'AbortError');
        if (isAbort) return;
        
        if (__DEV__) {
          console.warn('[MapScreen] Search failed:', e);
        }
        
        setIsLoading(false);
        setIsTopSearchLoading(false);
      }
    })();
    
    return () => {
      controller.abort();
    };
  }, [isSearchMode, search.query, search.viewport]);

  useEffect(() => {
    if (!lastFocus) return;
    
    // Prevent processing the same focus request multiple times
    if (lastProcessedFocusRef.current === lastFocus.nonce) {
      if (__DEV__) {
        console.log(`[MapScreen] Skipping duplicate focus request: ${lastFocus.nonce}`);
      }
      return;
    }
    lastProcessedFocusRef.current = lastFocus.nonce;

    const nextViewState: ViewState = {
      latitude: lastFocus.lat,
      longitude: lastFocus.lng,
      zoom: 14,
      bearing: 0,
      pitch: 0,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
    };

    viewStateRef.current = nextViewState;
    
    // Check if restaurant is already in allRestaurants
    const existingRestaurant = allRestaurants.find(r => r.id === lastFocus.restaurantId);
    
    // Create restaurant object immediately (synchronously) so it's available when we open the sheet
    const newRestaurant: RestaurantWithRanking = {
      id: lastFocus.restaurantId,
      name: lastFocus.name,
      address: null,
      lat: lastFocus.lat,
      lng: lastFocus.lng,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      top_dish_net_score: 0, // Will be enriched
    };
    
    // Add restaurant immediately if it doesn't exist
    if (!existingRestaurant) {
      setAllRestaurants(prev => {
        if (prev.find(r => r.id === lastFocus.restaurantId)) return prev;
        return [...prev, newRestaurant];
      });
    }
    
    // Enrich with rankings asynchronously (don't block navigation)
    (async () => {
      try {
        const enriched = await enrichRestaurantsWithRankings([newRestaurant]);
        const restaurantToAdd = enriched.length > 0 ? enriched[0] : newRestaurant;
        
        // If enrichment didn't work, try direct query as fallback
        if (restaurantToAdd.top_dish_net_score === 0) {
          const osmId = extractOsmId(lastFocus.restaurantId);
          let mapboxId: string | null = null;
          const mapboxMatch = lastFocus.restaurantId.match(/^mapbox:(.+)$/);
          if (mapboxMatch) {
            mapboxId = mapboxMatch[1];
          }
          
          try {
            if (mapboxId) {
              // Query by mapbox_id
              const { data: mapboxRankings } = await supabase
                .from('dish_rankings')
                .select('score')
                .eq('mapbox_id', mapboxId)
                .not('mapbox_id', 'is', null);
              
              if (mapboxRankings && mapboxRankings.length > 0) {
                const avgScore = mapboxRankings.reduce((sum, r) => sum + (r.score || 0), 0) / mapboxRankings.length;
                restaurantToAdd.top_dish_net_score = Math.round(avgScore * 10) / 10;
                
                if (__DEV__) {
                  console.log(`[MapScreen] Found ranking by mapbox_id: ${mapboxId}, score: ${restaurantToAdd.top_dish_net_score}`);
                }
              }
            } else if (osmId) {
              // Query by OSM ID
              const { data: rankingsData } = await supabase.rpc('get_restaurant_rankings_batch', {
                osm_ids: [osmId],
              });
              if (rankingsData && rankingsData.length > 0 && rankingsData[0].ranking) {
                restaurantToAdd.top_dish_net_score = Number(rankingsData[0].ranking);
                
                if (__DEV__) {
                  console.log(`[MapScreen] Found ranking by OSM ID: ${osmId}, score: ${restaurantToAdd.top_dish_net_score}`);
                }
              }
            }
          } catch (err) {
            if (__DEV__) {
              console.warn('Failed to fetch ranking directly:', err);
            }
          }
        }
        
        // Update restaurant with enriched data
        setAllRestaurants(prev => {
          const existing = prev.find(r => r.id === lastFocus.restaurantId);
          if (existing) {
            return prev.map(r => r.id === lastFocus.restaurantId ? restaurantToAdd : r);
          }
          return [...prev, restaurantToAdd];
        });
      } catch (error) {
        if (__DEV__) {
          console.warn('Failed to enrich restaurant:', error);
        }
      }
    })();
    
    // Navigate immediately (don't wait for enrichment)
    setSelectedRestaurantId(lastFocus.restaurantId);
    setSelectedRestaurantNameHint(null);
    setViewMode('map');
    setViewport(viewStateToViewportBounds(nextViewState));
    setIsLoading(false); // Set to false since we have the restaurant data
    
    // Smoothly animate to restaurant location
    // Use native animateToRegion for react-native-maps (smoother than flyTo)
    // Validate coordinates before animating
    if (mapRef.current && 
        !isNaN(lastFocus.lat) && 
        !isNaN(lastFocus.lng) && 
        lastFocus.lat !== 0 && 
        lastFocus.lng !== 0 &&
        Math.abs(lastFocus.lat) <= 90 &&
        Math.abs(lastFocus.lng) <= 180) {
      
      try {
        const { latitudeDelta, longitudeDelta } = zoomToDelta(15); // Zoom level 15 for good detail
        
        // Validate delta values
        if (isNaN(latitudeDelta) || isNaN(longitudeDelta) || 
            !isFinite(latitudeDelta) || !isFinite(longitudeDelta) ||
            latitudeDelta <= 0 || longitudeDelta <= 0) {
          if (__DEV__) {
            console.warn('[MapScreen] Invalid delta values:', { latitudeDelta, longitudeDelta });
          }
          return;
        }
        
        const region: Region = {
          latitude: lastFocus.lat,
          longitude: lastFocus.lng,
          latitudeDelta,
          longitudeDelta,
        };
        
        // Use animateToRegion for native maps (smoother animation)
        if (mapRef.current.animateToRegion && typeof mapRef.current.animateToRegion === 'function') {
          // Add a small delay to ensure map is fully ready
          setTimeout(() => {
            if (mapRef.current?.animateToRegion) {
              try {
                mapRef.current.animateToRegion(region, 1000); // 1000ms for smooth animation
              } catch (error) {
                if (__DEV__) {
                  console.warn('[MapScreen] animateToRegion failed:', error);
                }
              }
            }
          }, 50);
        } else if (mapRef.current.flyTo && typeof mapRef.current.flyTo === 'function') {
          // Fallback for web maps
          try {
            mapRef.current.flyTo({
              center: [lastFocus.lng, lastFocus.lat],
              zoom: 15,
              duration: 1000, // Increased duration for smoother animation
            });
          } catch (error) {
            if (__DEV__) {
              console.warn('[MapScreen] flyTo failed:', error);
            }
          }
        }
      } catch (error) {
        if (__DEV__) {
          console.warn('[MapScreen] Failed to animate to restaurant:', error);
        }
      }
    } else if (__DEV__) {
      console.warn('[MapScreen] Invalid coordinates for animation:', { lat: lastFocus.lat, lng: lastFocus.lng });
    }
    
    // Open sheet after animation starts (slightly delayed for smoother UX)
    setTimeout(() => {
      try {
        if (sheetRef.current && sheetInitializedRef.current) {
          openSheetTo(0);
        } else {
          // If sheet isn't ready, just set the state - it will open via useEffect
          setSheetIndex(0);
        }
      } catch (error) {
        if (__DEV__) {
          console.warn('[MapScreen] Failed to open sheet:', error);
        }
      }
    }, 200);
  }, [lastFocus, openSheetTo]); // Removed allRestaurants from dependencies

  useEffect(() => {
    if (!selectedRestaurantId) return;
    const hit = restaurants.find((r) => r.id === selectedRestaurantId);
    if (hit) setSelectedRestaurantNameHint(null);
  }, [restaurants, selectedRestaurantId]);

  useEffect(() => {
    if (!selectedRestaurantId) {
      setDishRankings([]);
      lastFetchedRestaurantIdRef.current = null;
      lastFetchedMapboxIdRef.current = null;
      lastFetchedOsmIdRef.current = null;
      return;
    }

    // Find the restaurant from allRestaurants to get its data
    // We access allRestaurants directly (not as dependency) to avoid infinite loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const restaurant = allRestaurants.find((r) => r.id === selectedRestaurantId);
    if (!restaurant) {
      setDishRankings([]);
      return;
    }

    // Extract OSM ID from restaurant ID (handles osm:node:123, osm:way:123, osm:relation:123)
    const osmMatch = restaurant.id.match(/^osm:(?:node|way|relation):(\d+)$/);
    const osmId = osmMatch ? osmMatch[1] : null;
    
    // Extract mapbox_id from various formats:
    // - "mapbox:poi.xxx" or "mapbox:xxx"
    // - "osm:node:mapbox:xxx" (incorrect format but we handle it)
    let mapboxId: string | null = null;
    const mapboxIdMatch1 = restaurant.id.match(/^mapbox:(.+)$/);
    if (mapboxIdMatch1) {
      mapboxId = mapboxIdMatch1[1];
    } else {
      // Handle incorrect format: osm:node:mapbox:xxx
      const mapboxIdMatch2 = restaurant.id.match(/^osm:(?:node|way|relation):mapbox:(.+)$/);
      if (mapboxIdMatch2) {
        mapboxId = mapboxIdMatch2[1];
      }
    }

    // Prevent re-fetching if we already fetched for this restaurant
    // Check by restaurant ID, mapbox_id, or osm_id to catch duplicates
    if (lastFetchedRestaurantIdRef.current === selectedRestaurantId) {
      if (__DEV__) {
        console.log('[MapScreen] Skipping fetch - already fetched for restaurant ID:', selectedRestaurantId);
      }
      return;
    }
    
    if (mapboxId && lastFetchedMapboxIdRef.current === mapboxId) {
      if (__DEV__) {
        console.log('[MapScreen] Skipping fetch - already fetched for mapbox_id:', mapboxId);
      }
      return;
    }
    
    if (osmId && lastFetchedOsmIdRef.current === osmId) {
      if (__DEV__) {
        console.log('[MapScreen] Skipping fetch - already fetched for osm_id:', osmId);
      }
      return;
    }

    if (__DEV__) {
      console.log('[MapScreen] Fetching dish rankings for restaurant:', { 
        restaurantId: restaurant.id, 
        osmId, 
        mapboxId 
      });
    }

    setIsLoadingDishRankings(true);
    lastFetchedRestaurantIdRef.current = selectedRestaurantId;
    if (mapboxId) lastFetchedMapboxIdRef.current = mapboxId;
    if (osmId) lastFetchedOsmIdRef.current = osmId;
    
    // For Mapbox restaurants, prioritize mapbox_id; for OSM restaurants, use osmId
    // Pass null for osmId if it's a Mapbox restaurant (mapbox_id takes precedence)
    const queryOsmId = mapboxId ? null : osmId;
    
    if (!mapboxId && !osmId) {
      if (__DEV__) {
        console.warn('[MapScreen] Cannot fetch rankings: no OSM ID or mapbox_id for restaurant:', restaurant.id);
      }
      setIsLoadingDishRankings(false);
      return;
    }
    
    getDishRankingsForRestaurant(queryOsmId, mapboxId)
      .then((rankings) => {
        // Check if restaurant is still selected (prevent stale updates)
        // Check by ID, mapbox_id, or osm_id
        const stillSelected = 
          lastFetchedRestaurantIdRef.current === selectedRestaurantId ||
          (mapboxId && lastFetchedMapboxIdRef.current === mapboxId) ||
          (osmId && lastFetchedOsmIdRef.current === osmId);
        
        if (!stillSelected) {
          if (__DEV__) {
            console.log('[MapScreen] Skipping stale rankings update - restaurant changed');
          }
          return;
        }

        if (__DEV__) {
          console.log('[MapScreen] Fetched dish rankings:', rankings.length, 'rankings for', restaurant.name, { osmId, mapboxId, queryOsmId });
        }
        setDishRankings(rankings);
        
        // Update restaurant ranking in allRestaurants only if score changed
        if (rankings.length > 0) {
          const avgScore = rankings.reduce((sum, r) => sum + r.score, 0) / rankings.length;
          const roundedScore = Math.round(avgScore * 10) / 10;
          
          if (__DEV__) {
            console.log(`[MapScreen] Calculated ranking for ${restaurant.name}: ${roundedScore} (from ${rankings.length} rankings)`);
          }
          
          setAllRestaurants((prev) => {
            return prev.map((r) => {
              if (r.id === restaurant.id) {
                // Only update if score actually changed to prevent infinite loop
                if (r.top_dish_net_score !== roundedScore) {
                  return { ...r, top_dish_net_score: roundedScore };
                }
              }
              return r;
            });
          });
        } else if (__DEV__) {
          console.log(`[MapScreen] No rankings found for ${restaurant.name}`);
        }
      })
      .catch((error) => {
        console.error('Failed to fetch dish rankings:', error);
        setDishRankings([]);
      })
      .finally(() => {
        setIsLoadingDishRankings(false);
      });
  }, [selectedRestaurantId]);

  // Web map handler (react-map-gl)
  const onMoveEnd = useCallback((evt: any) => {
    // Update viewStateRef immediately for clustering
    const viewState = evt.viewState as ViewState;
    viewStateRef.current = viewState;
    
    // Use startTransition for non-urgent viewport updates to prevent stuttering
    startTransition(() => {
      const newViewport = viewStateToViewportBounds(evt.viewState);
      setViewport((prev) => {
        const prevMidLat = (prev.northEastLat + prev.southWestLat) / 2;
        const prevMidLng = (prev.northEastLng + prev.southWestLng) / 2;
        const nextMidLat = (newViewport.northEastLat + newViewport.southWestLat) / 2;
        const nextMidLng = (newViewport.northEastLng + newViewport.southWestLng) / 2;
        const prevSpanLat = prev.northEastLat - prev.southWestLat;
        const prevSpanLng = prev.northEastLng - prev.southWestLng;
        const nextSpanLat = newViewport.northEastLat - newViewport.southWestLat;
        const nextSpanLng = newViewport.northEastLng - newViewport.southWestLng;

        // More aggressive threshold for updates - only update if significant change
        const movedEnough = Math.abs(nextMidLat - prevMidLat) > Math.max(0.002, prevSpanLat * 0.08) || Math.abs(nextMidLng - prevMidLng) > Math.max(0.002, prevSpanLng * 0.08);
        const zoomedEnough = Math.abs(nextSpanLat - prevSpanLat) > Math.max(0.002, prevSpanLat * 0.12) || Math.abs(nextSpanLng - prevSpanLng) > Math.max(0.002, prevSpanLng * 0.12);

        return movedEnough || zoomedEnough ? newViewport : prev;
      });
    });
  }, []);

  // Native map handler (react-native-maps)
  // react-native-maps onRegionChangeComplete provides: { latitude, longitude, latitudeDelta, longitudeDelta }
  const onNativeRegionChangeComplete = useCallback((region: Region) => {
    const viewport = regionToViewportBounds(region);
    const zoom = Math.log2(360 / region.latitudeDelta);
    
    const viewState: ViewState = {
      latitude: region.latitude,
      longitude: region.longitude,
      zoom: Math.max(10, Math.min(18, zoom)),
      bearing: 0,
      pitch: 0,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
    };
    
    viewStateRef.current = viewState;
    
    startTransition(() => {
      setViewport((prev) => {
        const prevMidLat = (prev.northEastLat + prev.southWestLat) / 2;
        const prevMidLng = (prev.northEastLng + prev.southWestLng) / 2;
        const nextMidLat = (viewport.northEastLat + viewport.southWestLat) / 2;
        const nextMidLng = (viewport.northEastLng + viewport.southWestLng) / 2;
        const prevSpanLat = prev.northEastLat - prev.southWestLat;
        const prevSpanLng = prev.northEastLng - prev.southWestLng;
        const nextSpanLat = viewport.northEastLat - viewport.southWestLat;
        const nextSpanLng = viewport.northEastLng - viewport.southWestLng;

        const movedEnough = Math.abs(nextMidLat - prevMidLat) > Math.max(0.002, prevSpanLat * 0.08) || Math.abs(nextMidLng - prevMidLng) > Math.max(0.002, prevSpanLng * 0.08);
        const zoomedEnough = Math.abs(nextSpanLat - prevSpanLat) > Math.max(0.002, prevSpanLat * 0.12) || Math.abs(nextSpanLng - prevSpanLng) > Math.max(0.002, prevSpanLng * 0.12);

        return movedEnough || zoomedEnough ? viewport : prev;
      });
    });
  }, []);

  // Debounce marker clicks to prevent rapid multiple calls
  const lastMarkerClickRef = useRef<{ id: string; time: number } | null>(null);
  
  const onMarkerPress = useCallback(async (restaurantId: string) => {
    const now = Date.now();
    const lastClick = lastMarkerClickRef.current;
    
    // Debounce: ignore if same restaurant clicked within 500ms
    if (lastClick && lastClick.id === restaurantId && now - lastClick.time < 500) {
      return;
    }
    
    lastMarkerClickRef.current = { id: restaurantId, time: now };
    
    const restaurant = allRestaurants.find(r => r.id === restaurantId);
    if (restaurant) {
      // Track restaurant view
      const osmId = extractOsmId(restaurant.id);
      if (osmId) {
        await trackRestaurantView(osmId, restaurant.name);
      }
      
      // Animate map to restaurant
      const nextViewState: ViewState = {
        latitude: restaurant.lat,
        longitude: restaurant.lng,
        zoom: 15,
        bearing: 0,
        pitch: 0,
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
      };
      viewStateRef.current = nextViewState;
      setViewport(viewStateToViewportBounds(nextViewState));
      if (mapRef.current) {
        if (Platform.OS === 'web') {
          // Web map (react-map-gl)
          if (mapRef.current?.flyTo && typeof mapRef.current.flyTo === 'function') {
            mapRef.current.flyTo({
              center: [restaurant.lng, restaurant.lat],
              zoom: 15,
              duration: 400,
            });
          }
        } else {
          // Native map (react-native-maps)
          const { latitudeDelta, longitudeDelta } = zoomToDelta(15);
          mapRef.current.animateToRegion({
            latitude: restaurant.lat,
            longitude: restaurant.lng,
            latitudeDelta,
            longitudeDelta,
          }, 400);
        }
      }
    }
    
    setSelectedRestaurantId(restaurantId);
    setViewMode('map');
    
    // Ensure sheet is initialized and not currently priming before opening
    if (sheetRef.current && sheetInitializedRef.current && !isPrimingRef.current) {
      // Small delay to ensure content is ready (especially important at launch)
      setTimeout(() => {
        if (sheetRef.current && !isPrimingRef.current) {
          openSheetTo(0);
        }
      }, 50);
    } else {
      // If sheet isn't ready yet, wait longer and try again
      // This handles the case when clicking a pin immediately at launch
      setTimeout(() => {
        if (sheetRef.current && sheetInitializedRef.current && !isPrimingRef.current) {
          openSheetTo(0);
        } else {
          // Fallback: just set the state, sheet will open via useEffect
          setSheetIndex(0);
        }
      }, 300);
    }
  }, [openSheetTo, allRestaurants]);

  const onClusterPress = useCallback(
    (cluster: ClusteredPoint) => {
      if (!isCluster(cluster)) return;
      // Don't await haptic - fire and forget for instant response
      lightHaptic();

      // Zoom into cluster
      const [lng, lat] = cluster.geometry.coordinates;
      const currentZoom = viewStateRef.current.zoom;
      const newZoom = Math.min(18, currentZoom + 1); // Zoom in by 1 level

      const newViewState: ViewState = {
        latitude: lat,
        longitude: lng,
        zoom: newZoom,
        bearing: 0,
        pitch: 0,
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
      };

      viewStateRef.current = newViewState;
      setViewport(viewStateToViewportBounds(newViewState));

      // Update map view immediately with shorter animation
      if (mapRef.current) {
        if (Platform.OS === 'web') {
          if (mapRef.current?.flyTo && typeof mapRef.current.flyTo === 'function') {
            mapRef.current.flyTo({
              center: [lng, lat],
              zoom: newZoom,
              duration: 200, // Reduced from 300ms for faster feel
            });
          }
        } else {
          // Native map (react-native-maps)
          const { latitudeDelta, longitudeDelta } = zoomToDelta(newZoom);
          mapRef.current.animateToRegion({
            latitude: lat,
            longitude: lng,
            latitudeDelta,
            longitudeDelta,
          }, 200);
        }
      }
    },
    []
  );

  // Memoize marker elements for performance - use clustering
  // Use stable callbacks to prevent unnecessary re-renders
  const stableOnMarkerPress = useRef(onMarkerPress);
  const stableOnClusterPress = useRef(onClusterPress);
  
  // Update refs when callbacks change (should be rare)
  useEffect(() => {
    stableOnMarkerPress.current = onMarkerPress;
  }, [onMarkerPress]);
  
  useEffect(() => {
    stableOnClusterPress.current = onClusterPress;
  }, [onClusterPress]);

  // Memoize marker elements for performance - use clustering
  // Platform-specific marker components
  const MarkerComponent = Platform.OS === 'web' ? WebMarkerComponent : NativeMarkerComponent;
  const ClusterMarkerComponent = Platform.OS === 'web' ? WebClusterMarkerComponent : NativeClusterMarkerComponent;

  const markerElements = useMemo(() => {
    // If clustering returns empty but we have restaurants, render visible ones directly
    if (clusteredData.length === 0 && visibleMarkers.length > 0) {
      // Pre-allocate array for better performance
      const elements: (React.ReactElement | null)[] = new Array(visibleMarkers.length);
      for (let i = 0; i < visibleMarkers.length; i++) {
        const restaurant = visibleMarkers[i];
        if (!restaurant || typeof restaurant.id !== 'string' || typeof restaurant.lat !== 'number' || typeof restaurant.lng !== 'number') {
          elements[i] = null;
          continue;
        }
        elements[i] = (
          <MarkerComponent
            key={restaurant.id}
            restaurant={restaurant}
            isSelected={restaurant.id === selectedRestaurantId}
            onPress={stableOnMarkerPress.current}
          />
        );
      }
      return elements.filter((el): el is React.ReactElement => el !== null);
    }
    
    // Pre-allocate array for clustered data
    const elements: (React.ReactElement | null)[] = new Array(clusteredData.length);
    for (let i = 0; i < clusteredData.length; i++) {
      const point = clusteredData[i];
      if (isCluster(point)) {
        elements[i] = (
          <ClusterMarkerComponent
            key={`cluster-${point.properties.cluster_id}`}
            cluster={point}
            onPress={stableOnClusterPress.current}
          />
        );
      } else {
        const restaurant = point.properties.restaurant;
        if (!restaurant || typeof restaurant.id !== 'string' || typeof restaurant.lat !== 'number' || typeof restaurant.lng !== 'number') {
          elements[i] = null;
          continue;
        }
        elements[i] = (
          <MarkerComponent
            key={restaurant.id}
            restaurant={restaurant}
            isSelected={restaurant.id === selectedRestaurantId}
            onPress={stableOnMarkerPress.current}
          />
        );
      }
    }
    
    return elements.filter((el): el is React.ReactElement => el !== null);
  }, [clusteredData, visibleMarkers, selectedRestaurantId, MarkerComponent, ClusterMarkerComponent]);

  useEffect(() => {
    if (!selectedRestaurantId) return;
    if (viewMode !== 'map') return;
    
    // Ensure sheet is initialized and not priming before opening
    if (currentSheetIndexRef.current === -1 && selectedRestaurantId) {
      if (sheetRef.current && sheetInitializedRef.current && !isPrimingRef.current) {
        // Small delay to ensure content is ready
        const timeoutId = setTimeout(() => {
          if (sheetRef.current && !isPrimingRef.current && currentSheetIndexRef.current === -1) {
            openSheetTo(0);
          }
        }, 100);
        return () => clearTimeout(timeoutId);
      } else {
        // If sheet isn't ready, wait longer and try again
        const timeoutId = setTimeout(() => {
          if (sheetRef.current && sheetInitializedRef.current && !isPrimingRef.current && currentSheetIndexRef.current === -1) {
            openSheetTo(0);
          }
        }, 400);
        return () => clearTimeout(timeoutId);
      }
    }
  }, [selectedRestaurantId, viewMode, openSheetTo]);

  useEffect(() => {
    if (isMainSheetClosing && sheetIndex === -1) {
      setIsMainSheetClosing(false);
      setRankingSheetIndex(0);
      // Open immediately - no delay
      rankingSheetRef.current?.snapToIndex(0);
      // Clear the opening ref after a longer delay to ensure the ranking sheet is fully open
      // Keep the restaurant ID ref until the form is actually reset
      setTimeout(() => {
        isOpeningRankingFormRef.current = false;
      }, 500);
    }
  }, [isMainSheetClosing, sheetIndex]);

  const prevViewModeRef = useRef(viewMode);
  useEffect(() => {
    if (viewMode === 'list' && prevViewModeRef.current !== 'list') {
      openSheetTo(1);
    }
    prevViewModeRef.current = viewMode;
  }, [openSheetTo, viewMode]);

  const onListPick = useCallback(
    async (r: RestaurantWithRanking) => {
      await lightHaptic();
      
      // Track restaurant view
      const osmId = extractOsmId(r.id);
      if (osmId) {
        await trackRestaurantView(osmId, r.name);
      }
      
      // Animate map to restaurant
      const nextViewState: ViewState = {
        latitude: r.lat,
        longitude: r.lng,
        zoom: 15,
        bearing: 0,
        pitch: 0,
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
      };
      setSelectedRestaurantId(r.id);
      setSelectedRestaurantNameHint(r.name);
      setViewMode('map');
      openSheetTo(0);
      setViewport(viewStateToViewportBounds(nextViewState));
      if (mapRef.current?.flyTo && typeof mapRef.current.flyTo === 'function') {
        mapRef.current.flyTo({
          center: [r.lng, r.lat],
          zoom: 15,
          duration: 400,
        });
      }
    },
    [openSheetTo]
  );

  const onUseCurrentLocation = useCallback(async () => {
    setLocationDenied(false);
    setIsLoading(true);
    const res = await getUserLocationBestEffort();
    if (res.status === 'granted') {
      const nextViewState: ViewState = {
        latitude: res.location.latitude,
        longitude: res.location.longitude,
        zoom: 14,
        bearing: 0,
        pitch: 0,
        padding: { top: 0, bottom: 0, left: 0, right: 0 },
      };
      setViewport(viewStateToViewportBounds(nextViewState));
      setUserCenter({ lat: res.location.latitude, lng: res.location.longitude });
      
      // Web: use flyTo
      if (Platform.OS === 'web' && mapRef.current?.flyTo && typeof mapRef.current.flyTo === 'function') {
        mapRef.current.flyTo({
          center: [res.location.longitude, res.location.latitude],
          zoom: 14,
          duration: 200,
        });
      } 
      // Native: use animateToRegion
      else if (Platform.OS !== 'web' && mapRef.current) {
        const region: Region = {
          latitude: res.location.latitude,
          longitude: res.location.longitude,
          latitudeDelta: 360 / Math.pow(2, 14),
          longitudeDelta: 360 / Math.pow(2, 14),
        };
        mapRef.current.animateToRegion(region, 500);
      }
      setIsLoading(false);
    } else if (res.status === 'denied') {
      setLocationDenied(true);
      setIsLoading(false);
    } else {
      setIsLoading(false);
    }
  }, []);

  const onLocatePress = useCallback(async () => {
    await lightHaptic();
    await onUseCurrentLocation();
  }, [onUseCurrentLocation]);

  const resetRankingForm = useCallback(() => {
    setRankingDishName('');
    setRankingPrice('');
    setRankingIngredients('');
    setRankingScore(5);
    setRankingImageUri(null);
    setRankingSheetIndex(-1);
    rankingSheetRef.current?.close();
    isOpeningRankingFormRef.current = false;
    ratingRestaurantIdRef.current = null;
    setRatingRestaurantName(null);
  }, []);

  useEffect(() => {
    // Don't close the ranking form if we're in the process of opening it (transitioning from main sheet)
    // Also check if we have a stored restaurant ID for rating
    const hasRatingRestaurant = ratingRestaurantIdRef.current !== null;
    if (!selectedRestaurant && rankingSheetIndex !== -1 && !isMainSheetClosing && !isOpeningRankingFormRef.current && !hasRatingRestaurant) {
      resetRankingForm();
    }
  }, [selectedRestaurant, rankingSheetIndex, resetRankingForm, isMainSheetClosing]);

  const handleOpenRankingForm = useCallback(async () => {
    await lightHaptic();
    if (!selectedRestaurant) {
      return;
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setShowAuthErrorModal(true);
      return;
    }
    // Store restaurant ID and name to preserve them during transition
    ratingRestaurantIdRef.current = selectedRestaurant.id;
    setRatingRestaurantName(selectedRestaurant.name);
    // Set ref BEFORE closing the main sheet to prevent premature closing
    isOpeningRankingFormRef.current = true;
    setIsMainSheetClosing(true);
    setSheetIndex(-1);
    sheetRef.current?.close();
  }, [selectedRestaurant]);

  const handlePickImage = useCallback(async () => {
    await lightHaptic();
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Please allow access to your photo library to upload a photo.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setRankingImageUri(result.assets[0].uri);
    }
  }, []);

  const handleSubmitRanking = useCallback(async () => {
    if (isSubmittingRanking) return;
    
    // Use selectedRestaurant if available, otherwise try to find it from the stored ID
    let restaurant = selectedRestaurant;
    if (!restaurant && ratingRestaurantIdRef.current) {
      restaurant = restaurants.find((r) => r.id === ratingRestaurantIdRef.current) ?? null;
    }
    
    // If still no restaurant found, create a minimal one from stored data
    if (!restaurant) {
      if (ratingRestaurantIdRef.current && ratingRestaurantName) {
        restaurant = {
          id: ratingRestaurantIdRef.current,
          name: ratingRestaurantName,
          address: null,
          lat: 0,
          lng: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          top_dish_net_score: 0,
        };
      } else {
        // Last resort: try to get from selectedRestaurantId if available
        if (selectedRestaurantId) {
          const found = restaurants.find((r) => r.id === selectedRestaurantId);
          if (found) {
            restaurant = found;
          }
        }
        
        if (!restaurant) {
          Alert.alert('Error', 'No restaurant selected. Please close and reopen the rating form.');
          return;
        }
      }
    }
    
    // Ensure we have a restaurant ID for submission (use stored ref if available, otherwise use restaurant.id)
    const restaurantIdForSubmission = ratingRestaurantIdRef.current || restaurant.id;
    if (!restaurantIdForSubmission) {
      Alert.alert('Error', 'No restaurant ID available for submission.');
      return;
    }
    
    if (!rankingDishName.trim()) {
      Alert.alert('Missing dish name', 'Please enter the name of the dish.');
      return;
    }
    if (rankingScore < 0 || rankingScore > 10) {
      Alert.alert('Invalid score', 'Score must be between 0 and 10.');
      return;
    }

    let priceCents: number | null = null;
    if (rankingPrice.trim()) {
      const parsed = parseFloat(rankingPrice);
      if (isNaN(parsed) || parsed < 0) {
        Alert.alert('Invalid price', 'Please enter a valid price (e.g., 12.50).');
        return;
      }
      priceCents = Math.round(parsed * 100);
    }

    setIsSubmittingRanking(true);
    try {
      const dishName = rankingDishName.trim();
      const ingredients = rankingIngredients.trim() || null;
      const score = rankingScore;

      // Extract OSM ID from restaurant ID (handles osm:node:123, osm:way:123, osm:relation:123)
      const osmMatch = restaurantIdForSubmission.match(/^osm:(?:node|way|relation):(\d+)$/);
      const osmId = osmMatch ? osmMatch[1] : null;
      
      // Extract mapbox_id from various formats:
      // - "mapbox:poi.xxx" or "mapbox:xxx"
      // - "osm:node:mapbox:xxx" (incorrect format but we handle it)
      let mapboxId: string | null = null;
      const mapboxIdMatch1 = restaurantIdForSubmission.match(/^mapbox:(.+)$/);
      if (mapboxIdMatch1) {
        mapboxId = mapboxIdMatch1[1];
      } else {
        // Handle incorrect format: osm:node:mapbox:xxx
        const mapboxIdMatch2 = restaurantIdForSubmission.match(/^osm:(?:node|way|relation):mapbox:(.+)$/);
        if (mapboxIdMatch2) {
          mapboxId = mapboxIdMatch2[1];
        }
      }
      
      // For submission, we need either an OSM ID or a mapbox_id
      // If we have a mapbox_id but no OSM ID, use the mapbox_id as the identifier
      const submissionOsmId = osmId || (mapboxId ? `mapbox:${mapboxId}` : null);
      
      if (!submissionOsmId) {
        Alert.alert('Error', 'Could not determine restaurant identifier for submission.');
        return;
      }

      let imageUrl: string | null = null;
      if (rankingImageUri) {
        try {
          imageUrl = await uploadDishPhoto(rankingImageUri);
        } catch (uploadErr) {
          console.error('Failed to upload image:', uploadErr);
          Alert.alert(
            'Image upload failed',
            'The image could not be uploaded. Would you like to submit without the photo?',
            [
              { 
                text: 'Cancel', 
                style: 'cancel', 
                onPress: () => setIsSubmittingRanking(false) 
              },
              {
                text: 'Submit without photo',
                onPress: async () => {
                  try {
                    await submitDishRanking({
                      osm_id: submissionOsmId,
                      restaurant_name: restaurant.name,
                      dish_name: dishName,
                      price_cents: priceCents,
                      ingredients: ingredients,
                      score: score,
                      image_url: null,
                      mapbox_id: mapboxId,
                    });
                    await lightHaptic();
                    Alert.alert('Success', 'Your dish ranking has been submitted!');
                    resetRankingForm();
                    
                    // Always refresh rankings after submission
                    if (__DEV__) {
                      console.log('[MapScreen] Refreshing rankings after submission (no photo):', { osmId: submissionOsmId, mapboxId });
                    }
                    getDishRankingsForRestaurant(submissionOsmId, mapboxId)
                      .then((rankings) => {
                        if (__DEV__) {
                          console.log('[MapScreen] Refreshed rankings (no photo):', rankings.length, 'rankings found');
                        }
                        setDishRankings(rankings);
                        if (rankings.length > 0) {
                          const avgScore = rankings.reduce((sum, r) => sum + r.score, 0) / rankings.length;
                          const roundedScore = Math.round(avgScore * 10) / 10;
                          
                          if (__DEV__) {
                            console.log(`[MapScreen] Updating restaurant ranking (no photo): ${restaurant.name}, score: ${roundedScore} (from ${rankings.length} rankings)`);
                          }
                          
                          setAllRestaurants((prev) =>
                            prev.map((r) =>
                              r.id === restaurant.id
                                ? { ...r, top_dish_net_score: roundedScore }
                                : r
                            )
                          );
                        } else if (__DEV__) {
                          console.log(`[MapScreen] No rankings found to update (no photo) for restaurant: ${restaurant.name}`);
                        }
                      })
                      .catch((error) => {
                        console.error('Failed to refresh dish rankings:', error);
                      });
                  } catch (submitErr) {
                    console.error('Failed to submit ranking:', submitErr);
                    Alert.alert('Error', 'Failed to submit ranking. Please try again.');
                  } finally {
                    setIsSubmittingRanking(false);
                  }
                },
              },
            ]
          );
          return;
        }
      }

      await submitDishRanking({
        osm_id: submissionOsmId, // Use the identifier we determined (OSM ID or mapbox:xxx format)
        restaurant_name: restaurant.name,
        dish_name: dishName,
        price_cents: priceCents,
        ingredients: ingredients,
        score: score,
        image_url: imageUrl,
        mapbox_id: mapboxId, // Store the actual mapbox_id for querying
      });
      await lightHaptic();
      Alert.alert('Success', 'Your dish ranking has been submitted!');
      resetRankingForm();
      
      // Always refresh rankings after submission, using the OSM ID and mapbox_id we just submitted
      if (__DEV__) {
        console.log('[MapScreen] Refreshing rankings after submission:', { osmId: submissionOsmId, mapboxId });
      }
      getDishRankingsForRestaurant(submissionOsmId, mapboxId)
        .then((rankings) => {
          if (__DEV__) {
            console.log('[MapScreen] Refreshed rankings:', rankings.length, 'rankings found');
          }
          setDishRankings(rankings);
          if (rankings.length > 0) {
            const avgScore = rankings.reduce((sum, r) => sum + r.score, 0) / rankings.length;
            const roundedScore = Math.round(avgScore * 10) / 10;
            
            if (__DEV__) {
              console.log(`[MapScreen] Updating restaurant ranking: ${restaurant.name}, score: ${roundedScore} (from ${rankings.length} rankings)`);
            }
            
            setAllRestaurants((prev) =>
              prev.map((r) =>
                r.id === restaurant.id
                  ? { ...r, top_dish_net_score: roundedScore }
                  : r
              )
            );
          } else if (__DEV__) {
            console.log(`[MapScreen] No rankings found to update for restaurant: ${restaurant.name}`);
          }
        })
        .catch((error) => {
          console.error('Failed to refresh dish rankings:', error);
          // Still try to refresh using the useEffect that watches selectedRestaurant
          // This will trigger when selectedRestaurant changes or when we re-select
        });
    } catch (err) {
      console.error('Failed to submit ranking:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to submit ranking. Please try again.';
      if (errorMessage === 'Not authenticated' || errorMessage.includes('authenticated')) {
        // Close the ranking sheet first to avoid BottomSheetTextInput cleanup errors
        setRankingSheetIndex(-1);
        rankingSheetRef.current?.close();
        // Wait a bit for the sheet to close before resetting and showing modal
        setTimeout(() => {
          resetRankingForm();
          setShowAuthErrorModal(true);
        }, 100);
      } else {
        Alert.alert('Error', errorMessage);
      }
    } finally {
      setIsSubmittingRanking(false);
    }
  }, [selectedRestaurant, restaurants, rankingDishName, rankingPrice, rankingIngredients, rankingScore, rankingImageUri, isSubmittingRanking, resetRankingForm]);

  if (!MAPBOX_TOKEN) {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.container}>
          <SDText weight="bold" variant="subtitle">
            Mapbox token required
          </SDText>
          <SDText color="textMuted">
            Please set EXPO_PUBLIC_MAPBOX_TOKEN in your environment variables.
          </SDText>
          <SDText color="textMuted" variant="caption" style={{ marginTop: 8 }}>
            Current value: {MAPBOX_TOKEN ? 'Set' : 'Not set'}
          </SDText>
        </View>
      </Screen>
    );
  }

  // Check if Map components are available before rendering
  const hasWebMap = Platform.OS === 'web' && WebMap && WebMarker;
  const hasNativeMap = Platform.OS !== 'web'; // react-native-maps always available
  
  if (!hasWebMap && !hasNativeMap) {
    return (
      <Screen edges={['top', 'bottom']}>
        <View style={styles.container}>
          <SDText weight="bold" variant="subtitle">
            {Platform.OS === 'web' ? 'Mapbox library not loaded' : 'Map not available'}
          </SDText>
          <SDText color="textMuted">
            {Platform.OS === 'web' 
              ? 'react-map-gl failed to load. Please check your dependencies and ensure react-map-gl is installed.'
              : 'react-native-maps is not available. Please ensure react-native-maps is installed.'}
          </SDText>
        </View>
      </Screen>
    );
  }


  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.mapContainer}>
          {Platform.OS === 'web' && WebMap ? (
            <WebMap
              ref={mapRef}
              mapboxAccessToken={MAPBOX_TOKEN || ''}
              initialViewState={initialViewState}
              onMoveEnd={onMoveEnd}
              onError={(error: any) => {
                if (__DEV__) {
                  console.error('[MapScreen] Map error:', error);
                }
              }}
              onLoad={() => {
                if (__DEV__) {
                  console.log('[MapScreen] Map loaded successfully');
                }
              }}
              style={styles.map}
              mapStyle="mapbox://styles/mapbox/streets-v12"
              reuseMaps
              doubleClickZoom={false}
              dragRotate={false}
              touchZoomRotate={false}
              touchPitch={false}
              cooperativeGestures={false}
              antialias={false}
              preserveDrawingBuffer={false}
              maxPitch={0}
              minZoom={10}
              maxZoom={18}
              renderWorldCopies={false}
              interactiveLayerIds={[]}
            >
              {markerElements}
            </WebMap>
          ) : (
            <MapView
              ref={mapRef}
              style={styles.map}
              initialRegion={{
                latitude: initialViewState.latitude,
                longitude: initialViewState.longitude,
                latitudeDelta: 360 / Math.pow(2, initialViewState.zoom),
                longitudeDelta: 360 / Math.pow(2, initialViewState.zoom),
              }}
              onRegionChangeComplete={onNativeRegionChangeComplete}
              onMapReady={() => {
                if (__DEV__) {
                  console.log('[MapScreen] Native map loaded successfully');
                }
              }}
              minZoomLevel={10}
              maxZoomLevel={18}
              pitchEnabled={false}
              rotateEnabled={false}
              showsUserLocation={true}
              showsMyLocationButton={false}
            >
              {markerElements}
              {/* User location accuracy circle */}
              {userCenter && (
                <Circle
                  center={{
                    latitude: userCenter.lat,
                    longitude: userCenter.lng,
                  }}
                  radius={100}
                  strokeWidth={2}
                  strokeColor="rgba(66, 133, 244, 0.5)"
                  fillColor="rgba(66, 133, 244, 0.1)"
                />
              )}
            </MapView>
          )}
        </View>

        <View style={[styles.topBar, styles.pointerEventsBoxNone]}>
          <View style={styles.topBarInner}>
            {cityLabel && cityLabel !== '—' ? (
              <View style={[styles.cityPill, styles.pointerEventsNone]}>
                <Ionicons name="location-outline" size={16} color={theme.colors.textMuted} />
                <SDText weight="bold" variant="subtitle">
                  {cityLabel}
                </SDText>
              </View>
            ) : (
              <View style={[styles.cityPill, { pointerEvents: 'none', opacity: 0.6 }]}>
                <Ionicons name="location-outline" size={16} color={theme.colors.textMuted} />
                <SDText weight="bold" variant="subtitle" color="textMuted">
                  Loading location...
                </SDText>
              </View>
            )}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoriesRow}
              keyboardShouldPersistTaps="always"
              removeClippedSubviews={true}
            >
              {useMemo(
                () =>
                  CUISINE_CATEGORIES.map((c) => {
                    const selected = c.id === selectedCuisineId;
                    return (
                      <Pressable
                        key={c.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Category ${c.label}`}
                        onPress={async () => {
                          await lightHaptic();
                          setSelectedCuisineId(c.id);
                        }}
                        style={({ pressed }) => [
                          styles.categoryChip,
                          selected ? styles.categoryChipSelected : null,
                          { opacity: pressed ? 0.85 : 1 },
                        ]}
                      >
                        <Ionicons name={c.icon} size={18} color={selected ? theme.colors.black : theme.colors.text} />
                        <SDText
                          variant="caption"
                          weight={selected ? 'bold' : 'semibold'}
                          color={selected ? 'black' : 'text'}
                        >
                          {c.label}
                        </SDText>
                      </Pressable>
                    );
                  }),
                [selectedCuisineId]
              )}
            </ScrollView>

            <View style={styles.searchPill}>
              <SearchHeader
                placeholder={isSearchMode ? `Searching "${search.query}"` : 'What restaurant are you at?'}
                onSelect={onMapboxSearchSelect}
                proximity={userCenter ? { latitude: userCenter.lat, longitude: userCenter.lng } : undefined}
              />
            </View>
          </View>
        </View>

        <View style={[styles.fabWrap, { pointerEvents: 'box-none' }]}>
          {isFetchingData ? (
            <View style={styles.fetchingPill}>
              <ActivityIndicator size="small" color={theme.colors.brand} />
              <SDText variant="caption" color="textMuted">
                Loading...
              </SDText>
            </View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use current location"
            onPress={onLocatePress}
            style={({ pressed }) => [styles.fab, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Ionicons name="locate-outline" size={22} color={theme.colors.text} />
          </Pressable>
        </View>

        <View style={[styles.viewToggleWrap, styles.pointerEventsBoxNone]}>
          <View style={styles.viewTogglePill}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Map view"
              onPress={async () => {
                await lightHaptic();
                setViewMode('map');
                // In map mode, close the sheet to make map the main focus
                // If a restaurant is selected, show minimal card at bottom (index 0)
                if (selectedRestaurantId) {
                  openSheetTo(0);
                } else {
                  setSheetIndex(-1);
                  sheetRef.current?.close();
                }
              }}
              style={({ pressed }) => [
                styles.viewToggleBtn,
                viewMode === 'map' ? styles.viewToggleBtnActive : null,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <SDText weight="semibold" color={viewMode === 'map' ? 'black' : 'text'}>
                Map
              </SDText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="List view"
              onPress={() => {
                lightHaptic(); // Don't await - fire and forget
                setViewMode('list');
                openSheetTo(1); // Open immediately
              }}
              style={({ pressed }) => [
                styles.viewToggleBtn,
                viewMode === 'list' ? styles.viewToggleBtnActive : null,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <SDText weight="semibold" color={viewMode === 'list' ? 'black' : 'text'}>
                List
              </SDText>
            </Pressable>
          </View>
        </View>

        {locationDenied ? (
          <View style={styles.locationBanner}>
            <View style={styles.locationBannerBody}>
              <SDText weight="semibold">Location is off</SDText>
              <SDText color="textMuted" variant="caption">
                Enable it to discover nearby restaurants.
              </SDText>
            </View>
            <SDButton title="Use current location" onPress={onUseCurrentLocation} />
          </View>
        ) : null}

        <BottomSheet
          ref={(ref) => {
            sheetRef.current = ref;
            if (ref && !sheetInitializedRef.current) {
              sheetInitializedRef.current = true;
              if (__DEV__) console.log('[MapScreen] BottomSheet ref initialized');
              
              if (!hasSheetBeenPrimedRef.current) {
                hasSheetBeenPrimedRef.current = true;
                isPrimingRef.current = true;
                
                // Use setTimeout with longer delay to ensure content is fully rendered
                setTimeout(() => {
                  if (sheetRef.current) {
                    try {
                      // Set index to 0 to render content first
                      setSheetIndex(0);
                      // Then expand after content is rendered (wait longer for scrollable ref to be available)
                      setTimeout(() => {
                        if (sheetRef.current) {
                          sheetRef.current.expand();
                          // Close after a longer delay to ensure scrollable ref is fully initialized
                          setTimeout(() => {
                            if (sheetRef.current) {
                              sheetRef.current.close();
                              setSheetIndex(-1);
                            }
                            isPrimingRef.current = false;
                            if (__DEV__) console.log('[MapScreen] BottomSheet priming complete');
                          }, 200);
                        }
                      }, 250);
                    } catch (e) {
                      if (__DEV__) console.warn('[MapScreen] Failed to prime BottomSheet:', e);
                      isPrimingRef.current = false;
                    }
                  }
                }, 300);
              }
            }
          }}
          index={sheetIndex}
          onChange={(i) => {
            if (__DEV__) console.log('[MapScreen] BottomSheet onChange:', i, 'previous sheetIndex:', sheetIndex);
            setSheetIndex(i);
            if (i === -1) {
              hasSheetBeenOpenedRef.current = false;
              // Check if we're opening the ranking form before clearing selectedRestaurantId
              const isOpeningRankingForm = isMainSheetClosing;
              // Don't set isMainSheetClosing to false here if we're opening ranking form
              // Let the useEffect handle it so it can open the ranking sheet
              if (!isOpeningRankingForm) {
                setIsMainSheetClosing(false);
              }
              
              const timeSinceOpen = Date.now() - lastOpenTimeRef.current;
              const wasJustOpened = timeSinceOpen < 500;
              
              if (viewMode === 'list') {
                setViewMode('map');
              } else if ((isUserClosingRef.current || !wasJustOpened) && !isOpeningRankingForm) {
                // Don't clear selectedRestaurantId if we're opening the ranking form
                setSelectedRestaurantId(null);
              }
              isUserClosingRef.current = false;
            } else if (i >= 0) {
              hasSheetBeenOpenedRef.current = true;
              lastOpenTimeRef.current = Date.now();
            }
          }}
          snapPoints={snapPoints}
          enablePanDownToClose
          enableContentPanningGesture={viewMode === 'list' || selectedRestaurant !== null}
          animateOnMount={true}
          enableOverDrag={false}
          activeOffsetY={[-1, 1]}
          failOffsetX={[-5, 5]}
          containerStyle={styles.sheetContainer}
          backgroundStyle={styles.sheetBg}
          handleIndicatorStyle={styles.sheetHandle}
          backdropComponent={(props) => (
            <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.28} enableTouchThrough={false} />
          )}
        >
          <View style={styles.sheetContent}>
            {viewMode === 'list' ? (
              // List mode: Show all restaurants in card format
              isLoading ? (
                <View style={styles.sheetLoading}>
                  <SkeletonBlock height={18} width="60%" />
                  <SkeletonBlock height={14} width="40%" />
                  <SkeletonBlock height={38} width="100%" radius={theme.radii.pill} />
                </View>
              ) : (
                <RestaurantCardList
                  restaurants={restaurants}
                  onSelect={onListPick}
                  userLocation={userCenter}
                  isLoading={isLoading}
                />
              )
            ) : isLoading ? (
              <View style={styles.sheetLoading}>
                <SkeletonBlock height={18} width="60%" />
                <SkeletonBlock height={14} width="40%" />
                <SkeletonBlock height={38} width="100%" radius={theme.radii.pill} />
              </View>
            ) : selectedRestaurant ? (
              <BottomSheetScrollView
                ref={restaurantDetailsScrollViewRef}
                contentContainerStyle={styles.restaurantDetailContainer}
                keyboardShouldPersistTaps="handled"
                onScrollBeginDrag={() => {
                  // Expand to full screen when user starts scrolling
                  if (sheetIndex === 0 && sheetRef.current) {
                    sheetRef.current.snapToIndex(1);
                  }
                }}
              >
                {/* Header with Close Button */}
                <View style={styles.restaurantSheetHeader}>
                  <SDText variant="title" weight="bold" style={styles.restaurantName}>
                    {selectedRestaurant.name}
                  </SDText>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close"
                    onPress={() => {
                      setSheetIndex(-1);
                      sheetRef.current?.close();
                    }}
                    style={({ pressed }) => [styles.closeButton, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <Ionicons name="close" size={24} color={theme.colors.text} />
                  </Pressable>
                </View>

                {/* Image Carousel */}
                <DishImageCarousel
                  images={dishRankings.filter((r) => r.image_url).map((r) => r.image_url!)}
                  restaurantId={selectedRestaurant.id}
                  restaurantName={selectedRestaurant.name}
                  onFavorite={async () => {
                    await lightHaptic();
                    // TODO: Implement favorite functionality
                  }}
                  onClose={() => {
                    setSheetIndex(-1);
                    sheetRef.current?.close();
                  }}
                  showFavoriteLabel={selectedRestaurant.top_dish_net_score > 7}
                />

                {/* Restaurant Information */}
                <View style={styles.restaurantInfoContainer}>
                  <View style={styles.restaurantHeader}>
                    <View style={styles.restaurantHeaderLeft}>
                      <View style={styles.ratingRow}>
                        <Ionicons name="star" size={16} color={theme.colors.brand} />
                        <SDText weight="semibold" style={styles.ratingText}>
                          {typeof selectedRestaurant.top_dish_net_score === 'number' 
                            ? selectedRestaurant.top_dish_net_score.toFixed(2) 
                            : '0.00'} ({dishRankings.length} {dishRankings.length === 1 ? 'rating' : 'ratings'})
                        </SDText>
                      </View>
                      {(selectedRestaurant.establishment_type || selectedRestaurant.cuisine || selectedRestaurant.address) && (
                        <SDText color="textMuted" variant="caption" style={styles.restaurantDescription}>
                          {[
                            selectedRestaurant.establishment_type,
                            selectedRestaurant.cuisine,
                            selectedRestaurant.address,
                          ]
                            .filter(Boolean)
                            .join(' • ')}
                        </SDText>
                      )}
                    </View>
                  </View>

                  {/* Rate a Dish Button */}
                  <SDButton
                    title="Rate a Dish"
                    onPress={() => void handleOpenRankingForm()}
                    style={styles.rateDishButton}
                  />
                </View>

                {/* Dish Rankings Section */}
                <View style={styles.dishRankingsSection}>
                  <SDText weight="bold" variant="subtitle" style={styles.dishRankingsTitle}>
                    Top Dish Rankings
                  </SDText>
                  {isLoadingDishRankings ? (
                    <View style={styles.dishRankingsLoading}>
                      <ActivityIndicator size="small" color={theme.colors.brand} />
                      <SDText color="textMuted" variant="caption">Loading rankings...</SDText>
                    </View>
                  ) : dishRankings.length === 0 ? (
                    <View style={styles.dishRankingsEmpty}>
                      <SDText color="textMuted" variant="caption">
                        No dish rankings yet. Be the first to rate a dish!
                      </SDText>
                    </View>
                  ) : (
                    <View style={styles.dishRankingsList}>
                      {[...dishRankings]
                        .sort((a, b) => b.score - a.score)
                        .map((ranking) => (
                          <View key={ranking.id} style={styles.dishRankingItem}>
                            {ranking.image_url ? (
                              <Image
                                source={{ uri: ranking.image_url }}
                                style={styles.dishRankingImage}
                                resizeMode="cover"
                              />
                            ) : (
                              <View style={styles.dishRankingImagePlaceholder}>
                                <Ionicons name="restaurant" size={32} color={theme.colors.textMuted} />
                              </View>
                            )}
                            <View style={styles.dishRankingContent}>
                              <SDText weight="semibold" numberOfLines={1}>
                                {ranking.dish_name}
                              </SDText>
                              <View style={styles.dishRankingScoreRow}>
                                <View style={styles.dishRankingScorePill}>
                                  <SDText weight="bold" color="black" variant="caption">
                                    {ranking.score}/10
                                  </SDText>
                                </View>
                                {ranking.price_cents != null ? (
                                  <SDText color="textMuted" variant="caption">
                                    ${(ranking.price_cents / 100).toFixed(2)}
                                  </SDText>
                                ) : null}
                              </View>
                              {ranking.ingredients ? (
                                <SDText color="textMuted" variant="caption" numberOfLines={2}>
                                  {ranking.ingredients}
                                </SDText>
                              ) : null}
                            </View>
                          </View>
                        ))}
                    </View>
                  )}
                </View>
              </BottomSheetScrollView>
            ) : (
              <View style={styles.sheetEmpty}>
                <SDText weight="semibold">{isSearchMode ? 'Browse results' : 'Pick a restaurant'}</SDText>
                <SDText color="textMuted" variant="caption">
                  {isSearchMode ? 'Switch to List to browse.' : 'Tap a pin to see the Star Dish preview.'}
                </SDText>
              </View>
            )}
          </View>
        </BottomSheet>

        {(selectedRestaurant || ratingRestaurantIdRef.current) && (
          <BottomSheet
            ref={rankingSheetRef}
            index={rankingSheetIndex}
            onChange={(index) => {
              setRankingSheetIndex(index);
              // Don't reset if we're in the process of opening the form
              if (index === -1 && !isOpeningRankingFormRef.current && ratingRestaurantIdRef.current === null) {
                resetRankingForm();
              }
            }}
            snapPoints={rankingSnapPoints}
            enablePanDownToClose
            keyboardBehavior="interactive"
            keyboardBlurBehavior="restore"
            android_keyboardInputMode="adjustResize"
            containerStyle={[styles.sheetContainer, { zIndex: 1000 }]}
            backgroundStyle={styles.sheetBg}
            handleIndicatorStyle={styles.sheetHandle}
            backdropComponent={(props) => (
              <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.5} />
            )}
          >
          <View style={styles.rankingFormContent}>
            <View style={styles.rankingFormHeader}>
              <SDText variant="subtitle" weight="bold" style={styles.rankingFormTitle}>
                {ratingRestaurantNameForTitle ? `Rate a dish at ${ratingRestaurantNameForTitle}` : 'Rate a Dish'}
              </SDText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close form"
                onPress={resetRankingForm}
                style={({ pressed }) => [styles.rankingCloseBtn, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Ionicons name="close" size={24} color={theme.colors.text} />
              </Pressable>
            </View>

            <BottomSheetScrollView
              ref={rankingScrollViewRef}
              contentContainerStyle={styles.rankingFormScroll}
              keyboardShouldPersistTaps="handled"
            >
              <SDText weight="semibold" style={styles.rankingLabel}>
                Dish Name *
              </SDText>
              {rankingSheetIndex >= 0 && rankingScrollViewRef.current ? (
                <BottomSheetTextInput
                  id="ranking-dish-name"
                  style={styles.rankingInput}
                  value={rankingDishName}
                  onChangeText={setRankingDishName}
                  placeholder="e.g. Tacos al Pastor"
                  placeholderTextColor={theme.colors.textMuted}
                />
              ) : (
                <TextInput
                  style={styles.rankingInput}
                  value={rankingDishName}
                  onChangeText={setRankingDishName}
                  placeholder="e.g. Tacos al Pastor"
                  placeholderTextColor={theme.colors.textMuted}
                />
              )}

              <SDText weight="semibold" style={styles.rankingLabel}>
                Price (optional)
              </SDText>
              {rankingSheetIndex >= 0 && rankingScrollViewRef.current ? (
                <BottomSheetTextInput
                  id="ranking-price"
                  style={styles.rankingInput}
                  value={rankingPrice}
                  onChangeText={setRankingPrice}
                  placeholder="e.g. 12.50"
                  placeholderTextColor={theme.colors.textMuted}
                  keyboardType="decimal-pad"
                />
              ) : (
                <TextInput
                  style={styles.rankingInput}
                  value={rankingPrice}
                  onChangeText={setRankingPrice}
                  placeholder="e.g. 12.50"
                  placeholderTextColor={theme.colors.textMuted}
                  keyboardType="decimal-pad"
                />
              )}

              <SDText weight="semibold" style={styles.rankingLabel}>
                Ingredients (optional)
              </SDText>
              {rankingSheetIndex >= 0 && rankingScrollViewRef.current ? (
                <BottomSheetTextInput
                  id="ranking-ingredients"
                  style={styles.rankingInput}
                  value={rankingIngredients}
                  onChangeText={setRankingIngredients}
                  placeholder="e.g. pork, pineapple, cilantro"
                  placeholderTextColor={theme.colors.textMuted}
                />
              ) : (
                <TextInput
                  style={styles.rankingInput}
                  value={rankingIngredients}
                  onChangeText={setRankingIngredients}
                  placeholder="e.g. pork, pineapple, cilantro"
                  placeholderTextColor={theme.colors.textMuted}
                />
              )}

              <SDText weight="semibold" style={styles.rankingLabel}>
                Score (0–10) *
              </SDText>
              <View style={styles.scorePickerRow}>
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <Pressable
                    key={n}
                    accessibilityRole="button"
                    accessibilityLabel={`Score ${n}`}
                    onPress={() => setRankingScore(n)}
                    style={[
                      styles.scoreChip,
                      rankingScore === n ? styles.scoreChipSelected : null,
                    ]}
                  >
                    <SDText
                      variant="caption"
                      weight={rankingScore === n ? 'bold' : 'regular'}
                      color={rankingScore === n ? 'black' : 'text'}
                    >
                      {n}
                    </SDText>
                  </Pressable>
                ))}
              </View>

              <SDText weight="semibold" style={styles.rankingLabel}>
                Photo (optional)
              </SDText>
              {rankingImageUri ? (
                <View style={styles.photoPreviewWrap}>
                  <Image source={{ uri: rankingImageUri }} style={styles.photoPreview} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove photo"
                    onPress={() => setRankingImageUri(null)}
                    style={styles.photoRemoveBtn}
                  >
                    <Ionicons name="close-circle" size={28} color={theme.colors.text} />
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Upload a photo"
                  onPress={() => void handlePickImage()}
                  style={({ pressed }) => [styles.uploadPhotoBtn, { opacity: pressed ? 0.85 : 1 }]}
                >
                  <Ionicons name="camera-outline" size={24} color={theme.colors.text} />
                  <SDText weight="semibold">Upload a photo</SDText>
                </Pressable>
              )}

              <SDButton
                title={isSubmittingRanking ? 'Submitting...' : 'Submit Rating'}
                onPress={() => void handleSubmitRanking()}
                disabled={isSubmittingRanking || !rankingDishName.trim()}
                style={styles.submitRankingBtn}
              />
            </BottomSheetScrollView>
          </View>
        </BottomSheet>
        )}

        <BottomSheet
          ref={filterSheetRef}
          index={filterSheetIndex}
          onChange={(i) => {
            setFilterSheetIndex(i);
            if (i === -1) onCloseFilters();
          }}
          snapPoints={filterSnapPoints}
          enablePanDownToClose
          backgroundStyle={styles.sheetBg}
          handleIndicatorStyle={styles.sheetHandle}
          backdropComponent={(props) => (
            <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.28} />
          )}
        >
          <View style={styles.filterSheetContent}>
            <View style={styles.filterHeaderRow}>
              <SDText weight="bold" variant="subtitle">
                Filters
              </SDText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Reset filters"
                onPress={onResetFilters}
                style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}
              >
                <SDText color="textMuted" variant="caption" style={styles.filterResetText}>
                  Reset
                </SDText>
              </Pressable>
            </View>

            <SDText weight="semibold">Categories</SDText>
            <View style={styles.filterCategoriesWrap}>
              {CUISINE_CATEGORIES.map((c) => {
                const selected = c.id === selectedCuisineId;
                return (
                  <Pressable
                    key={`filter-${c.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Filter category ${c.label}`}
                    onPress={async () => {
                      await lightHaptic();
                      setSelectedCuisineId(c.id);
                    }}
                    style={({ pressed }) => [
                      styles.filterChip,
                      selected ? styles.filterChipSelected : null,
                      { opacity: pressed ? 0.85 : 1 },
                    ]}
                  >
                    <SDText variant="caption" weight={selected ? 'bold' : 'semibold'} color={selected ? 'black' : 'text'}>
                      {c.label}
                    </SDText>
                  </Pressable>
                );
              })}
            </View>

            {userCenter && !locationDenied ? (
              <>
                <View style={styles.filterDistanceHeader}>
                  <SDText weight="semibold">Distance to me</SDText>
                  <SDText color="textMuted" variant="caption">
                    {maxDistanceKm == null ? 'Any' : `${maxDistanceKm} km`}
                  </SDText>
                </View>

                <View style={styles.filterDistanceRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Decrease distance"
                    onPress={() => void bumpDistance(-1)}
                    style={({ pressed }) => [styles.filterDistanceBtn, { opacity: pressed ? 0.85 : 1 }]}
                  >
                    <Ionicons name="remove" size={18} color={theme.colors.text} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Increase distance"
                    onPress={() => void bumpDistance(1)}
                    style={({ pressed }) => [styles.filterDistanceBtn, { opacity: pressed ? 0.85 : 1 }]}
                  >
                    <Ionicons name="add" size={18} color={theme.colors.text} />
                  </Pressable>
                </View>
              </>
            ) : (
              <SDText color="textMuted" variant="caption">
                Enable location to filter by distance.
              </SDText>
            )}

            <SDButton title="Show results" onPress={() => setFilterSheetIndex(-1)} />
          </View>
        </BottomSheet>

        <AuthErrorModal
          visible={showAuthErrorModal}
          onClose={() => setShowAuthErrorModal(false)}
          onSignIn={() => {
            setShowAuthErrorModal(false);
            navigation.navigate('Profile');
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  mapContainer: {
    flex: 1,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  topBar: {
    position: 'absolute',
    top: theme.spacing.md,
    left: theme.spacing.md,
    right: theme.spacing.md,
    alignItems: 'stretch',
    zIndex: 10,
    overflow: 'visible',
  },
  pointerEventsBoxNone: {
    pointerEvents: 'box-none' as const,
  },
  pointerEventsNone: {
    pointerEvents: 'none' as const,
  },
  topBarInner: {
    alignItems: 'stretch',
    gap: theme.spacing.xs,
    overflow: 'visible',
  },
  cityPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(255,255,255,0.95)',
    minHeight: 36,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  categoriesRow: {
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 2,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: theme.radii.pill,
    borderWidth: 1.5,
    borderColor: 'rgba(255,106,61,0.3)',
    backgroundColor: 'rgba(255,255,255,0.95)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  categoryChipSelected: {
    borderColor: theme.colors.brand,
    backgroundColor: theme.colors.brand,
    shadowColor: theme.colors.brand,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  searchPill: {
    width: '100%',
    position: 'relative',
    overflow: 'visible',
    zIndex: 100,
  },
  searchPillContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flex: 1,
    gap: theme.spacing.sm,
  },
  searchPillTextContainer: {
    flex: 1,
    gap: 2,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.text,
    paddingVertical: 2,
  },
  searchClearBtn: {
    borderRadius: theme.radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    padding: 6,
    backgroundColor: theme.colors.surface2,
  },
  searchIconBtn: {
    borderRadius: theme.radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    padding: 6,
    backgroundColor: theme.colors.surface2,
  },
  locationBanner: {
    position: 'absolute',
    left: theme.spacing.md,
    right: theme.spacing.md,
    bottom: theme.spacing.md,
    borderRadius: theme.radii.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(17,21,34,0.95)',
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  locationBannerBody: {
    gap: 4,
  },
  fabWrap: {
    position: 'absolute',
    right: theme.spacing.md,
    bottom: 120 + 86,
    alignItems: 'flex-end',
    gap: theme.spacing.sm,
    zIndex: 10,
  },
  fetchingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: theme.radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  fab: {
    alignSelf: 'flex-end',
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  viewToggleWrap: {
    position: 'absolute',
    left: theme.spacing.md,
    right: theme.spacing.md,
    bottom: theme.spacing.lg + 86,
    alignItems: 'center',
    zIndex: 10,
  },
  viewTogglePill: {
    flexDirection: 'row',
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(255,255,255,0.95)',
    padding: theme.spacing.xs,
    gap: theme.spacing.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  viewToggleBtn: {
    borderRadius: theme.radii.pill,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: 'transparent',
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewToggleBtnActive: {
    backgroundColor: theme.colors.brand,
    shadowColor: theme.colors.brand,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  sheetContainer: {
    zIndex: 999,
    elevation: 999,
  },
  sheetBg: {
    backgroundColor: theme.colors.surface,
  },
  sheetHandle: {
    backgroundColor: 'rgba(15,23,42,0.18)',
    width: 44,
  },
  sheetContent: {
    flex: 1,
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  filterSheetContent: {
    flex: 1,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  filterHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  filterResetText: {
    textDecorationLine: 'underline',
  },
  filterCategoriesWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  filterChip: {
    borderRadius: theme.radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    paddingVertical: 8,
    paddingHorizontal: theme.spacing.md,
  },
  filterChipSelected: {
    borderColor: 'rgba(0,0,0,0.15)',
    backgroundColor: theme.colors.brand,
  },
  filterDistanceHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  filterDistanceRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  filterDistanceBtn: {
    borderRadius: theme.radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetLoading: {
    gap: theme.spacing.sm,
  },
  sheetEmpty: {
    gap: 6,
  },
  listHeader: {
    gap: 4,
  },
  listContent: {
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  listRowBody: {
    flex: 1,
    gap: 2,
  },
  listScorePill: {
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.brand,
    paddingVertical: 6,
    paddingHorizontal: 10,
    minWidth: 40,
    alignItems: 'center',
  },
  placeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  placeHeaderLeft: {
    flex: 1,
    gap: 4,
  },
  scorePillCompact: {
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.brand,
    paddingVertical: 6,
    paddingHorizontal: 10,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },
  quickActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: theme.radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    paddingVertical: 10,
    paddingHorizontal: theme.spacing.md,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  actionButtonFlex: {
    flex: 1,
  },
  rankingFormContent: {
    flex: 1,
    paddingHorizontal: theme.spacing.md,
  },
  rankingFormHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  rankingFormTitle: {
    flex: 1,
  },
  rankingCloseBtn: {
    padding: 4,
  },
  rankingFormScroll: {
    gap: theme.spacing.sm,
    paddingBottom: 120,
  },
  rankingLabel: {
    marginTop: theme.spacing.xs,
  },
  rankingInput: {
    borderRadius: theme.radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    color: theme.colors.text,
    fontSize: 16,
  },
  scorePickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs,
  },
  scoreChip: {
    borderRadius: theme.radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 36,
    alignItems: 'center',
  },
  scoreChipSelected: {
    borderColor: 'rgba(0,0,0,0.15)',
    backgroundColor: theme.colors.brand,
  },
  uploadPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    borderRadius: theme.radii.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    paddingVertical: theme.spacing.lg,
    paddingHorizontal: theme.spacing.md,
  },
  photoPreviewWrap: {
    position: 'relative',
    alignSelf: 'flex-start',
  },
  photoPreview: {
    width: 160,
    height: 120,
    borderRadius: theme.radii.md,
    backgroundColor: theme.colors.surface2,
  },
  photoRemoveBtn: {
    position: 'absolute',
    top: -8,
    right: -8,
    backgroundColor: theme.colors.bg,
    borderRadius: 14,
  },
  submitRankingBtn: {
    marginTop: theme.spacing.lg,
    marginBottom: theme.spacing.xl,
  },
  dishRankingsSection: {
    marginTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.xl,
  },
  dishRankingsTitle: {
    marginBottom: theme.spacing.xs,
  },
  dishRankingsLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
  },
  dishRankingsEmpty: {
    paddingVertical: theme.spacing.md,
  },
  dishRankingsList: {
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  dishRankingCard: {
    width: 200,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.surface2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  dishRankingImage: {
    width: 120,
    height: 120,
    backgroundColor: theme.colors.surface2,
  },
  dishRankingImagePlaceholder: {
    width: 120,
    height: 120,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dishRankingContent: {
    flex: 1,
    padding: theme.spacing.sm,
    gap: 6,
  },
  dishRankingScoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  dishRankingScorePill: {
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.brand,
    paddingVertical: 4,
    paddingHorizontal: 8,
    minWidth: 50,
    alignItems: 'center',
  },
  restaurantDetailContainer: {
    backgroundColor: theme.colors.surface,
    paddingBottom: theme.spacing.lg,
  },
  restaurantInfoContainer: {
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  restaurantHeader: {
    gap: theme.spacing.xs,
  },
  restaurantHeaderLeft: {
    gap: 8,
  },
  restaurantName: {
    fontSize: 24,
    lineHeight: 28,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ratingText: {
    fontSize: 15,
  },
  restaurantDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  rateDishButton: {
    marginTop: theme.spacing.sm,
  },
  restaurantSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  closeButton: {
    padding: theme.spacing.sm,
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.surface2,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dishRankingItem: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
    marginBottom: theme.spacing.md,
    padding: theme.spacing.md,
    gap: theme.spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
});

