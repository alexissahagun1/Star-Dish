import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '../components/Screen';
import { SDButton, SDText } from '../components/ui';
import { usePlatilloVotes } from '../hooks/usePlatilloVotes';
import { togglePlatilloVote } from '../services/voteService';
import { theme } from '../theme';
import type { Platillo, Restaurant } from '../types/database';

type Props = {
  userId: string;
  platillo: Platillo;
  restaurant: Restaurant;
};

export function PlatilloDetailScreen({ userId, platillo, restaurant }: Props) {
  const { counts, loading } = usePlatilloVotes(platillo.id);

  const onUp = useCallback(async () => {
    await togglePlatilloVote(userId, platillo.id, 'UP');
  }, [platillo.id, userId]);

  const onDown = useCallback(async () => {
    await togglePlatilloVote(userId, platillo.id, 'DOWN');
  }, [platillo.id, userId]);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <SDText variant="title" weight="bold">
            {platillo.name}
          </SDText>
          <SDText color="textMuted">{restaurant.name}</SDText>
          {platillo.description ? <SDText color="textMuted">{platillo.description}</SDText> : null}
        </View>

        <View style={styles.card}>
          <SDText weight="semibold">Votes</SDText>
          <SDText color="textMuted" variant="caption">
            {loading ? 'Live updating…' : `UP ${counts.up} · DOWN ${counts.down} · NET ${counts.net}`}
          </SDText>

          <View style={styles.row}>
            <SDButton title="Upvote" onPress={onUp} />
            <SDButton title="Downvote" onPress={onDown} tone="surface" />
          </View>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
    backgroundColor: theme.colors.bg,
  },
  header: {
    gap: 6,
  },
  card: {
    borderRadius: theme.radii.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  row: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
});




