import React from 'react';
import { Marker } from 'react-native-maps';
import { View, StyleSheet, Platform } from 'react-native';

import type { RestaurantWithRanking } from '../types/database';

type Props = {
  restaurant: RestaurantWithRanking;
  onPress: (restaurantId: string) => void;
  isSelected?: boolean;
};

function StarDishMarkerInner({ restaurant, onPress, isSelected }: Props) {
  // Use a ref to prevent double-firing when both onPress and onSelect are called
  const pressHandledRef = React.useRef(false);
  
  // CRITICAL FIX: Start with tracksViewChanges=true to ensure markers render on initial load
  // Then disable it after render for performance (prevents re-render storms when panning)
  // This fixes the issue where custom markers don't appear on Android/iOS initial render
  const [tracksViewChanges, setTracksViewChanges] = React.useState(true);
  
  // Disable view tracking after initial render for performance
  React.useEffect(() => {
    // Use a short timeout to ensure marker is fully rendered before disabling tracking
    const timer = setTimeout(() => {
      setTracksViewChanges(false);
    }, 100);
    return () => clearTimeout(timer);
  }, []); // Only run once on mount
  
  const handlePress = React.useCallback(() => {
    // Prevent double calls - if already handled in this tick, ignore
    if (pressHandledRef.current) return;
    pressHandledRef.current = true;
    onPress(restaurant.id);
    // Reset after a short delay
    setTimeout(() => {
      pressHandledRef.current = false;
    }, 100);
  }, [onPress, restaurant.id]);

  const color = isSelected ? '#FFB020' : '#FF6A3D';

  // Use custom view instead of pinColor for better cross-platform compatibility
  // Custom views are more reliable on iOS and give us better control
  return (
    <Marker
      coordinate={{ latitude: restaurant.lat, longitude: restaurant.lng }}
      // Use both onSelect and onPress for maximum compatibility
      // onSelect works better on some platforms, onPress on others
      onSelect={handlePress}
      onPress={handlePress}
      tracksViewChanges={tracksViewChanges}
      identifier={restaurant.id}
      anchor={{ x: 0.5, y: 0.5 }}
      centerOffset={{ x: 0, y: -12 }}
    >
      {/* Custom marker view - ensures visibility on all platforms */}
      <View 
        style={[styles.markerContainer, { backgroundColor: color }]}
        onLayout={() => {
          // Once layout is complete, we can safely disable view tracking
          // This ensures the marker is fully rendered before optimizing
          if (tracksViewChanges) {
            setTimeout(() => setTracksViewChanges(false), 50);
          }
        }}
      >
        <View style={styles.markerDot} />
      </View>
    </Marker>
  );
}

/**
 * CRITICAL: React.memo prevents re-render storms when panning/zooming.
 * We re-render only when:
 * - coordinates change
 * - selection changes
 * - top_dish_net_score changes (visual indicator)
 */
export const StarDishMarker = React.memo(
  StarDishMarkerInner,
  (prev, next) => {
    // Defensive: if either restaurant is missing, always re-render to be safe.
    if (!prev.restaurant || !next.restaurant) return false;

    // CRITICAL: Also check if onPress changed - if it did, we need to re-render
    // to ensure the marker has the latest callback reference
    if (prev.onPress !== next.onPress) return false;

    return (
      prev.restaurant.id === next.restaurant.id &&
      prev.restaurant.lat === next.restaurant.lat &&
      prev.restaurant.lng === next.restaurant.lng &&
      prev.restaurant.top_dish_net_score === next.restaurant.top_dish_net_score &&
      prev.isSelected === next.isSelected
    );
  }
);

const styles = StyleSheet.create({
  markerContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  markerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'white',
  },
});


