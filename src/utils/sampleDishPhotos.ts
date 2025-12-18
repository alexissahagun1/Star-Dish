/**
 * Sample dish photos for carousel fallback
 * These are high-quality food photography from Unsplash
 * Will be replaced with actual dish photos in production
 */
export const SAMPLE_DISH_PHOTOS = [
  'https://images.unsplash.com/photo-1565299585323-38174c0b0b0a?auto=format&fit=crop&w=800&q=80', // Mexican/Tacos
  'https://images.unsplash.com/photo-1551218808-94e220e084d2?auto=format&fit=crop&w=800&q=80', // Italian/Pasta
  'https://images.unsplash.com/photo-1553621042-f6e147245754?auto=format&fit=crop&w=800&q=80', // Asian/Sushi
  'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=800&q=80', // Pizza
  'https://images.unsplash.com/photo-1559339352-11d035aa65de?auto=format&fit=crop&w=800&q=80', // Burger
  'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=800&q=80', // Sandwich
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=800&q=80', // General food
  'https://images.unsplash.com/photo-1565958011703-44f9829ba187?auto=format&fit=crop&w=800&q=80', // Seafood
  'https://images.unsplash.com/photo-1571091718767-18b5b1457add?auto=format&fit=crop&w=800&q=80', // Burger variant
  'https://images.unsplash.com/photo-1567620905732-2d1ec7ab7445?auto=format&fit=crop&w=800&q=80', // Food platter
] as const;

/**
 * Get sample dish photos for a restaurant
 * Returns a subset of sample photos, cycling through them
 */
export function getSampleDishPhotos(restaurantId: string, count: number = 5): string[] {
  // Use restaurant ID to deterministically select photos
  const hash = restaurantId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const startIndex = hash % SAMPLE_DISH_PHOTOS.length;
  
  const photos: string[] = [];
  for (let i = 0; i < count; i++) {
    const index = (startIndex + i) % SAMPLE_DISH_PHOTOS.length;
    photos.push(SAMPLE_DISH_PHOTOS[index]);
  }
  
  return photos;
}
