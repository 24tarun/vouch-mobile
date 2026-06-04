import { useCallback, useMemo, memo, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { highlightedRowBackground, type Colors, radius, spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import { StatusPill } from '@/components/StatusPill';
import { usePomodoro } from '@/components/pomodoro/PomodoroProvider';
import { ProofCaptureModal } from '@/components/tasks/ProofCaptureModal';
import { supabase } from '@/lib/supabase';
import { TASK_COMPLETED_LIKE_STATUSES } from '@/lib/constants/task-status';
import { isOptimisticTaskId } from '@/lib/tasks/task-id';
import type { TaskStatus } from '@/lib/types';

interface Subtask {
  id: string;
  title: string;
  is_completed: boolean;
  completed_at: string | null;
}

const MAX_SUBTASKS = 20;
const DELETE_WINDOW_MS = 10 * 60 * 1000;

export interface TaskRowData {
  id: string;
  title: string;
  deadline: string; // ISO string
  status?: string;
  has_proof?: boolean;
  requires_proof?: boolean;
  postponed_at?: string | null;
  recurrence_rule_id?: string | null;
  created_at?: string;
  subtaskTotal?: number;
  subtaskCompleted?: number;
  completed?: boolean; // legacy fallback when status not provided
}

interface TaskRowProps {
  task: TaskRowData;
  onComplete?: (id: string) => void;
  onProofPicked?: (taskId: string, asset: ImagePicker.ImagePickerAsset) => void | Promise<void>;
  onProofRemoved?: (taskId: string) => void | Promise<void>;
  onPostpone?: (task: TaskRowData) => void | Promise<void>;
  onDelete?: (task: TaskRowData) => void | Promise<void>;
  defaultPomoDurationMinutes?: number;
  onSubtaskComposerFocus?: (inputBottomY: number) => void;
  proofActionInProgress?: boolean;
}

// Format deadline as `HH:MM` for today/past or `HH:MM DD mon` for future
function formatDeadline(isoString: string, isFuture: boolean = false): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (!isFuture) return time;
  const day = date.getDate().toString().padStart(2, '0');
  const month = date.toLocaleDateString('en-GB', { month: 'short' }).toLowerCase();
  return `${time} ${day} ${month}`;
}

export const TaskRow = memo(function TaskRow({
  task,
  onComplete,
  onProofPicked,
  onProofRemoved,
  onPostpone,
  onDelete,
  defaultPomoDurationMinutes = 25,
  onSubtaskComposerFocus,
  proofActionInProgress = false,
}: TaskRowProps) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    session: activePomoSession,
    isLoading: pomoLoading,
    setMinimized,
    startSession,
  } = usePomodoro();
  const isCompleted = task.status
    ? TASK_COMPLETED_LIKE_STATUSES.has(task.status as TaskStatus)
    : (task.completed ?? false);
  const isRepeatingTask = Boolean(task.recurrence_rule_id);
  const canOpenDetail = !isOptimisticTaskId(task.id);
  const { width: screenWidth } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);

  // ── Swipe gesture ──────────────────────────────────────────────────────────
  const translateX = useSharedValue(0);
  const SWIPE_THRESHOLD = screenWidth * 0.35;

  const triggerComplete = useCallback(() => {
    if (task.requires_proof && !task.has_proof) {
      // Shrug — shake and spring back
      translateX.value = withSequence(
        withTiming(-12, { duration: 60 }),
        withTiming(12, { duration: 60 }),
        withTiming(-8, { duration: 50 }),
        withTiming(8, { duration: 50 }),
        withTiming(0, { duration: 50 }),
      );
      return;
    }
    // Flick off-screen right, then trigger complete
    translateX.value = withTiming(screenWidth, { duration: 200 });
    onComplete?.(task.id);
  }, [task.requires_proof, task.has_proof, task.id, onComplete, translateX, screenWidth]);

  const triggerOpenDetail = useCallback(() => {
    if (!canOpenDetail) return;
    // Flick off-screen left, then navigate
    translateX.value = withTiming(-screenWidth, { duration: 200 });
    // Small delay so user sees the flick
    setTimeout(() => {
      router.push(`/tasks/${task.id}` as any);
      // Reset position for when user navigates back
      translateX.value = 0;
    }, 150);
  }, [canOpenDetail, translateX, screenWidth, router, task.id]);

  const panGesture = useMemo(() => {
    const gesture = Gesture.Pan()
      .activeOffsetX([-15, 15])
      .failOffsetY([-10, 10])
      .onUpdate((e) => {
        translateX.value = e.translationX;
      })
      .onEnd((e) => {
        if (e.translationX > SWIPE_THRESHOLD) {
          runOnJS(triggerComplete)();
        } else if (e.translationX < -SWIPE_THRESHOLD) {
          runOnJS(triggerOpenDetail)();
        } else {
          translateX.value = withTiming(0, { duration: 150 });
        }
      });
    if (expanded) gesture.enabled(false);
    return gesture;
  }, [SWIPE_THRESHOLD, triggerComplete, triggerOpenDetail, translateX, expanded]);

  const swipeAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const swipeBgStyle = useAnimatedStyle(() => {
    const tx = translateX.value;
    return {
      backgroundColor: tx > 0 ? colors.success : tx < 0 ? colors.warning : 'transparent',
    };
  });

  const [isPostponing, setIsPostponing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [proofCaptureOpen, setProofCaptureOpen] = useState(false);
  // Subtasks
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [subtasksLoaded, setSubtasksLoaded] = useState(false);
  const [newSubtaskDraft, setNewSubtaskDraft] = useState('');
  const subtaskInputRef = useRef<TextInput>(null);
  const userIdRef = useRef<string | null>(null);

  // Cache the user ID once on mount so inserts can include it
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      userIdRef.current = data.session?.user?.id ?? null;
    });
  }, []);

  useEffect(() => {
    if (!expanded || subtasksLoaded) return;
    let cancelled = false;

    async function load() {
      try {
        const { data, error } = await supabase
          .from('task_subtasks')
          .select('id, title, is_completed, completed_at')
          .eq('parent_task_id', task.id)
          .order('created_at', { ascending: true });

        if (cancelled || error || !data) return;
        setSubtasks(data as Subtask[]);
        setSubtasksLoaded(true);
      } catch {
        // silently ignore load errors
      }
    }

    load();
    return () => { cancelled = true; };
  }, [expanded, subtasksLoaded, task.id]);

  async function handleAddSubtask() {
    const title = newSubtaskDraft.trim();
    if (!title || subtasks.length >= MAX_SUBTASKS) return;

    const userId = userIdRef.current;
    if (!userId) return;

    setNewSubtaskDraft('');

    const tempId = `temp-${Date.now()}`;
    const optimistic: Subtask = { id: tempId, title, is_completed: false, completed_at: null };
    setSubtasks((prev) => [...prev, optimistic]);

    try {
      const { data, error } = await supabase
        .from('task_subtasks')
        .insert({ parent_task_id: task.id, user_id: userId, title, is_completed: false, completed_at: null })
        .select('id, title, is_completed, completed_at')
        .single();

      if (error || !data) {
        setSubtasks((prev) => prev.filter((s) => s.id !== tempId));
        return;
      }

      setSubtasks((prev) => prev.map((s) => (s.id === tempId ? (data as Subtask) : s)));
      subtaskInputRef.current?.focus();
    } catch {
      setSubtasks((prev) => prev.filter((s) => s.id !== tempId));
    }
  }

  async function handleToggleSubtask(subtask: Subtask) {
    const nowCompleted = !subtask.is_completed;
    const completedAt = nowCompleted ? new Date().toISOString() : null;
    const delta = nowCompleted ? 1 : -1;

    type TaskListCache = { dueSoonTasks: TaskRowData[]; futureTasks: TaskRowData[]; pastTasks: TaskRowData[]; hasMorePast: boolean };
    const patchTaskListCache = (d: number) => {
      queryClient.setQueriesData<TaskListCache>(
        { queryKey: ['task-lists'], exact: false },
        (current) => {
          if (!current) return current;
          const patch = (tasks: TaskRowData[]) =>
            tasks.map((t) =>
              t.id === task.id
                ? { ...t, subtaskCompleted: Math.max(0, (t.subtaskCompleted ?? 0) + d) }
                : t,
            );
          return { ...current, dueSoonTasks: patch(current.dueSoonTasks), futureTasks: patch(current.futureTasks), pastTasks: patch(current.pastTasks) };
        },
      );
    };

    setSubtasks((prev) =>
      prev.map((s) => (s.id === subtask.id ? { ...s, is_completed: nowCompleted, completed_at: completedAt } : s)),
    );
    patchTaskListCache(delta);

    try {
      const { error } = await supabase
        .from('task_subtasks')
        .update({ is_completed: nowCompleted, completed_at: completedAt })
        .eq('id', subtask.id)
        .eq('parent_task_id', task.id);

      if (error) {
        setSubtasks((prev) => prev.map((s) => (s.id === subtask.id ? subtask : s)));
        patchTaskListCache(-delta);
      }
    } catch {
      setSubtasks((prev) => prev.map((s) => (s.id === subtask.id ? subtask : s)));
      patchTaskListCache(-delta);
    }
  }

  async function handleDeleteSubtask(subtaskId: string) {
    const snapshot = subtasks;
    const deleted = subtasks.find((s) => s.id === subtaskId);
    setSubtasks((prev) => prev.filter((s) => s.id !== subtaskId));

    type TaskListCache = { dueSoonTasks: TaskRowData[]; futureTasks: TaskRowData[]; pastTasks: TaskRowData[]; hasMorePast: boolean };
    const patchCache = (totalDelta: number, completedDelta: number) => {
      queryClient.setQueriesData<TaskListCache>(
        { queryKey: ['task-lists'], exact: false },
        (current) => {
          if (!current) return current;
          const patch = (tasks: TaskRowData[]) =>
            tasks.map((t) =>
              t.id === task.id
                ? {
                    ...t,
                    subtaskTotal: Math.max(0, (t.subtaskTotal ?? 0) + totalDelta),
                    subtaskCompleted: Math.max(0, (t.subtaskCompleted ?? 0) + completedDelta),
                  }
                : t,
            );
          return { ...current, dueSoonTasks: patch(current.dueSoonTasks), futureTasks: patch(current.futureTasks), pastTasks: patch(current.pastTasks) };
        },
      );
    };

    const completedDelta = deleted?.is_completed ? -1 : 0;
    patchCache(-1, completedDelta);

    try {
      const { error } = await supabase
        .from('task_subtasks')
        .delete()
        .eq('id', subtaskId)
        .eq('parent_task_id', task.id);

      if (error) {
        setSubtasks(snapshot);
        patchCache(1, -completedDelta);
      }
    } catch {
      setSubtasks(snapshot);
      patchCache(1, -completedDelta);
    }
  }

  function handleSubtaskInputFocus() {
    const input = subtaskInputRef.current;
    if (!input || !onSubtaskComposerFocus) return;

    requestAnimationFrame(() => {
      input.measureInWindow((_x, y, _width, height) => {
        if (height <= 0) return;
        onSubtaskComposerFocus(y + height);
      });
    });
  }

  const hasSubtasks = (task.subtaskTotal ?? 0) > 0 || subtasks.length > 0;

  // Determine deadline color and formatting
  const deadlineDate = new Date(task.deadline);
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deadlineDateOnly = new Date(deadlineDate);
  deadlineDateOnly.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const isFuture = deadlineDateOnly.getTime() > tomorrow.getTime();
  const isToday = deadlineDateOnly.getTime() === today.getTime();
  const isTomorrow = deadlineDateOnly.getTime() === tomorrow.getTime();

  // Check if less than 1 hour to deadline
  const timeUntilDeadline = deadlineDate.getTime() - now.getTime();
  const isUrgent = timeUntilDeadline < 60 * 60 * 1000 && timeUntilDeadline > 0;

  // Determine deadline color
  let deadlineColor: string = colors.textMuted;
  if (isUrgent) {
    deadlineColor = colors.destructive; // same red as status pills — within 1 hour of deadline
  } else if (isToday) {
    deadlineColor = '#10B981'; // emerald green — due today
  } else if (isTomorrow) {
    deadlineColor = '#EC4899'; // hot pink — due tomorrow
  }

  const deadlineLabel = formatDeadline(task.deadline, isFuture);
  const createdAtMs = task.created_at ? new Date(task.created_at).getTime() : NaN;
  const canDeleteByAge = Number.isFinite(createdAtMs) && (Date.now() - createdAtMs) <= DELETE_WINDOW_MS;
  const canPostpone = Boolean(onPostpone) && !task.postponed_at && !isPostponing;
  const isCurrentTaskPomo = activePomoSession?.task_id === task.id;
  const currentTaskPomoStatus = isCurrentTaskPomo ? activePomoSession?.status : null;

  function openDetail() {
    if (!canOpenDetail) {
      Alert.alert('Please wait', 'Task is still being created.');
      return;
    }
    router.push(`/tasks/${task.id}` as any);
  }

  async function handlePickedResult(result: ImagePicker.ImagePickerResult) {
    if (result.canceled || result.assets.length === 0) return;

    const asset = result.assets[0];
    if (asset.type === 'video' && typeof asset.duration === 'number' && asset.duration > 15000) {
      Alert.alert('Video too long', 'Please keep proof videos at 15 seconds or less.');
      return;
    }

    if (onProofPicked) {
      await onProofPicked(task.id, asset);
      return;
    }

    Alert.alert(
      'Proof selected',
      asset.type === 'video' ? 'Video selected for this task.' : 'Photo selected for this task.',
    );
  }

  function openProofSourcePicker() {
    if (proofActionInProgress) return;
    const hasProof = Boolean(task.has_proof);
    if (!hasProof) {
      setProofCaptureOpen(true);
      return;
    }

    const takePhotoLabel = hasProof ? 'Replace: Take Photo' : 'Take Photo';
    const recordVideoLabel = hasProof ? 'Replace: Record Video' : 'Record Video';
    const galleryLabel = hasProof ? 'Replace: Choose from Library' : 'Choose from Library';
    const removeLabel = 'Remove proof';

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: hasProof
            ? [takePhotoLabel, recordVideoLabel, galleryLabel, removeLabel, 'Cancel']
            : [takePhotoLabel, recordVideoLabel, galleryLabel, 'Cancel'],
          cancelButtonIndex: hasProof ? 4 : 3,
          destructiveButtonIndex: hasProof ? 3 : undefined,
          userInterfaceStyle: 'dark',
        },
        (selectedIndex) => {
          if (selectedIndex === 0 || selectedIndex === 1 || selectedIndex === 2) setProofCaptureOpen(true);
          if (hasProof && selectedIndex === 3) void onProofRemoved?.(task.id);
        },
      );
      return;
    }

    Alert.alert(
      hasProof ? 'Replace proof' : 'Attach proof',
      'Choose a media source.',
      hasProof
        ? [
            { text: 'Replace proof', onPress: () => setProofCaptureOpen(true) },
            { text: removeLabel, style: 'destructive', onPress: () => void onProofRemoved?.(task.id) },
            { text: 'Cancel', style: 'cancel' },
          ]
        : [
            { text: takePhotoLabel, onPress: () => setProofCaptureOpen(true) },
            { text: recordVideoLabel, onPress: () => setProofCaptureOpen(true) },
            { text: galleryLabel, onPress: () => setProofCaptureOpen(true) },
            { text: 'Cancel', style: 'cancel' },
          ],
      { cancelable: true },
    );
  }

  async function handlePostponePress() {
    if (isPostponing) return;

    if (task.postponed_at) {
      Alert.alert('Already postponed', 'Task has already been postponed once.');
      return;
    }

    if (!onPostpone) {
      Alert.alert('Postpone unavailable', 'Postpone is not available right now.');
      return;
    }

    setIsPostponing(true);
    try {
      await onPostpone(task);
    } finally {
      setIsPostponing(false);
    }
  }

  function confirmDelete(): Promise<boolean> {
    return new Promise((resolve) => {
      Alert.alert(
        'Delete task',
        'This task will be moved to deleted.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
  }

  async function handleDeletePress() {
    if (isDeleting) return;
    if (!canDeleteByAge) return;
    if (!onDelete) {
      Alert.alert('Delete unavailable', 'Delete is not available right now.');
      return;
    }

    const confirmed = await confirmDelete();
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await onDelete(task);
    } finally {
      setIsDeleting(false);
    }
  }

  function handleTimerPress() {
    if (isCurrentTaskPomo) {
      setMinimized(false);
      return;
    }

    void startSession(task.id, defaultPomoDurationMinutes);
  }

  if (isCompleted) {
    // ── Completed / past row ─────────────────────────────────────────────────
    return (
      <TouchableOpacity
        style={styles.completedRow}
        activeOpacity={0.7}
        onPress={openDetail}
        accessibilityRole="button"
        accessibilityLabel={task.title}
      >
        <View style={styles.completedMain}>
          <View style={styles.completedTitleRow}>
            <Text style={styles.completedTitle} numberOfLines={1}>{task.title}</Text>
            {isRepeatingTask ? (
              <Feather name="repeat" size={16} color="#C084FC" style={styles.repeatIcon} />
            ) : null}
          </View>
        </View>
        <View style={styles.completedMeta}>
          {task.status && <StatusPill status={task.status} />}
          <Feather name="external-link" size={14} color={colors.textMuted} style={styles.externalLink} />
        </View>
      </TouchableOpacity>
    );
  }

  // ── Active row ─────────────────────────────────────────────────────────────
  return (
    <View style={[styles.swipeWrapper, expanded && styles.containerExpanded]}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.swipeBg, swipeBgStyle]} />
      <GestureDetector gesture={panGesture}>
      <Animated.View style={[styles.container, swipeAnimatedStyle]}>
        <ProofCaptureModal
        visible={proofCaptureOpen}
        onClose={() => setProofCaptureOpen(false)}
        onAssetPicked={async (asset) => {
          await handlePickedResult({ canceled: false, assets: [asset] });
        }}
      />
      <Pressable
        onPress={() => setExpanded((prev) => !prev)}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${task.title}, ${expanded ? 'collapse' : 'expand'}`}
      >
        {/* Title + subtask count */}
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {task.title}
          </Text>
          {isRepeatingTask ? (
            <Feather name="repeat" size={16} color="#C084FC" style={styles.repeatIcon} />
          ) : null}
          {hasSubtasks && (
            <Text style={styles.subtaskBadge}>
              {task.subtaskCompleted ?? 0}/{task.subtaskTotal}
            </Text>
          )}
        </View>

        <Text style={[styles.deadline, { color: deadlineColor }]}>{deadlineLabel}</Text>
      </Pressable>

      {/* Expanded action tray */}
      {expanded && (
        <View style={styles.expandedPanel}>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.leadingActionBtnAligned]}
              activeOpacity={0.65}
              accessibilityLabel="Complete task"
              onPress={() => {
                if (task.requires_proof && !task.has_proof) {
                  openProofSourcePicker();
                } else {
                  onComplete?.(task.id);
                }
              }}
            >
              <Feather name="circle" size={20} color={colors.success} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              activeOpacity={0.65}
              accessibilityLabel={task.has_proof ? 'Replace proof' : 'Attach proof'}
              onPress={openProofSourcePicker}
              disabled={proofActionInProgress}
            >
              {proofActionInProgress ? (
                <ActivityIndicator size="small" color="#F472B6" />
              ) : (
                <Feather name={task.has_proof ? 'refresh-cw' : 'camera'} size={20} color="#F472B6" />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, !canPostpone && styles.actionBtnDisabled]}
              activeOpacity={0.65}
              accessibilityLabel="Postpone"
              accessibilityState={{ disabled: !canPostpone }}
              onPress={() => { void handlePostponePress(); }}
              disabled={!canPostpone}
            >
              {isPostponing ? (
                <ActivityIndicator size="small" color="#F59E0B" />
              ) : (
                <Feather name="alert-triangle" size={20} color={canPostpone ? '#F59E0B' : colors.textMuted} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, isCurrentTaskPomo && styles.actionBtnActive, pomoLoading && styles.actionBtnDisabled]}
              activeOpacity={0.65}
              accessibilityLabel="Timer"
              onPress={handleTimerPress}
              disabled={pomoLoading}
            >
              <Ionicons name="stopwatch-outline" size={20} color="#22D3EE" />
              {currentTaskPomoStatus ? (
                <Text style={styles.actionBtnTimerLabel}>
                  {currentTaskPomoStatus === 'PAUSED' ? 'Paused' : 'Running'}
                </Text>
              ) : null}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, !canDeleteByAge && styles.actionBtnDisabled]}
              activeOpacity={0.65}
              accessibilityLabel="Delete"
              onPress={() => { void handleDeletePress(); }}
              disabled={!canDeleteByAge}
            >
              {isDeleting ? (
                <ActivityIndicator size="small" color={colors.destructive} />
              ) : (
                <Feather name="trash-2" size={20} color={canDeleteByAge ? colors.destructive : colors.textMuted} />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.trailingActionBtnAligned]}
              activeOpacity={0.65}
              accessibilityLabel="Open detail"
              onPress={openDetail}
            >
              <Feather name="external-link" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.subtasksSection}>
            {subtasks.map((subtask) => (
              <View key={subtask.id} style={styles.subtaskItemRow}>
                <TouchableOpacity
                  onPress={() => { void handleToggleSubtask(subtask); }}
                  style={[styles.subtaskCircle, subtask.is_completed && styles.subtaskCircleCompleted]}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  {subtask.is_completed && <Feather name="check" size={11} color={colors.success} />}
                </TouchableOpacity>
                <Text
                  style={[styles.subtaskItemTitle, subtask.is_completed && styles.subtaskItemTitleCompleted]}
                  numberOfLines={1}
                >
                  {subtask.title}
                </Text>
                <TouchableOpacity
                  onPress={() => { void handleDeleteSubtask(subtask.id); }}
                  activeOpacity={0.7}
                  accessibilityLabel="Delete subtask"
                  style={styles.subtaskDeleteCircle}
                >
                  <Feather name="trash-2" size={14} color={colors.destructive} />
                </TouchableOpacity>
              </View>
            ))}

            <View style={styles.subtaskRow}>
              <TouchableOpacity
                onPress={() => { void handleAddSubtask(); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.6}
              >
                <Feather name="plus" size={16} color={colors.textMuted} />
              </TouchableOpacity>
              <TextInput
                ref={subtaskInputRef}
                style={styles.subtaskInput}
                placeholder="Add subtask..."
                placeholderTextColor={colors.textMuted}
                value={newSubtaskDraft}
                onChangeText={setNewSubtaskDraft}
                returnKeyType="done"
                blurOnSubmit={false}
                onSubmitEditing={() => { void handleAddSubtask(); }}
                onFocus={handleSubtaskInputFocus}
              />
              {newSubtaskDraft.trim().length > 0 && (
                <TouchableOpacity
                  onPress={() => { void handleAddSubtask(); }}
                  activeOpacity={0.7}
                  accessibilityLabel="Confirm subtask"
                  style={styles.subtaskConfirmButton}
                >
                  <Feather name="plus" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      )}
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
  swipeBg: {
    borderRadius: radius.md,
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
  containerExpanded: {},
  completedRow: {
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
  },
  completedMain: {
    flex: 1,
    minWidth: 0,
  },
  completedTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
  },
  completedTitle: {
    flexShrink: 1,
    fontSize: 20,
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  completedMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 15,
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
    fontSize: 20,
    color: colors.text,
  },
  repeatIcon: {
    flexShrink: 0,
  },
  subtaskBadge: {
    fontSize: typography.xs,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  deadlineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexShrink: 0,
    gap: 0,
  },
  deadline: {
    fontSize: typography.sm,
    color: colors.textMuted,
    whiteSpace: 'nowrap',
  } as any,
  deadlineOrdinal: {
    fontSize: 9,
    fontWeight: typography.bold,
    color: colors.textMuted,
    marginTop: 1,
    marginHorizontal: 0,
  },
  externalLink: {
    flexShrink: 0,
  },
  expandedPanel: {
    paddingBottom: spacing.md,
    borderTopWidth: isDark ? 0 : 1,
    borderTopColor: isDark ? 'transparent' : colors.border,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  actionBtn: {
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  leadingActionBtnAligned: {
    marginLeft: -6,
  },
  trailingActionBtnAligned: {
    marginRight: -6,
  },
  actionBtnActive: {
    borderRadius: radius.full,
    backgroundColor: '#22D3EE14',
  },
  actionBtnDisabled: {
    opacity: 0.45,
  },
  subtaskDeleteCircle: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtaskConfirmButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  actionBtnTimerLabel: {
    fontSize: typography.xs,
    color: '#22D3EE',
    fontWeight: typography.medium,
  },
  subtasksSection: {
    marginLeft: spacing.lg,
    marginRight: spacing.lg,
    marginTop: spacing.sm,
  },
  subtaskItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    gap: spacing.sm,
  },
  subtaskCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginLeft: 2,
  },
  subtaskCircleCompleted: {
    borderColor: colors.success,
    backgroundColor: colors.successMuted,
  },
  subtaskItemTitle: {
    flex: 1,
    fontSize: typography.md,
    color: colors.text,
  },
  subtaskItemTitleCompleted: {
    textDecorationLine: 'line-through',
    color: colors.textMuted,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  subtaskIcon: {
    flexShrink: 0,
  },
  subtaskInput: {
    flex: 1,
    fontSize: typography.md,
    color: colors.text,
    paddingVertical: 0,
  },
});
