import React, { useRef, useState } from 'react';
import { View, StyleSheet, Image, Pressable, Dimensions, ScrollView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SDText } from './ui';
import { theme } from '../theme';
import { getSampleDishPhotos } from '../utils/sampleDishPhotos';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
// Carousel height should be ~60% of bottom sheet height (which is ~45% of screen at first snap)
// Using ~27% of screen height for a good aspect ratio, with a minimum of 200px
const CAROUSEL_HEIGHT = Math.max(SCREEN_HEIGHT * 0.27, 200);

export interface DishImageCarouselProps {
  images: string[];
  restaurantId?: string;
  restaurantName?: string;
  onFavorite?: () => void;
  onClose?: () => void;
  showFavoriteLabel?: boolean;
  isFavorite?: boolean;
}

export function DishImageCarousel({
  images,
  restaurantId,
  restaurantName,
  onFavorite,
  onClose,
  showFavoriteLabel = false,
  isFavorite = false,
}: DishImageCarouselProps) {
  const scrollViewRef = useRef<ScrollView>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Use dish photos if available, otherwise use sample photos
  const displayImages = images.length > 0 
    ? images 
    : (restaurantId ? getSampleDishPhotos(restaurantId, 5) : []);

  // Ensure we have at least one image
  const finalImages = displayImages.length > 0 ? displayImages : getSampleDishPhotos('default', 1);

  const handleScroll = (event: any) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(contentOffsetX / SCREEN_WIDTH);
    setCurrentIndex(index);
  };

  const scrollToIndex = (index: number) => {
    if (scrollViewRef.current) {
      scrollViewRef.current.scrollTo({
        x: index * SCREEN_WIDTH,
        animated: true,
      });
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        style={styles.scrollView}
        contentContainerStyle={styles.scrollViewContent}
        nestedScrollEnabled={true}
      >
        {finalImages.map((imageUri, index) => (
          <Image
            key={`${imageUri}-${index}`}
            source={{ uri: imageUri }}
            style={styles.image}
            resizeMode="cover"
          />
        ))}
      </ScrollView>

      {/* Overlay elements */}
      <View style={styles.overlay} pointerEvents="box-none">
        {/* Top-left: Favorite label */}
        {showFavoriteLabel && (
          <View style={styles.favoriteLabel}>
            <SDText weight="bold" color="black" variant="caption">
              Guest favorite
            </SDText>
          </View>
        )}

        {/* Top-right: Action buttons */}
        <View style={styles.actionButtons}>
          {onFavorite && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              onPress={onFavorite}
              style={({ pressed }) => [
                styles.actionButton,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons
                name={isFavorite ? 'heart' : 'heart-outline'}
                size={22}
                color={theme.colors.text}
              />
            </Pressable>
          )}
          {onClose && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={({ pressed }) => [
                styles.actionButton,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name="close" size={22} color={theme.colors.text} />
            </Pressable>
          )}
        </View>

        {/* Bottom-center: Navigation dots */}
        {finalImages.length > 1 && (
          <View style={styles.dotsContainer}>
            {finalImages.map((_, index) => (
              <Pressable
                key={index}
                accessibilityRole="button"
                accessibilityLabel={`Go to image ${index + 1}`}
                onPress={() => scrollToIndex(index)}
                style={({ pressed }) => [
                  styles.dot,
                  currentIndex === index && styles.dotActive,
                  { opacity: pressed ? 0.7 : 1 },
                ]}
              />
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: CAROUSEL_HEIGHT,
    position: 'relative',
    backgroundColor: theme.colors.surface2,
  },
  scrollView: {
    width: '100%',
    height: '100%',
  },
  scrollViewContent: {
    alignItems: 'center',
  },
  image: {
    width: SCREEN_WIDTH,
    height: CAROUSEL_HEIGHT,
    backgroundColor: theme.colors.surface2,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 44 : 16,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  favoriteLabel: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: theme.radii.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
    ...(Platform.OS === 'web'
      ? {
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        }
      : {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          elevation: 3,
        }),
  },
  actionButtons: {
    alignSelf: 'flex-end',
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web'
      ? {
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        }
      : {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          elevation: 3,
        }),
  },
  dotsContainer: {
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    borderRadius: theme.radii.pill,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.5)',
  },
  dotActive: {
    backgroundColor: 'rgba(255, 255, 255, 1)',
    width: 20,
  },
});
