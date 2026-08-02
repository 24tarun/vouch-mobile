import { memo, useCallback, useEffect, useMemo } from 'react';
import { Alert, Pressable, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { StatusPill } from '@/components/StatusPill';
import { TASK_COMPLETED_LIKE_STATUSES } from '@/lib/constants/task-status';
import { highlightedRowBackground, type Colors, radius, spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import { isOptimisticTaskId } from '@/lib/tasks/task-id';
import type { TaskStatus } from '@/lib/types';

export interface SubtaskRowData {
  id: string;
  title: string;
  is_completed: boolean;
  completed_at: string | null;
}

export interface TaskRowData {
  id: string;
  title: string;
  deadline: string;
  status?: string;
  has_proof?: boolean;
  requires_proof?: boolean;
  postponed_at?: string | null;
  recurrence_rule_id?: string | null;
  recurrence_paused_at?: string | null;
  created_at?: string;
  updated_at?: string;
  subtaskTotal?: number;
  subtaskCompleted?: number;
  subtasks?: SubtaskRowData[];
  completed?: boolean;
}

export type TaskCompletionIntentResult = 'accepted' | 'blocked' | 'proof-required';

export interface TaskRowProps {
  task: TaskRowData;
  variant?: 'default' | 'future-muted';
  onCompletionIntent?: (task: TaskRowData) => TaskCompletionIntentResult;
  onPostponeIntent?: (task: TaskRowData) => void;
  onPrefetch?: (taskId: string) => void;
  completionInProgress?: boolean;
}

function formatDeadline(isoString: string, showTime: boolean): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  if (showTime) {
    return date.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }
  const day = date.getDate().toString().padStart(2, '0');
  const month = date.toLocaleDateString('en-GB', { month: 'short' });
  return `${day} ${month}`;
}

export const TaskRow = memo(function TaskRow({
  task,
  variant = 'default',
  onCompletionIntent,
  onPostponeIntent,
  onPrefetch,
  completionInProgress = false,
}: TaskRowProps) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const router = useRouter();
  const { width: screenWidth } = useWindowDimensions();
  const translateX = useSharedValue(0);

  const isHistorical = task.status
    ? TASK_COMPLETED_LIKE_STATUSES.has(task.status as TaskStatus)
    : (task.completed ?? false);
  const isMutedFuture = variant === 'future-muted';
  const useCompactRow = isHistorical || isMutedFuture;
  const isRepeatingTask = Boolean(task.recurrence_rule_id);
  const isRepetitionPaused = isRepeatingTask && Boolean(task.recurrence_paused_at);
  const canOpenDetail = !isOptimisticTaskId(task.id);

  useEffect(() => {
    translateX.value = 0;
  }, [task.id, task.status, translateX]);

  const prefetchDetail = useCallback(() => {
    if (canOpenDetail) onPrefetch?.(task.id);
  }, [canOpenDetail, onPrefetch, task.id]);

  const openDetail = useCallback(() => {
    if (!canOpenDetail) {
      Alert.alert('Please wait', 'Task is still being created.');
      return;
    }
    router.push(`/tasks/${task.id}` as any);
  }, [canOpenDetail, router, task.id]);

  const triggerCompletionIntent = useCallback(() => {
    if (completionInProgress || !onCompletionIntent) {
      translateX.value = withTiming(0, { duration: 150 });
      return;
    }

    const result = onCompletionIntent(task);
    translateX.value = result === 'accepted'
      ? withTiming(screenWidth, { duration: 200 })
      : withTiming(0, { duration: 150 });
  }, [completionInProgress, onCompletionIntent, screenWidth, task, translateX]);

  const triggerPostponeIntent = useCallback(() => {
    translateX.value = withTiming(0, { duration: 150 });
    if (completionInProgress) return;
    onPostponeIntent?.(task);
  }, [completionInProgress, onPostponeIntent, task, translateX]);

  const swipeThreshold = screenWidth * 0.35;
  const panGesture = useMemo(
    () => Gesture.Pan()
      .activeOffsetX([-15, 15])
      .failOffsetY([-10, 10])
      .onUpdate((event) => {
        translateX.value = event.translationX;
      })
      .onEnd((event) => {
        if (event.translationX > swipeThreshold) {
          runOnJS(triggerCompletionIntent)();
        } else if (event.translationX < -swipeThreshold) {
          runOnJS(triggerPostponeIntent)();
        } else {
          translateX.value = withTiming(0, { duration: 150 });
        }
      }),
    [swipeThreshold, translateX, triggerCompletionIntent, triggerPostponeIntent],
  );

  const swipeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));
  const swipeBackgroundStyle = useAnimatedStyle(() => {
    const swipeDistance = Math.abs(translateX.value);
    return {
      backgroundColor: translateX.value > 0
        ? colors.success
        : translateX.value < 0
          ? colors.warning
          : 'transparent',
      opacity: Math.min(swipeDistance / spacing.lg, 1),
    };
  });

  if (useCompactRow) {
    return (
      <TouchableOpacity
        style={[styles.historicalRow, isMutedFuture && styles.futureMutedRow]}
        activeOpacity={0.7}
        onPressIn={prefetchDetail}
        onPress={openDetail}
        accessibilityRole="button"
        accessibilityLabel={`Open ${task.title} details`}
      >
        <View style={styles.historicalMain}>
          <View style={styles.historicalTitleRow}>
            <Text style={styles.historicalTitle} numberOfLines={1}>{task.title}</Text>
            {isRepeatingTask ? (
              <>
                <Feather name="repeat" size={16} color="#C084FC" style={styles.repeatIcon} />
                {isRepetitionPaused ? (
                  <Feather name="pause" size={15} color="#C084FC" style={styles.pausedRepeatIcon} />
                ) : null}
              </>
            ) : null}
          </View>
        </View>
        <View style={styles.historicalMeta}>
          {isMutedFuture ? (
            <Text style={styles.deadline}>{formatDeadline(task.deadline, false)}</Text>
          ) : task.status ? (
            <StatusPill status={task.status} paused={isRepetitionPaused} />
          ) : null}
        </View>
      </TouchableOpacity>
    );
  }

  const deadlineDate = new Date(task.deadline);
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadlineDateOnly = new Date(deadlineDate);
  deadlineDateOnly.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const isToday = deadlineDateOnly.getTime() === today.getTime();
  const isTomorrow = deadlineDateOnly.getTime() === tomorrow.getTime();
  const timeUntilDeadline = deadlineDate.getTime() - now.getTime();
  const isUrgent = timeUntilDeadline < 60 * 60 * 1000 && timeUntilDeadline > 0;

  let deadlineColor = colors.textMuted;
  if (isUrgent) deadlineColor = colors.destructive;
  else if (isToday) deadlineColor = '#10B981';
  else if (isTomorrow) deadlineColor = colors.warning;

  const deadlineLabel = formatDeadline(task.deadline, isToday || isTomorrow);
  const hasSubtasks = (task.subtaskTotal ?? 0) > 0;

  return (
    <View style={styles.swipeWrapper}>
      <Animated.View
        testID="task-swipe-actions"
        style={[StyleSheet.absoluteFill, styles.swipeBackground, swipeBackgroundStyle]}
        pointerEvents="none"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={[styles.swipeActionLabel, styles.completeSwipeLabel]}>Complete</Text>
        <Text style={[styles.swipeActionLabel, styles.postponeSwipeLabel]}>Postpone</Text>
      </Animated.View>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.container, swipeAnimatedStyle]}>
          <Pressable
            onPressIn={prefetchDetail}
            onPress={openDetail}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={`Open ${task.title} details`}
          >
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={1}>{task.title}</Text>
              {isRepeatingTask ? (
                <>
                  <Feather name="repeat" size={16} color="#C084FC" style={styles.repeatIcon} />
                  {isRepetitionPaused ? (
                    <Feather name="pause" size={15} color="#C084FC" style={styles.pausedRepeatIcon} />
                  ) : null}
                </>
              ) : null}
              {hasSubtasks ? (
                <Text style={styles.subtaskBadge}>
                  {task.subtaskCompleted ?? 0}/{task.subtaskTotal}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.deadline, { color: deadlineColor }]}>{deadlineLabel}</Text>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
});

