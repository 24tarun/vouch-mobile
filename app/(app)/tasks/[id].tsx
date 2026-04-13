import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { StatusPill, STATUS_COLOR, STATUS_LABEL } from '@/components/StatusPill';
import type { Task, TaskEvent, TaskSubtask, TaskReminder } from '@/lib/types';

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
  DEADLINE_WARNING_1H: '1-hour deadline warning',
  DEADLINE_WARNING_5M: '5-minute deadline warning',
  GOOGLE_EVENT_CANCELLED: 'Google event cancelled',
  POSTPONE: 'Postponed',
  AI_APPROVE: 'AI approved',
  AI_DENY: 'AI denied',
  ORCA_DENIED_AUTO_HOP: 'Orca denied — escalated',
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
  markComplete:  { bg: '#10B98114', border: '#10B98159', text: '#6EE7B7' },
  postpone:      { bg: '#F59E0B14', border: '#F59E0B59', text: '#FCD34D' },
  stopRepeating: { bg: '#C084FC1A', border: '#C084FC59', text: '#C084FC' },
  override:      { bg: '#A21CAF33', border: '#A21CAFB3', text: '#F0ABFC' },
  delete:        { bg: '#450A0A26', border: '#7F1D1D66', text: '#F87171CC' },
  subtasks:      { bg: '#0066FF33', border: '#0066FF66', text: '#66A3FF' },
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
  const dayName = d.toLocaleDateString('en-GB', { weekday: 'long' });
  const month = d.toLocaleDateString('en-GB', { month: 'long' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${dayName} ${getOrdinal(d.getDate())} ${month} · ${time}`;
}

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date} · ${time}`;
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

function isWithinDeleteWindow(createdAt: string): boolean {
  return Date.now() - Date.parse(createdAt) < 10 * 60 * 1000;
}

const AWAITING_STATUSES = new Set(['AWAITING_VOUCHER', 'AWAITING_ORCA', 'AWAITING_USER', 'ESCALATED']);
const TERMINAL_STATUSES = new Set(['ACCEPTED', 'AUTO_ACCEPTED', 'ORCA_ACCEPTED', 'RECTIFIED', 'SETTLED', 'DELETED']);

// ─── Component ────────────────────────────────────────────────────────────────

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [task, setTask] = useState<Task | null>(null);
  const [voucherUsername, setVoucherUsername] = useState<string | null>(null);
  const [subtasks, setSubtasks] = useState<TaskSubtask[]>([]);
  const [reminders, setReminders] = useState<TaskReminder[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [currency, setCurrency] = useState('USD');
  const [pomoDuration, setPomoDuration] = useState(25);
  const [totalFocusedSeconds, setTotalFocusedSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subtasksOpen, setSubtasksOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);

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

        const [voucherRes, subtasksRes, remindersRes, eventsRes, profileRes, sessionsRes] = await Promise.all([
          supabase.from('profiles').select('id, username').eq('id', (taskData as Task).voucher_id).single(),
          supabase.from('task_subtasks').select('*').eq('parent_task_id', id).order('created_at', { ascending: true }),
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
        setVoucherUsername((voucherRes.data as any)?.username ?? null);
        setSubtasks((subtasksRes.data ?? []) as TaskSubtask[]);
        setReminders((remindersRes.data ?? []) as TaskReminder[]);
        setEvents((eventsRes.data ?? []) as TaskEvent[]);
        setCurrency((profileRes.data as any)?.currency ?? 'USD');
        setPomoDuration((profileRes.data as any)?.default_pomo_duration_minutes ?? 25);
        setTotalFocusedSeconds(focusedSeconds);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to load task');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [id]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
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
          <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
            <Feather name="arrow-left" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error ?? 'Task not found.'}</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.retryBtn}>
            <Text style={styles.retryText}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Allowed flags ──────────────────────────────────────────────────────────
  const s = task.status;
  const isActiveOrPostponed = s === 'ACTIVE' || s === 'POSTPONED';
  const isAwaiting = AWAITING_STATUSES.has(s);
  const isMissedOrDenied = s === 'MISSED' || s === 'DENIED';

  const canPomo          = isActiveOrPostponed;
  const canProof         = isActiveOrPostponed || isAwaiting;
  const canMarkComplete  = isActiveOrPostponed;
  const canPostpone      = s === 'ACTIVE' && !task.postponed_at;
  const canStopRepeating = isActiveOrPostponed && !!task.recurrence_rule_id;
  const canOverride      = isMissedOrDenied;
  const canDelete        = isActiveOrPostponed && isWithinDeleteWindow(task.created_at);

  // Per-button deny reasons
  const REASONS = {
    pomo:          'Task must be active to start a pomodoro.',
    proof:         'Proof can only be attached to active or awaiting tasks.',
    markComplete:  'Task must be active or postponed to mark complete.',
    postpone:      task.postponed_at
                     ? 'This task has already been postponed once.'
                     : 'Only active tasks can be postponed.',
    stopRepeating: 'This task is not part of a recurring series.',
    override:      'Use Override is only available for missed or denied tasks.',
    delete:        'The 10-minute delete window has passed.',
  };

  const isSelfVouch = task.voucher_id === task.user_id;
  const completedSubtasks = subtasks.filter((sub) => sub.is_completed).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Feather name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <StatusPill status={task.status} />
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
          <InfoRow icon="user"          label="Voucher"      value={isSelfVouch ? 'Self vouch' : (voucherUsername ? `@${voucherUsername}` : '—')} />
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

          {/* Pomodoro */}
          <ShakeBtn
            allowed={canPomo}
            onPress={() => { /* TODO: start pomo session */ }}
            onDeny={() => showMsg(REASONS.pomo)}
            style={[styles.pomoBtn]}
            accessibilityLabel="Start pomodoro"
          >
            <Ionicons name="stopwatch-outline" size={22} color={BTN.pomo.text} />
            <View style={[styles.pomoDivider, { backgroundColor: BTN.pomo.text + '44' }]} />
            <Text style={[styles.pomoDuration, { color: BTN.pomo.text }]}>{pomoDuration}</Text>
            <Text style={[styles.pomoLabel, { color: BTN.pomo.text }]}>{' m pomodoro?'}</Text>
          </ShakeBtn>

          {/* Proof / Camera */}
          <ShakeBtn
            allowed={canProof}
            onPress={() => { /* TODO: proof upload flow */ }}
            onDeny={() => showMsg(REASONS.proof)}
            style={[styles.actionBtn, { backgroundColor: BTN.proof.bg, borderColor: BTN.proof.border }]}
            accessibilityLabel="Attach proof"
          >
            <Feather name="camera" size={20} color={BTN.proof.text} />
          </ShakeBtn>

          {/* Mark Complete */}
          <ActionBtn
            allowed={canMarkComplete} token={BTN.markComplete} label="Mark Complete"
            onPress={() => { /* TODO: /tasks/complete edge function */ }}
            onDeny={() => showMsg(REASONS.markComplete)}
          />

          {/* Postpone */}
          <ActionBtn
            allowed={canPostpone} token={BTN.postpone} label="Postpone once?"
            onPress={() => { /* TODO: /tasks/postpone edge function */ }}
            onDeny={() => showMsg(REASONS.postpone)}
          />

          {/* Stop Repeating */}
          <ActionBtn
            allowed={canStopRepeating} token={BTN.stopRepeating} label="Stop Repeating" icon="repeat"
            onPress={() => { /* TODO: stop recurrence edge function */ }}
            onDeny={() => showMsg(REASONS.stopRepeating)}
          />

          {/* Use Override */}
          <ActionBtn
            allowed={canOverride} token={BTN.override} label="Use Override"
            onPress={() => { /* TODO: /tasks/override edge function */ }}
            onDeny={() => showMsg(REASONS.override)}
          />

          {/* Delete */}
          <ShakeBtn
            allowed={canDelete}
            onPress={() => { /* TODO: /tasks/delete edge function */ }}
            onDeny={() => showMsg(REASONS.delete)}
            style={[styles.actionBtn, { backgroundColor: BTN.delete.bg, borderColor: BTN.delete.border }]}
            accessibilityLabel="Delete task"
          >
            <Feather name="trash-2" size={20} color={BTN.delete.text} />
          </ShakeBtn>

          {/* Subtasks toggle */}
          <TouchableOpacity
            style={[styles.toggleBtn, { backgroundColor: BTN.subtasks.bg, borderColor: BTN.subtasks.border }]}
            onPress={() => setSubtasksOpen((v) => !v)}
            activeOpacity={0.75}
            accessibilityLabel={`Subtasks, ${completedSubtasks} of ${subtasks.length} completed`}
          >
            <Text style={[styles.toggleLabel, { color: BTN.subtasks.text }]}>Subtasks</Text>
            <Text style={[styles.toggleCount, { color: BTN.subtasks.text }]}>{completedSubtasks}/{subtasks.length}</Text>
          </TouchableOpacity>

          {subtasksOpen && (
            <View style={styles.toggleBody}>
              {subtasks.length === 0
                ? <Text style={styles.toggleEmpty}>No subtasks yet.</Text>
                : subtasks.map((sub) => (
                    <View key={sub.id} style={styles.subtaskRow}>
                      <View style={[styles.subtaskCircle, sub.is_completed && styles.subtaskCircleDone]}>
                        {sub.is_completed && <Feather name="check" size={9} color={colors.bg} />}
                      </View>
                      <Text style={[styles.subtaskTitle, sub.is_completed && styles.subtaskTitleDone]}>{sub.title}</Text>
                    </View>
                  ))
              }
            </View>
          )}

          {/* Reminders toggle */}
          <TouchableOpacity
            style={[styles.toggleBtn, { backgroundColor: BTN.reminders.bg, borderColor: BTN.reminders.border }]}
            onPress={() => setRemindersOpen((v) => !v)}
            activeOpacity={0.75}
            accessibilityLabel={`Reminders, ${reminders.length} set`}
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
        {events.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Timeline</Text>
            <View style={styles.timeline}>
              {events.map((ev, idx) => {
                const isLast = idx === events.length - 1;
                const evColor = STATUS_COLOR[ev.to_status] ?? colors.textMuted;
                return (
                  <View key={ev.id} style={styles.timelineRow}>
                    <View style={styles.timelineSpine}>
                      <View style={[styles.timelineDot, { backgroundColor: evColor }]} />
                      {!isLast && <View style={styles.timelineLine} />}
                    </View>
                    <View style={styles.timelineContent}>
                      <Text style={styles.timelineLabel}>{EVENT_LABEL[ev.event_type] ?? ev.event_type}</Text>
                      <Text style={styles.timelineTime}>{formatEventTime(ev.created_at)}</Text>
                      {ev.from_status !== ev.to_status && (
                        <Text style={styles.timelineTransition}>
                          {STATUS_LABEL[ev.from_status] ?? ev.from_status}{' → '}{STATUS_LABEL[ev.to_status] ?? ev.to_status}
                        </Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        )}

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
  accessibilityLabel,
  children,
}: {
  allowed: boolean;
  onPress: () => void;
  onDeny: () => void;
  style?: object | object[];
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
    <Animated.View style={{ transform: [{ translateX: shakeX }] }}>
      <TouchableOpacity style={style} onPress={handlePress} activeOpacity={0.75} accessibilityLabel={accessibilityLabel}>
        {children}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ─── ActionBtn ────────────────────────────────────────────────────────────────

interface BtnToken { bg: string; border: string; text: string }

function ActionBtn({ allowed, token, label, icon, onPress, onDeny }: {
  allowed: boolean;
  token: BtnToken;
  label: string;
  icon?: string;
  onPress: () => void;
  onDeny: () => void;
}) {
  return (
    <ShakeBtn
      allowed={allowed}
      onPress={onPress}
      onDeny={onDeny}
      style={[styles.actionBtn, { backgroundColor: token.bg, borderColor: token.border }]}
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
  title: { fontSize: typography.xl, fontWeight: typography.bold, color: colors.text, lineHeight: 32, letterSpacing: -0.5 },
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

  pomoBtn: { height: 56, flexDirection: 'row', alignItems: 'center', borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: spacing.lg, backgroundColor: BTN.pomo.bg, borderColor: BTN.pomo.border, gap: spacing.md },
  pomoDivider: { width: 1, height: 24 },
  pomoDuration: { fontSize: typography.xl, fontWeight: typography.bold, lineHeight: 28 },
  pomoLabel: { fontSize: typography.sm },

  actionBtn: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: spacing.lg },
  actionBtnIcon: { marginRight: spacing.sm },
  actionBtnLabel: { fontSize: typography.sm, fontWeight: typography.semibold },

  toggleBtn: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: spacing.lg },
  toggleLabel: { fontSize: typography.sm, fontWeight: typography.semibold },
  toggleCount: { fontSize: typography.sm, fontWeight: typography.semibold },
  toggleBody: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden', marginTop: -spacing.xs },
  toggleEmpty: { fontSize: typography.sm, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md },

  subtaskRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 12, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  subtaskCircle: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  subtaskCircleDone: { backgroundColor: colors.success, borderColor: colors.success },
  subtaskTitle: { flex: 1, fontSize: typography.sm, color: colors.text },
  subtaskTitleDone: { color: colors.textMuted, textDecorationLine: 'line-through' },

  reminderRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 11, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  reminderTime: { fontSize: typography.sm, color: colors.text },
  reminderSource: { fontSize: typography.xs, color: colors.textMuted, marginTop: 2 },

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
