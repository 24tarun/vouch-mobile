import { useEffect, useMemo, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import type { ReputationScoreData } from '@/lib/reputation/types';
import { useTheme } from '@/lib/ThemeContext';

const ORANGE = 'rgb(249,115,22)';
const ORANGE_GLOW = 'rgba(249,115,22,0.5)';
const EMERALD = '#34d399';
const RED = '#f87171';

interface ReputationBarProps {
  data: ReputationScoreData;
}

export function ReputationBar({ data }: ReputationBarProps) {
  const { colors, isDark } = useTheme();
  const dynamicStyles = useMemo(() => ({
    score: { color: isDark ? '#ffffff' : '#1C1C1E' },
    track: {
      backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#E8EDF4',
      borderColor: isDark ? 'rgba(255,255,255,0.06)' : '#D8DEE8',
    },
    fillGlow: isDark ? styles.fillGlowIos : null,
  }), [isDark]);
  const fillAnim = useRef(new Animated.Value(0)).current;
  const targetFill = (data.score / 1000) * 100;

  useEffect(() => {
    Animated.timing(fillAnim, {
      toValue: targetFill,
      duration: 700,
      useNativeDriver: false,
    }).start();
  }, [targetFill, fillAnim]);

  const isPositive = data.velocityDelta !== null && data.velocityDelta >= 0;
  const velocityColor = isPositive ? EMERALD : RED;
  const velocityArrow = isPositive ? '↑' : '↓';

  return (
    <View style={styles.container}>
      {/* Labels row */}
      <View style={styles.labelRow}>
        <Text style={[styles.score, dynamicStyles.score]}>{data.score}</Text>
        {data.velocityDelta !== null && (
          <Text style={[styles.velocity, { color: velocityColor }]}>
            {velocityArrow} {Math.abs(data.velocityDelta)} this week
          </Text>
        )}
      </View>

      {/* Track */}
      <View style={[styles.track, dynamicStyles.track]}>
        {/* Fill */}
        <Animated.View
          style={[
            styles.fill,
            Platform.OS === 'ios' && dynamicStyles.fillGlow,
            {
              width: fillAnim.interpolate({
                inputRange: [0, 100],
                outputRange: ['0%', '100%'],
                extrapolate: 'clamp',
              }),
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  score: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    color: '#ffffff',
  },
  velocity: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
  },
  track: {
    height: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 999,
    backgroundColor: ORANGE,
  },
  fillGlowIos: {
    shadowColor: ORANGE_GLOW,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 8,
  },
});
