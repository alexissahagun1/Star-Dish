import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native';

import { theme } from '../../theme';

type Props = {
  height: number;
  width?: number | `${number}%`;
  radius?: number;
  style?: ViewStyle;
};

export function SkeletonBlock({ height, width = '100%', radius = theme.radii.md, style }: Props) {
  const opacity = useRef(new Animated.Value(0.55)).current;
  const anim = useMemo(
    () =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.85, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ])
      ),
    [opacity]
  );

  useEffect(() => {
    anim.start();
    return () => anim.stop();
  }, [anim]);

  return (
    <View style={[styles.wrap, { height, width, borderRadius: radius }, style]}>
      <Animated.View style={[styles.fill, { opacity }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: theme.colors.surface2,
  },
  fill: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
});




