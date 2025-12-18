// Mapbox CSS and components - Metro bundler doesn't support React.lazy for these modules
import 'mapbox-gl/dist/mapbox-gl.css';
import React, { useCallback, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { ActivityIndicator, Alert, Image, Keyboard, Linking, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

// react-map-gl v8 requires importing from specific subpaths
// @ts-ignore - Metro bundler compatibility
import { Map, Marker } from 'react-map-gl/mapbox';

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
import { fetchRestaurantsInViewport, searchRestaurantsInArea, findRestaurantByMapboxId, findRestaurantByCoordinates } from '../services/mapService';
import { trackRestaurantView, extractOsmId, getRecentlyViewedRestaurants, getTopPicks, getBestRated, fetchRestaurantsForRecommendations } from '../services/recommendationService';
import { RecommendationsList } from '../components/RecommendationsList';
import { SearchResultsList } from '../components/SearchResultsList';
import { RestaurantCardList } from '../components/RestaurantCardList';
import { SearchHeader } from '../components/SearchHeader';
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

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;

if (!MAPBOX_TOKEN) {
  console.warn('EXPO_PUBLIC_MAPBOX_TOKEN is not set. Map will not work on web.');
}

// Extract marker styles to constants to prevent re-creation on every render
const markerStyles = {
  container: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'white',
    boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    cursor: 'pointer' as const,
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

// Web-compatible marker component - memoized for performance
const WebMarker = React.memo(function WebMarker({
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
    
    if (__DEV__) console.log('[WebMarker] Clicked marker for restaurant:', restaurant.id, restaurant.name);
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

  return (
    <Marker
      latitude={restaurant.lat}
      longitude={restaurant.lng}
      anchor="bottom"
      onClick={handleClick}
    >
      <View style={markerContainerStyle}>
        <View style={markerStyles.inner} />
      </View>
    </Marker>
  );
}, (prev, next) => {
  return (
    prev.restaurant.id === next.restaurant.id &&
    prev.restaurant.lat === next.restaurant.lat &&
    prev.restaurant.lng === next.restaurant.lng &&
    prev.isSelected === next.isSelected &&
    prev.onPress === next.onPress
  );
});

// Web-compatible cluster marker component
const WebClusterMarker = React.memo(function WebClusterMarker({
  cluster,
  onPress,
}: {
  cluster: ClusteredPoint;
  onPress: (cluster: ClusteredPoint) => void;
}) {
  if (!isCluster(cluster)) return null;

  const handleClick = React.useCallback(() => {
    onPress(cluster);
  }, [onPress, cluster]);

  const pointCount = cluster.properties.point_count;
  const [lng, lat] = cluster.geometry.coordinates;

  // Determine cluster size based on point count
  const getClusterSize = () => {
    if (pointCount < 10) return 40;
    if (pointCount < 50) return 50;
    if (pointCount < 100) return 60;
    return 70;
  };

  const size = getClusterSize();
  const fontSize = pointCount < 10 ? 12 : pointCount < 100 ? 14 : 16;

  return (
    <Marker
      latitude={lat}
      longitude={lng}
      anchor="center"
      onClick={handleClick}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.colors.brand,
          borderWidth: 3,
          borderColor: theme.colors.white,
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}
      >
        <SDText
          weight="bold"
          color="white"
          style={{
            fontSize,
            color: theme.colors.white,
          }}
        >
          {pointCount < 1000 ? pointCount.toString() : cluster.properties.point_count_abbreviated}
        </SDText>
      </View>
    </Marker>
  );
}, (prev, next) => {
  return (
    prev.cluster.properties.cluster_id === next.cluster.properties.cluster_id &&
    prev.cluster.properties.point_count === next.cluster.properties.point_count &&
    prev.cluster.geometry.coordinates[0] === next.cluster.geometry.coordinates[0] &&
    prev.cluster.geometry.coordinates[1] === next.cluster.geometry.coordinates[1] &&
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
  const clustererRef = useRef<SuperClusterInstance | null>(null);

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
  
  // Dish rankings for selected restaurant
  const [dishRankings, setDishRankings] = useState<DishRanking[]>([]);
  const [isLoadingDishRankings, setIsLoadingDishRankings] = useState(false);

  // Refs for bottom sheet scrollable content
  const listFlatListRef = useRef<any>(null);
  const rankingScrollViewRef = useRef<any>(null);
  const restaurantDetailsScrollViewRef = useRef<any>(null);

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

  const snapPoints = useMemo(() => (viewMode === 'list' ? ['25%', '55%', '90%'] : ['45%', '52%']), [viewMode]);
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
      if (__DEV__) console.error('[MapScreen.web] Mapbox reverse geocoding failed:', error);
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
          if (__DEV__) console.log('[MapScreen.web] City label updated (Mapbox from viewport):', webLabel);
          return;
        }
        
        // Fallback to expo-location (may fail on web but try anyway)
        try {
          const places = await Location.reverseGeocodeAsync({ latitude: midLat, longitude: midLng });
          if (!alive) return;
          const label = bestCityLabel(places);
          if (label) {
            setCityLabel(label);
            if (__DEV__) console.log('[MapScreen.web] City label updated (expo-location from viewport):', label);
          }
        } catch (expoError) {
          // expo-location may fail on web, that's okay
          if (__DEV__) console.warn('[MapScreen.web] expo-location geocoding failed (expected on web):', expoError);
        }
      } catch (error) {
        if (__DEV__) console.error('[MapScreen.web] Reverse geocoding failed:', error);
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
      const restaurant: RestaurantWithRanking = {
        id: matchingRestaurants.length > 0 
          ? matchingRestaurants[0].id 
          : `mapbox:${feature.mapbox_id}`, // Fallback ID format
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
        mapRef.current.flyTo({
          center: [lng, lat],
          zoom: 15,
          duration: 500,
        });
      }

      // Update search state
      const currentViewport = viewStateToViewportBounds(viewStateRef.current);
      setSearch({ query: finalRestaurant.name, viewport: currentViewport });
      
      // Track restaurant view if we have an OSM ID
      const osmId = extractOsmId(finalRestaurant.id);
      if (osmId) {
        await trackRestaurantView(osmId, finalRestaurant.name);
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
        mapRef.current.flyTo({
          center: [centerLng, centerLat],
          zoom: newViewState.zoom,
          duration: 500,
        });
      }
      
      setAllRestaurants(results);
      setIsLoading(false);
      setIsTopSearchLoading(false);
    } catch (error) {
      if (__DEV__) {
        console.warn('[MapScreen.web] Search failed:', error);
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
      lastSearchQueryRef.current = '';
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
    setRecommendations(prev => ({ ...prev, isLoading: true }));
    
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
        console.warn('[MapScreen.web] Failed to load recommendations:', error);
      }
      setRecommendations(prev => ({ ...prev, isLoading: false }));
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
        // Use browser geolocation API to check accuracy
        let useLocation = true;
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
            if (__DEV__) console.warn('[MapScreen.web] Geolocation accuracy too low:', browserPos.coords.accuracy, 'm. Using Zapopan default.');
            useLocation = false;
          }
        } catch (e) {
          // If browser geolocation fails, use Zapopan default
          if (__DEV__) console.warn('[MapScreen.web] Browser geolocation check failed, using Zapopan default');
          useLocation = false;
        }

        if (useLocation) {
          setUserCenter({ lat: res.location.latitude, lng: res.location.longitude });

          // Try to get city label immediately from user location using web-compatible method
          try {
            const webLabel = await reverseGeocodeWeb(res.location.latitude, res.location.longitude);
            if (webLabel) {
              setCityLabel(webLabel);
              if (__DEV__) console.log('[MapScreen.web] City label from user location (Mapbox):', webLabel);
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
            if (mapRef.current) {
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
          if (__DEV__) console.log('[MapScreen.web] Using Zapopan, Jalisco as default location');
          
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
            if (mapRef.current) {
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
        if (__DEV__) console.log('[MapScreen.web] Location denied, using Zapopan, Jalisco as default');
      }
      }).catch((error) => {
        // Location detection errors are non-critical - just use default
        if (__DEV__) console.warn('[MapScreen.web] Location detection error (non-critical):', error);
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
    if (mapRef.current) {
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
          console.warn('[MapScreen.web] Search failed:', e);
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

    const nextViewState: ViewState = {
      latitude: lastFocus.lat,
      longitude: lastFocus.lng,
      zoom: 14,
      bearing: 0,
      pitch: 0,
      padding: { top: 0, bottom: 0, left: 0, right: 0 },
    };

    viewStateRef.current = nextViewState;
    setSelectedRestaurantId(lastFocus.restaurantId);
    setSelectedRestaurantNameHint(lastFocus.name);
    setViewMode('map');
    openSheetTo(0);
    setIsLoading(true);
    setViewport(viewStateToViewportBounds(nextViewState));
    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [lastFocus.lng, lastFocus.lat],
        zoom: 14,
        duration: 450,
      });
    }
  }, [lastFocus, openSheetTo]);

  useEffect(() => {
    if (!selectedRestaurantId) return;
    const hit = restaurants.find((r) => r.id === selectedRestaurantId);
    if (hit) setSelectedRestaurantNameHint(null);
  }, [restaurants, selectedRestaurantId]);

  useEffect(() => {
    if (!selectedRestaurant) {
      setDishRankings([]);
      return;
    }

    const match = selectedRestaurant.id.match(/^osm:(?:node|way|relation):(\d+)$/);
    const osmId = match ? match[1] : null;

    if (!osmId) {
      setDishRankings([]);
      return;
    }

    setIsLoadingDishRankings(true);
    getDishRankingsForRestaurant(osmId)
      .then((rankings) => {
        setDishRankings(rankings);
      })
      .catch((error) => {
        console.error('Failed to fetch dish rankings:', error);
        setDishRankings([]);
      })
      .finally(() => {
        setIsLoadingDishRankings(false);
      });
  }, [selectedRestaurant]);

  const onMoveEnd = useCallback((evt: { viewState: ViewState }) => {
    // Update viewStateRef immediately for clustering
    viewStateRef.current = evt.viewState;
    
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
        mapRef.current.flyTo({
          center: [restaurant.lng, restaurant.lat],
          zoom: 15,
          duration: 400,
        });
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
        mapRef.current.flyTo({
          center: [lng, lat],
          zoom: newZoom,
          duration: 200, // Reduced from 300ms for faster feel
        });
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
  // Removed debug logs for production performance
  const markerElements = useMemo(() => {
    // If clustering returns empty but we have restaurants, render visible ones directly
    if (clusteredData.length === 0 && visibleMarkers.length > 0) {
      // Pre-allocate array for better performance
      const elements: (JSX.Element | null)[] = new Array(visibleMarkers.length);
      for (let i = 0; i < visibleMarkers.length; i++) {
        const restaurant = visibleMarkers[i];
        if (!restaurant || typeof restaurant.id !== 'string' || typeof restaurant.lat !== 'number' || typeof restaurant.lng !== 'number') {
          elements[i] = null;
          continue;
        }
        elements[i] = (
          <WebMarker
            key={restaurant.id}
            restaurant={restaurant}
            isSelected={restaurant.id === selectedRestaurantId}
            onPress={stableOnMarkerPress.current}
          />
        );
      }
      return elements.filter((el): el is JSX.Element => el !== null);
    }
    
    // Pre-allocate array for clustered data
    const elements: (JSX.Element | null)[] = new Array(clusteredData.length);
    for (let i = 0; i < clusteredData.length; i++) {
      const point = clusteredData[i];
      if (isCluster(point)) {
        elements[i] = (
          <WebClusterMarker
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
          <WebMarker
            key={restaurant.id}
            restaurant={restaurant}
            isSelected={restaurant.id === selectedRestaurantId}
            onPress={stableOnMarkerPress.current}
          />
        );
      }
    }
    
    return elements.filter((el): el is JSX.Element => el !== null);
  }, [clusteredData, visibleMarkers, selectedRestaurantId]);

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
      if (mapRef.current) {
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
      if (mapRef.current) {
        mapRef.current.flyTo({
          center: [res.location.longitude, res.location.latitude],
          zoom: 14,
          duration: 200,
        });
      }
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
  }, []);

  useEffect(() => {
    if (!selectedRestaurant && rankingSheetIndex !== -1) {
      resetRankingForm();
    }
  }, [selectedRestaurant, rankingSheetIndex, resetRankingForm]);

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
    
    if (!selectedRestaurant) {
      Alert.alert('Error', 'No restaurant selected.');
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
      const restaurant = selectedRestaurant;
      const dishName = rankingDishName.trim();
      const ingredients = rankingIngredients.trim() || null;
      const score = rankingScore;

      const match = restaurant.id.match(/^osm:(?:node|way|relation):(\d+)$/);
      const osmId = match ? match[1] : restaurant.id;

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
                      osm_id: osmId,
                      restaurant_name: restaurant.name,
                      dish_name: dishName,
                      price_cents: priceCents,
                      ingredients: ingredients,
                      score: score,
                      image_url: null,
                    });
                    await lightHaptic();
                    Alert.alert('Success', 'Your dish ranking has been submitted!');
                    resetRankingForm();
                    if (match) {
                      getDishRankingsForRestaurant(osmId)
                        .then((rankings) => {
                          setDishRankings(rankings);
                          if (rankings.length > 0) {
                            const avgScore = rankings.reduce((sum, r) => sum + r.score, 0) / rankings.length;
                            setAllRestaurants((prev) =>
                              prev.map((r) =>
                                r.id === restaurant.id
                                  ? { ...r, top_dish_net_score: Math.round(avgScore * 10) / 10 }
                                  : r
                              )
                            );
                          }
                        })
                        .catch((error) => {
                          console.error('Failed to refresh dish rankings:', error);
                        });
                    }
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
        osm_id: osmId,
        restaurant_name: restaurant.name,
        dish_name: dishName,
        price_cents: priceCents,
        ingredients: ingredients,
        score: score,
        image_url: imageUrl,
      });
      await lightHaptic();
      Alert.alert('Success', 'Your dish ranking has been submitted!');
      resetRankingForm();
      if (match) {
        getDishRankingsForRestaurant(osmId)
          .then((rankings) => {
            setDishRankings(rankings);
            if (rankings.length > 0) {
              const avgScore = rankings.reduce((sum, r) => sum + r.score, 0) / rankings.length;
              setAllRestaurants((prev) =>
                prev.map((r) =>
                  r.id === restaurant.id
                    ? { ...r, top_dish_net_score: Math.round(avgScore * 10) / 10 }
                    : r
                )
              );
            }
          })
          .catch((error) => {
            console.error('Failed to refresh dish rankings:', error);
          });
      }
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
  }, [selectedRestaurant, rankingDishName, rankingPrice, rankingIngredients, rankingScore, rankingImageUri, isSubmittingRanking, resetRankingForm]);

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


  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.mapContainer}>
          <Map
            ref={mapRef}
            mapboxAccessToken={MAPBOX_TOKEN || ''}
            initialViewState={initialViewState}
            onMoveEnd={onMoveEnd}
            onError={(error) => {
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
            optimizeForTerrain={false}
            antialias={false}
            preserveDrawingBuffer={false}
            maxPitch={0}
            minZoom={10}
            maxZoom={18}
            renderWorldCopies={false}
            // Performance optimizations for web
            interactiveLayerIds={[]}
            preventStyleDiffing={false}
          >
            {markerElements}
          </Map>
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open filters"
                onPress={onOpenFilters}
                style={({ pressed }) => [styles.searchIconBtn, { opacity: pressed ? 0.75 : 1 }]}
              >
                <Ionicons name="options-outline" size={18} color={theme.colors.text} />
              </Pressable>
            </View>
            {__DEV__ ? (
              <View style={[styles.debugPill, styles.pointerEventsNone]}>
                <SDText color="textMuted" variant="caption">
                  Pins: {restaurants.length} · sheet: {sheetIndex}
                </SDText>
              </View>
            ) : null}
            <View style={[styles.attributionPill, styles.pointerEventsNone]}>
              <SDText color="textMuted" variant="caption">
                © OpenStreetMap contributors
              </SDText>
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
              setIsMainSheetClosing(false);
              
              const timeSinceOpen = Date.now() - lastOpenTimeRef.current;
              const wasJustOpened = timeSinceOpen < 500;
              
              if (viewMode === 'list') {
                setViewMode('map');
              } else if (isUserClosingRef.current || !wasJustOpened) {
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
                contentContainerStyle={styles.sheetContent}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.placeHeaderRow}>
                  <View style={styles.placeHeaderLeft}>
                    <SDText variant="subtitle" weight="bold">
                      {selectedRestaurant.name}
                    </SDText>
                    <SDText color="textMuted">{selectedRestaurant.address ?? 'Nearby'}</SDText>
                  </View>
                  <View style={styles.scorePillCompact}>
                    <SDText weight="bold" color="black" variant="caption">
                      {selectedRestaurant.top_dish_net_score}
                    </SDText>
                  </View>
                </View>

                {selectedRestaurant.establishment_type || selectedRestaurant.cuisine ? (
                  <SDText color="textMuted" variant="caption">
                    {[selectedRestaurant.establishment_type, selectedRestaurant.cuisine].filter(Boolean).join(' • ')}
                  </SDText>
                ) : null}

                {selectedRestaurant.opening_hours ? (
                  <SDText color="textMuted" variant="caption">
                    {selectedRestaurant.opening_hours}
                  </SDText>
                ) : null}

                <View style={styles.quickActionsRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Directions"
                    onPress={() => void openDirections(selectedRestaurant)}
                    style={({ pressed }) => [styles.quickActionBtn, { opacity: pressed ? 0.85 : 1 }]}
                  >
                    <Ionicons name="navigate-outline" size={18} color={theme.colors.text} />
                    <SDText variant="caption" weight="semibold">
                      Directions
                    </SDText>
                  </Pressable>

                  {selectedRestaurant.website ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Website"
                      onPress={() => void openExternalUrl(selectedRestaurant.website!)}
                      style={({ pressed }) => [styles.quickActionBtn, { opacity: pressed ? 0.85 : 1 }]}
                    >
                      <Ionicons name="globe-outline" size={18} color={theme.colors.text} />
                      <SDText variant="caption" weight="semibold">
                        Website
                      </SDText>
                    </Pressable>
                  ) : null}

                  {selectedRestaurant.phone ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Call"
                      onPress={() => void openExternalUrl(`tel:${selectedRestaurant.phone}`)}
                      style={({ pressed }) => [styles.quickActionBtn, { opacity: pressed ? 0.85 : 1 }]}
                    >
                      <Ionicons name="call-outline" size={18} color={theme.colors.text} />
                      <SDText variant="caption" weight="semibold">
                        Call
                      </SDText>
                    </Pressable>
                  ) : null}
                </View>

                <View style={styles.actionButtonsRow}>
                  <SDButton title="Open details" onPress={() => openSheetTo(1)} style={styles.actionButtonFlex} />
                  <SDButton
                    title="Rate a Dish"
                    tone="surface"
                    onPress={() => void handleOpenRankingForm()}
                    style={styles.actionButtonFlex}
                  />
                </View>

                <View style={styles.dishRankingsSection}>
                  <SDText weight="bold" variant="subtitle" style={styles.dishRankingsTitle}>
                    Dish Rankings
                  </SDText>
                  {isLoadingDishRankings ? (
                    <View style={styles.dishRankingsLoading}>
                      <ActivityIndicator size="small" color={theme.colors.textMuted} />
                      <SDText color="textMuted" variant="caption">
                        Loading dishes...
                      </SDText>
                    </View>
                  ) : dishRankings.length === 0 ? (
                    <View style={styles.dishRankingsEmpty}>
                      <SDText color="textMuted" variant="caption">
                        No dish rankings yet. Be the first to rate a dish!
                      </SDText>
                    </View>
                  ) : (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.dishRankingsList}
                    >
                      {dishRankings.map((ranking) => (
                        <View key={ranking.id} style={styles.dishRankingCard}>
                          {ranking.image_url ? (
                            <Image source={{ uri: ranking.image_url }} style={styles.dishRankingImage} />
                          ) : (
                            <View style={styles.dishRankingImagePlaceholder}>
                              <Ionicons name="restaurant-outline" size={32} color={theme.colors.textMuted} />
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
                    </ScrollView>
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

        {selectedRestaurant && (
          <BottomSheet
            ref={rankingSheetRef}
            index={rankingSheetIndex}
            onChange={(index) => {
              setRankingSheetIndex(index);
              if (index === -1) {
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
                {selectedRestaurant ? `Rate a dish at ${selectedRestaurant.name}` : 'Rate a Dish'}
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
                  name="rankingDishName"
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
                  name="rankingPrice"
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
                  name="rankingIngredients"
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
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: theme.radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(255,255,255,0.92)',
    minHeight: 32,
  },
  categoriesRow: {
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 2,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,106,61,0.28)',
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  categoryChipSelected: {
    borderColor: 'rgba(255,106,61,0.25)',
    backgroundColor: theme.colors.brand,
  },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(255,255,255,0.92)',
    width: '100%',
    position: 'relative',
    overflow: 'visible',
    zIndex: 100,
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
  attributionPill: {
    paddingVertical: 6,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  debugPill: {
    paddingVertical: 6,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(255,255,255,0.85)',
  },
  locationBanner: {
    position: 'absolute',
    left: theme.spacing.md,
    right: theme.spacing.md,
    bottom: theme.spacing.md,
    borderRadius: theme.radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(17,21,34,0.92)',
    padding: theme.spacing.md,
    gap: theme.spacing.md,
    zIndex: 10,
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingVertical: 10,
    paddingHorizontal: 10,
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: 'rgba(255,255,255,0.92)',
    padding: 4,
    gap: 4,
  },
  viewToggleBtn: {
    borderRadius: theme.radii.pill,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.lg,
    backgroundColor: 'transparent',
  },
  viewToggleBtnActive: {
    backgroundColor: theme.colors.brand,
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
    gap: theme.spacing.sm,
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
    width: '100%',
    height: 140,
    backgroundColor: theme.colors.surface2,
  },
  dishRankingImagePlaceholder: {
    width: '100%',
    height: 140,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dishRankingContent: {
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
});

