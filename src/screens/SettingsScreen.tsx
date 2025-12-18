import { StyleSheet, Switch, View } from 'react-native';

import { Screen } from '../components/Screen';
import { SDText } from '../components/ui';
import { useSettings } from '../state/SettingsContext';
import { theme } from '../theme';

export function SettingsScreen() {
  const { hapticsEnabled, setHapticsEnabled } = useSettings();

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <SDText variant="title" weight="bold">
            Settings
          </SDText>
          <SDText color="textMuted">Tune the app to your preferences.</SDText>
        </View>

        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowBody}>
              <SDText weight="semibold">Haptics</SDText>
              <SDText color="textMuted" variant="caption">
                Vibrations on taps and primary actions.
              </SDText>
            </View>
            <Switch
              value={hapticsEnabled}
              onValueChange={setHapticsEnabled}
              trackColor={{ false: theme.colors.surface2, true: theme.colors.brand }}
              thumbColor={theme.colors.white}
            />
          </View>
        </View>

        <View style={styles.card}>
          <SDText weight="semibold">About</SDText>
          <SDText color="textMuted" variant="caption">
            Star Dish helps you discover restaurants and vote on the best dishes.
          </SDText>
        </View>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
  },
  rowBody: {
    flex: 1,
    gap: theme.spacing.xs,
  },
});




