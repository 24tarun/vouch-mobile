import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from '@/lib/theme';
import type { PomoSession } from '@/lib/types';

export interface PomodoroTimerProps {
  session: PomoSession;
  taskTitle: string;
  serverClockOffsetMs: number;
  onMinimize: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: (source?: 'manual_stop' | 'timer_completed' | 'system') => void;
}

const DIGIT_SEGMENTS: Record<string, [boolean, boolean, boolean, boolean, boolean, boolean, boolean]> = {
  '0': [true, true, true, true, true, true, false],
  '1': [false, true, true, false, false, false, false],
  '2': [true, true, false, true, true, false, true],
  '3': [true, true, true, true, false, false, true],
  '4': [false, true, true, false, false, true, true],
  '5': [true, false, true, true, false, true, true],
  '6': [true, false, true, true, true, true, true],
  '7': [true, true, true, false, false, false, false],
  '8': [true, true, true, true, true, true, true],
  '9': [true, true, true, true, false, true, true],
};

function getSessionTiming(session: PomoSession, nowMs: number) {
  const durationSec = session.duration_minutes * 60;
  let currentElapsed = session.elapsed_seconds;

  if (session.status === 'ACTIVE') {
    const start = new Date(session.started_at).getTime();
    currentElapsed += Math.max(0, Math.floor((nowMs - start) / 1000));
  }

  const remaining = Math.max(0, durationSec - currentElapsed);
  const progress = durationSec > 0 ? Math.min(100, (currentElapsed / durationSec) * 100) : 100;
  return { remaining, progress };
}

function SevenSegmentDigit({
  digit,
  large,
}: {
  digit: string;
  large: boolean;
}) {
  const segments = DIGIT_SEGMENTS[digit] || DIGIT_SEGMENTS['0'];
  const width = large ? 64 : 38;
  const height = large ? 116 : 72;
  const thickness = large ? 8 : 4;
  const horizontal = width - thickness * 1.6;
  const vertical = (height - thickness * 3.2) / 2;
  const activeSegmentStyle = large ? styles.segmentOnLarge : styles.segmentOnSmall;
  const inactiveSegmentStyle = large ? styles.segmentOffLarge : styles.segmentOffSmall;

  return (
    <View style={[styles.digit, { width, height }]} aria-hidden>
      <View style={[styles.segmentBase, styles.segmentHorizontal, { width: horizontal, height: thickness, top: 0, left: (width - horizontal) / 2 }, segments[0] ? activeSegmentStyle : inactiveSegmentStyle]} />
      <View style={[styles.segmentBase, styles.segmentVertical, { width: thickness, height: vertical, top: thickness * 0.75, right: 0 }, segments[1] ? activeSegmentStyle : inactiveSegmentStyle]} />
      <View style={[styles.segmentBase, styles.segmentVertical, { width: thickness, height: vertical, bottom: thickness * 0.75, right: 0 }, segments[2] ? activeSegmentStyle : inactiveSegmentStyle]} />
      <View style={[styles.segmentBase, styles.segmentHorizontal, { width: horizontal, height: thickness, bottom: 0, left: (width - horizontal) / 2 }, segments[3] ? activeSegmentStyle : inactiveSegmentStyle]} />
      <View style={[styles.segmentBase, styles.segmentVertical, { width: thickness, height: vertical, bottom: thickness * 0.75, left: 0 }, segments[4] ? activeSegmentStyle : inactiveSegmentStyle]} />
      <View style={[styles.segmentBase, styles.segmentVertical, { width: thickness, height: vertical, top: thickness * 0.75, left: 0 }, segments[5] ? activeSegmentStyle : inactiveSegmentStyle]} />
      <View style={[styles.segmentBase, styles.segmentHorizontal, { width: horizontal, height: thickness, top: (height - thickness) / 2, left: (width - horizontal) / 2 }, segments[6] ? activeSegmentStyle : inactiveSegmentStyle]} />
    </View>
  );
}

function SevenSegmentColon({ large }: { large: boolean }) {
  const dotSize = large ? 10 : 6;
  const gap = large ? 21 : 15;
  return (
    <View style={[styles.colon, { width: large ? 24 : 14, height: large ? 116 : 72 }]}>
      <View style={[styles.colonDot, styles.colonDotOn, { width: dotSize, height: dotSize, marginBottom: gap }]} />
      <View style={[styles.colonDot, styles.colonDotOn, { width: dotSize, height: dotSize }]} />
    </View>
  );
}


