import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { theme } from '../../theme';

type Variant = 'title' | 'subtitle' | 'body' | 'caption';

type Props = PropsWithChildren<
  TextProps & {
    variant?: Variant;
    color?: keyof typeof theme.colors;
    weight?: keyof typeof theme.typography.weight;
    align?: TextStyle['textAlign'];
  }
>;

export function SDText({
  children,
  variant = 'body',
  color = 'text',
  weight = 'regular',
  align,
  style,
  ...rest
}: Props) {
  return (
    <Text
      {...rest}
      style={[
        styles.base,
        variantStyles[variant],
        { color: theme.colors[color], fontWeight: theme.typography.weight[weight], textAlign: align },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontFamily: theme.typography.fontFamily,
    letterSpacing: 0.2,
  },
});

const variantStyles = StyleSheet.create({
  title: { fontSize: theme.typography.size.xxl, lineHeight: 34 },
  subtitle: { fontSize: theme.typography.size.xl, lineHeight: 28 },
  body: { fontSize: theme.typography.size.md, lineHeight: 22 },
  caption: { fontSize: theme.typography.size.sm, lineHeight: 18 },
});