const makeStyles = (colors: Colors, isDark: boolean) => StyleSheet.create({
  swipeWrapper: {
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  swipeBackground: {
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  swipeActionLabel: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  completeSwipeLabel: {
    color: '#FFFFFF',
  },
  postponeSwipeLabel: {
    color: '#111827',
  },
  container: {
    borderRadius: radius.md,
    backgroundColor: highlightedRowBackground(colors, isDark),
    borderWidth: isDark ? 0 : 1,
    borderColor: isDark ? 'transparent' : colors.border,
    shadowColor: '#0F172A',
    shadowOpacity: isDark ? 0 : 0.06,
    shadowRadius: isDark ? 0 : 10,
    shadowOffset: { width: 0, height: isDark ? 0 : 4 },
    elevation: isDark ? 0 : 1,
  },
  historicalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    gap: spacing.sm,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: highlightedRowBackground(colors, isDark),
    borderWidth: isDark ? 0 : 1,
    borderColor: isDark ? 'transparent' : colors.border,
    shadowColor: '#0F172A',
    shadowOpacity: isDark ? 0 : 0.06,
    shadowRadius: isDark ? 0 : 10,
    shadowOffset: { width: 0, height: isDark ? 0 : 4 },
    elevation: isDark ? 0 : 1,
    opacity: 0.18,
  },
  futureMutedRow: {
    opacity: 0.5,
  },
  historicalMain: {
    flex: 1,
    minWidth: 0,
  },
  historicalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  historicalTitle: {
    flexShrink: 1,
    fontSize: typography.md,
    color: colors.text,
  },
  historicalMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    gap: spacing.md,
  },
  rowPressed: {
    opacity: 0.7,
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    overflow: 'hidden',
  },
  title: {
    flexShrink: 1,
    fontSize: typography.md,
    color: colors.text,
  },
  repeatIcon: {
    flexShrink: 0,
  },
  pausedRepeatIcon: {
    flexShrink: 0,
    marginLeft: -4,
  },
  subtaskBadge: {
    fontSize: typography.xs,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  deadline: {
    fontSize: typography.sm,
    color: colors.textMuted,
    whiteSpace: 'nowrap',
  } as any,
});
