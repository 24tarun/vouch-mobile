import { useCallback, useEffect, useRef, useState } from 'react';
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
import { supabase } from '@/lib/supabase';
import { purgeTaskProofForFinalState, removeTaskProofAsset, uploadTaskProofAsset } from '@/lib/task-proof-upload';
import { completeTask, stopTaskRepetitions, undoCompleteTask, deleteTask, postponeTaskDeadline, isTaskWithinDeleteWindow } from '@/lib/tasks/task-actions';
import { syncLocalReminderNotificationsAsync } from '@/lib/notifications';
import { type Colors, radius, spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import { StatusPill, STATUS_COLOR } from '@/components/StatusPill';
import { usePomodoro } from '@/components/pomodoro/PomodoroProvider';
import type { RecurrenceRule, Task, TaskEvent, TaskReminder } from '@/lib/types';
import { resolveUserClientInstanceId } from '@/lib/user-client-instance';
import { AI_PROFILE_ID, AI_PROFILE_USERNAME } from '@/lib/constants/ai-profile';
import { TASK_AWAITING_STATUSES } from '@/lib/constants/task-status';
import { useAuth } from '@/hooks/useAuth';
import { useTaskDetail } from '@/lib/hooks/useTaskDetail';
import { queryKeys } from '@/lib/query/keys';
import { PostponeDeadlineModal } from '@/components/tasks/PostponeDeadlineModal';
import { LegacyPostponeCalendarPicker } from '@/components/tasks/LegacyPostponeCalendarPicker';
import { ProofCaptureModal } from '@/components/tasks/ProofCaptureModal';

// ─── Event labels ─────────────────────────────────────────────────────────────

const EVENT_LABEL: Record<string, string> = {
  ACTIVE: 'Task created',
  MARK_COMPLETE: 'Marked complete',
  UNDO_COMPLETE: 'Completion undone',
  PROOF_UPLOADED: 'Proof uploaded',
  PROOF_UPLOAD_FAILED_REVERT: 'Proof upload failed',
  PROOF_REMOVED: 'Proof removed',
  PROOF_REQUESTED: 'Proof requested',
  VOUCHER_ACCEPT: 'Voucher accepted',
  VOUCHER_DENY: 'Voucher denied',
  VOUCHER_DELETE: 'Voucher removed',
  RECTIFY: 'Rectified',
  OVERRIDE: 'Override applied',
  DEADLINE_MISSED: 'Deadline missed',
  VOUCHER_TIMEOUT: 'Voucher timed out',
  POMO_COMPLETED: 'Pomodoro completed',
  DEADLINE_WARNING_1H: '1h left',
  DEADLINE_WARNING_5M: '5m left',
  DEADLINE_WARNING_10M: '10m left',
  GOOGLE_EVENT_CANCELLED: 'Google event cancelled',
  POSTPONE: 'Postponed',
  AI_APPROVE: 'AI approved',
  AI_DENY: 'AI denied',
  AI_DENIED_AUTO_HOP: 'AI denied — escalated',
  ESCALATE: 'Escalated',
  AI_ESCALATE_TO_HUMAN: 'Escalated to human voucher',
  ACCEPT_DENIAL: 'Denial accepted',
};

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

function formatTimelineTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${date} ${time}`;
}

function formatPomoEventDuration(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  if (safeSeconds < 60) return `${safeSeconds}s`;
  if (safeSeconds % 60 === 0) return `${safeSeconds / 60}m`;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function formatEnumLabel(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

type TimelineEntry = {
  id: string;
  createdAt: string;
  status?: string;
  label?: string;
  tone?: string;
  preserveStatus?: boolean;
  renderAsPill?: boolean;
};

function getTimelineTone(event: TaskEvent): 'SUCCESS' | 'DANGER' | 'WARNING' | 'INFO' | 'PROOF' | 'NEUTRAL' {
  switch (event.event_type) {
    case 'MARK_COMPLETE':
    case 'VOUCHER_ACCEPT':
    case 'AI_APPROVE':
    case 'POMO_COMPLETED':
      return 'SUCCESS';
    case 'VOUCHER_DENY':
    case 'AI_DENY':
    case 'AI_DENIED_AUTO_HOP':
    case 'DEADLINE_MISSED':
    case 'PROOF_UPLOAD_FAILED_REVERT':
    case 'ACCEPT_DENIAL':
      return 'DANGER';
    case 'DEADLINE_WARNING_1H':
    case 'DEADLINE_WARNING_10M':
    case 'DEADLINE_WARNING_5M':
    case 'VOUCHER_TIMEOUT':
    case 'PROOF_REQUESTED':
      return 'WARNING';
    case 'PROOF_UPLOADED':
    case 'PROOF_REMOVED':
      return 'PROOF';
    case 'ACTIVE':
    case 'UNDO_COMPLETE':
    case 'RECTIFY':
    case 'OVERRIDE':
    case 'POSTPONE':
    case 'ESCALATE':
    case 'AI_ESCALATE_TO_HUMAN':
    case 'GOOGLE_EVENT_CANCELLED':
      return 'INFO';
    default:
      return 'NEUTRAL';
  }
}

function makeTimelineEntry(event: TaskEvent, suffix: string, entry: Omit<TimelineEntry, 'id' | 'createdAt'>): TimelineEntry {
  return {
    id: `${event.id}:${suffix}`,
    createdAt: event.created_at,
    ...entry,
  };
}

function getReminderTimelineLabel(eventType: string): string | null {
  switch (eventType) {
    case 'DEADLINE_WARNING_1H':
      return '1hr Reminder Sent';
    case 'DEADLINE_WARNING_10M':
      return '10m Reminder Sent';
    case 'DEADLINE_WARNING_5M':
      return '5m Reminder Sent';
    default:
      return null;
  }
}

function buildTimelineEntries(event: TaskEvent): TimelineEntry[] {
  const statusTransition =
    event.from_status !== event.to_status
      ? [makeTimelineEntry(event, 'status', { status: event.to_status, preserveStatus: true })]
      : [];
  const reminderLabel = getReminderTimelineLabel(event.event_type);

  if (event.event_type === 'ACTIVE') {
    return [makeTimelineEntry(event, 'status', { status: 'ACTIVE', preserveStatus: true })];
  }

  if (reminderLabel) {
    return [makeTimelineEntry(event, 'reminder', { label: reminderLabel, tone: 'WARNING' })];
  }

  switch (event.event_type) {
    case 'MARK_COMPLETE':
      return [
        makeTimelineEntry(event, 'action', {
          status: 'MARKED_COMPLETE',
          label: 'Marked Complete',
          preserveStatus: true,
        }),
        ...statusTransition,
      ];
    case 'UNDO_COMPLETE':
      return [
        makeTimelineEntry(event, 'action', {
          label: 'Completion Undone',
          tone: 'INFO',
        }),
        ...statusTransition,
      ];
    case 'VOUCHER_ACCEPT':
      return statusTransition;
    case 'VOUCHER_DENY':
      return statusTransition;
    case 'AI_APPROVE':
      return [
        makeTimelineEntry(event, 'action', { label: 'AI Approved', tone: 'SUCCESS' }),
        ...statusTransition,
      ];
    case 'AI_DENY':
    case 'AI_DENIED_AUTO_HOP':
      return [
        makeTimelineEntry(event, 'action', { label: 'AI Denied', tone: 'DANGER' }),
        ...statusTransition,
      ];
    case 'PROOF_UPLOADED':
      return [makeTimelineEntry(event, 'action', { label: 'Proof Uploaded', tone: 'PROOF' })];
    case 'PROOF_UPLOAD_FAILED_REVERT':
      return [makeTimelineEntry(event, 'action', { label: 'Proof Upload Failed', tone: 'DANGER' })];
    case 'PROOF_REMOVED':
      return [makeTimelineEntry(event, 'action', { label: 'Proof Removed', tone: 'PROOF' })];
    case 'PROOF_REQUESTED':
      return [makeTimelineEntry(event, 'action', { label: 'Proof Requested', tone: 'WARNING' })];
    case 'POMO_COMPLETED': {
      const elapsedSeconds = Number(event.metadata?.elapsed_seconds ?? 0);
      const durationLabel = elapsedSeconds > 0 ? ` (${formatPomoEventDuration(elapsedSeconds)})` : '';
      return [makeTimelineEntry(event, 'action', {
        label: `Pomodoro Completed${durationLabel}`,
        tone: 'INFO',
        renderAsPill: false,
      })];
    }
    case 'POSTPONE':
    case 'RECTIFY':
    case 'OVERRIDE':
    case 'DEADLINE_MISSED':
    case 'VOUCHER_TIMEOUT':
    case 'ESCALATE':
    case 'AI_ESCALATE_TO_HUMAN':
    case 'ACCEPT_DENIAL':
      if (statusTransition.length > 0) return statusTransition;
      break;
    default:
      if (statusTransition.length > 0) return statusTransition;
  }

  return [
    makeTimelineEntry(event, 'action', {
      label: EVENT_LABEL[event.event_type] ?? formatEnumLabel(event.event_type),
      tone: getTimelineTone(event),
    }),
  ];
}

function getTimelineEntryColor(entry: TimelineEntry, textMuted: string): string {
  const styleKey = entry.tone
    ?? (entry.preserveStatus ? entry.status : (entry.status === 'MARKED_COMPLETE' ? 'AWAITING_VOUCHER' : entry.status))
    ?? 'NEUTRAL';
  return STATUS_COLOR[styleKey] ?? textMuted;
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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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

export default function TaskDetailScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { id, back } = useLocalSearchParams<{ id: string; back?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { width: screenWidth } = useWindowDimensions();
  const { user, profile } = useAuth();
  const detail = useTaskDetail(id);
  const handleBack = () => {
    if (back === 'friends') {
      router.navigate('/friends' as any);
    } else {
      router.back();
    }
  };

  // ── Subtasks ───────────────────────────────────────────────────────────────
  interface Subtask { id: string; title: string; is_completed: boolean; completed_at: string | null }
  const MAX_SUBTASKS = 20;
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtaskDraft, setNewSubtaskDraft] = useState('');
  const subtaskInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!id) return;
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
  }, [id]);

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
        .eq('parent_task_id', id);
      if (error) setSubtasks(snapshot);
    } catch {
      setSubtasks(snapshot);
    }
  }

  const [currency, setCurrency] = useState('USD');
  const [pomoDuration, setPomoDuration] = useState(25);
  const [pomoDraft, setPomoDraft] = useState('25');
  const [isEditingPomo, setIsEditingPomo] = useState(false);
  const [expandedPanel, setExpandedPanel] = useState<'reminders' | 'subtasks' | null>(null);
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
  const [proofRemoving, setProofRemoving] = useState(false);
  const [isOverriding, setIsOverriding] = useState(false);
  const [isUndoingComplete, setIsUndoingComplete] = useState(false);
  const [isStoppingRepetitions, setIsStoppingRepetitions] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [isPostponing, setIsPostponing] = useState(false);
  const [postponePickerOpen, setPostponePickerOpen] = useState(false);
  const [postponePickerDate, setPostponePickerDate] = useState<Date>(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const [proofLightboxOpen, setProofLightboxOpen] = useState(false);
  const [proofCaptureOpen, setProofCaptureOpen] = useState(false);
  const {
    session: activePomoSession,
    isLoading: pomoLoading,
    setMinimized,
    startSession,
  } = usePomodoro();
  const task = detail.data?.task ?? null;
  const voucherUsername = task?.voucher_id === AI_PROFILE_ID
    ? AI_PROFILE_USERNAME
    : detail.data?.voucherUsername ?? null;
  const reminders = detail.data?.reminders ?? [];
  const events = detail.data?.events ?? [];
  const totalFocusedSeconds = detail.data?.totalFocusedSeconds ?? 0;
  const proof = detail.data?.proof ?? null;
  const recurrenceRule = detail.data?.recurrenceRule ?? null;
  const proofPreviewWidth = screenWidth - spacing.lg * 2;

  const refetchDetail = detail.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetchDetail();
    }, [refetchDetail]),
  );

  useEffect(() => {
    const nextCurrency = profile?.currency ?? 'USD';
    setCurrency(nextCurrency);
    const defaultPomo = profile?.default_pomo_duration_minutes ?? 25;
    setPomoDuration(defaultPomo);
    setPomoDraft(String(defaultPomo));
  }, [profile?.currency, profile?.default_pomo_duration_minutes]);

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
    if (!task || proofUploading) return;

    const isReplacingProof = Boolean(proof);
    setProofUploading(true);
    try {
      const result = await uploadTaskProofAsset(task.id, asset);
      if (!result.success) {
        showProofToast(`Proof upload failed: ${result.error}`, 'error');
        return;
      }

      const optimisticProofMediaKind: 'image' | 'video' = asset.type === 'video' ? 'video' : 'image';
      const optimisticProofUrl = asset.uri;
      queryClient.setQueryData(queryKeys.taskDetail(id), (previous: any) => previous ? {
        ...previous,
        task: previous.task
          ? {
              ...previous.task,
              has_proof: true,
              proof_request_open: false,
              proof_requested_at: null,
              proof_requested_by: null,
            }
          : previous.task,
        proof: optimisticProofUrl
          ? {
              signedUrl: optimisticProofUrl,
              mediaKind: optimisticProofMediaKind,
              overlayTimestampText: '',
              bucket: previous.proof?.bucket ?? 'task-proofs',
              objectPath: previous.proof?.objectPath ?? '',
            }
          : previous.proof ?? null,
      } : previous);
      await Promise.resolve(detail.refetch());
      invalidateDerivedTaskViews();
      if (isReplacingProof) {
        showProofToast('Proof replaced successfully.', 'success');
      }
    } finally {
      setProofUploading(false);
    }
  }

  async function removeCurrentProof() {
    if (!task || !proof || proofUploading || proofRemoving) return;

    setProofRemoving(true);
    try {
      const removeResult = await removeTaskProofAsset(task.id, {
        bucket: proof.bucket,
        objectPath: proof.objectPath,
      });

      if (!removeResult.success) {
        Alert.alert('Could not remove proof', removeResult.error);
        return;
      }

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
        Alert.alert('Proof removed', 'Proof file was removed, but task state did not refresh yet. Pull to refresh.');
      }

      queryClient.setQueryData(queryKeys.taskDetail(id), (previous: any) => previous ? {
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
      setProofRemoving(false);
    }
  }

  function openProofPicker() {
    if (proofUploading || proofRemoving) return;
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

              const { error: taskErr } = await supabase
                .from('tasks')
                .update({ status: 'SETTLED', updated_at: now })
                .eq('id', task.id)
                .eq('user_id', userId);

              if (taskErr) { Alert.alert('Override failed', taskErr.message); return; }

              await Promise.all([
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

              if (task.has_proof) {
                const purgeResult = await purgeTaskProofForFinalState(task.id);
                if (!purgeResult.success) {
                  Alert.alert('Override applied, cleanup failed', purgeResult.error);
                }
              }

              queryClient.setQueryData(queryKeys.taskDetail(id), (previous: any) => previous ? {
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
    const targetStatusLabel = task.postponed_at ? 'postponed' : 'active';

    Alert.alert(
      'Undo completion?',
      `The selected task will be moved back to ${targetStatusLabel} status.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Undo',
          onPress: async () => {
            setIsUndoingComplete(true);
            try {
              const result = await undoCompleteTask(task.id, task.status);
              if (!result.success) {
                Alert.alert('Failed to undo', result.error ?? 'Please try again.');
                return;
              }
              const nowIso = new Date().toISOString();
              queryClient.setQueryData(queryKeys.taskDetail(id), (previous: any) => previous ? {
                ...previous,
                task: previous.task
                  ? {
                      ...previous.task,
                      status: 'ACTIVE',
                      marked_completed_at: null,
                      voucher_response_deadline: null,
                      updated_at: nowIso,
                    }
                  : previous.task,
              } : previous);
              invalidateDerivedTaskViews();
            } finally {
              setIsUndoingComplete(false);
            }
          },
        },
      ],
    );
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
      queryClient.setQueryData(queryKeys.taskDetail(id), (previous: any) => previous ? {
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
      Alert.alert('Delete unavailable', 'Tasks can only be deleted within 10 minutes of creation.');
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
        queryClient.setQueryData(queryKeys.taskDetail(id), (previous: any) => previous ? {
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
      candidate.setTime(now + 30 * 60 * 1000);
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

      queryClient.setQueryData(queryKeys.taskDetail(id), (previous: any) => previous ? {
        ...previous,
        reminders: (previous.reminders ?? []).filter((item: TaskReminder) => item.id !== reminder.id),
      } : previous);
      void syncLocalReminderNotificationsAsync(user.id);
    } finally {
      setIsMutatingReminder(false);
    }
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
  const isAwaiting = TASK_AWAITING_STATUSES.has(s);
  const isMissedOrDenied = s === 'MISSED' || s === 'DENIED';
  const isOwnTask = task.user_id === user?.id;

  const canPomo          = isOwnTask && isActiveOrPostponed;
  const canComplete      = isOwnTask && isActiveOrPostponed && !isCompleting;
  const canProof         = isOwnTask && (isActiveOrPostponed || isAwaiting);
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
            {task.requires_proof && <FlagPill icon="camera" label={task.has_proof ? 'Proof uploaded' : 'Proof required'} active={task.has_proof} />}
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
                  onPress={() => setExpandedPanel((current) => (current === 'subtasks' ? null : 'subtasks'))}
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
                          />
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
        {(() => {
          // Synthesize ACTIVE and MARK_COMPLETE entries from task fields when
          // they are absent from task_events (e.g. older tasks or missing logs).
          const hasActiveEvent = events.some((e) => e.event_type === 'ACTIVE');
          const hasMarkCompleteEvent = events.some((e) => e.event_type === 'MARK_COMPLETE');

          const synthetic: TaskEvent[] = [];

          if (!hasActiveEvent) {
            synthetic.push({
              id: '__synthetic_active__',
              task_id: task.id,
              event_type: 'ACTIVE',
              actor_id: null,
              from_status: 'ACTIVE',
              to_status: 'ACTIVE',
              metadata: null,
              created_at: task.created_at,
            });
          }

          if (!hasMarkCompleteEvent && task.marked_completed_at) {
            synthetic.push({
              id: '__synthetic_mark_complete__',
              task_id: task.id,
              event_type: 'MARK_COMPLETE',
              actor_id: null,
              from_status: 'ACTIVE',
              to_status: 'MARKED_COMPLETE',
              metadata: null,
              created_at: task.marked_completed_at,
            });
          }

          const displayEvents = [...synthetic, ...events].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          );
          const timelineEntries = displayEvents.flatMap(buildTimelineEntries);

          if (timelineEntries.length === 0) return null;

          return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Timeline</Text>
            <View style={styles.timeline}>
              {timelineEntries.map((entry, idx) => {
                const isRightSide = idx % 2 === 0;
                const isLast = idx === timelineEntries.length - 1;
                const entryColor = getTimelineEntryColor(entry, colors.textMuted);

                const pill = entry.renderAsPill === false ? (
                  <Text style={[styles.timelineEventLabel, { color: entryColor }]} numberOfLines={2}>
                    {entry.label}
                  </Text>
                ) : (
                  <StatusPill
                    status={entry.status}
                    label={entry.label}
                    tone={entry.tone}
                    preserveStatus={entry.preserveStatus}
                  />
                );

                return (
                  <View key={entry.id} style={styles.timelineRow}>
                    {/* Left side */}
                    <View style={styles.timelineSide}>
                      {!isRightSide ? (
                        <View style={styles.timelineEntryLeft}>
                          <View style={styles.timelineStemRow}>
                            <View style={styles.timelinePillWrapLeft}>{pill}</View>
                            <View style={[styles.timelineConnectorFixed, { backgroundColor: entryColor + '66' }]} />
                          </View>
                          <Text style={styles.timelineTime}>
                            {formatTimelineTimestamp(entry.createdAt)}
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    {/* Center spine */}
                    <View style={styles.timelineCenter}>
                      <View style={[styles.timelineMarker, { backgroundColor: entryColor, borderColor: colors.bg }]} />
                      {!isLast ? <View style={styles.timelineAxisSegment} /> : null}
                    </View>

                    {/* Right side */}
                    <View style={styles.timelineSide}>
                      {isRightSide ? (
                        <View style={styles.timelineEntryRight}>
                          <View style={styles.timelineStemRow}>
                            <View style={[styles.timelineConnector, { backgroundColor: entryColor + '66' }]} />
                            <View style={styles.timelinePillWrap}>{pill}</View>
                          </View>
                          <Text style={[styles.timelineTime, { textAlign: 'right' }]}>
                            {formatTimelineTimestamp(entry.createdAt)}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
          );
        })()}

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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
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
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return <View style={styles.infoDivider} />;
}

function FlagPill({ icon, label, active }: { icon: string; label: string; active: boolean }) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <View style={[styles.flagPill, active && styles.flagPillActive]}>
      <Feather name={icon as any} size={12} color={active ? colors.success : colors.textMuted} />
      <Text style={[styles.flagPillText, active && styles.flagPillTextActive]}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (colors: Colors) => StyleSheet.create({
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
  subtaskDeleteCircle: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.destructive, borderWidth: 1, borderColor: '#00000024', flexShrink: 0, marginTop: 2 },
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
    backgroundColor: '#101822',
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
});
