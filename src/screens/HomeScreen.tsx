import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';

import { Screen } from '../components/Screen';
import { SDText } from '../components/ui';
import { SearchHeader } from '../components/SearchHeader';
import { getUserLocationBestEffort } from '../lib/location';
import { lightHaptic } from '../lib/haptics';
import { useSearch } from '../state/SearchContext';
import { useMapFocus } from '../state/MapFocusContext';
import { getTopRankedRestaurants, trackRestaurantView, extractOsmId } from '../services/recommendationService';
import { theme } from '../theme';
import type { ViewportBounds, MapboxFeature, RestaurantWithRanking } from '../types/database';

const HOME_IMAGES = {
  // Small, cache-friendly Unsplash images (CDN).
  banner:
    'https://images.unsplash.com/photo-1529692236671-f1dcf7d6c6d8?auto=format&fit=crop&w=1200&q=70',
  card1:
    'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=900&q=70',
  card2:
    'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=900&q=70',
  card3:
    'https://images.unsplash.com/photo-1553621042-f6e147245754?auto=format&fit=crop&w=900&q=70',
} as const;

type HomeCard = {
  title: string;
  subtitle: string;
  imageUrl: string;
  query: string;
};

const POPULAR_CARDS: HomeCard[] = [
  { title: 'Sushi night', subtitle: 'Fresh • trending', imageUrl: HOME_IMAGES.card3, query: 'sushi' },
  { title: 'Italian', subtitle: 'Pasta • pizza', imageUrl: HOME_IMAGES.card2, query: 'italian' },
  { title: 'Burgers', subtitle: 'Fast • classic', imageUrl: HOME_IMAGES.card1, query: 'burger' },
];

function viewportAround(center: { latitude: number; longitude: number }, spanDeg: number): ViewportBounds {
  const half = spanDeg / 2;
  return {
    northEastLat: center.latitude + half,
    northEastLng: center.longitude + half,
    southWestLat: center.latitude - half,
    southWestLng: center.longitude - half,
  };
}

function bestCityLabel(places: Location.LocationGeocodedAddress[]) {
  const first = places[0];
  if (!first) return null;
  const city = first.city ?? first.subregion ?? first.district ?? null;
  const region = first.region ?? null;
  return [city, region].filter(Boolean).join(', ') || null;
}

