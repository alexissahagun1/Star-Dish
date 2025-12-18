import React from 'react';
import { View, StyleSheet, Pressable, FlatList, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { SDText } from './ui';
import { theme } from '../theme';
import { lightHaptic } from '../lib/haptics';
import type { RestaurantWithRanking } from '../types/database';

type RestaurantCardListProps = {
  restaurants: RestaurantWithRanking[];
  onSelect: (restaurant: RestaurantWithRanking) => void;
  userLocation?: { lat: number; lng: number } | null;
  isLoading?: boolean;
};

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

function formatDistance(km: number): string {
  if (km < 1) {
    return `${(km * 1000).toFixed(0)} M`;
  }
  return `${km.toFixed(2)} MI`;
}

// Placeholder images for different cuisine types
const getCuisineImage = (cuisine?: string | null, establishmentType?: string | null): string => {
  const cuisineLower = (cuisine || '').toLowerCase();
  const typeLower = (establishmentType || '').toLowerCase();
  
  if (cuisineLower.includes('pizza') || typeLower.includes('pizza')) {
    return 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=200&q=70';
  }
  if (cuisineLower.includes('burger') || typeLower.includes('burger') || typeLower.includes('fast_food')) {
    return 'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=200&q=70';
  }
  if (cuisineLower.includes('sandwich') || cuisineLower.includes('sub')) {
    return 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=200&q=70';
  }
  if (cuisineLower.includes('asian') || cuisineLower.includes('japanese') || cuisineLower.includes('chinese')) {
    return 'https://images.unsplash.com/photo-1553621042-f6e147245754?auto=format&fit=crop&w=200&q=70';
  }
  if (cuisineLower.includes('mexican') || cuisineLower.includes('tacos')) {
    return 'https://images.unsplash.com/photo-1565299585323-38174c0b0b0a?auto=format&fit=crop&w=200&q=70';
  }
  if (cuisineLower.includes('italian')) {
    return 'https://images.unsplash.com/photo-1551218808-94e220e084d2?auto=format&fit=crop&w=200&q=70';
  }
  // Default food image
  return 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=200&q=70';
};

// Generate a promotional offer based on restaurant data
function getPromotionalOffer(restaurant: RestaurantWithRanking): string {
  const cuisine = (restaurant.cuisine || '').toLowerCase();
  const type = (restaurant.establishment_type || '').toLowerCase();
  
  if (cuisine.includes('pizza') || type.includes('pizza')) {
    return 'Free Breadsticks when you buy a pizza';
  }
  if (cuisine.includes('burger') || type.includes('burger') || type.includes('fast_food')) {
    return '20% off on all burgers';
  }
  if (cuisine.includes('sandwich') || cuisine.includes('sub')) {
    return '10% off on any sandwich';
  }
  if (cuisine.includes('asian') || cuisine.includes('japanese') || cuisine.includes('chinese')) {
    return 'Buy (1) Dish - Get (1) 25% Off';
  }
  // Default offer
  return 'Special offer available';
}

function getCuisineLabel(restaurant: RestaurantWithRanking): string {
  if (restaurant.cuisine) {
    const cuisine = restaurant.cuisine.split(';')[0].trim().toUpperCase();
    return cuisine;
  }
  if (restaurant.establishment_type) {
    return restaurant.establishment_type.replace('_', ' ').toUpperCase();
  }
  return 'RESTAURANT';
}

export function RestaurantCardList({ restaurants, onSelect, userLocation, isLoading }: RestaurantCardListProps) {
  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <SDText color="textMuted" variant="body">
            Loading restaurants...
          </SDText>
        </View>
      </View>
    );
  }

  if (restaurants.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="restaurant-outline" size={48} color={theme.colors.textMuted} />
        <SDText weight="semibold" variant="subtitle" style={styles.emptyTitle}>
          No restaurants found
        </SDText>
        <SDText color="textMuted" variant="body" style={styles.emptySubtitle}>
          Try adjusting your filters or search
        </SDText>
      </View>
    );
  }

  // Calculate distances and sort by distance if user location is available
  const restaurantsWithDistance = restaurants.map((restaurant) => {
    let distance: number | null = null;
    if (userLocation) {
      distance = haversineKm(userLocation, { lat: restaurant.lat, lng: restaurant.lng });
    }
    return { restaurant, distance };
  });

  // Sort by distance if available, otherwise keep original order
  const sortedRestaurants = userLocation
    ? [...restaurantsWithDistance].sort((a, b) => {
        if (a.distance === null) return 1;
        if (b.distance === null) return -1;
        return a.distance - b.distance;
      })
    : restaurantsWithDistance;

  return (
    <View style={styles.container}>
      <FlatList
        data={sortedRestaurants}
        keyExtractor={(item) => item.restaurant.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        renderItem={({ item, index }) => {
          const { restaurant, distance } = item;
          const imageUrl = getCuisineImage(restaurant.cuisine, restaurant.establishment_type);
          const promotionalOffer = getPromotionalOffer(restaurant);
          const cuisineLabel = getCuisineLabel(restaurant);

          return (
            <Animated.View entering={FadeInDown.delay(index * 50).duration(300)}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Select ${restaurant.name}`}
                onPress={async () => {
                  await lightHaptic();
                  onSelect(restaurant);
                }}
                style={({ pressed }) => [
                  styles.card,
                  { opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Image source={{ uri: imageUrl }} style={styles.cardImage} />
                <View style={styles.cardContent}>
                  <SDText weight="bold" variant="subtitle" numberOfLines={1}>
                    {restaurant.name}
                  </SDText>
                  <SDText color="textMuted" variant="caption" numberOfLines={2} style={styles.promotionText}>
                    {promotionalOffer}
                  </SDText>
                  <View style={styles.cardFooter}>
                    <SDText color="textMuted" variant="caption" weight="semibold">
                      {cuisineLabel}
                    </SDText>
                    {distance !== null && (
                      <SDText color="textMuted" variant="caption" weight="semibold">
                        {formatDistance(distance)}
                      </SDText>
                    )}
                  </View>
                </View>
              </Pressable>
            </Animated.View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.xl,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
    gap: theme.spacing.lg,
  },
  cardImage: {
    width: 88,
    height: 88,
    borderRadius: theme.radii.lg,
    backgroundColor: theme.colors.surface2,
  },
  cardContent: {
    flex: 1,
    gap: theme.spacing.xs,
    justifyContent: 'center',
  },
  promotionText: {
    marginTop: 2,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: theme.spacing.xs,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  emptyTitle: {
    marginTop: theme.spacing.md,
  },
  emptySubtitle: {
    textAlign: 'center',
  },
});
