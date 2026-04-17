import { useEffect, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Animated,
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import type { ImagePickerAsset } from 'expo-image-picker';
import { supabase } from '@/lib/supabase';
import { uploadTaskProofAsset } from '@/lib/task-proof-upload';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { StatusPill, STATUS_COLOR } from '@/components/StatusPill';
import { usePomodoro } from '@/components/pomodoro/PomodoroProvider';
import type { Task, TaskEvent, TaskReminder } from '@/lib/types';
import { resolveUserClientInstanceId } from '@/lib/user-client-instance';
import { AI_PROFILE_ID, AI_PROFILE_USERNAME } from '@/lib/constants/ai-profile';
import { TASK_AWAITING_STATUSES } from '@/lib/constants/task-status';

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

const REMINDER_SOURCE_LABEL: Record<string, string> = {
  MANUAL: 'Custom',
  DEFAULT_DEADLINE_1H: '1 hr before deadline',
  DEFAULT_DEADLINE_10M: '10 min before deadline',
};

// ─── Button color tokens ──────────────────────────────────────────────────────

const BTN = {
  pomo:          { bg: '#22D3EE1A', border: '#22D3EE4D', text: '#22D3EE' },
  proof:         { bg: '#F472B61A', border: '#F472B659', text: '#F472B6' },
  stopRepeating: { bg: '#C084FC1A', border: '#C084FC59', text: '#C084FC' },
  override:      { bg: '#A21CAF33', border: '#A21CAFB3', text: '#F0ABFC' },
  reminders:     { bg: '#FBBF2426', border: '#FBBF2459', text: '#FBBF24' },
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

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} · ${time}`;
}

function formatPomoEventDuration(totalSeconds: number): string {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  if (safeSeconds < 60) return `${safeSeconds}s`;
  if (safeSeconds % 60 === 0) return `${safeSeconds / 60}m`;
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}m ${seconds}s`;
}

