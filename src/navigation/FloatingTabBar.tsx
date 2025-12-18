import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SDText } from '../components/ui';
import { lightHaptic } from '../lib/haptics';
import { theme } from '../theme';

export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View pointerEvents="box-none" style={[styles.wrap, { paddingBottom: Math.max(10, insets.bottom) }]}>
      <View style={styles.pill}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const { options } = descriptors[route.key];

          const iconName = (() => {
            switch (route.name) {
              case 'Home':
                return focused ? 'home' : 'home-outline';
              case 'Map':
                return focused ? 'map' : 'map-outline';
              case 'Profile':
                return focused ? 'person' : 'person-outline';
              case 'Settings':
                return focused ? 'settings' : 'settings-outline';
              default:
                return 'ellipse';
            }
          })();

          const onPress = async () => {
            await lightHaptic();
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };

          const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityLabel={options.tabBarAccessibilityLabel}
              accessibilityState={focused ? { selected: true } : {}}
              onPress={onPress}
              onLongPress={onLongPress}
              style={({ pressed }) => [styles.item, focused ? styles.itemActive : null, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Ionicons
                name={iconName}
                size={22}
                color={focused ? theme.colors.white : theme.colors.textMuted}
              />
              {focused ? (
                <SDText variant="caption" weight="semibold" color="white">
                  {route.name}
                </SDText>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    gap: theme.spacing.xs,
    padding: theme.spacing.xs,
    borderRadius: 999,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    boxShadow: '0 12px 24px rgba(0, 0, 0, 0.15), 0 4px 8px rgba(0, 0, 0, 0.1)',
    elevation: 12,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    borderRadius: 999,
    minHeight: 44,
  },
  itemActive: {
    backgroundColor: theme.colors.brand,
  },
});


