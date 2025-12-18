import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { lightHaptic } from '../../lib/haptics';
import { theme } from '../../theme';
import { SDText } from './SDText';

type Tone = 'brand' | 'surface';

type Props = PropsWithChildren<{
  title: string;
  onPress: () => void;
  tone?: Tone;
  disabled?: boolean;
  style?: ViewStyle;
}>;

export function SDButton({ title, onPress, tone = 'brand', disabled, style, children }: Props) {
  const bg = tone === 'brand' ? theme.colors.brand : theme.colors.surface2;
  return (
    <Pressable
      disabled={disabled}
      onPress={async () => {
        await lightHaptic();
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      <View style={styles.row}>
        <SDText weight="semibold" color={tone === 'brand' ? 'black' : 'text'}>
          {title}
        </SDText>
        {children}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: theme.radii.pill,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.xl,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.xs,
  },
});




