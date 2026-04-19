import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { StatusPill } from '@/components/StatusPill';
import { usePomodoro } from '@/components/pomodoro/PomodoroProvider';
import { supabase } from '@/lib/supabase';
import { TASK_COMPLETED_LIKE_STATUSES } from '@/lib/constants/task-status';
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

export function TaskRow({
  task,
  onComplete,
  onProofPicked,
  onProofRemoved,
  onPostpone,
  onDelete,
  defaultPomoDurationMinutes = 25,
  onSubtaskComposerFocus,
}: TaskRowProps) {
  const router = useRouter();
  const {
    session: activePomoSession,
    isLoading: pomoLoading,
    setMinimized,
    startSession,
  } = usePomodoro();
  const isCompleted = task.status
    ? TASK_COMPLETED_LIKE_STATUSES.has(task.status as TaskStatus)
    : (task.completed ?? false);

  // Active rows are tappable to expand the action tray
  const [expanded, setExpanded] = useState(false);
  const [isPostponing, setIsPostponing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [firstActionX, setFirstActionX] = useState(0);

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

    setSubtasks((prev) =>
      prev.map((s) => (s.id === subtask.id ? { ...s, is_completed: nowCompleted, completed_at: completedAt } : s)),
    );

    try {
      const { error } = await supabase
        .from('task_subtasks')
        .update({ is_completed: nowCompleted, completed_at: completedAt })
        .eq('id', subtask.id)
        .eq('parent_task_id', task.id);

      if (error) {
        setSubtasks((prev) => prev.map((s) => (s.id === subtask.id ? subtask : s)));
      }
    } catch {
      setSubtasks((prev) => prev.map((s) => (s.id === subtask.id ? subtask : s)));
    }
  }

  async function handleDeleteSubtask(subtaskId: string) {
    const snapshot = subtasks;
    setSubtasks((prev) => prev.filter((s) => s.id !== subtaskId));

    try {
      const { error } = await supabase
        .from('task_subtasks')
        .delete()
        .eq('id', subtaskId)
        .eq('parent_task_id', task.id);

      if (error) {
        setSubtasks(snapshot);
      }
    } catch {
      setSubtasks(snapshot);
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
  const isCurrentTaskPomo = activePomoSession?.task_id === task.id;
  const currentTaskPomoStatus = isCurrentTaskPomo ? activePomoSession?.status : null;

  async function ensureCameraPermission(): Promise<boolean> {
    const current = await ImagePicker.getCameraPermissionsAsync();
    if (current.granted) return true;

    const requested = await ImagePicker.requestCameraPermissionsAsync();
    if (requested.granted) return true;

    Alert.alert(
      'Camera permission required',
      'Allow camera access in Settings to capture proof media.',
    );
    return false;
  }

  async function ensureGalleryPermission(): Promise<boolean> {
    const current = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (current.granted) return true;

    const requested = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (requested.granted) return true;

    Alert.alert(
      'Photos permission required',
      'Allow photo library access in Settings to attach existing media.',
    );
    return false;
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

  async function handleTakePhoto() {
    try {
      const allowed = await ensureCameraPermission();
      if (!allowed) return;

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: 'images',
        quality: 0.9,
        allowsEditing: false,
        exif: true,
      });

      await handlePickedResult(result);
    } catch {
      Alert.alert('Could not open camera', 'Please try again.');
    }
  }

  async function handleRecordVideo() {
    try {
      const allowed = await ensureCameraPermission();
      if (!allowed) return;

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: 'videos',
        videoMaxDuration: 15,
        quality: 0.8,
        exif: true,
      });

      await handlePickedResult(result);
    } catch {
      Alert.alert('Could not record video', 'Please try again.');
    }
  }

  async function handleChooseFromGallery() {
    try {
      const allowed = await ensureGalleryPermission();
      if (!allowed) return;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsMultipleSelection: false,
        quality: 0.9,
        videoMaxDuration: 15,
        exif: true,
        ...(Platform.OS === 'ios'
          ? {
              preferredAssetRepresentationMode:
                ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
            }
          : {}),
      });

      await handlePickedResult(result);
    } catch {
      Alert.alert('Could not open photo library', 'Please try again.');
    }
  }

  function openProofSourcePicker() {
    const hasProof = Boolean(task.has_proof);
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
          if (selectedIndex === 0) void handleTakePhoto();
          if (selectedIndex === 1) void handleRecordVideo();
          if (selectedIndex === 2) void handleChooseFromGallery();
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
            { text: takePhotoLabel, onPress: () => void handleTakePhoto() },
            { text: recordVideoLabel, onPress: () => void handleRecordVideo() },
            { text: galleryLabel, onPress: () => void handleChooseFromGallery() },
            { text: removeLabel, style: 'destructive', onPress: () => void onProofRemoved?.(task.id) },
            { text: 'Cancel', style: 'cancel' },
          ]
        : [
            { text: takePhotoLabel, onPress: () => void handleTakePhoto() },
            { text: recordVideoLabel, onPress: () => void handleRecordVideo() },
            { text: galleryLabel, onPress: () => void handleChooseFromGallery() },
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
        onPress={() => router.push(`/tasks/${task.id}` as any)}
        accessibilityRole="button"
        accessibilityLabel={task.title}
      >
        <View style={styles.circleCompleted}>
          <Feather name="check" size={13} color={colors.textMuted} />
        </View>
        <View style={styles.completedMain}>
          <Text style={styles.completedTitle} numberOfLines={1}>{task.title}</Text>
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
    <View style={[styles.container, expanded && styles.containerExpanded]}>
      <Pressable
        onPress={() => setExpanded((prev) => !prev)}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${task.title}, ${expanded ? 'collapse' : 'expand'}`}
      >
        {/* Circle — tapping only toggles completion */}
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onComplete?.(task.id);
          }}
          style={({ pressed }) => [styles.circle, pressed && styles.circlePressed]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: false }}
          accessibilityLabel={`Mark "${task.title}" complete`}
          hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
        />

        {/* Title + subtask count */}
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {task.title}
          </Text>
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
              style={styles.actionBtn}
              activeOpacity={0.65}
              accessibilityLabel={task.has_proof ? 'Replace proof' : 'Attach proof'}
              onPress={openProofSourcePicker}
              onLayout={(e) => setFirstActionX(e.nativeEvent.layout.x)}
            >
              <Feather name={task.has_proof ? 'refresh-cw' : 'camera'} size={20} color="#F472B6" />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              activeOpacity={0.65}
              accessibilityLabel="Postpone"
              onPress={() => { void handlePostponePress(); }}
            >
              {isPostponing ? (
                <ActivityIndicator size="small" color="#F59E0B" />
              ) : (
                <Feather name="alert-triangle" size={20} color="#F59E0B" />
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
              style={styles.actionBtn}
              activeOpacity={0.65}
              accessibilityLabel="Open detail"
              onPress={() => router.push(`/tasks/${task.id}` as any)}
            >
              <Feather name="external-link" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={[styles.subtasksSection, { marginLeft: firstActionX }]}>
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
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  <Feather name="x" size={14} color={colors.textMuted} />
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
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  containerExpanded: {
    backgroundColor: colors.surface,
  },
  completedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    gap: spacing.sm,
  },
  completedMain: {
    flex: 1,
    minWidth: 0,
  },
  completedTitle: {
    fontSize: 18,
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
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  circleCompleted: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  circlePressed: {
    opacity: 0.6,
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
    fontSize: 18,
    color: colors.text,
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
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  actionBtn: {
    padding: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionBtnActive: {
    borderRadius: radius.full,
    backgroundColor: '#22D3EE14',
  },
  actionBtnDisabled: {
    opacity: 0.45,
  },
  actionBtnTimerLabel: {
    fontSize: typography.xs,
    color: '#22D3EE',
    fontWeight: typography.medium,
  },
  subtasksSection: {
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
  },
  subtaskCircleCompleted: {
    borderColor: colors.success,
    backgroundColor: colors.successMuted,
  },
  subtaskItemTitle: {
    flex: 1,
    fontSize: typography.sm,
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
    fontSize: typography.base,
    color: colors.text,
    paddingVertical: 0,
  },
});