export function HomeScreen() {
  const navigation = useNavigation();
  const { setSearch } = useSearch();
  const { focusRestaurant } = useMapFocus();

  const [cityLabel, setCityLabel] = useState<string>('—');
  const [loadingCity, setLoadingCity] = useState(true);
  const [cityError, setCityError] = useState<string | null>(null);
  const [userCenter, setUserCenter] = useState<{ latitude: number; longitude: number } | null>(null);
  const [topRestaurants, setTopRestaurants] = useState<RestaurantWithRanking[]>([]);
  const [loadingTopRestaurants, setLoadingTopRestaurants] = useState(true);


  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const loc = await getUserLocationBestEffort();
        if (!alive) return;
        if (loc.status !== 'granted') {
          setCityError('Enable location to browse nearby restaurants.');
          return;
        }

        const center = { latitude: loc.location.latitude, longitude: loc.location.longitude };
        setUserCenter(center);

        const places = await Location.reverseGeocodeAsync(center);
        if (!alive) return;
        const label = bestCityLabel(places);
        if (label) setCityLabel(label);
      } catch (e) {
        if (!alive) return;
        setCityError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        if (!alive) return;
        setLoadingCity(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const onMapboxSearchSelect = useCallback(
    async (feature: MapboxFeature) => {
      if (!userCenter) {
        setCityError('Enable location to search.');
        return;
      }

      await lightHaptic();
      Keyboard.dismiss();

      // Navigate to Map screen - the Map screen will handle the Mapbox feature
      // We'll pass the feature through navigation params
      const viewport = viewportAround(userCenter, 1.2);
      setSearch({ query: feature.properties.name || feature.place_name || '', viewport });
      (navigation as any).navigate('Map', { mapboxFeature: feature });
    },
    [navigation, setSearch, userCenter]
  );

  // Fetch top-ranked restaurants
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoadingTopRestaurants(true);
        // Use user location as proximity for better search results
        const proximity = userCenter ? { latitude: userCenter.latitude, longitude: userCenter.longitude } : undefined;
        const restaurants = await getTopRankedRestaurants(6, proximity);
        if (!alive) return;
        
        // Final deduplication by restaurant ID and name to prevent any duplicates
        const uniqueRestaurants = new Map<string, RestaurantWithRanking>();
        for (const restaurant of restaurants) {
          const osmId = extractOsmId(restaurant.id);
          // Normalize OSM ID to handle leading zeros (e.g., "123" vs "0123")
          const normalizedOsmId = osmId ? String(Number(osmId) || osmId) : null;
          // Use normalized OSM ID if available, otherwise use restaurant ID
          const key = normalizedOsmId || restaurant.id;
          
          // Only add if we haven't seen this restaurant before
          if (!uniqueRestaurants.has(key)) {
            uniqueRestaurants.set(key, restaurant);
          } else if (__DEV__) {
            console.warn(`[HomeScreen] Duplicate restaurant detected: ${restaurant.name} (OSM ID: ${normalizedOsmId || 'N/A'})`);
          }
        }
        
        if (__DEV__) {
          console.log(`[HomeScreen] Setting ${uniqueRestaurants.size} unique restaurants from ${restaurants.length} total`);
        }
        
        setTopRestaurants(Array.from(uniqueRestaurants.values()));
      } catch (e) {
        if (!alive) return;
        if (__DEV__) {
          console.warn('Failed to fetch top restaurants:', e);
        }
      } finally {
        if (!alive) return;
        setLoadingTopRestaurants(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [userCenter]);

  const onRestaurantSelect = useCallback(
    async (restaurant: RestaurantWithRanking) => {
      await lightHaptic();
      Keyboard.dismiss();

      // Track restaurant view
      const osmId = extractOsmId(restaurant.id);
      if (osmId) {
        await trackRestaurantView(osmId, restaurant.name);
      }

      // If restaurant has valid coordinates (not 0,0), focus on it directly
      if (restaurant.lat !== 0 && restaurant.lng !== 0 && !isNaN(restaurant.lat) && !isNaN(restaurant.lng)) {
        focusRestaurant({
          restaurantId: restaurant.id,
          name: restaurant.name,
          lat: restaurant.lat,
          lng: restaurant.lng,
        });
        (navigation as any).navigate('Map');
      } else {
        // If no valid coordinates, search for it on Map screen
        // This will trigger Mapbox search on the Map screen
        const viewport = userCenter ? viewportAround(userCenter, 1.2) : undefined;
        if (viewport) {
          setSearch({ query: restaurant.name, viewport });
        }
        (navigation as any).navigate('Map');
      }
    },
    [focusRestaurant, navigation, setSearch, userCenter]
  );

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerTopRow}>
            <View style={{ flex: 1 }}>
              <SDText variant="subtitle" weight="bold">
                Hello Alexis
              </SDText>
              <View style={styles.cityPill}>
                <Ionicons name="location-outline" size={14} color={theme.colors.textMuted} />
                <SDText color="textMuted" variant="caption">
                  {loadingCity ? 'Finding your city…' : cityError ? cityError : cityLabel}
                </SDText>
              </View>
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open profile"
              onPress={() => (navigation as any).navigate('Profile')}
              style={({ pressed }) => [styles.avatarBtn, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Ionicons name="person" size={18} color={theme.colors.text} />
            </Pressable>
          </View>
        </View>

        <View style={styles.bannerCard}>
          <Image source={{ uri: HOME_IMAGES.banner }} style={styles.bannerImage} />
          <View style={styles.bannerOverlay}>
            <SDText weight="bold" variant="subtitle" color="white">
              Discover top dishes
            </SDText>
            <SDText color="white" variant="caption" style={{ opacity: 0.9 }}>
              Find the best-rated dish near you.
            </SDText>
          </View>
        </View>

        <View style={styles.searchWrapper}>
          <SearchHeader
            placeholder="What restaurant are you at?"
            onSelect={onMapboxSearchSelect}
            proximity={userCenter || undefined}
            autoFocus={false}
          />
          {loadingCity ? (
            <View style={styles.searchHintRow}>
              <ActivityIndicator color={theme.colors.textMuted} size="small" />
              <SDText color="textMuted" variant="caption">
                Loading nearby area…
              </SDText>
            </View>
          ) : null}
        </View>

        <View style={styles.sectionHeader}>
          <SDText weight="bold" variant="subtitle">
            Popular this week
          </SDText>
          <SDText color="textMuted" variant="caption">
            Top ranked restaurants
          </SDText>
        </View>

        {loadingTopRestaurants ? (
          <View style={styles.popularLoadingContainer}>
            <ActivityIndicator color={theme.colors.brand} size="small" />
            <SDText color="textMuted" variant="caption" style={styles.popularLoadingText}>
              Loading top restaurants...
            </SDText>
          </View>
        ) : topRestaurants.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.popularRow}>
            {topRestaurants.map((restaurant) => {
              // Get cuisine image based on restaurant data
              const cuisineImage = (() => {
                const cuisine = (restaurant.cuisine || '').toLowerCase();
                const type = (restaurant.establishment_type || '').toLowerCase();
                
                if (cuisine.includes('pizza') || type.includes('pizza')) {
                  return HOME_IMAGES.card2;
                }
                if (cuisine.includes('burger') || type.includes('burger') || type.includes('fast_food')) {
                  return HOME_IMAGES.card1;
                }
                if (cuisine.includes('asian') || cuisine.includes('japanese') || cuisine.includes('chinese') || cuisine.includes('sushi')) {
                  return HOME_IMAGES.card3;
                }
                return HOME_IMAGES.card1; // Default
              })();

              const score = restaurant.top_dish_net_score || 0;
              const cuisineLabel = restaurant.cuisine 
                ? restaurant.cuisine.split(';')[0].trim() 
                : restaurant.establishment_type || 'Restaurant';

              return (
                <Pressable
                  key={restaurant.id}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${restaurant.name}`}
                  onPress={() => void onRestaurantSelect(restaurant)}
                  style={({ pressed }) => [styles.popularCard, { opacity: pressed ? 0.88 : 1 }]}
                >
                  <Image source={{ uri: cuisineImage }} style={styles.popularImage} />
                  <View style={styles.popularOverlay}>
                    <SDText weight="bold" color="white" numberOfLines={1}>
                      {restaurant.name}
                    </SDText>
                    <View style={styles.popularOverlayRow}>
                      {score > 0 && (
                        <View style={styles.popularScoreBadge}>
                          <Ionicons name="star" size={12} color={theme.colors.white} />
                          <SDText variant="caption" weight="bold" color="white">
                            {score.toFixed(1)}
                          </SDText>
                        </View>
                      )}
                      <SDText variant="caption" color="white" style={{ opacity: 0.9 }} numberOfLines={1}>
                        {cuisineLabel}
                      </SDText>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : (
          <View style={styles.popularEmptyContainer}>
            <SDText color="textMuted" variant="caption">
              No top restaurants available yet
            </SDText>
          </View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.lg,
    paddingBottom: 110,
    gap: theme.spacing.lg,
    backgroundColor: theme.colors.bg,
  },
  header: {
    gap: 6,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  avatarBtn: {
    width: 48,
    height: 48,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  cityPill: {
    marginTop: theme.spacing.xs,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  bannerCard: {
    borderRadius: theme.radii.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  bannerImage: {
    width: '100%',
    height: 140,
  },
  bannerOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: theme.spacing.lg,
    backgroundColor: 'rgba(15,23,42,0.35)',
  },
  searchWrapper: {
    position: 'relative',
    zIndex: 100,
    gap: theme.spacing.sm,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    borderRadius: theme.radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
  },
  searchInput: {
    flex: 1,
    color: theme.colors.text,
  },
  searchAction: {
    borderRadius: theme.radii.pill,
    backgroundColor: theme.colors.brand,
    padding: 10,
  },
  searchHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  popularRow: {
    gap: theme.spacing.md,
    paddingVertical: 2,
    paddingRight: theme.spacing.lg,
  },
  popularCard: {
    width: 220,
    height: 150,
    borderRadius: theme.radii.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  popularImage: {
    width: '100%',
    height: '100%',
  },
  popularOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: theme.spacing.md,
    backgroundColor: 'rgba(15,23,42,0.4)',
    gap: theme.spacing.xs,
  },
  popularOverlayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    flexWrap: 'wrap',
  },
  popularScoreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 106, 61, 0.9)',
    paddingHorizontal: theme.spacing.xs,
    paddingVertical: 2,
    borderRadius: theme.radii.sm,
  },
  popularLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.xl,
    gap: theme.spacing.sm,
  },
  popularLoadingText: {
    marginLeft: theme.spacing.xs,
  },
  popularEmptyContainer: {
    paddingVertical: theme.spacing.xl,
    alignItems: 'center',
  },
});


