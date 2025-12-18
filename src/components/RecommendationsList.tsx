import React from 'react';
import { View, StyleSheet, Pressable, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { SDText } from './ui';
import { theme } from '../theme';
import { lightHaptic } from '../lib/haptics';
import type { RestaurantWithRanking } from '../types/database';

type SectionProps = {
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  restaurants: RestaurantWithRanking[];
  onSelect: (restaurant: RestaurantWithRanking) => void;
};

function RecommendationSection({ title, icon, restaurants, onSelect }: SectionProps) {
  if (restaurants.length === 0) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        {icon && <Ionicons name={icon} size={18} color={theme.colors.textMuted} />}
        <SDText weight="bold" variant="subtitle" style={styles.sectionTitle}>
          {title}
        </SDText>
      </View>
      <FlatList
        data={restaurants}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sectionList}
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 50).duration(300)}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Select ${item.name}`}
              onPress={async () => {
                await lightHaptic();
                onSelect(item);
              }}
              style={({ pressed }) => [
                styles.recommendationCard,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <View style={styles.cardContent}>
                <SDText weight="semibold" numberOfLines={1}>
                  {item.name}
                </SDText>
                {item.address && (
                  <SDText color="textMuted" variant="caption" numberOfLines={1}>
                    {item.address}
                  </SDText>
                )}
                {item.top_dish_net_score > 0 && (
                  <View style={styles.scoreRow}>
                    <Ionicons name="star" size={12} color={theme.colors.brand} />
                    <SDText weight="semibold" variant="caption" color="brand">
                      {item.top_dish_net_score.toFixed(1)}
                    </SDText>
                  </View>
                )}
              </View>
            </Pressable>
          </Animated.View>
        )}
      />
    </View>
  );
}

type RecommendationsListProps = {
  recentlyViewed: RestaurantWithRanking[];
  topPicks: RestaurantWithRanking[];
  bestRated: RestaurantWithRanking[];
  onSelect: (restaurant: RestaurantWithRanking) => void;
};

export function RecommendationsList({
  recentlyViewed,
  topPicks,
  bestRated,
  onSelect,
}: RecommendationsListProps) {
  const hasAnyRecommendations = recentlyViewed.length > 0 || topPicks.length > 0 || bestRated.length > 0;

  if (!hasAnyRecommendations) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="search-outline" size={48} color={theme.colors.textMuted} />
        <SDText weight="semibold" variant="subtitle" style={styles.emptyTitle}>
          Search for a restaurant
        </SDText>
        <SDText color="textMuted" variant="body" style={styles.emptySubtitle}>
          What restaurant are you at or thinking about?
        </SDText>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {recentlyViewed.length > 0 && (
        <RecommendationSection
          title="Recently Viewed"
          icon="time-outline"
          restaurants={recentlyViewed}
          onSelect={onSelect}
        />
      )}
      {topPicks.length > 0 && (
        <RecommendationSection
          title="Top Picks"
          icon="flame-outline"
          restaurants={topPicks}
          onSelect={onSelect}
        />
      )}
      {bestRated.length > 0 && (
        <RecommendationSection
          title="Best Rated"
          icon="star-outline"
          restaurants={bestRated}
          onSelect={onSelect}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.md,
  },
  section: {
    marginBottom: theme.spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  sectionTitle: {
    flex: 1,
  },
  sectionList: {
    gap: theme.spacing.md,
    paddingRight: theme.spacing.lg,
  },
  recommendationCard: {
    width: 220,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
    minHeight: 100,
  },
  cardContent: {
    gap: theme.spacing.xs,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs,
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
