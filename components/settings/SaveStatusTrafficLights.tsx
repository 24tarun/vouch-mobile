import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useTheme } from '@/lib/ThemeContext';

export type SaveIndicatorPhase = 'idle' | 'dirty' | 'saving' | 'saved';

export function SaveStatusTrafficLights({
  phase,
  successTick,
}: {
  phase: SaveIndicatorPhase;
  successTick: number;
}) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  const [flashPhase, setFlashPhase] = useState<Exclude<SaveIndicatorPhase, 'idle'> | null>(null);
  const previousPhaseRef = useRef<SaveIndicatorPhase>(phase);
  const lightSize = 22;
  const lightRadius = lightSize / 2;

  useEffect(() => {
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = phase;

    if (phase === previousPhase || (phase !== 'dirty' && phase !== 'saving')) return;

    setFlashPhase(phase);
    pulse.setValue(0);
    Animated.sequence([
      Animated.timing(pulse, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(pulse, {
        toValue: 0,
        duration: 150,
        easing: Easing.in(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(pulse, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start(() => {
      setFlashPhase(null);
      pulse.setValue(0);
    });
  }, [phase, pulse]);

  useEffect(() => {
    if (successTick === 0) return;

    setFlashPhase('saved');
    pulse.setValue(0);
    Animated.sequence([
      Animated.timing(pulse, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(pulse, {
        toValue: 0,
        duration: 150,
        easing: Easing.in(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(pulse, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start(() => {
      setFlashPhase(null);
      pulse.setValue(0);
    });
  }, [successTick, pulse]);

  const displayedPhase = flashPhase ?? phase;

  const redOpacity = displayedPhase === 'dirty'
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.52, 1] })
    : 0.25;
  const amberOpacity = displayedPhase === 'saving'
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.52, 1] })
    : 0.25;
  const greenOpacity = displayedPhase === 'saved'
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.58, 1] })
    : displayedPhase === 'dirty' || displayedPhase === 'saving'
      ? 0.08
      : 0.92;
  const redScale = displayedPhase === 'dirty'
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] })
    : 1;
  const amberScale = displayedPhase === 'saving'
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] })
    : 1;
  const greenScale = displayedPhase === 'saved'
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] })
    : displayedPhase === 'dirty' || displayedPhase === 'saving'
      ? 1
      : 1.04;

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
      accessibilityLabel={
        phase === 'dirty'
          ? 'Unsaved settings changes'
          : phase === 'saving'
            ? 'Saving settings'
            : phase === 'saved'
              ? 'Settings saved'
              : 'Settings are up to date'
      }
    >
      <Animated.View
        style={{
          width: lightSize,
          height: lightSize,
          borderRadius: lightRadius,
          backgroundColor: colors.destructive,
          opacity: redOpacity,
          transform: [{ scale: redScale }],
          shadowColor: colors.destructive,
          shadowOpacity: displayedPhase === 'dirty' ? 0.6 : 0.14,
          shadowRadius: displayedPhase === 'dirty' ? 8 : 2,
          shadowOffset: { width: 0, height: 0 },
          elevation: displayedPhase === 'dirty' ? 6 : 0,
        }}
      />
      <Animated.View
        style={{
          width: lightSize,
          height: lightSize,
          borderRadius: lightRadius,
          backgroundColor: colors.warning,
          opacity: amberOpacity,
          transform: [{ scale: amberScale }],
          shadowColor: colors.warning,
          shadowOpacity: displayedPhase === 'saving' ? 0.55 : 0.14,
          shadowRadius: displayedPhase === 'saving' ? 8 : 2,
          shadowOffset: { width: 0, height: 0 },
          elevation: displayedPhase === 'saving' ? 6 : 0,
        }}
      />
      <Animated.View
        style={{
          width: lightSize,
          height: lightSize,
          borderRadius: lightRadius,
          backgroundColor: colors.success,
          opacity: greenOpacity,
          transform: [{ scale: greenScale }],
          shadowColor: colors.success,
          shadowOpacity: displayedPhase === 'saved' ? 0.62 : displayedPhase === 'idle' ? 0.4 : 0,
          shadowRadius: displayedPhase === 'saved' ? 10 : displayedPhase === 'idle' ? 6 : 0,
          shadowOffset: { width: 0, height: 0 },
          elevation: displayedPhase === 'saved' ? 7 : displayedPhase === 'idle' ? 4 : 0,
        }}
      />
    </View>
  );
}