function getEventSecondaryText(event: TaskEvent): string {
  if (event.event_type === 'POMO_COMPLETED') {
    const elapsedSeconds = Number(event.metadata?.elapsed_seconds ?? 0);
    return formatPomoEventDuration(elapsedSeconds);
  }

  return formatEventTime(event.created_at);
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function TaskDetailScreen() {
  const { id, back } = useLocalSearchParams<{ id: string; back?: string }>();
  const router = useRouter();
  const handleBack = () => {
    if (back === 'friends') {
      router.navigate('/friends' as any);
    } else {
      router.back();
    }
  };

  const [task, setTask] = useState<Task | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [voucherUsername, setVoucherUsername] = useState<string | null>(null);
  const [reminders, setReminders] = useState<TaskReminder[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [currency, setCurrency] = useState('USD');
  const [pomoDuration, setPomoDuration] = useState(25);
  const [pomoDraft, setPomoDraft] = useState('25');
  const [isEditingPomo, setIsEditingPomo] = useState(false);
  const [totalFocusedSeconds, setTotalFocusedSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [proofUploading, setProofUploading] = useState(false);
  const [isOverriding, setIsOverriding] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const hadCurrentTaskSessionRef = useRef(false);
  const {
    session: activePomoSession,
    isLoading: pomoLoading,
    setMinimized,
    startSession,
  } = usePomodoro();

  // Transient message shown when a locked button is pressed
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const msgTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showMsg(msg: string) {
    if (msgTimeout.current) clearTimeout(msgTimeout.current);
    setActionMsg(msg);
    msgTimeout.current = setTimeout(() => setActionMsg(null), 3000);
  }

  useEffect(() => () => { if (msgTimeout.current) clearTimeout(msgTimeout.current); }, []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setTotalFocusedSeconds(0);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) { if (!cancelled) setLoading(false); return; }

        const { data: taskData, error: taskErr } = await supabase
          .from('tasks').select('*').eq('id', id).single();

        if (taskErr || !taskData) {
          if (!cancelled) setError(taskErr?.message ?? 'Task not found');
          return;
        }

        const [voucherRes, remindersRes, eventsRes, profileRes, sessionsRes] = await Promise.all([
          supabase.from('profiles').select('id, username').eq('id', (taskData as Task).voucher_id).single(),
          supabase.from('task_reminders').select('*').eq('parent_task_id', id).order('reminder_at', { ascending: true }),
          supabase.from('task_events').select('*').eq('task_id', id).order('created_at', { ascending: true }),
          supabase.from('profiles').select('currency, default_pomo_duration_minutes').eq('id', userId).single(),
          supabase
            .from('pomo_sessions')
            .select('elapsed_seconds')
            .eq('task_id', id)
            .eq('user_id', userId)
            .neq('status', 'DELETED'),
        ]);

        if (cancelled) return;

        const focusedSeconds = (sessionsRes.data ?? []).reduce((sum, session) => {
          const elapsed = Number((session as { elapsed_seconds: number | null }).elapsed_seconds ?? 0);
          return sum + (Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0);
        }, 0);

        setTask(taskData as Task);
        setUserId(userId);
        setVoucherUsername(
          (taskData as Task).voucher_id === AI_PROFILE_ID
            ? AI_PROFILE_USERNAME
            : ((voucherRes.data as any)?.username ?? null),
        );
        setReminders((remindersRes.data ?? []) as TaskReminder[]);
        setEvents((eventsRes.data ?? []) as TaskEvent[]);
        setCurrency((profileRes.data as any)?.currency ?? 'USD');
        const defaultPomo = (profileRes.data as any)?.default_pomo_duration_minutes ?? 25;
        setPomoDuration(defaultPomo);
        setPomoDraft(String(defaultPomo));
        setTotalFocusedSeconds(focusedSeconds);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to load task');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id, reloadTick]);

  useEffect(() => {
    if (!id) return;
    const hasCurrentTaskSession = activePomoSession?.task_id === id;
    if (hadCurrentTaskSessionRef.current && !hasCurrentTaskSession) {
      setReloadTick((tick) => tick + 1);
    }
    hadCurrentTaskSessionRef.current = hasCurrentTaskSession;
  }, [activePomoSession?.task_id, id]);

  useEffect(() => {
    if (!id) return;

    const channel = supabase
      .channel(`task-detail-live:${id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pomo_sessions',
          filter: `task_id=eq.${id}`,
        },
        () => {
          setReloadTick((tick) => tick + 1);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'task_events',
          filter: `task_id=eq.${id}`,
        },
        () => {
          setReloadTick((tick) => tick + 1);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id]);

  async function ensureCameraPermission(): Promise<boolean> {
    const current = await ImagePicker.getCameraPermissionsAsync();
    if (current.granted) return true;

    const requested = await ImagePicker.requestCameraPermissionsAsync();
    if (requested.granted) return true;

    Alert.alert('Camera permission required', 'Allow camera access in Settings to capture proof media.');
    return false;
  }

  async function ensureGalleryPermission(): Promise<boolean> {
    const current = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (current.granted) return true;

    const requested = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (requested.granted) return true;

    Alert.alert('Photos permission required', 'Allow photo library access in Settings to attach proof.');
    return false;
  }

  async function uploadSelectedProof(asset: ImagePickerAsset) {
    if (!task || proofUploading) return;

    setProofUploading(true);
    try {
      const result = await uploadTaskProofAsset(task.id, asset);
      if (!result.success) {
        Alert.alert('Could not attach proof', result.error);
        return;
      }

      setTask((prev) => (prev ? {
        ...prev,
        has_proof: true,
        proof_request_open: false,
        proof_requested_at: null,
        proof_requested_by: null,
      } : prev));

      Alert.alert('Proof attached', result.mediaKind === 'video' ? 'Video proof uploaded.' : 'Photo proof uploaded.');
      setReloadTick((tick) => tick + 1);
    } finally {
      setProofUploading(false);
    }
  }

  async function handleCameraPhoto() {
    const allowed = await ensureCameraPermission();
    if (!allowed) return;

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
      allowsEditing: false,
      exif: true,
    });

    if (!result.canceled && result.assets.length > 0) {
      await uploadSelectedProof(result.assets[0]);
    }
  }

  async function handleCameraVideo() {
    const allowed = await ensureCameraPermission();
    if (!allowed) return;

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      videoMaxDuration: 15,
      quality: 0.8,
      exif: true,
    });

    if (!result.canceled && result.assets.length > 0) {
      await uploadSelectedProof(result.assets[0]);
    }
  }

  async function handleGalleryPick() {
    const allowed = await ensureGalleryPermission();
    if (!allowed) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      allowsMultipleSelection: false,
      quality: 0.9,
      videoMaxDuration: 15,
      exif: true,
    });

    if (!result.canceled && result.assets.length > 0) {
      await uploadSelectedProof(result.assets[0]);
    }
  }

  function openProofPicker() {
    if (!canProof || proofUploading) {
      showMsg(REASONS.proof);
      return;
    }

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Take Photo', 'Record Video', 'Choose from Library', 'Cancel'],
          cancelButtonIndex: 3,
          userInterfaceStyle: 'dark',
        },
        (selectedIndex) => {
          if (selectedIndex === 0) void handleCameraPhoto();
          if (selectedIndex === 1) void handleCameraVideo();
          if (selectedIndex === 2) void handleGalleryPick();
        },
      );
      return;
    }

    Alert.alert('Attach proof', 'Choose a media source.', [
      { text: 'Take Photo', onPress: () => void handleCameraPhoto() },
      { text: 'Record Video', onPress: () => void handleCameraVideo() },
      { text: 'Choose from Library', onPress: () => void handleGalleryPick() },
      { text: 'Cancel', style: 'cancel' },
    ]);
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

              setReloadTick((t) => t + 1);
            } finally {
              setIsOverriding(false);
            }
          },
        },
      ],
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} hitSlop={12}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.centered}><ActivityIndicator color={colors.textMuted} /></View>
      </SafeAreaView>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error || !task) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={handleBack} hitSlop={12}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error ?? 'Task not found.'}</Text>
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
  const isOwnTask = task.user_id === userId;

  const canPomo          = isOwnTask && isActiveOrPostponed;
  const canProof         = isOwnTask && (isActiveOrPostponed || isAwaiting);
  const canStopRepeating = isOwnTask && isActiveOrPostponed && !!task.recurrence_rule_id;
  const canOverride      = isOwnTask && isMissedOrDenied && !isOverriding;

  // Per-button deny reasons
  const REASONS = {
    pomo:          'Task must be active to start a pomodoro.',
    proof:         'Proof can only be attached to active or awaiting tasks.',
    stopRepeating: 'This task is not part of a recurring series.',
    override:      'Use Override is only available for missed or denied tasks.',
  };

  const isSelfVouch = task.voucher_id === task.user_id;
  const isCurrentTaskPomo = activePomoSession?.task_id === task.id;
  const currentTaskPomoStatus = isCurrentTaskPomo ? activePomoSession?.status : null;

  const handlePomoPress = () => {
    if (!canPomo) {
      showMsg(REASONS.pomo);
      return;
    }

    if (isCurrentTaskPomo) {
      setMinimized(false);
      return;
    }

    void startSession(task.id, pomoDuration);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <StatusPill status={task.status} size="large" />
        <View style={{ width: 22 }} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* Title */}
        <Text style={styles.title}>{task.title}</Text>
        {task.recurrence_rule_id && task.iteration_number != null && (
          <Text style={styles.iterationBadge}>Recurrence #{task.iteration_number}</Text>
        )}

        {/* Info block */}
        <View style={styles.infoBlock}>
          <InfoRow icon="clock"         label="Deadline"     value={formatFullDeadline(task.deadline)} />
          <Divider />
          <InfoRow icon="stopwatch-outline" iconSet="ionicons" label="Focused" value={formatFocusedTime(totalFocusedSeconds)} />
          <Divider />
          <InfoRow icon="alert-circle"  label="Failure cost" value={formatCost(task.failure_cost_cents, currency)} />
          <Divider />
          <InfoRow icon="user"          label="Voucher"      value={isSelfVouch ? 'Self vouch' : (voucherUsername ? voucherUsername : '—')} />
          {task.postponed_at && (<><Divider /><InfoRow icon="skip-forward" label="Postponed at"  value={formatFullDeadline(task.postponed_at)} /></>)}
          {task.marked_completed_at && (<><Divider /><InfoRow icon="check-circle" label="Completed at" value={formatFullDeadline(task.marked_completed_at)} /></>)}
        </View>

        {/* Flags */}
        {(task.requires_proof || task.required_pomo_minutes || task.is_strict) && (
          <View style={styles.flagsRow}>
            {task.requires_proof && <FlagPill icon="camera" label={task.has_proof ? 'Proof uploaded' : 'Proof required'} active={task.has_proof} />}
            {task.required_pomo_minutes != null && <FlagPill icon="clock" label={`${task.required_pomo_minutes} pomo min`} active={false} />}
            {task.is_strict && <FlagPill icon="lock" label="Strict window" active={false} />}
          </View>
        )}

        {/* ── Actions ───────────────────────────────────────────────────────── */}
        <View style={styles.actionsBlock}>

          {/* Message shown when a locked button is pressed */}
          {actionMsg && (
            <View style={styles.actionMsg}>
              <Feather name="info" size={12} color={colors.textMuted} />
              <Text style={styles.actionMsgText}>{actionMsg}</Text>
            </View>
          )}

          {/* Pomodoro + Proof row */}
          <View style={styles.pomoCameraRow}>
            <View style={{ flex: 1, opacity: canPomo ? 1 : 0.4 }}>
              {isCurrentTaskPomo ? (
                <TouchableOpacity
                  style={[styles.pomoRunningBtn, pomoLoading && styles.pomoDisabled]}
                  onPress={handlePomoPress}
                  activeOpacity={0.8}
                  accessibilityLabel="Open pomodoro timer"
                  disabled={pomoLoading}
                >
                  <Ionicons name="stopwatch-outline" size={18} color={BTN.pomo.text} />
                  <Text style={styles.pomoRunningLabel}>{currentTaskPomoStatus === 'PAUSED' ? 'Paused' : 'Running'}</Text>
                </TouchableOpacity>
              ) : (
                <ShakeBtn
                  allowed={canPomo}
                  onPress={handlePomoPress}
                  onDeny={() => showMsg(REASONS.pomo)}
                  style={[styles.pomoBtn, pomoLoading && styles.pomoDisabled]}
                  containerStyle={{ flex: 1 }}
                  accessibilityLabel="Start pomodoro"
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
                </ShakeBtn>
              )}
            </View>

            <ShakeBtn
              allowed={canProof}
              onPress={openProofPicker}
              onDeny={() => showMsg(REASONS.proof)}
              style={[styles.actionBtn, { backgroundColor: BTN.proof.bg, borderColor: BTN.proof.border }]}
              containerStyle={{ flex: 1 }}
              accessibilityLabel="Attach proof"
            >
              {proofUploading ? (
                <ActivityIndicator size="small" color={BTN.proof.text} />
              ) : (
                <Feather name="camera" size={20} color={BTN.proof.text} />
              )}
            </ShakeBtn>
          </View>

          {/* Stop repetitions + Override row */}
          <View style={styles.pomoCameraRow}>
            <ActionBtn
              allowed={canStopRepeating}
              token={BTN.stopRepeating}
              label="Stop repetitions"
              icon="repeat"
              onPress={() => { /* TODO: stop recurrence edge function */ }}
              onDeny={() => showMsg(REASONS.stopRepeating)}
              containerStyle={{ flex: 1 }}
            />

            <ActionBtn
              allowed={canOverride}
              token={BTN.override}
              label={isOverriding ? 'Overriding…' : 'Override'}
              icon="zap"
              onPress={() => { void handleOverride(); }}
              onDeny={() => showMsg(REASONS.override)}
              containerStyle={{ flex: 1 }}
            />
          </View>

          {/* Reminders toggle */}
          <TouchableOpacity
            style={[styles.toggleBtn, { backgroundColor: BTN.reminders.bg, borderColor: BTN.reminders.border }, !isOwnTask && styles.toggleBtnDisabled]}
            onPress={() => setRemindersOpen((v) => !v)}
            activeOpacity={0.75}
            accessibilityLabel={`Reminders, ${reminders.length} set`}
            disabled={!isOwnTask}
          >
            <Text style={[styles.toggleLabel, { color: BTN.reminders.text }]}>Reminders</Text>
            <Text style={[styles.toggleCount, { color: BTN.reminders.text }]}>{reminders.length}</Text>
          </TouchableOpacity>

          {remindersOpen && (
            <View style={styles.toggleBody}>
              {reminders.length === 0
                ? <Text style={styles.toggleEmpty}>No reminders set.</Text>
                : reminders.map((r) => (
                    <View key={r.id} style={styles.reminderRow}>
                      <Feather name="bell" size={13} color={BTN.reminders.text} style={{ flexShrink: 0 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.reminderTime}>{formatFullDeadline(r.reminder_at)}</Text>
                        <Text style={styles.reminderSource}>{REMINDER_SOURCE_LABEL[r.source] ?? r.source}</Text>
                      </View>
                      <View style={[styles.reminderStatusPill, r.notified_at ? styles.reminderStatusSent : styles.reminderStatusScheduled]}>
                        <Text style={[styles.reminderStatusText, { color: r.notified_at ? '#FBBF24' : '#60A5FA' }]}>
                          {r.notified_at ? 'Sent' : 'Scheduled'}
                        </Text>
                      </View>
                    </View>
                  ))
              }
            </View>
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

          if (displayEvents.length === 0) return null;

          return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Timeline</Text>
            <View style={styles.timeline}>
              {displayEvents.map((ev, idx) => {
                const isLast = idx === displayEvents.length - 1;
                const evColor = STATUS_COLOR[ev.to_status] ?? colors.textMuted;
                return (
                  <View key={ev.id} style={styles.timelineRow}>
                    <View style={styles.timelineSpine}>
                      <View style={[styles.timelineDot, { backgroundColor: evColor }]} />
                      {!isLast && <View style={styles.timelineLine} />}
                    </View>
                    <View style={styles.timelineContent}>
                      <Text style={styles.timelineLabel}>
                        {EVENT_LABEL[ev.event_type] ?? ev.event_type}
                        {(ev.event_type === 'DEADLINE_WARNING_1H' || ev.event_type === 'DEADLINE_WARNING_5M') && ' (Sent)'}
                        {' | '}
                        {getEventSecondaryText(ev)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
          );
        })()}

      </ScrollView>
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
  return <View style={styles.infoDivider} />;
}

function FlagPill({ icon, label, active }: { icon: string; label: string; active: boolean }) {
  return (
    <View style={[styles.flagPill, active && styles.flagPillActive]}>
      <Feather name={icon as any} size={12} color={active ? colors.success : colors.textMuted} />
      <Text style={[styles.flagPillText, active && styles.flagPillTextActive]}>{label}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  scroll: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  errorText: { fontSize: typography.sm, color: colors.textMuted, textAlign: 'center' },
  retryBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface2 },
  retryText: { fontSize: typography.sm, color: colors.text },
  title: { fontSize: typography.xl, fontWeight: typography.bold, color: colors.text, lineHeight: 32, letterSpacing: -0.5, textAlign: 'center' },
  iterationBadge: { fontSize: typography.xs, color: colors.textMuted, marginTop: -spacing.sm },
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
  actionMsg: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  actionMsgText: { flex: 1, fontSize: typography.xs, color: colors.textMuted, lineHeight: 17 },

  pomoCameraRow: { flexDirection: 'row', gap: spacing.sm },
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
  actionBtnIcon: { marginRight: spacing.sm },
  actionBtnLabel: { fontSize: typography.sm, fontWeight: typography.semibold },

  toggleBtn: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: spacing.lg },
  toggleBtnDisabled: { opacity: 0.5 },
  toggleLabel: { fontSize: typography.sm, fontWeight: typography.semibold },
  toggleCount: { fontSize: typography.sm, fontWeight: typography.semibold },
  toggleBody: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden', marginTop: -spacing.xs },
  toggleEmpty: { fontSize: typography.sm, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md },

  subtaskRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 12, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  subtaskCircle: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  subtaskCircleDone: { backgroundColor: colors.success, borderColor: colors.success },
  subtaskTitle: { flex: 1, fontSize: typography.sm, color: colors.text },
  subtaskTitleDone: { color: colors.textMuted, textDecorationLine: 'line-through' },

  reminderRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 11, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  reminderTime: { fontSize: typography.sm, color: colors.text },
  reminderSource: { fontSize: typography.xs, color: colors.textMuted, marginTop: 2 },
  reminderStatusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, flexShrink: 0 },
  reminderStatusSent: { backgroundColor: '#FBBF2420' },
  reminderStatusScheduled: { backgroundColor: '#60A5FA20' },
  reminderStatusText: { fontSize: typography.xs, fontWeight: typography.medium },
  timelineLabelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },

  section: { gap: spacing.sm },
  sectionTitle: { fontSize: typography.xs, fontWeight: typography.semibold, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.8 },
  description: { fontSize: typography.base, color: colors.text, lineHeight: 22 },

  timeline: { paddingLeft: spacing.xs },
  timelineRow: { flexDirection: 'row', gap: spacing.md },
  timelineSpine: { alignItems: 'center', width: 12 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 3, flexShrink: 0 },
  timelineLine: { flex: 1, width: 1, backgroundColor: colors.border, marginVertical: 3, minHeight: 16 },
  timelineContent: { flex: 1, paddingBottom: spacing.md, gap: 2 },
  timelineLabel: { fontSize: typography.sm, color: colors.text, fontWeight: typography.medium },
  timelineTime: { fontSize: typography.xs, color: colors.textMuted },
  timelineTransition: { fontSize: typography.xs, color: colors.textSubtle, marginTop: 1 },
});
