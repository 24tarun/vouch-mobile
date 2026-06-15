import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Animated,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import type { ImagePickerAsset } from 'expo-image-picker';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useVideoPlayer, VideoView } from 'expo-video';
import Toast from 'react-native-toast-message';
import { DEFAULT_REMINDER_OFFSET_MS, normalizePomoDurationMinutes } from '@/lib/constants/timings';
import { supabase } from '@/lib/supabase';
import { purgeTaskProofForFinalState, queueAiEvalForTask, removeTaskProofAsset, uploadTaskProofAsset } from '@/lib/task-proof-upload';
import { completeTask, stopTaskRepetitions, undoCompleteTask, deleteTask, postponeTaskDeadline, isTaskWithinDeleteWindow } from '@/lib/tasks/task-actions';
import { syncLocalReminderNotificationsAsync } from '@/lib/notifications';
import { type Colors, radius, spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import { StatusPill } from '@/components/StatusPill';
import { usePomodoro } from '@/components/pomodoro/PomodoroProvider';
import type { RecurrenceRule, Task, TaskEvent, TaskReminder } from '@/lib/types';
import { resolveUserClientInstanceId } from '@/lib/user-client-instance';
import { AI_PROFILE_ID, AI_PROFILE_USERNAME } from '@/lib/constants/ai-profile';
import { useAuth } from '@/hooks/useAuth';
import { useTaskDetail } from '@/lib/hooks/useTaskDetail';
import { queryKeys } from '@/lib/query/keys';
import { isOptimisticTaskId } from '@/lib/tasks/task-id';
import { getDefaultDeadline } from '@/lib/task-title-parser';
import { PostponeDeadlineModal } from '@/components/tasks/PostponeDeadlineModal';
import { LegacyPostponeCalendarPicker } from '@/components/tasks/LegacyPostponeCalendarPicker';
import { ProofCaptureModal } from '@/components/tasks/ProofCaptureModal';
import { TaskTimeline } from '@/components/tasks/TaskTimeline';

const MAX_AI_RESUBMITS = 3;

// ─── Button color tokens ──────────────────────────────────────────────────────

const BTN = {
  complete:      { bg: '#22C55E1A', border: '#22C55E59', text: '#22C55E' },
  pomo:          { bg: '#22D3EE1A', border: '#22D3EE4D', text: '#22D3EE' },
  proof:         { bg: '#F472B61A', border: '#F472B659', text: '#F472B6' },
  stopRepeating: { bg: '#C084FC1A', border: '#C084FC59', text: '#C084FC' },
  override:      { bg: '#A21CAF33', border: '#A21CAFB3', text: '#F0ABFC' },
  reminders:     { bg: '#FBBF2426', border: '#FBBF2459', text: '#FBBF24' },
  undoComplete:  { bg: '#34D3991A', border: '#34D39959', text: '#34D399' },
  postpone:      { bg: '#F59E0B1A', border: '#F59E0B59', text: '#F59E0B' },
  delete:        { bg: '#F871711A', border: '#F8717159', text: '#F87171' },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getOrdinal(day: number): string {
  if (day >= 11 && day <= 13) return `${day}th`;
  switch (day % 10) {
    case 1: return `${day}st`;
    case 2: return `${day}nd`;
    case 3: return `${day}rd`;
    default: return `${day}th`;
  }
}

function formatFullDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const dayName = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const month = d.toLocaleDateString('en-GB', { month: 'long' });
  return `${dayName} ${getOrdinal(d.getDate())} ${month} · ${time}`;
}

function getEventReason(event: TaskEvent): string | null {
  const rawReason = event.metadata?.reason;
  if (typeof rawReason !== 'string') return null;
  const trimmed = rawReason.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatFocusedTime(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, totalSeconds) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function formatCost(cents: number, currency: string): string {
  const amount = cents / 100;
  const symbol = currency === 'EUR' ? '€' : currency === 'INR' ? '₹' : '$';
  const formatted = amount % 1 === 0 ? Math.round(amount).toString() : amount.toFixed(2);
  return `${symbol}${formatted}`;
}

function weekdayName(day: number): string {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[((day % 7) + 7) % 7];
}

function formatListWithAnd(values: string[]): string {
  if (values.length === 0) return '';
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function formatDeadlineTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function buildRecurrenceSummary(task: Task, recurrenceRule: RecurrenceRule | null): string | null {
  if (!task.recurrence_rule_id) return null;

  const config = recurrenceRule?.rule_config ?? null;
  const frequency = config?.frequency ?? null;
  const timeOfDay = config?.time_of_day ?? formatDeadlineTime(task.deadline);

  if (!frequency) return `Deadline at ${timeOfDay}`;

  switch (frequency) {
    case 'DAILY':
      return `Every day with deadline at ${timeOfDay}`;
    case 'WEEKDAYS':
      return `Every weekday with deadline at ${timeOfDay}`;
    case 'MONTHLY':
      return `Every month with deadline at ${timeOfDay}`;
    case 'YEARLY':
      return `Every year with deadline at ${timeOfDay}`;
    case 'WEEKLY':
    case 'CUSTOM': {
      const days = (config?.days_of_week ?? [])
        .map((day) => Number(day))
        .filter((day) => Number.isFinite(day))
        .map((day) => weekdayName(day));

      if (days.length > 0) {
        return `${formatListWithAnd(days)} with deadline at ${timeOfDay}`;
      }

      return `${weekdayName(new Date(task.deadline).getDay())} with deadline at ${timeOfDay}`;
    }
    default:
      return `Deadline at ${timeOfDay}`;
  }
}

function VideoProofPreview({
  signedUrl,
  overlayTimestampText,
  width,
}: {
  signedUrl: string;
  overlayTimestampText: string;
  width: number;
}) {
  const player = useVideoPlayer(signedUrl, (p) => {
    p.loop = false;
    p.muted = false;
  });
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const sub = player.addListener('playingChange', (event) => {
      setPlaying(event.isPlaying);
    });
    return () => sub.remove();
  }, [player]);

  function togglePlay() {
    if (playing) {
      player.pause();
    } else {
      player.play();
    }
  }

  return (
    <Pressable
      style={[styles.proofPreviewWrap, { width }]}
      onPress={togglePlay}
    >
      <VideoView
        player={player}
        style={styles.proofPreviewVideo}
        contentFit="cover"
        nativeControls={false}
      />
      {!playing ? (
        <View style={styles.proofVideoOverlay}>
          <Feather name="play-circle" size={36} color="rgba(255,255,255,0.9)" />
        </View>
      ) : null}
      {overlayTimestampText ? (
        <View style={styles.proofTimestampWrap}>
          <Text style={styles.proofTimestampText}>{overlayTimestampText}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function TaskDetailScreen() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const { id, back } = useLocalSearchParams<{ id: string; back?: string }>();
  const routeTaskId = typeof id === 'string' ? id : '';
  const optimisticTask = isOptimisticTaskId(routeTaskId);
  const isValidId = optimisticTask || UUID_REGEX.test(routeTaskId);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { width: screenWidth } = useWindowDimensions();
  const { user, profile } = useAuth();
  const detail = useTaskDetail(isValidId && routeTaskId ? routeTaskId : null);
  const handleBack = () => {
    if (back === 'friends') {
      router.navigate('/friends' as any);
    } else {
      router.back();
    }
  };

  useEffect(() => {
    if (routeTaskId && !isValidId) {
      router.back();
    }
  }, [routeTaskId, isValidId, router]);

  // ── Subtasks ───────────────────────────────────────────────────────────────
  interface Subtask { id: string; title: string; is_completed: boolean; completed_at: string | null }
  const MAX_SUBTASKS = 20;

  const getCachedSubtasks = useCallback((): Subtask[] | undefined => {
    const allCaches = queryClient.getQueriesData<{ dueSoonTasks: { id: string; subtasks?: Subtask[] }[]; futureTasks: { id: string; subtasks?: Subtask[] }[] }>({ queryKey: ['task-lists'] });
    for (const [, cache] of allCaches) {
      if (!cache) continue;
      for (const bucket of [cache.dueSoonTasks, cache.futureTasks]) {
        const match = bucket?.find((t) => t.id === id);
        if (match?.subtasks) return match.subtasks;
      }
    }
    return undefined;
  }, [id, queryClient]);

  const [subtasks, setSubtasks] = useState<Subtask[]>(() => getCachedSubtasks() ?? []);
  const [newSubtaskDraft, setNewSubtaskDraft] = useState('');
  const subtaskInputRef = useRef<TextInput>(null);
  const subtaskSnapshotRef = useRef<Subtask[]>([]);
  const mutatingSubtaskIdsRef = useRef<Set<string>>(new Set());
  const hasUserToggledSubtasksRef = useRef(false);

  useEffect(() => {
    if (!id) return;
    const cached = getCachedSubtasks();
    if (cached) {
      setSubtasks(cached);
      return;
    }
    let cancelled = false;
    setSubtasks([]);
    supabase
      .from('task_subtasks')
      .select('id, title, is_completed, completed_at')
      .eq('parent_task_id', id)
      .order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setSubtasks(data as Subtask[]);
      });
    return () => { cancelled = true; };
  }, [id, getCachedSubtasks]);

  async function handleAddSubtask() {
    const title = newSubtaskDraft.trim();
    if (!title || subtasks.length >= MAX_SUBTASKS || !user?.id || !id) return;
    setNewSubtaskDraft('');
    const tempId = `temp-${Date.now()}`;
    setSubtasks((prev) => [...prev, { id: tempId, title, is_completed: false, completed_at: null }]);
    try {
      const { data, error } = await supabase
        .from('task_subtasks')
        .insert({ parent_task_id: id, user_id: user.id, title, is_completed: false, completed_at: null })
        .select('id, title, is_completed, completed_at')
        .single();
      if (error || !data) { setSubtasks((prev) => prev.filter((s) => s.id !== tempId)); return; }
      setSubtasks((prev) => prev.map((s) => (s.id === tempId ? (data as Subtask) : s)));
      subtaskInputRef.current?.focus();
    } catch {
      setSubtasks((prev) => prev.filter((s) => s.id !== tempId));
    }
  }

  async function handleToggleSubtask(subtask: Subtask) {
    if (mutatingSubtaskIdsRef.current.has(subtask.id)) return;
    mutatingSubtaskIdsRef.current.add(subtask.id);

    const nowCompleted = !subtask.is_completed;
    const completedAt = nowCompleted ? new Date().toISOString() : null;
    setSubtasks((prev) => prev.map((s) => (s.id === subtask.id ? { ...s, is_completed: nowCompleted, completed_at: completedAt } : s)));
    try {
      const { error } = await supabase
        .from('task_subtasks')
        .update({ is_completed: nowCompleted, completed_at: completedAt })
        .eq('id', subtask.id)
        .eq('parent_task_id', id);
      if (error) setSubtasks((prev) => prev.map((s) => (s.id === subtask.id ? subtask : s)));
    } catch {
      setSubtasks((prev) => prev.map((s) => (s.id === subtask.id ? subtask : s)));
    } finally {
      mutatingSubtaskIdsRef.current.delete(subtask.id);
    }
  }

  async function handleDeleteSubtask(subtaskId: string) {
    setSubtasks((prev) => {
      subtaskSnapshotRef.current = prev;
      return prev.filter((s) => s.id !== subtaskId);
    });
    try {
      const { error } = await supabase
        .from('task_subtasks')
        .delete()
        .eq('id', subtaskId)
        .eq('parent_task_id', id);
      if (error) setSubtasks(subtaskSnapshotRef.current);
    } catch {
      setSubtasks(subtaskSnapshotRef.current);
    }
  }

  const [currency, setCurrency] = useState('USD');
  const [pomoDuration, setPomoDuration] = useState(25);
  const [pomoDraft, setPomoDraft] = useState('25');
  const [isEditingPomo, setIsEditingPomo] = useState(false);
  const [expandedPanel, setExpandedPanel] = useState<'reminders' | 'subtasks' | null>(
    () => ((getCachedSubtasks()?.length ?? 0) > 0 ? 'subtasks' : null),
  );
  const [isMutatingReminder, setIsMutatingReminder] = useState(false);
  const [customReminderDate, setCustomReminderDate] = useState<Date>(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 30, 0, 0);
    return d;
  });
  const [customReminderPickerMode, setCustomReminderPickerMode] = useState<'date' | 'time'>('date');
  const [showCustomReminderAndroidPicker, setShowCustomReminderAndroidPicker] = useState(false);
  const [showCustomReminderIosModal, setShowCustomReminderIosModal] = useState(false);
  const [proofUploading, setProofUploading] = useState(false);
  const proofUploadLockRef = useRef(false);
  const [proofRemoving, setProofRemoving] = useState(false);
  const [isOverriding, setIsOverriding] = useState(false);
  const [isUndoingComplete, setIsUndoingComplete] = useState(false);
  const [isStoppingRepetitions, setIsStoppingRepetitions] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isPostponing, setIsPostponing] = useState(false);
  const [isEscalating, setIsEscalating] = useState(false);
  const [isAcceptingDenial, setIsAcceptingDenial] = useState(false);
  const [isSubmittingAiReview, setIsSubmittingAiReview] = useState(false);
  const [postponePickerOpen, setPostponePickerOpen] = useState(false);
  const [postponePickerDate, setPostponePickerDate] = useState<Date>(() => getDefaultDeadline());
  const [refreshing, setRefreshing] = useState(false);
  const [proofLightboxOpen, setProofLightboxOpen] = useState(false);
  const [proofCaptureOpen, setProofCaptureOpen] = useState(false);

  useEffect(() => {
    hasUserToggledSubtasksRef.current = false;
    setExpandedPanel((getCachedSubtasks()?.length ?? 0) > 0 ? 'subtasks' : null);
  }, [getCachedSubtasks]);

  useEffect(() => {
    if (subtasks.length === 0 || hasUserToggledSubtasksRef.current || expandedPanel !== null) return;
    setExpandedPanel('subtasks');
  }, [expandedPanel, subtasks.length]);

  function handleSubtasksTogglePress() {
    hasUserToggledSubtasksRef.current = true;
    setExpandedPanel((current) => (current === 'subtasks' ? null : 'subtasks'));
  }
  const [escalationPickerOpen, setEscalationPickerOpen] = useState(false);
  const [escalationFriendsLoading, setEscalationFriendsLoading] = useState(false);
  const [escalationFriends, setEscalationFriends] = useState<Array<{ id: string; username: string; email: string }>>([]);
  const {
    session: activePomoSession,
    isLoading: pomoLoading,
    setMinimized,
    startSession,
  } = usePomodoro();
  const task = detail.data?.task ?? null;
  const taskId = task?.id ?? null;
  const voucherUsername = task?.voucher_id === AI_PROFILE_ID
    ? AI_PROFILE_USERNAME
    : detail.data?.voucherUsername ?? null;
  const reminders = detail.data?.reminders ?? [];
  const events = detail.data?.events ?? [];
  const totalFocusedSeconds = detail.data?.totalFocusedSeconds ?? 0;
  const proof = detail.data?.proof ?? null;
  const hasUploadedProof = Boolean(proof);
  const recurrenceRule = detail.data?.recurrenceRule ?? null;
  const proofPreviewWidth = screenWidth - spacing.lg * 2;
  const autoSubmitAfterProofUpload = profile?.auto_submit_after_proof_upload ?? true;

  const refetchDetail = detail.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetchDetail();
    }, [refetchDetail]),
  );

  useEffect(() => {
    const nextCurrency = profile?.currency ?? 'USD';
    setCurrency(nextCurrency);
    const defaultPomo = normalizePomoDurationMinutes(profile?.default_pomo_duration_minutes);
    setPomoDuration(defaultPomo);
    setPomoDraft(String(defaultPomo));
  }, [profile?.currency, profile?.default_pomo_duration_minutes]);

  useEffect(() => {
    if (postponePickerOpen && taskId) {
      setPostponePickerDate(getDefaultDeadline());
    }
  }, [postponePickerOpen, taskId]);

  function showProofToast(message: string, tone: 'error' | 'success') {
    Toast.show({
      type: tone === 'error' ? 'proofError' : 'proofSuccess',
      text1: message,
      position: 'bottom',
      autoHide: true,
      visibilityTime: 2600,
      bottomOffset: 84,
    });
  }

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.resolve(detail.refetch());
    setRefreshing(false);
  }

  function invalidateDerivedTaskViews() {
    if (!user?.id) return;
    void queryClient.invalidateQueries({ queryKey: ['task-lists', user.id] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.settingsStats(user.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.ledger(user.id) });
  }

  async function uploadSelectedProof(asset: ImagePickerAsset) {
    if (!task || proofUploadLockRef.current) return;

    const isReplacingProof = Boolean(proof);
    const shouldAutoCompleteAfterUpload =
      autoSubmitAfterProofUpload &&
      task.user_id === user?.id &&
      (task.status === 'ACTIVE' || task.status === 'POSTPONED');
    const shouldQueueAiAfterUpload = task.status === 'AWAITING_USER' && task.voucher_id === AI_PROFILE_ID;
    proofUploadLockRef.current = true;
    setProofUploading(true);
    try {
      const result = await uploadTaskProofAsset(task.id, asset);
      if (!result.success) {
        showProofToast(`Proof upload failed: ${result.error}`, 'error');
        return;
      }

      queryClient.setQueryData(queryKeys.taskDetail(routeTaskId), (previous: any) => previous ? {
        ...previous,
        task: previous.task
          ? {
              ...previous.task,
              proof_request_open: false,
              proof_requested_at: null,
              proof_requested_by: null,
            }
          : previous.task,
      } : previous);
      await Promise.resolve(detail.refetch());
      if (shouldAutoCompleteAfterUpload) {
        setIsCompleting(true);
        let completeResult: Awaited<ReturnType<typeof completeTask>>;
        try {
          completeResult = await completeTask(task.id);
        } finally {
          setIsCompleting(false);
        }
        if (!completeResult.success) {
          Alert.alert('Proof uploaded, but could not complete task', completeResult.error ?? 'Unknown error');
          return;
        }
        if (completeResult.userId) void syncLocalReminderNotificationsAsync(completeResult.userId);
        await Promise.resolve(detail.refetch());
      }
      if (shouldQueueAiAfterUpload) {
        Toast.show({
          type: 'proofSuccess',
          text1: 'Proof uploaded',
          text2: 'Tap Submit to send this to AI review.',
          position: 'bottom',
          bottomOffset: 84,
          visibilityTime: 2600,
        });
      }
      invalidateDerivedTaskViews();
      if (isReplacingProof) {
        showProofToast('Proof replaced successfully.', 'success');
      }
    } finally {
      proofUploadLockRef.current = false;
      setProofUploading(false);
    }
  }

  async function removeCurrentProof() {
    if (!task || !proof || proofUploadLockRef.current || proofRemoving) return;

    proofUploadLockRef.current = true;
    setProofRemoving(true);
    try {
      // 1. Update DB ground truth first so realtime events never see has_proof=true
      //    after the proof is gone. A dangling storage file is harmless.
      const nowIso = new Date().toISOString();
      const { error: taskUpdateError } = await supabase
        .from('tasks')
        .update({
          has_proof: false,
          updated_at: nowIso,
        })
        .eq('id', task.id)
        .eq('user_id', task.user_id);

      if (taskUpdateError) {
        Alert.alert('Could not update task', taskUpdateError.message);
        return;
      }

      // 2. Best-effort storage cleanup
      const removeResult = await removeTaskProofAsset(task.id, {
        bucket: proof.bucket,
        objectPath: proof.objectPath,
      });

      if (!removeResult.success) {
        Alert.alert('Proof removed', 'Task state was updated, but the proof file could not be deleted from storage.');
      }

      queryClient.setQueryData(queryKeys.taskDetail(routeTaskId), (previous: any) => previous ? {
        ...previous,
        task: previous.task
          ? {
              ...previous.task,
              has_proof: false,
            }
          : previous.task,
        proof: null,
      } : previous);
      await Promise.resolve(detail.refetch());
      invalidateDerivedTaskViews();
    } finally {
      proofUploadLockRef.current = false;
      setProofRemoving(false);
    }
  }

  function openProofPicker() {
    if (proofUploadLockRef.current || proofRemoving) return;
    if (!proof) {
      setProofCaptureOpen(true);
      return;
    }

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Replace proof', 'Remove proof', 'Cancel'],
          cancelButtonIndex: 2,
          destructiveButtonIndex: 1,
          userInterfaceStyle: 'dark',
        },
        (selectedIndex) => {
          if (selectedIndex === 0) setProofCaptureOpen(true);
          if (selectedIndex === 1) void removeCurrentProof();
        },
      );
      return;
    }

    Alert.alert('Manage proof', 'Replace the current proof or remove it.', [
      { text: 'Replace proof', onPress: () => setProofCaptureOpen(true) },
      { text: 'Remove proof', style: 'destructive', onPress: () => void removeCurrentProof() },
      { text: 'Cancel', style: 'cancel' },
    ], { cancelable: true });
  }

  async function loadEscalationFriends() {
    if (!user?.id || escalationFriendsLoading) return;
    setEscalationFriendsLoading(true);
    try {
      const { data, error } = await (supabase.from('friendships') as any)
        .select('friend_id, friend:profiles!friendships_friend_id_fkey(id, username, email)')
        .eq('user_id', user.id);

      if (error) {
        Alert.alert('Could not load friends', error.message);
        return;
      }

      const next = ((data ?? []) as any[])
        .map((row) => row.friend)
        .filter((friend) => friend?.id && friend.id !== AI_PROFILE_ID && friend.id !== user.id)
        .map((friend) => ({
          id: String(friend.id),
          username: String(friend.username ?? '').trim() || String(friend.email ?? 'Friend'),
          email: String(friend.email ?? ''),
        }));

      setEscalationFriends(next);
      setEscalationPickerOpen(true);
    } finally {
      setEscalationFriendsLoading(false);
    }
  }

  function getVoucherResponseDeadlineIso(): string {
    const deadline = new Date();
    deadline.setDate(deadline.getDate() + 2);
    deadline.setHours(23, 59, 59, 999);
    return deadline.toISOString();
  }

  async function handleEscalateToFriend(friendId: string) {
    if (!task || !user?.id || isEscalating) return;
    setIsEscalating(true);
    try {
      if (task.user_id !== user.id) {
        Alert.alert('Not authorised', 'You can only escalate your own task.');
        return;
      }
      if (task.status !== 'AWAITING_USER') {
        Alert.alert('Cannot escalate', `Task is currently ${task.status}.`);
        return;
      }
      if (task.voucher_id !== AI_PROFILE_ID || task.ai_escalated_from) {
        Alert.alert('Cannot escalate', 'This task is not eligible for AI escalation.');
        return;
      }
      if (friendId === AI_PROFILE_ID || friendId === user.id) {
        Alert.alert('Cannot escalate', 'Please choose a friend.');
        return;
      }
      if (!hasUploadedProof) {
        Alert.alert('Missing proof', 'Upload proof before escalating to a friend.');
        return;
      }

      const nowIso = new Date().toISOString();
      const actorUserClientInstanceId = await resolveUserClientInstanceId(user.id);

      const { data: reassignedProofRows, error: reassignProofError } = await supabase
        .from('task_completion_proofs')
        .update({
          voucher_id: friendId,
          updated_at: nowIso,
        } as any)
        .eq('task_id', task.id)
        .eq('owner_id', user.id)
        .eq('upload_state', 'UPLOADED')
        .not('object_path', 'is', null)
        .select('id');

      if (reassignProofError) {
        Alert.alert('Escalation failed', `Could not attach proof for the selected friend: ${reassignProofError.message}`);
        return;
      }
      if (!reassignedProofRows || reassignedProofRows.length === 0) {
        Alert.alert('Escalation failed', 'No uploaded proof was found to send to your friend.');
        return;
      }

      const { data: updatedRows, error: updateError } = await supabase
        .from('tasks')
        .update({
          voucher_id: friendId,
          ai_escalated_from: true,
          status: 'AWAITING_VOUCHER',
          voucher_response_deadline: getVoucherResponseDeadlineIso(),
          updated_at: nowIso,
        })
        .eq('id', task.id)
        .eq('user_id', user.id)
        .eq('status', 'AWAITING_USER')
        .select('id');

      if (updateError) {
        Alert.alert('Escalation failed', updateError.message);
        return;
      }
      if (!updatedRows || updatedRows.length === 0) {
        Alert.alert('Escalation failed', 'Task is no longer in AWAITING_USER.');
        return;
      }

      const { error: eventError } = await supabase.from('task_events').insert([
        {
          task_id: task.id,
          event_type: 'ESCALATE',
          actor_id: user.id,
          actor_user_client_instance_id: actorUserClientInstanceId,
          from_status: 'AWAITING_USER',
          to_status: 'ESCALATED',
          metadata: { new_voucher_id: friendId },
        },
        {
          task_id: task.id,
          event_type: 'AI_ESCALATE_TO_HUMAN',
          actor_id: user.id,
          actor_user_client_instance_id: actorUserClientInstanceId,
          from_status: 'ESCALATED',
          to_status: 'AWAITING_VOUCHER',
          metadata: { new_voucher_id: friendId },
        },
      ] as any);

      if (eventError) {
        Alert.alert('Escalated', `Task escalated, but event logging failed: ${eventError.message}`);
      }

      setEscalationPickerOpen(false);
      await Promise.resolve(detail.refetch());
      invalidateDerivedTaskViews();
    } finally {
      setIsEscalating(false);
    }
  }

  async function handleAcceptDenial() {
    if (!task || !user?.id || isAcceptingDenial) return;
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Accept denial?',
        'This finalizes the denial and applies failure cost.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Accept', style: 'destructive', onPress: () => resolve(true) },
        ],
      );
    });
    if (!confirmed) return;

    setIsAcceptingDenial(true);
    try {
      if (task.user_id !== user.id || task.status !== 'AWAITING_USER') {
        Alert.alert('Cannot finalize', 'Task is no longer awaiting your decision.');
        return;
      }

      const period = new Date().toISOString().slice(0, 7);
      const nowIso = new Date().toISOString();
      const actorUserClientInstanceId = await resolveUserClientInstanceId(user.id);

      const { data: updatedRows, error: updateError } = await supabase
        .from('tasks')
        .update({ status: 'DENIED', updated_at: nowIso } as any)
        .eq('id', task.id)
        .eq('user_id', user.id)
        .eq('status', 'AWAITING_USER')
        .select('id');

      if (updateError) {
        Alert.alert('Could not finalize denial', updateError.message);
        return;
      }
      if (!updatedRows || updatedRows.length === 0) {
        Alert.alert('Could not finalize denial', 'Task status changed before confirmation.');
        return;
      }

      const [ledgerRes, eventRes] = await Promise.all([
        supabase.from('ledger_entries').insert({
          user_id: user.id,
          task_id: task.id,
          period,
          amount_cents: task.failure_cost_cents,
          entry_type: 'failure',
        } as any),
        supabase.from('task_events').insert({
          task_id: task.id,
          event_type: 'ACCEPT_DENIAL',
          actor_id: user.id,
          actor_user_client_instance_id: actorUserClientInstanceId,
          from_status: 'AWAITING_USER',
          to_status: 'DENIED',
        } as any),
      ]);

      if (ledgerRes.error || eventRes.error) {
        const firstError = ledgerRes.error ?? eventRes.error;
        Alert.alert('Denial finalized', `Task is denied, but follow-up logging failed: ${firstError?.message ?? 'Unknown error'}`);
      }

      await Promise.resolve(detail.refetch());
      invalidateDerivedTaskViews();
    } finally {
      setIsAcceptingDenial(false);
    }
  }

  async function handleSubmitAiReview() {
    if (!task || !user?.id || isSubmittingAiReview) return;
    if (task.user_id !== user.id || task.status !== 'AWAITING_USER' || task.voucher_id !== AI_PROFILE_ID) {
      Alert.alert('Cannot submit', 'Task is no longer awaiting AI appeal submission.');
      return;
    }
    if (!hasUploadedProof) {
      Alert.alert('Missing proof', 'Upload proof before submitting to AI.');
      return;
    }

    setIsSubmittingAiReview(true);
    try {
      const nowIso = new Date().toISOString();
      const { data: updatedRows, error: statusUpdateError } = await supabase
        .from('tasks')
        .update({
          status: 'AWAITING_AI',
          updated_at: nowIso,
        } as any)
        .eq('id', task.id)
        .eq('user_id', user.id)
        .eq('status', 'AWAITING_USER')
        .eq('voucher_id', AI_PROFILE_ID)
        .select('id');

      if (statusUpdateError) {
        Alert.alert('Could not submit', statusUpdateError.message);
        return;
      }
      if (!updatedRows || updatedRows.length === 0) {
        Alert.alert('Could not submit', 'Task changed before submission.');
        return;
      }

      const queueResult = await queueAiEvalForTask(task.id);
      if (!queueResult.success) {
        Alert.alert('Submission failed', queueResult.error);
        return;
      }

      await Promise.resolve(detail.refetch());
      invalidateDerivedTaskViews();
      Toast.show({
        type: 'proofSuccess',
        text1: 'Submitted to AI',
        position: 'bottom',
        bottomOffset: 84,
        visibilityTime: 2200,
      });
    } finally {
      setIsSubmittingAiReview(false);
    }
  }

  // ── Override ───────────────────────────────────────────────────────────────
  async function handleOverride() {
    if (!task || isOverriding) return;

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId || userId !== task.user_id) {
      Alert.alert('Not authorised', 'You can only override your own tasks.');
      return;
    }

    const currentPeriod = new Date().toISOString().slice(0, 7);
    const failedPeriod  = new Date(task.updated_at).toISOString().slice(0, 7);
    if (failedPeriod !== currentPeriod) {
      Alert.alert('Override expired', 'Override can only be applied to tasks that failed this calendar month.');
      return;
    }

    const { count } = await supabase
      .from('overrides')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('period', currentPeriod);

    if ((count ?? 0) >= 1) {
      Alert.alert('Override used', 'You have already used your one override for this month.');
      return;
    }

    Alert.alert(
      'Use Override?',
      `This will settle "${task.title}" and reverse its €${(task.failure_cost_cents / 100).toFixed(2)} failure charge. You have one override per calendar month.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Override',
          style: 'destructive',
          onPress: async () => {
            setIsOverriding(true);
            try {
              const now = new Date().toISOString();
              const fromStatus = task.status;
              const actorUserClientInstanceId = await resolveUserClientInstanceId(userId);

              // 1. Insert supporting records first so the task can't be left
              //    in SETTLED while override/ledger data is missing.
              const [overrideRes, ledgerRes, eventRes] = await Promise.all([
                supabase.from('overrides').insert({
                  user_id: userId,
                  task_id: task.id,
                  period:  currentPeriod,
                }),
                supabase.from('ledger_entries').insert({
                  user_id:     userId,
                  task_id:     task.id,
                  period:      currentPeriod,
                  amount_cents: -(task.failure_cost_cents),
                  entry_type:  'override',
                }),
                supabase.from('task_events').insert({
                  task_id:     task.id,
                  event_type:  'OVERRIDE',
                  actor_id:    userId,
                  actor_user_client_instance_id: actorUserClientInstanceId,
                  from_status: fromStatus,
                  to_status:   'SETTLED',
                }),
              ]);

              if (overrideRes.error || ledgerRes.error || eventRes.error) {
                const firstError = overrideRes.error ?? ledgerRes.error ?? eventRes.error;
                Alert.alert('Override failed', firstError?.message ?? 'Could not record override.');
                return;
              }

              // 2. Only update task status after inserts succeed
              const { error: taskErr } = await supabase
                .from('tasks')
                .update({ status: 'SETTLED', updated_at: now })
                .eq('id', task.id)
                .eq('user_id', userId);

              if (taskErr) {
                // Best-effort rollback so we don't leave orphaned records
                await Promise.all([
                  supabase.from('overrides').delete().eq('task_id', task.id).eq('period', currentPeriod),
                  supabase.from('ledger_entries').delete().eq('task_id', task.id).eq('entry_type', 'override').eq('period', currentPeriod),
                  supabase.from('task_events').delete().eq('task_id', task.id).eq('event_type', 'OVERRIDE'),
                ]);
                Alert.alert('Override failed', taskErr.message);
                return;
              }

              if (hasUploadedProof) {
                const purgeResult = await purgeTaskProofForFinalState(task.id);
                if (!purgeResult.success) {
                  Alert.alert('Override applied, cleanup failed', purgeResult.error);
                }
              }

              queryClient.setQueryData(queryKeys.taskDetail(routeTaskId), (previous: any) => previous ? {
                ...previous,
                task: previous.task
                  ? {
                      ...previous.task,
                      status: 'SETTLED',
                      has_proof: false,
                      updated_at: now,
                    }
                  : previous.task,
                proof: null,
              } : previous);
              invalidateDerivedTaskViews();
            } finally {
              setIsOverriding(false);
            }
          },
        },
      ],
    );
  }

  // ── Undo complete ──────────────────────────────────────────────────────────
  async function handleUndoComplete() {
    if (!task || isUndoingComplete) return;
    setIsUndoingComplete(true);
    try {
      const previousTask = task;
      const nowIso = new Date().toISOString();

      queryClient.setQueryData(queryKeys.taskDetail(routeTaskId), (previous: any) => previous ? {
        ...previous,
        task: previous.task
          ? {
              ...previous.task,
              status: 'ACTIVE',
              marked_completed_at: null,
              voucher_response_deadline: null,
              voucher_id: previous.task.ai_escalated_from ? AI_PROFILE_ID : previous.task.voucher_id,
              ai_escalated_from: previous.task.ai_escalated_from ? false : previous.task.ai_escalated_from,
              updated_at: nowIso,
            }
          : previous.task,
      } : previous);

      const result = await undoCompleteTask(task.id, task.status);
      if (!result.success) {
        queryClient.setQueryData(queryKeys.taskDetail(routeTaskId), (previous: any) => previous ? {
          ...previous,
          task: previous.task
            ? {
                ...previous.task,
                ...previousTask,
              }
            : previous.task,
        } : previous);
        Toast.show({
          type: 'error',
          text1: 'Undo failed',
          text2: result.error ?? 'Please try again.',
          position: 'bottom',
          bottomOffset: 84,
          visibilityTime: 2500,
        });
        return;
      }

      invalidateDerivedTaskViews();
    } finally {
      setIsUndoingComplete(false);
    }
  }

  // ── Complete task ──────────────────────────────────────────────────────────
  async function handleMarkComplete() {
    if (!task || isCompleting) return;

    setIsCompleting(true);
    try {
      const result = await completeTask(task.id);
      if (!result.success) {
        Alert.alert('Could not complete task', result.error ?? 'Unknown error');
        return;
      }
      await Promise.resolve(detail.refetch());
      invalidateDerivedTaskViews();
    } finally {
      setIsCompleting(false);
    }
  }

  async function handleStopRepetitions() {
    if (!task || isStoppingRepetitions) return;

    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Stop repetitions',
        'This task will no longer repeat after this. Are you sure?',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Stop', style: 'destructive', onPress: () => resolve(true) },
        ],
      );
    });

    if (!confirmed) return;

    setIsStoppingRepetitions(true);
    try {
      const result = await stopTaskRepetitions(task.id);
      if (!result.success) {
        Alert.alert('Could not stop repetitions', result.error ?? 'Please try again.');
        return;
      }

      const nowIso = new Date().toISOString();
      queryClient.setQueryData(queryKeys.taskDetail(routeTaskId), (previous: any) => previous ? {
        ...previous,
        task: previous.task
          ? {
              ...previous.task,
              recurrence_rule_id: null,
              updated_at: nowIso,
            }
          : previous.task,
      } : previous);
      invalidateDerivedTaskViews();
    } finally {
      setIsStoppingRepetitions(false);
    }
  }

  function handlePostponePress() {
    if (!task) return;
    const currentDeadline = new Date(task.deadline);
    setPostponePickerDate(Number.isNaN(currentDeadline.getTime()) ? new Date() : currentDeadline);
    setPostponePickerOpen(true);
  }

  async function confirmPostpone() {
    if (!task) return;
    const minDate = task.created_at ? new Date(task.created_at) : new Date(0);
    if (postponePickerDate.getTime() <= minDate.getTime()) {
      Alert.alert('Invalid deadline', 'New deadline must be after the task was created.');
      return;
    }
    setPostponePickerOpen(false);
    setIsPostponing(true);
    try {
      const result = await postponeTaskDeadline(task.id, postponePickerDate.toISOString());
      if (!result.success) {
        Alert.alert('Could not move deadline', result.error ?? 'Unknown error');
        return;
      }
      if (result.userId) void syncLocalReminderNotificationsAsync(result.userId);
      invalidateDerivedTaskViews();
    } finally {
      setIsPostponing(false);
    }
  }

  async function handleDeletePress() {
    if (!task || isDeleting) return;
    if (!isTaskWithinDeleteWindow(task.created_at)) {
      Alert.alert('Delete unavailable', 'Tasks can only be deleted within 1 hour of creation.');
      return;
    }
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Delete task',
        'This task will be moved to deleted.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
        ],
      );
    });
    if (!confirmed) return;
    setIsDeleting(true);
    try {
      const result = await deleteTask(task.id);
      if (!result.success) {
        Alert.alert('Could not delete task', result.error ?? 'Unknown error');
        return;
      }
      invalidateDerivedTaskViews();
      router.back();
    } finally {
      setIsDeleting(false);
    }
  }

  function updateCustomReminderDatePart(dateValue: Date) {
    setCustomReminderDate((prev) => {
      const next = new Date(prev);
      next.setFullYear(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate());
      return next;
    });
  }

  function handleCustomReminderAndroidPickerChange(_event: DateTimePickerEvent, selected?: Date) {
    setShowCustomReminderAndroidPicker(false);
    if (_event.type === 'dismissed' || !selected) return;

    if (customReminderPickerMode === 'date') {
      updateCustomReminderDatePart(selected);
      setCustomReminderPickerMode('time');
      setTimeout(() => setShowCustomReminderAndroidPicker(true), 0);
      return;
    }

    const candidate = new Date(customReminderDate);
    candidate.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    setCustomReminderDate(candidate);
    setCustomReminderPickerMode('date');
    void handleAddCustomReminder(candidate);
  }

  async function handleAddCustomReminder(input?: Date): Promise<boolean> {
    if (!task || !isOwnTask || !isActiveOrPostponed || isMutatingReminder || !user?.id) return false;

    const candidate = new Date(input ?? customReminderDate);
    candidate.setSeconds(0, 0);

    if (Number.isNaN(candidate.getTime())) {
      Alert.alert('Invalid reminder', 'Please choose a valid reminder date and time.');
      return false;
    }
    if (candidate.getTime() <= Date.now()) {
      Alert.alert('Invalid reminder', 'Reminder must be in the future.');
      return false;
    }

    const deadlineMs = new Date(task.deadline).getTime();
    if (candidate.getTime() >= deadlineMs) {
      Alert.alert('Invalid reminder', 'Reminder must be earlier than the task deadline.');
      return false;
    }

    const duplicateExists = reminders.some((item) => (
      new Date(item.reminder_at).getTime() === candidate.getTime()
    ));
    if (duplicateExists) {
      Alert.alert('Duplicate reminder', 'A reminder already exists for this date and time.');
      return false;
    }

    setIsMutatingReminder(true);
    try {
      const nowIso = new Date().toISOString();
      const reminderIso = candidate.toISOString();
      const { data: insertedRows, error: reminderInsertError } = await supabase
        .from('task_reminders')
        .insert({
          parent_task_id: task.id,
          user_id: user.id,
          reminder_at: reminderIso,
          source: 'MANUAL',
          notified_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        } as any)
        .select('*');

      if (reminderInsertError) {
        Alert.alert('Could not add reminder', reminderInsertError.message);
        return false;
      }

      const insertedReminder = (insertedRows?.[0] ?? null) as TaskReminder | null;
      if (insertedReminder) {
        queryClient.setQueryData(queryKeys.taskDetail(routeTaskId), (previous: any) => previous ? {
          ...previous,
          reminders: [...(previous.reminders ?? []), insertedReminder].sort(
            (a: TaskReminder, b: TaskReminder) => new Date(a.reminder_at).getTime() - new Date(b.reminder_at).getTime(),
          ),
        } : previous);
      } else {
        void detail.refetch();
      }
      void syncLocalReminderNotificationsAsync(user.id);
      return true;
    } finally {
      setIsMutatingReminder(false);
    }
  }

  function openAddReminderFlow() {
    if (!task) return;

    const now = Date.now();
    const deadlineMs = new Date(task.deadline).getTime();
    const candidate = new Date(customReminderDate);
    candidate.setSeconds(0, 0);

    if (Number.isNaN(candidate.getTime()) || candidate.getTime() <= now) {
      candidate.setTime(now + DEFAULT_REMINDER_OFFSET_MS);
      candidate.setSeconds(0, 0);
    }

    const latestAllowedMs = deadlineMs - 60 * 1000;
    if (candidate.getTime() >= latestAllowedMs) {
      candidate.setTime(latestAllowedMs);
      candidate.setSeconds(0, 0);
    }

    if (Number.isNaN(candidate.getTime()) || candidate.getTime() <= now || candidate.getTime() >= deadlineMs) {
      Alert.alert('Invalid reminder', 'Set a later task deadline before adding reminders.');
      return;
    }

    setCustomReminderDate(candidate);

    if (Platform.OS === 'ios') {
      setShowCustomReminderIosModal(true);
      return;
    }

    setCustomReminderPickerMode('date');
    setShowCustomReminderAndroidPicker(true);
  }

  async function handleDeleteReminder(reminder: TaskReminder) {
    if (!task || !isOwnTask || !isActiveOrPostponed || isMutatingReminder || !user?.id) return;

    setIsMutatingReminder(true);
    try {
      const { error: deleteError } = await supabase
        .from('task_reminders')
        .delete()
        .eq('id', reminder.id)
        .eq('parent_task_id', task.id)
        .eq('user_id', user.id);

      if (deleteError) {
        Alert.alert('Could not remove reminder', deleteError.message);
        return;
      }

      queryClient.setQueryData(queryKeys.taskDetail(routeTaskId), (previous: any) => previous ? {
        ...previous,
        reminders: (previous.reminders ?? []).filter((item: TaskReminder) => item.id !== reminder.id),
      } : previous);
      void syncLocalReminderNotificationsAsync(user.id);
    } finally {
      setIsMutatingReminder(false);
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (optimisticTask) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>Task is still being created.</Text>
          <TouchableOpacity onPress={handleBack} style={styles.retryBtn}>
            <Text style={styles.retryText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (detail.loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centered}><ActivityIndicator color={colors.textMuted} /></View>
      </SafeAreaView>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (detail.error || !task) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{detail.error ?? 'Task not found.'}</Text>
          <TouchableOpacity onPress={handleBack} style={styles.retryBtn}>
            <Text style={styles.retryText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Allowed flags ──────────────────────────────────────────────────────────
  const s = task.status;
  const isActiveOrPostponed = s === 'ACTIVE' || s === 'POSTPONED';
  const isMissedOrDenied = s === 'MISSED' || s === 'DENIED';
  const isOwnTask = task.user_id === user?.id;
  const isAiVouched = task.voucher_id === AI_PROFILE_ID;
  const isAwaitingUserAi = isOwnTask && isAiVouched && s === 'AWAITING_USER';
  const aiResubmitCount = Number(task.resubmit_count ?? 0);
  const canResubmitAi = isAwaitingUserAi && aiResubmitCount < MAX_AI_RESUBMITS && !proofUploading;
  const canSubmitAiReview = isAwaitingUserAi && hasUploadedProof && !isSubmittingAiReview;
  const canEscalateAiToFriend = isAwaitingUserAi && hasUploadedProof && !isEscalating;
  const latestAiDenialReason = (() => {
    const aiDenials = events.filter((event) => event.event_type === 'AI_DENIED');
    for (let i = aiDenials.length - 1; i >= 0; i -= 1) {
      const reason = getEventReason(aiDenials[i]);
      if (reason) return reason;
    }
    return null;
  })();

  const canPomo          = isOwnTask && isActiveOrPostponed;
  const canComplete      = isOwnTask && isActiveOrPostponed && !isCompleting;
  const canProof         = isOwnTask && (isActiveOrPostponed || s === 'AWAITING_VOUCHER' || s === 'AWAITING_AI' || s === 'MARKED_COMPLETE');
  const canStopRepeating = isOwnTask && isActiveOrPostponed && !!task.recurrence_rule_id;
  const canOverride      = isOwnTask && isMissedOrDenied && !isOverriding;
  const canUndoComplete  = isOwnTask && (s === 'MARKED_COMPLETE' || s === 'AWAITING_VOUCHER' || s === 'AWAITING_AI') && !isUndoingComplete;
  const canPostpone      = isOwnTask && s === 'ACTIVE' && !task.postponed_at && !isPostponing;
  const canDelete        = isOwnTask && (s === 'ACTIVE' || s === 'POSTPONED') && isTaskWithinDeleteWindow(task.created_at) && !isDeleting;

  const isSelfVouch = task.voucher_id === task.user_id;
  const isCurrentTaskPomo = activePomoSession?.task_id === task.id;
  const currentTaskPomoStatus = isCurrentTaskPomo ? activePomoSession?.status : null;
  const recurrenceSummary = buildRecurrenceSummary(task, recurrenceRule);

  const handlePomoPress = () => {
    if (isCurrentTaskPomo) {
      setMinimized(false);
      return;
    }
    void startSession(task.id, pomoDuration);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.textMuted}
            colors={[colors.textMuted]}
          />
        }
      >

        {/* Title */}
        {task.recurrence_rule_id && task.iteration_number != null ? (
          <Text style={styles.title}>
            <Text style={styles.iterationInline}>#{task.iteration_number} </Text>
            {task.title}
          </Text>
        ) : (
          <Text style={styles.title}>{task.title}</Text>
        )}
        {recurrenceSummary ? (
          <View style={styles.recurrenceSummaryRow}>
            <Feather name="repeat" size={16} color="#C084FC" style={styles.recurrenceSummaryIconInline} />
            <Text style={styles.recurrenceSummaryText}>{recurrenceSummary}</Text>
          </View>
        ) : null}

        {/* Info block */}
        <View style={styles.infoBlock}>
          <View style={styles.infoRow}>
            <Feather name="activity" size={15} color={colors.textMuted} style={{ flexShrink: 0 }} />
            <Text style={styles.infoLabel}>Status</Text>
            <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }}>
              <StatusPill status={task.status} size="small" />
            </View>
          </View>
          <Divider />
          <InfoRow icon="clock"         label="Deadline"     value={formatFullDeadline(task.deadline)} />
          <Divider />
          <InfoRow icon="stopwatch-outline" iconSet="ionicons" label="Focused" value={formatFocusedTime(totalFocusedSeconds)} />
          <Divider />
          <InfoRow icon="alert-circle"  label="Failure cost" value={formatCost(task.failure_cost_cents, currency)} />
          <Divider />
          <InfoRow icon="user"          label="Voucher"      value={isSelfVouch ? 'Self vouch' : (voucherUsername ? voucherUsername : '—')} />
          {task.postponed_at && (<><Divider /><InfoRow icon="skip-forward" label="Postponed at"  value={formatFullDeadline(task.postponed_at)} /></>)}
        </View>

        {/* Flags */}
        {(task.requires_proof || task.required_pomo_minutes || task.is_strict) && (
          <View style={styles.flagsRow}>
            {task.requires_proof && <FlagPill icon="camera" label={hasUploadedProof ? 'Proof uploaded' : 'Proof required'} active={hasUploadedProof} />}
            {task.required_pomo_minutes != null && <FlagPill icon="clock" label={`${task.required_pomo_minutes} pomo min`} active={false} />}
            {task.is_strict && <FlagPill icon="lock" label="Strict window" active={false} />}
          </View>
        )}

        {proof ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Uploaded Proof</Text>
            {proof.mediaKind === 'image' ? (
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => setProofLightboxOpen(true)}
                accessibilityLabel="Expand proof image"
              >
                <View style={[styles.proofPreviewWrap, { width: proofPreviewWidth }]}>
                  <Image
                    source={{ uri: proof.signedUrl }}
                    style={styles.proofPreviewImage}
                    resizeMode="cover"
                  />
                  {proof.overlayTimestampText ? (
                    <View style={styles.proofTimestampWrap}>
                      <Text style={styles.proofTimestampText}>{proof.overlayTimestampText}</Text>
                    </View>
                  ) : null}
                  <View style={styles.proofExpandHint}>
                    <Feather name="maximize-2" size={14} color="rgba(255,255,255,0.7)" />
                  </View>
                </View>
              </TouchableOpacity>
            ) : (
              <VideoProofPreview
                signedUrl={proof.signedUrl}
                overlayTimestampText={proof.overlayTimestampText}
                width={proofPreviewWidth}
              />
            )}
          </View>
        ) : null}

        {/* Proof image lightbox */}
        {proof?.mediaKind === 'image' ? (
          <Modal
            visible={proofLightboxOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setProofLightboxOpen(false)}
            statusBarTranslucent
          >
            <Pressable
              style={styles.lightboxBackdrop}
              onPress={() => setProofLightboxOpen(false)}
            >
              <Image
                source={{ uri: proof.signedUrl }}
                style={styles.lightboxImage}
                resizeMode="contain"
              />
              {proof.overlayTimestampText ? (
                <View style={styles.lightboxTimestampWrap}>
                  <Text style={styles.proofTimestampText}>{proof.overlayTimestampText}</Text>
                </View>
              ) : null}
              <TouchableOpacity
                style={styles.lightboxClose}
                onPress={() => setProofLightboxOpen(false)}
                hitSlop={12}
                accessibilityLabel="Close"
              >
                <Feather name="x" size={22} color="#fff" />
              </TouchableOpacity>
            </Pressable>
          </Modal>
        ) : null}
        <ProofCaptureModal
          visible={proofCaptureOpen}
          onClose={() => setProofCaptureOpen(false)}
          onAssetPicked={uploadSelectedProof}
        />

        {/* ── Actions ───────────────────────────────────────────────────────── */}
        <View style={styles.actionsBlock}>
          {isAwaitingUserAi && (
            <View style={styles.awaitingUserCard}>
              <Text style={styles.awaitingUserTitle}>AI denied</Text>
              <Text style={styles.awaitingUserSubtitle}>
                Attempt {Math.max(1, aiResubmitCount)} of {MAX_AI_RESUBMITS}
              </Text>
              {latestAiDenialReason ? <Text style={styles.awaitingUserReason}>{latestAiDenialReason}</Text> : null}
              <View style={styles.awaitingUserActions}>
                <ActionBtn
                  allowed={canResubmitAi}
                  token={BTN.proof}
                  label={proofUploading ? 'Uploading…' : 'Upload New Proof'}
                  icon="camera"
                  onPress={() => setProofCaptureOpen(true)}
                  onDeny={() => {
                    if (aiResubmitCount >= MAX_AI_RESUBMITS) {
                      Alert.alert('Resubmit limit reached', 'You have used all AI resubmits for this task.');
                    }
                  }}
                  containerStyle={{ flex: 1 }}
                />
                <ActionBtn
                  allowed={canEscalateAiToFriend}
                  token={BTN.reminders}
                  label={isEscalating ? 'Escalating…' : 'Escalate to Friend'}
                  icon="users"
                  onPress={() => { void loadEscalationFriends(); }}
                  onDeny={() => {
                    if (!hasUploadedProof) {
                      Alert.alert('Missing proof', 'Upload proof first, then you can escalate to a friend.');
                    }
                  }}
                  containerStyle={{ flex: 1 }}
                />
              </View>
              <View style={styles.awaitingUserActions}>
                <ActionBtn
                  allowed={canSubmitAiReview}
                  token={BTN.complete}
                  label={isSubmittingAiReview ? 'Submitting…' : 'Submit'}
                  icon="check"
                  onPress={() => { void handleSubmitAiReview(); }}
                  onDeny={() => {
                    if (!hasUploadedProof) {
                      Alert.alert('Missing proof', 'Upload proof first, then submit.');
                    }
                  }}
                  containerStyle={{ flex: 1 }}
                />
                <ActionBtn
                  allowed={!isAcceptingDenial}
                  token={BTN.delete}
                  label={isAcceptingDenial ? 'Finalizing…' : 'Accept Denial'}
                  icon="x-circle"
                  onPress={() => { void handleAcceptDenial(); }}
                  onDeny={() => {}}
                  containerStyle={{ flex: 1 }}
                />
              </View>
            </View>
          )}

          {/* Pomodoro + Proof row — only rendered when at least one is available */}
          {(canPomo || canProof) && (
            <View style={styles.pomoCameraRow}>
              {canPomo && (
                <View style={{ flex: 1 }}>
                  {isCurrentTaskPomo ? (
                    <TouchableOpacity
                      style={[styles.pomoRunningBtn, { flex: 1 }, pomoLoading && styles.pomoDisabled]}
                      onPress={handlePomoPress}
                      activeOpacity={0.8}
                      accessibilityLabel="Open pomodoro timer"
                      disabled={pomoLoading}
                    >
                      <Ionicons name="stopwatch-outline" size={18} color={BTN.pomo.text} />
                      <Text style={styles.pomoRunningLabel}>{currentTaskPomoStatus === 'PAUSED' ? 'Paused' : 'Running'}</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.pomoBtn, pomoLoading && styles.pomoDisabled, { flex: 1 }]}
                      onPress={handlePomoPress}
                      activeOpacity={0.75}
                      accessibilityLabel="Start pomodoro"
                      disabled={pomoLoading}
                    >
                      <Ionicons name="stopwatch-outline" size={22} color={BTN.pomo.text} />
                      <View style={[styles.pomoDivider, { backgroundColor: BTN.pomo.text + '44' }]} />
                      {isEditingPomo ? (
                        <TextInput
                          style={[styles.pomoDuration, { color: BTN.pomo.text, minWidth: 28, textAlign: 'center', padding: 0 }]}
                          value={pomoDraft}
                          onChangeText={setPomoDraft}
                          onBlur={() => {
                            const n = parseInt(pomoDraft, 10);
                            if (!isNaN(n) && n >= 1 && n <= 120) {
                              setPomoDuration(n);
                              setPomoDraft(String(n));
                            } else {
                              setPomoDraft(String(pomoDuration));
                            }
                            setIsEditingPomo(false);
                          }}
                          keyboardType="number-pad"
                          maxLength={3}
                          selectTextOnFocus
                          autoFocus
                        />
                      ) : (
                        <TouchableOpacity
                          onPress={() => setIsEditingPomo(true)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.pomoDuration, { color: BTN.pomo.text }]}>{pomoDuration}</Text>
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {canProof && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: BTN.proof.bg, borderColor: BTN.proof.border, flex: 1 }]}
                  onPress={openProofPicker}
                  activeOpacity={0.75}
                  accessibilityLabel={proof ? 'Manage proof' : 'Attach proof'}
                  disabled={proofUploading || proofRemoving}
                >
                  {proofUploading ? (
                    <>
                      <ActivityIndicator size="small" color={BTN.proof.text} />
                      <Text style={[styles.actionBtnLabel, { color: BTN.proof.text, marginLeft: spacing.xs }]}>Uploading</Text>
                    </>
                  ) : proofRemoving ? (
                    <>
                      <ActivityIndicator size="small" color={BTN.proof.text} />
                      <Text style={[styles.actionBtnLabel, { color: BTN.proof.text, marginLeft: spacing.xs }]}>Removing</Text>
                    </>
                  ) : proof ? (
                    <>
                      <Feather name="refresh-cw" size={18} color={BTN.proof.text} style={styles.actionBtnIcon} />
                      <Text style={[styles.actionBtnLabel, { color: BTN.proof.text }]}>Replace</Text>
                    </>
                  ) : (
                    <Feather name="camera" size={20} color={BTN.proof.text} />
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Stop repetitions + Override row — only rendered when at least one is available */}
          {(canStopRepeating || canOverride) && (
            <View style={styles.pomoCameraRow}>
              {canStopRepeating && (
                <ActionBtn
                  allowed
                  token={BTN.stopRepeating}
                  label={isStoppingRepetitions ? 'Stopping…' : 'Stop repetitions'}
                  icon="repeat"
                  onPress={() => { void handleStopRepetitions(); }}
                  onDeny={() => {}}
                  containerStyle={{ flex: 1 }}
                />
              )}
              {canOverride && (
                <ActionBtn
                  allowed
                  token={BTN.override}
                  label={isOverriding ? 'Overriding…' : 'Override'}
                  icon="zap"
                  onPress={() => { void handleOverride(); }}
                  onDeny={() => {}}
                  containerStyle={{ flex: 1 }}
                />
              )}
            </View>
          )}

          {/* Undo complete — only rendered when available */}
          {canUndoComplete && (
            <ActionBtn
              allowed
              token={BTN.undoComplete}
              label={isUndoingComplete ? 'Undoing…' : 'Undo completion'}
              icon="rotate-ccw"
              onPress={() => { void handleUndoComplete(); }}
              onDeny={() => {}}
              containerStyle={{}}
            />
          )}

          {/* Postpone + Complete row */}
          {(canPostpone || canComplete) && (
            <View style={styles.pomoCameraRow}>
              {canPostpone && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.equalWidthActionBtn, { backgroundColor: BTN.postpone.bg, borderColor: BTN.postpone.border }]}
                  onPress={handlePostponePress}
                  activeOpacity={0.75}
                  accessibilityLabel="Postpone"
                  disabled={isPostponing}
                >
                  {isPostponing ? (
                    <ActivityIndicator size="small" color={BTN.postpone.text} />
                  ) : (
                    <Feather name="alert-triangle" size={20} color={BTN.postpone.text} />
                  )}
                </TouchableOpacity>
              )}
              {canComplete && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.equalWidthActionBtn, { backgroundColor: BTN.complete.bg, borderColor: BTN.complete.border }]}
                  onPress={() => { void handleMarkComplete(); }}
                  activeOpacity={0.75}
                  accessibilityLabel={isCompleting ? 'Completing task' : 'Mark complete'}
                  disabled={isCompleting}
                >
                  {isCompleting ? (
                    <ActivityIndicator size="small" color={BTN.complete.text} />
                  ) : (
                    <Feather name="check" size={20} color={BTN.complete.text} />
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Delete row */}
          {canDelete && (
            <ActionBtn
              allowed
              token={BTN.delete}
              label={isDeleting ? 'Deleting…' : 'Delete'}
              icon="trash-2"
              onPress={() => { void handleDeletePress(); }}
              onDeny={() => {}}
              containerStyle={{}}
            />
          )}

          {/* Reminders + Subtasks paired toggles — only relevant for own active/postponed tasks */}
          {isOwnTask && isActiveOrPostponed && (
            <>
              <View style={styles.togglePairRow}>
                <TouchableOpacity
                  style={[
                    styles.toggleBtn,
                    styles.toggleHalfBtn,
                    { backgroundColor: BTN.reminders.bg, borderColor: BTN.reminders.border },
                  ]}
                  onPress={() => setExpandedPanel((current) => (current === 'reminders' ? null : 'reminders'))}
                  activeOpacity={0.75}
                  accessibilityLabel={`Reminders, ${reminders.length} set`}
                >
                  <Text style={[styles.toggleLabel, { color: BTN.reminders.text }]}>Reminders</Text>
                  <Text style={[styles.toggleCount, { color: BTN.reminders.text }]}>{reminders.length}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.toggleBtn,
                    styles.toggleHalfBtn,
                    { backgroundColor: colors.surface2, borderColor: colors.borderStrong },
                  ]}
                  onPress={handleSubtasksTogglePress}
                  activeOpacity={0.75}
                  accessibilityLabel={`Subtasks, ${subtasks.length} items`}
                >
                  <Text style={styles.toggleLabel}>Subtasks</Text>
                  <Text style={styles.toggleCount}>{subtasks.length}</Text>
                </TouchableOpacity>
              </View>

              {expandedPanel === 'reminders' && (
                <View style={styles.toggleBody}>
                  <View style={styles.reminderToolbar}>
                    {showCustomReminderAndroidPicker && (
                      <DateTimePicker
                        value={customReminderDate}
                        mode={customReminderPickerMode}
                        display="default"
                        minimumDate={customReminderPickerMode === 'date' ? new Date() : undefined}
                        onChange={handleCustomReminderAndroidPickerChange}
                      />
                    )}
                    <TouchableOpacity
                      style={styles.addReminderInlineBtn}
                      activeOpacity={0.85}
                      onPress={openAddReminderFlow}
                      disabled={isMutatingReminder}
                      accessibilityRole="button"
                      accessibilityLabel="Add reminders"
                    >
                      <Text style={styles.addReminderInlineText}>Add reminders</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.reminderActionSlot, isMutatingReminder && styles.addReminderInlineBtnDisabled]}
                      activeOpacity={0.85}
                      onPress={openAddReminderFlow}
                      disabled={isMutatingReminder}
                      accessibilityRole="button"
                      accessibilityLabel="Add reminder"
                      hitSlop={8}
                    >
                      <Feather name="plus" size={16} color={BTN.reminders.text} />
                    </TouchableOpacity>
                  </View>
                  {reminders.length === 0
                    ? <Text style={styles.toggleEmpty}>No reminders set.</Text>
                    : reminders.map((r) => (
                        <View key={r.id} style={styles.reminderRow}>
                          <Feather name="bell" size={13} color={BTN.reminders.text} style={{ flexShrink: 0 }} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.reminderTime}>{formatFullDeadline(r.reminder_at)}</Text>
                          </View>
                          <View style={styles.reminderRowActions}>
                            <View style={[styles.reminderStatusPill, r.notified_at ? styles.reminderStatusSent : styles.reminderStatusScheduled]}>
                              <Text style={[styles.reminderStatusText, { color: r.notified_at ? '#FBBF24' : '#60A5FA' }]}>
                                {r.notified_at ? 'Sent' : 'Scheduled'}
                              </Text>
                            </View>
                            <TouchableOpacity
                              style={styles.reminderActionSlot}
                              onPress={() => { void handleDeleteReminder(r); }}
                              activeOpacity={0.75}
                              accessibilityRole="button"
                              accessibilityLabel="Remove reminder"
                              hitSlop={8}
                              disabled={isMutatingReminder}
                            >
                              <Feather name="trash-2" size={15} color={colors.destructive} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      ))
                  }
                </View>
              )}

              {expandedPanel === 'subtasks' && (
                <View style={styles.toggleBody}>
                  <View style={styles.subtasksPanel}>
                    {subtasks.length > 0 && (
                      subtasks.map((subtask) => (
                        <View key={subtask.id} style={styles.subtaskItemRow}>
                          <TouchableOpacity
                            onPress={() => { void handleToggleSubtask(subtask); }}
                            style={[styles.subtaskCircle, subtask.is_completed && styles.subtaskCircleCompleted]}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            activeOpacity={0.7}
                          >
                            {subtask.is_completed && <Feather name="check" size={11} color={colors.success} />}
                          </TouchableOpacity>
                          <Text style={[styles.subtaskItemTitle, subtask.is_completed && styles.subtaskItemTitleCompleted]}>
                            {subtask.title}
                          </Text>
                          <TouchableOpacity
                            onPress={() => { void handleDeleteSubtask(subtask.id); }}
                            activeOpacity={0.7}
                            accessibilityLabel="Delete subtask"
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={styles.subtaskDeleteCircle}
                          >
                            <Feather name="trash-2" size={14} color={colors.destructive} />
                          </TouchableOpacity>
                        </View>
                      ))
                    )}
                    {subtasks.length < MAX_SUBTASKS && (
                      <View style={styles.subtaskAddRow}>
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
                        />
                        {newSubtaskDraft.trim().length > 0 && (
                          <TouchableOpacity
                            onPress={() => { void handleAddSubtask(); }}
                            activeOpacity={0.7}
                            accessibilityLabel="Confirm subtask"
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                            style={styles.subtaskConfirmCircle}
                          />
                        )}
                      </View>
                    )}
                  </View>
                </View>
              )}
            </>
          )}

          {Platform.OS === 'ios' && (
            <Modal
              visible={showCustomReminderIosModal}
              transparent
              animationType="fade"
              onRequestClose={() => setShowCustomReminderIosModal(false)}
            >
              <Pressable
                style={styles.reminderPickerBackdrop}
                onPress={() => setShowCustomReminderIosModal(false)}
              />
              <View style={styles.reminderPickerSheet}>
                <Text style={styles.reminderPickerTitle}>Choose reminder</Text>
                <DateTimePicker
                  value={customReminderDate}
                  mode="datetime"
                  display="spinner"
                  minimumDate={new Date()}
                  maximumDate={new Date(new Date(task.deadline).getTime() - 60 * 1000)}
                  onChange={(_event, selected) => {
                    if (selected) {
                      setCustomReminderDate(selected);
                    }
                  }}
                  themeVariant="dark"
                  accentColor={colors.warning}
                />
                <View style={styles.reminderPickerActions}>
                  <TouchableOpacity
                    style={styles.reminderPickerCancel}
                    activeOpacity={0.8}
                    onPress={() => setShowCustomReminderIosModal(false)}
                  >
                    <Text style={styles.reminderPickerCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.reminderPickerConfirm, isMutatingReminder && styles.reminderPickerConfirmDisabled]}
                    activeOpacity={0.85}
                    onPress={() => {
                      void (async () => {
                        const didAdd = await handleAddCustomReminder(customReminderDate);
                        if (didAdd) {
                          setShowCustomReminderIosModal(false);
                        }
                      })();
                    }}
                    disabled={isMutatingReminder}
                  >
                    <Text style={styles.reminderPickerConfirmText}>Add reminder</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Modal>
          )}

        </View>

        {/* Description */}
        {task.description ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.description}>{task.description}</Text>
          </View>
        ) : null}

        {/* Event timeline */}
        <TaskTimeline task={task} events={events} aiVouches={detail.data?.aiVouches ?? []} />

      </ScrollView>

      {Platform.OS === 'ios' ? (
        <LegacyPostponeCalendarPicker
          task={postponePickerOpen && task ? { id: task.id, title: task.title, deadline: task.deadline, created_at: task.created_at ?? undefined, postponed_at: task.postponed_at } : null}
          date={postponePickerDate}
          setTask={(t) => { if (!t) setPostponePickerOpen(false); }}
          onDateChange={(_e, selected) => { if (selected) setPostponePickerDate(selected); }}
          onAndroidDateChange={(_e, selected) => {
            if (!selected) return;
            const next = new Date(selected);
            next.setHours(postponePickerDate.getHours(), postponePickerDate.getMinutes(), 0, 0);
            setPostponePickerDate(next);
          }}
          onAndroidTimeChange={(_e, selected) => {
            if (!selected) return;
            const next = new Date(postponePickerDate);
            next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
            setPostponePickerDate(next);
          }}
          onConfirm={confirmPostpone}
        />
      ) : (
        <PostponeDeadlineModal
          task={postponePickerOpen && task ? { id: task.id, title: task.title, deadline: task.deadline, created_at: task.created_at ?? undefined, postponed_at: task.postponed_at } : null}
          date={postponePickerDate}
          setTask={(t) => { if (!t) setPostponePickerOpen(false); }}
          onDateChange={(_e, selected) => { if (selected) setPostponePickerDate(selected); }}
          onAndroidDateChange={(_e, selected) => {
            if (!selected) return;
            const next = new Date(selected);
            next.setHours(postponePickerDate.getHours(), postponePickerDate.getMinutes(), 0, 0);
            setPostponePickerDate(next);
          }}
          onAndroidTimeChange={(_e, selected) => {
            if (!selected) return;
            const next = new Date(postponePickerDate);
            next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
            setPostponePickerDate(next);
          }}
          onConfirm={confirmPostpone}
        />
      )}

      <Modal
        visible={escalationPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setEscalationPickerOpen(false)}
      >
        <Pressable style={styles.escalationBackdrop} onPress={() => setEscalationPickerOpen(false)}>
          <Pressable style={styles.escalationSheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.escalationTitle}>Escalate to Friend</Text>
            {escalationFriendsLoading ? (
              <ActivityIndicator color={colors.textMuted} />
            ) : escalationFriends.length === 0 ? (
              <Text style={styles.escalationEmpty}>No friends available.</Text>
            ) : (
              <ScrollView style={styles.escalationList} showsVerticalScrollIndicator={false}>
                {escalationFriends.map((friend) => (
                  <TouchableOpacity
                    key={friend.id}
                    style={styles.escalationRow}
                    onPress={() => { void handleEscalateToFriend(friend.id); }}
                    activeOpacity={0.8}
                    disabled={isEscalating}
                  >
                    <Text style={styles.escalationName}>{friend.username}</Text>
                    {friend.email ? <Text style={styles.escalationEmail}>{friend.email}</Text> : null}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <TouchableOpacity style={styles.escalationCancel} onPress={() => setEscalationPickerOpen(false)} activeOpacity={0.8}>
              <Text style={styles.escalationCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

    </SafeAreaView>
  );
}

// ─── ShakeBtn ─────────────────────────────────────────────────────────────────

function ShakeBtn({
  allowed,
  onPress,
  onDeny,
  style,
  containerStyle,
  accessibilityLabel,
  children,
}: {
  allowed: boolean;
  onPress: () => void;
  onDeny: () => void;
  style?: object | object[];
  containerStyle?: object | object[];
  accessibilityLabel?: string;
  children?: React.ReactNode;
}) {
  const shakeX = useRef(new Animated.Value(0)).current;

  function handlePress() {
    if (!allowed) {
      Animated.sequence([
        Animated.timing(shakeX, { toValue: 9,  duration: 45, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: -9, duration: 45, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: 6,  duration: 45, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: -6, duration: 45, useNativeDriver: true }),
        Animated.timing(shakeX, { toValue: 0,  duration: 45, useNativeDriver: true }),
      ]).start();
      onDeny();
    } else {
      onPress();
    }
  }

  return (
    <Animated.View style={[containerStyle, { transform: [{ translateX: shakeX }], opacity: allowed ? 1 : 0.4 }]}>
      <TouchableOpacity style={[{ flex: 1 }, style]} onPress={handlePress} activeOpacity={0.75} accessibilityLabel={accessibilityLabel}>
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── ActionBtn ────────────────────────────────────────────────────────────────

interface BtnToken { bg: string; border: string; text: string }

function ActionBtn({ allowed, token, label, icon, onPress, onDeny, containerStyle }: {
  allowed: boolean;
  token: BtnToken;
  label: string;
  icon?: string;
  onPress: () => void;
  onDeny: () => void;
  containerStyle?: object | object[];
}) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  return (
    <ShakeBtn
      allowed={allowed}
      onPress={onPress}
      onDeny={onDeny}
      style={[styles.actionBtn, { backgroundColor: token.bg, borderColor: token.border }]}
      containerStyle={containerStyle}
      accessibilityLabel={label}
    >
      {icon && <Feather name={icon as any} size={16} color={token.text} style={styles.actionBtnIcon} />}
      <Text style={[styles.actionBtnLabel, { color: token.text }]}>{label}</Text>
    </ShakeBtn>
  );
}

// ─── Minor sub-components ─────────────────────────────────────────────────────

function InfoRow({
  icon,
  label,
  value,
  iconSet = 'feather',
}: {
  icon: string;
  label: string;
  value: string;
  iconSet?: 'feather' | 'ionicons';
}) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  return (
    <View style={styles.infoRow}>
      {iconSet === 'ionicons' ? (
        <Ionicons name={icon as any} size={16} color={colors.textMuted} style={{ flexShrink: 0 }} />
      ) : (
        <Feather name={icon as any} size={15} color={colors.textMuted} style={{ flexShrink: 0 }} />
      )}
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function Divider() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  return <View style={styles.infoDivider} />;
}

function FlagPill({ icon, label, active }: { icon: string; label: string; active: boolean }) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  return (
    <View style={[styles.flagPill, active && styles.flagPillActive]}>
      <Feather name={icon as any} size={12} color={active ? colors.success : colors.textMuted} />
      <Text style={[styles.flagPillText, active && styles.flagPillTextActive]}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (colors: Colors, isDark = true) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  errorText: { fontSize: typography.sm, color: colors.textMuted, textAlign: 'center' },
  retryBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface2 },
  retryText: { fontSize: typography.sm, color: colors.text },
  title: { fontSize: typography.xl, fontWeight: typography.bold, color: colors.text, lineHeight: 32, letterSpacing: -0.5, textAlign: 'center' },
  iterationInline: { color: '#C084FC' },
  recurrenceSummaryRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: spacing.xs },
  recurrenceSummaryIconInline: { marginRight: spacing.xs, transform: [{ translateY: 1 }] },
  recurrenceSummaryText: { fontSize: typography.sm, color: '#C084FC', fontWeight: typography.semibold, letterSpacing: 0.2, lineHeight: 19, flex: 1 },
  infoBlock: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 13, gap: spacing.sm },
  infoLabel: { fontSize: typography.sm, color: colors.textMuted, width: 110, flexShrink: 0 },
  infoValue: { flex: 1, fontSize: typography.sm, color: colors.text, textAlign: 'right' },
  infoDivider: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.md },
  flagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flagPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.sm, paddingVertical: 5, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  flagPillActive: { borderColor: colors.success + '55', backgroundColor: colors.successMuted },
  flagPillText: { fontSize: typography.xs, color: colors.textMuted },
  flagPillTextActive: { color: colors.success },

  // Actions
  actionsBlock: { gap: spacing.sm },


  pomoCameraRow: { flexDirection: 'row', gap: spacing.sm, width: '100%' },
  pomoBtn: { height: 56, flexDirection: 'row', alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: spacing.lg, backgroundColor: BTN.pomo.bg, borderColor: BTN.pomo.border, gap: spacing.md },
  pomoRunningBtn: {
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: BTN.pomo.border,
    backgroundColor: BTN.pomo.bg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pomoRunningLabel: {
    fontSize: typography.xs,
    fontWeight: typography.medium,
    color: BTN.pomo.text,
  },
  pomoDisabled: {
    opacity: 0.55,
  },
  pomoDivider: { width: 1, height: 24 },
  pomoDuration: { fontSize: typography.xl, fontWeight: typography.bold, lineHeight: 28 },
  pomoLabel: { fontSize: typography.sm },

  actionBtn: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: spacing.lg },
  equalWidthActionBtn: { flex: 1, minWidth: 0, paddingHorizontal: 0 },
  actionBtnIcon: { marginRight: spacing.sm },
  actionBtnLabel: { fontSize: typography.sm, fontWeight: typography.semibold },
  awaitingUserCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: isDark ? '#fb923c44' : '#ea580c44',
    backgroundColor: isDark ? '#7c2d1218' : '#fff7ed',
    padding: spacing.md,
    gap: spacing.sm,
  },
  awaitingUserTitle: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    color: isDark ? '#fdba74' : '#c2410c',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  awaitingUserSubtitle: {
    fontSize: typography.sm,
    color: isDark ? '#fdba74' : '#c2410c',
  },
  awaitingUserReason: {
    fontSize: typography.sm,
    color: isDark ? '#ffedd5' : '#431407',
    lineHeight: 20,
  },
  awaitingUserActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },

  toggleBtn: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: spacing.lg },
  togglePairRow: { flexDirection: 'row', gap: spacing.sm, width: '100%' },
  toggleHalfBtn: { flex: 1, minWidth: 0 },
  toggleBtnDisabled: { opacity: 0.5 },
  toggleLabel: { fontSize: typography.sm, fontWeight: typography.semibold, color: colors.text },
  toggleCount: { fontSize: typography.sm, fontWeight: typography.semibold, color: colors.text },
  toggleBody: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden', marginTop: -spacing.xs },
  toggleEmpty: { fontSize: typography.sm, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md },
  reminderToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  addReminderInlineBtn: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    flex: 1,
    paddingHorizontal: 0,
  },
  addReminderInlineBtnDisabled: { opacity: 0.6 },
  addReminderInlineText: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    color: BTN.reminders.text,
  },

  subtasksBlock: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden', paddingHorizontal: spacing.md },
  subtasksPanel: { paddingHorizontal: spacing.md },
  subtaskItemRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 11, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  subtaskCircle: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  subtaskCircleCompleted: { borderColor: colors.success, backgroundColor: colors.successMuted },
  subtaskItemTitle: { flex: 1, fontSize: typography.sm, color: colors.text, lineHeight: 20 },
  subtaskItemTitleCompleted: { textDecorationLine: 'line-through', color: colors.textMuted },
  subtaskDeleteCircle: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  subtaskConfirmCircle: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.success, borderWidth: 1, borderColor: '#00000024', flexShrink: 0 },
  subtaskAddRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.sm },
  subtaskInput: { flex: 1, fontSize: typography.sm, color: colors.text, paddingVertical: 0 },
  subtaskRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 12, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  subtaskCircleDone: { backgroundColor: colors.success, borderColor: colors.success },
  subtaskTitle: { flex: 1, fontSize: typography.sm, color: colors.text },
  subtaskTitleDone: { color: colors.textMuted, textDecorationLine: 'line-through' },

  reminderRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 11, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  reminderTime: { fontSize: typography.sm, color: colors.text },
  reminderRowActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  reminderActionSlot: { width: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  reminderStatusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, flexShrink: 0 },
  reminderStatusSent: { backgroundColor: '#FBBF2420' },
  reminderStatusScheduled: { backgroundColor: '#60A5FA20' },
  reminderStatusText: { fontSize: typography.xs, fontWeight: typography.medium },
  reminderPickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#00000088',
  },
  reminderPickerSheet: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface2,
    padding: spacing.md,
    gap: spacing.sm,
  },
  reminderPickerTitle: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    color: colors.text,
    textAlign: 'center',
  },
  reminderPickerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  reminderPickerCancel: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  reminderPickerCancelText: { fontSize: typography.sm, color: colors.textMuted },
  reminderPickerConfirm: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: BTN.reminders.border,
    backgroundColor: BTN.reminders.bg,
  },
  reminderPickerConfirmDisabled: { opacity: 0.6 },
  reminderPickerConfirmText: { fontSize: typography.sm, fontWeight: typography.semibold, color: BTN.reminders.text },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: typography.xs, fontWeight: typography.semibold, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  description: { fontSize: typography.base, color: colors.text, lineHeight: 22 },
  proofPreviewWrap: {
    height: 220,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: isDark ? '#101822' : colors.surface2,
    alignSelf: 'center',
  },
  proofPreviewImage: {
    width: '100%',
    height: '100%',
  },
  proofPreviewVideo: {
    width: '100%',
    height: '100%',
  },
  proofVideoOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  proofExpandHint: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    backgroundColor: '#00000066',
    borderRadius: radius.sm,
    padding: 5,
  },
  proofTimestampWrap: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: '#000000AA',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  proofTimestampText: {
    color: '#fff',
    fontSize: typography.xs,
    fontWeight: typography.medium,
  },
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: '#000000EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxImage: {
    width: '100%',
    height: '100%',
  },
  lightboxTimestampWrap: {
    position: 'absolute',
    left: spacing.lg,
    bottom: spacing.xxl,
    backgroundColor: '#000000AA',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  lightboxClose: {
    position: 'absolute',
    top: 52,
    right: spacing.lg,
    backgroundColor: '#00000066',
    borderRadius: radius.full,
    padding: spacing.sm,
  },
  timeline: { paddingVertical: spacing.xs, paddingBottom: spacing.md },
  timelineRow: { flexDirection: 'row', alignItems: 'stretch' },
  timelineSide: { flex: 1 },
  timelineCenter: {
    width: 12,
    alignItems: 'center',
  },
  timelineMarker: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  timelineAxisSegment: {
    width: 2,
    flex: 1,
    backgroundColor: colors.border,
  },
  timelineEntryLeft: {
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  timelineEntryRight: {
    paddingBottom: spacing.md,
    gap: spacing.xs,
    alignItems: 'flex-end',
  },
  timelineStemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  // Right side: connector grows to fill space before the pill
  timelineConnector: {
    flex: 1,
    height: 2,
    minWidth: 8,
  },
  // Left side: pill grows, connector is a fixed bridge to the spine
  timelinePillWrapLeft: { flex: 1 },
  timelineConnectorFixed: {
    width: 28,
    flexShrink: 0,
    height: 2,
  },
  timelinePillWrap: { flexShrink: 1 },
  timelineEventLabel: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    lineHeight: 20,
  },
  timelineTime: {
    fontSize: typography.xs,
    color: colors.textMuted,
    lineHeight: 16,
  },
  timelineDetail: {
    fontSize: typography.xs,
    color: colors.textMuted,
    lineHeight: 16,
  },
  escalationBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#00000088',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  escalationSheet: {
    width: '100%',
    maxHeight: '70%',
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface2,
    padding: spacing.md,
    gap: spacing.sm,
  },
  escalationTitle: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: colors.text,
  },
  escalationList: {
    maxHeight: 300,
  },
  escalationRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  escalationName: {
    fontSize: typography.sm,
    color: colors.text,
    fontWeight: typography.medium,
  },
  escalationEmail: {
    fontSize: typography.xs,
    color: colors.textMuted,
  },
  escalationEmpty: {
    fontSize: typography.sm,
    color: colors.textMuted,
  },
  escalationCancel: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  escalationCancelText: {
    fontSize: typography.sm,
    color: colors.textMuted,
  },
});
