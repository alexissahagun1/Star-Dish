import React from 'react';
import { View, StyleSheet, Pressable, FlatList } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { SDText } from './ui';
import { theme } from '../theme';
import { lightHaptic } from '../lib/haptics';
import type { RestaurantWithRanking } from '../types/database';

type SearchResultsListProps = {
  restaurants: RestaurantWithRanking[];
  onSelect: (restaurant: RestaurantWithRanking) => void;
  isLoading?: boolean;
};

export function SearchResultsList({ restaurants, onSelect, isLoading }: SearchResultsListProps) {
  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <SDText color="textMuted" variant="body">
            Searching...
          </SDText>
        </View>
      </View>
    );
  }

  if (restaurants.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Ionicons name="search-outline" size={48} color={theme.colors.textMuted} />
        <SDText weight="semibold" variant="subtitle" style={styles.emptyTitle}>
          No results found
        </SDText>
        <SDText color="textMuted" variant="body" style={styles.emptySubtitle}>
          Try a different search term
        </SDText>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <SDText weight="bold" variant="subtitle">
          {restaurants.length} {restaurants.length === 1 ? 'result' : 'results'}
        </SDText>
      </View>
      <FlatList
        data={restaurants}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
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
                styles.listRow,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <View style={styles.listRowBody}>
                <SDText weight="semibold" numberOfLines={1}>
                  {item.name}
                </SDText>
                {item.address && (
                  <SDText color="textMuted" variant="caption" numberOfLines={1}>
                    {item.address}
                  </SDText>
                )}
                {(item.establishment_type || item.cuisine) && (
                  <SDText color="textMuted" variant="caption" numberOfLines={1}>
                    {[item.establishment_type, item.cuisine].filter(Boolean).join(' • ')}
                  </SDText>
                )}
              </View>
              {item.top_dish_net_score > 0 && (
                <View style={styles.scorePill}>
                  <Ionicons name="star" size={14} color={theme.colors.brand} />
                  <SDText weight="semibold" variant="caption" color="black">
                    {item.top_dish_net_score.toFixed(1)}
                  </SDText>
                </View>
              )}
            </Pressable>
          </Animated.View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  header: {
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  list: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.lg,
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
    minHeight: 72,
  },
  listRowBody: {
    flex: 1,
    gap: theme.spacing.xs,
    marginRight: theme.spacing.sm,
  },
  scorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    backgroundColor: theme.colors.brand + '20',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.radii.pill,
    minWidth: 60,
    justifyContent: 'center',
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