export function PomodoroTimer({
  session,
  taskTitle,
  serverClockOffsetMs,
  onMinimize,
  onPause,
  onResume,
  onStop,
}: PomodoroTimerProps) {
  const insets = useSafeAreaInsets();
  const durationSec = session.duration_minutes * 60;
  const initialRemaining = Math.max(0, durationSec - session.elapsed_seconds);
  const initialProgress = durationSec > 0 ? Math.min(100, (session.elapsed_seconds / durationSec) * 100) : 100;
  const [timeLeft, setTimeLeft] = useState(initialRemaining);
  const [progress, setProgress] = useState(initialProgress);
  const autoStopTriggeredRef = useRef(false);
  const isLongSession = session.duration_minutes >= 100;
  const isStrictSession = Boolean(session.is_strict);

  useEffect(() => {
    const calculate = () => {
      const timing = getSessionTiming(session, Date.now() + serverClockOffsetMs);
      setTimeLeft(timing.remaining);
      setProgress(timing.progress);
    };

    calculate();
    const interval = setInterval(calculate, 1000);
    return () => clearInterval(interval);
  }, [session, serverClockOffsetMs]);

  useEffect(() => {
    autoStopTriggeredRef.current = false;
  }, [session.id]);

  useEffect(() => {
    if (session.status !== 'ACTIVE') return;
    if (timeLeft > 0) return;
    if (progress < 100) return;
    if (autoStopTriggeredRef.current) return;

    autoStopTriggeredRef.current = true;
    onStop('timer_completed');
  }, [onStop, progress, session.status, timeLeft]);

  const formattedTime = useMemo(() => {
    if (isLongSession) {
      const hours = Math.floor(timeLeft / 3600);
      const minutes = Math.floor((timeLeft % 3600) / 60);
      const seconds = timeLeft % 60;
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }, [isLongSession, timeLeft]);

  return (
    <View style={styles.overlay} pointerEvents="box-none">
      <View style={styles.overlayBackdrop} />
      <View style={styles.overlayContent}>
        <View style={[styles.overlayHeader, { paddingTop: insets.top + spacing.md }]}>
          <Text style={styles.overlayTitle} numberOfLines={1}>{taskTitle}</Text>
          <TouchableOpacity
            onPress={onMinimize}
            style={styles.overlayIconButton}
            accessibilityRole="button"
            accessibilityLabel="Minimize timer"
          >
            <Feather name="minimize-2" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={styles.overlayMain}>
          <View style={styles.clockAndControls}>
            <View style={styles.clockWrap}>
              <View style={styles.clockFrame}>
                {formattedTime.split('').map((char, index) => (
                  char === ':'
                    ? <SevenSegmentColon key={`colon-${index}`} large={!isLongSession} />
                    : <SevenSegmentDigit key={`digit-${index}-${char}`} digit={char} large={!isLongSession} />
                ))}
              </View>
            </View>

          <View style={styles.controlsRow}>
            {!isStrictSession && (session.status === 'ACTIVE' ? (
              <TouchableOpacity
                onPress={onPause}
                style={styles.controlButton}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Pause pomodoro"
              >
                <View style={styles.pauseIcon}>
                  <View style={styles.pauseBar} />
                  <View style={styles.pauseBar} />
                </View>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={onResume}
                style={styles.controlButton}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Resume pomodoro"
              >
                <View style={styles.playIcon} />
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              onPress={() => {
                Alert.alert(
                  'Stop pomodoro?',
                  'Are you sure you want to stop this session?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Stop',
                      style: 'destructive',
                      onPress: () => onStop('manual_stop'),
                    },
                  ],
                );
              }}
              style={styles.controlButton}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Stop pomodoro"
            >
              <View style={styles.stopIcon} />
            </TouchableOpacity>
          </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const glowShadow = {
  shadowColor: colors.accentCyan,
  shadowOpacity: 0.28,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 0 },
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    elevation: 50,
  },
  overlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  },
  overlayContent: {
    flex: 1,
  },
  overlayHeader: {
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  overlayTitle: {
    flex: 1,
    color: colors.text,
    fontSize: typography.lg,
    fontWeight: typography.semibold,
    paddingRight: spacing.md,
  },
  overlayIconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayMain: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  clockAndControls: {
    alignItems: 'center',
    gap: spacing.xl,
  },
  clockWrap: {
    minHeight: 170,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accentCyan,
    shadowOpacity: 0.18,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 0 },
  },
  clockFrame: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  digit: {
    position: 'relative',
    transform: [{ skewX: '-13deg' }],
  },
  segmentBase: {
    position: 'absolute',
    borderRadius: radius.full,
  },
  segmentHorizontal: {},
  segmentVertical: {},
  segmentOnLarge: {
    backgroundColor: colors.accentCyan,
    ...glowShadow,
  },
  segmentOffLarge: {
    backgroundColor: 'rgba(0, 217, 255, 0.04)',
  },
  segmentOnSmall: {
    backgroundColor: colors.accentCyan,
    shadowColor: colors.accentCyan,
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  segmentOffSmall: {
    backgroundColor: 'rgba(0, 217, 255, 0.04)',
  },
  colon: {
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ skewX: '-13deg' }],
  },
  colonDot: {
    borderRadius: radius.full,
  },
  colonDotOn: {
    backgroundColor: colors.accentCyan,
    shadowColor: colors.accentCyan,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
  },
  controlButton: {
    padding: spacing.sm,
  },
  pauseIcon: {
    flexDirection: 'row',
    gap: 7,
  },
  pauseBar: {
    width: 12,
    height: 44,
    borderRadius: 4,
    backgroundColor: colors.accentCyan,
    shadowColor: colors.accentCyan,
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  playIcon: {
    width: 0,
    height: 0,
    borderTopWidth: 22,
    borderTopColor: 'transparent',
    borderBottomWidth: 22,
    borderBottomColor: 'transparent',
    borderLeftWidth: 40,
    borderLeftColor: colors.accentCyan,
  },
  stopIcon: {
    width: 40,
    height: 40,
    borderRadius: 7,
    backgroundColor: colors.accentCyan,
    shadowColor: colors.accentCyan,
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
});
