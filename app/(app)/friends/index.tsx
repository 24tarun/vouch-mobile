import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { colors, spacing, typography } from '@/lib/theme';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader } from '@/components/PageHeader';
import type { TaskStatus } from '@/lib/types';

type DecisionAction = 'accept' | 'deny' | 'proof';

interface VoucherTaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  proof_request_open: boolean;
  user: {
    id: string;
    username: string;
    voucher_can_view_active_tasks: boolean;
  } | null;
}

interface ActionButtonProps {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  color: string;
  backgroundColor: string;
  disabled: boolean;
  loading: boolean;
  onPress: () => void;
}

const ACTIONABLE_STATUSES: TaskStatus[] = ['AWAITING_VOUCHER'];
const ACTIVE_VIEW_STATUSES: TaskStatus[] = ['ACTIVE', 'POSTPONED'];
const ADDITIONAL_VISIBLE_STATUSES: TaskStatus[] = ['MARKED_COMPLETE'];
const VISIBLE_STATUSES: TaskStatus[] = [
  ...ACTIVE_VIEW_STATUSES,
  ...ACTIONABLE_STATUSES,
  ...ADDITIONAL_VISIBLE_STATUSES,
];

function ActionButton({
  icon,
  label,
  color,
  backgroundColor,
  disabled,
  loading,
  onPress,
}: ActionButtonProps) {
  return (
    <TouchableOpacity
      style={[
        styles.actionButton,
        { backgroundColor },
        disabled && styles.actionButtonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {loading ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <Feather name={icon} size={17} color={color} />
      )}
    </TouchableOpacity>
  );
}

function canVoucherSeeTask(task: VoucherTaskRow): boolean {
  if (ACTIONABLE_STATUSES.includes(task.status)) return true;
  if (ACTIVE_VIEW_STATUSES.includes(task.status)) {
    return Boolean(task.user?.voucher_can_view_active_tasks);
  }
  return true;
}

function getStatusPillStyle(status: TaskStatus): {
  label: string;
  textColor: string;
  borderColor: string;
  backgroundColor: string;
} {
  switch (status) {
    case 'ACTIVE':
    case 'POSTPONED':
      return {
        label: 'ACTIVE',
        textColor: '#60A5FA',
        borderColor: 'rgba(96,165,250,0.45)',
        backgroundColor: 'rgba(96,165,250,0.12)',
      };
    case 'AWAITING_VOUCHER':
      return {
        label: 'AWAITING VOUCHER',
        textColor: '#C084FC',
        borderColor: 'rgba(192,132,252,0.45)',
        backgroundColor: 'rgba(192,132,252,0.12)',
      };
    case 'MARKED_COMPLETE':
      return {
        label: 'MARKED COMPLETE',
        textColor: '#A78BFA',
        borderColor: 'rgba(167,139,250,0.45)',
        backgroundColor: 'rgba(167,139,250,0.12)',
      };
    default:
      return {
        label: status.replaceAll('_', ' '),
        textColor: colors.textMuted,
        borderColor: colors.borderStrong,
        backgroundColor: colors.surface2,
      };
  }
}

export default function FriendsScreen() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<VoucherTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inFlightByTaskId, setInFlightByTaskId] = useState<Record<string, DecisionAction | null>>({});
  const [historyOpen, setHistoryOpen] = useState(true);

  const awaitingVoucherTasks = useMemo(
    () => tasks.filter((task) => task.status === 'AWAITING_VOUCHER'),
    [tasks],
  );
  const activeTasks = useMemo(
    () => tasks.filter((task) => task.status === 'ACTIVE' || task.status === 'POSTPONED'),
    [tasks],
  );
  const otherVisibleTasks = useMemo(
    () => tasks.filter((task) => !['AWAITING_VOUCHER', 'ACTIVE', 'POSTPONED'].includes(task.status)),
    [tasks],
  );

  const fetchVoucherTasks = useCallback(async () => {
    if (!user) {
      setTasks([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    setError(null);

    const { data, error: fetchError } = await supabase
      .from('tasks')
      .select(`
        id,
        title,
        status,
        proof_request_open,
        user:profiles!tasks_user_id_fkey(
          id,
          username,
          voucher_can_view_active_tasks
        )
      `)
      .eq('voucher_id', user.id)
      .neq('user_id', user.id)
      .in('status', VISIBLE_STATUSES)
      .order('updated_at', { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setTasks([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const mapped = ((data ?? []) as any[]).map((row) => {
      const owner = row.user as {
        id?: string;
        username?: string;
        voucher_can_view_active_tasks?: boolean;
      } | null;

      return {
        id: row.id as string,
        title: (row.title as string) || 'Untitled task',
        status: row.status as TaskStatus,
        proof_request_open: Boolean(row.proof_request_open),
        user: owner?.id
          ? {
              id: owner.id,
              username: owner.username ?? 'Unknown owner',
              voucher_can_view_active_tasks: Boolean(owner.voucher_can_view_active_tasks),
            }
          : null,
      } satisfies VoucherTaskRow;
    });

    const filtered = mapped.filter(canVoucherSeeTask);

    setTasks(filtered);
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useEffect(() => {
    setLoading(true);
    void fetchVoucherTasks();
  }, [fetchVoucherTasks]);

  function updateInFlight(taskId: string, action: DecisionAction | null) {
    setInFlightByTaskId((prev) => ({ ...prev, [taskId]: action }));
  }

  async function handleAccept(task: VoucherTaskRow) {
    if (!user) return;

    updateInFlight(task.id, 'accept');
    try {
      const { data: updatedRows, error: updateError } = await supabase
        .from('tasks')
        .update({
          status: 'ACCEPTED',
          proof_request_open: false,
          proof_requested_at: null,
          proof_requested_by: null,
        })
        .eq('id', task.id)
        .eq('voucher_id', user.id)
        .in('status', ACTIONABLE_STATUSES)
        .select('id');

      if (updateError) {
        Alert.alert('Could not accept task', updateError.message);
        return;
      }
      if (!updatedRows || updatedRows.length === 0) {
        Alert.alert('Task changed', 'This task is no longer waiting for your review.');
        await fetchVoucherTasks();
        return;
      }

      const { error: eventError } = await supabase.from('task_events').insert({
        task_id: task.id,
        event_type: 'VOUCHER_ACCEPT',
        actor_id: user.id,
        from_status: task.status,
        to_status: 'ACCEPTED',
      });

      if (eventError) {
        setError('Task accepted, but event logging failed.');
      }

      setTasks((prev) => prev.filter((candidate) => candidate.id !== task.id));
    } finally {
      updateInFlight(task.id, null);
    }
  }

  async function handleDeny(task: VoucherTaskRow) {
    if (!user) return;

    updateInFlight(task.id, 'deny');
    try {
      const { data: updatedRows, error: updateError } = await supabase
        .from('tasks')
        .update({
          status: 'DENIED',
          proof_request_open: false,
          proof_requested_at: null,
          proof_requested_by: null,
        })
        .eq('id', task.id)
        .eq('voucher_id', user.id)
        .in('status', ACTIONABLE_STATUSES)
        .select('id');

      if (updateError) {
        Alert.alert('Could not deny task', updateError.message);
        return;
      }
      if (!updatedRows || updatedRows.length === 0) {
        Alert.alert('Task changed', 'This task is no longer waiting for your review.');
        await fetchVoucherTasks();
        return;
      }

      const { error: eventError } = await supabase.from('task_events').insert({
        task_id: task.id,
        event_type: 'VOUCHER_DENY',
        actor_id: user.id,
        from_status: task.status,
        to_status: 'DENIED',
      });

      if (eventError) {
        setError('Task denied, but event logging failed.');
      }

      setTasks((prev) => prev.filter((candidate) => candidate.id !== task.id));
    } finally {
      updateInFlight(task.id, null);
    }
  }

  async function handleRequestProof(task: VoucherTaskRow) {
    if (!user) return;

    updateInFlight(task.id, 'proof');
    try {
      const nowIso = new Date().toISOString();
      const { data: updatedRows, error: updateError } = await supabase
        .from('tasks')
        .update({
          proof_request_open: true,
          proof_requested_at: nowIso,
          proof_requested_by: user.id,
          updated_at: nowIso,
        })
        .eq('id', task.id)
        .eq('voucher_id', user.id)
        .eq('status', 'AWAITING_VOUCHER')
        .select('id');

      if (updateError) {
        Alert.alert('Could not request proof', updateError.message);
        return;
      }
      if (!updatedRows || updatedRows.length === 0) {
        Alert.alert('Task changed', 'This task is no longer awaiting voucher response.');
        await fetchVoucherTasks();
        return;
      }

      const { error: eventError } = await supabase.from('task_events').insert({
        task_id: task.id,
        event_type: 'PROOF_REQUESTED',
        actor_id: user.id,
        from_status: 'AWAITING_VOUCHER',
        to_status: 'AWAITING_VOUCHER',
      });

      if (eventError) {
        setError('Proof requested, but event logging failed.');
      }

      setTasks((prev) =>
        prev.map((candidate) => (
          candidate.id === task.id
            ? { ...candidate, proof_request_open: true }
            : candidate
        )),
      );
    } finally {
      updateInFlight(task.id, null);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <PageHeader title="Friends" />

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accentCyan} />
          <Text style={styles.helperText}>Loading friend activity…</Text>
        </View>
      ) : tasks.length === 0 ? (
        <View style={styles.centerState}>
          <Feather name={error ? 'alert-circle' : 'users'} size={28} color={error ? colors.warning : colors.textSubtle} />
          <Text style={styles.helperTitle}>{error ? 'Could not load friend activity' : 'Nothing to watch yet'}</Text>
          <Text style={styles.helperText}>
            {error ? error : 'Active tasks from your friends will appear here when they are shared with you.'}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void fetchVoucherTasks();
              }}
              tintColor={colors.accentCyan}
            />
          }
        >
          {error ? (
            <View style={styles.errorBanner}>
              <Feather name="alert-circle" size={14} color={colors.warning} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {awaitingVoucherTasks.map((task) => {
            const inFlightAction = inFlightByTaskId[task.id] ?? null;
            const pill = getStatusPillStyle(task.status);

            return (
              <View key={task.id} style={styles.taskRow}>
                <View style={styles.taskMain}>
                  <Text style={styles.taskTitle} numberOfLines={2}>
                    {task.title}
                  </Text>
                  <View style={styles.taskMetaRow}>
                    <Text style={styles.taskMetaUser} numberOfLines={1}>
                      {(task.user?.username ?? 'Unknown owner').toLowerCase()}
                    </Text>
                    <View style={[
                      styles.statusPill,
                      styles.statusPillInline,
                      {
                        borderColor: pill.borderColor,
                        backgroundColor: pill.backgroundColor,
                      },
                    ]}>
                      <Text style={[styles.statusPillText, { color: pill.textColor }]}>{pill.label}</Text>
                    </View>
                  </View>
                  {task.proof_request_open ? (
                    <Text style={styles.proofRequested}>Proof requested</Text>
                  ) : null}
                </View>

                <View style={styles.actions}>
                  <ActionButton
                    icon="check"
                    label="Accept task"
                    color={colors.success}
                    backgroundColor={colors.successMuted}
                    disabled={Boolean(inFlightAction)}
                    loading={inFlightAction === 'accept'}
                    onPress={() => { void handleAccept(task); }}
                  />
                  <ActionButton
                    icon="x"
                    label="Deny task"
                    color={colors.destructive}
                    backgroundColor={colors.destructiveMuted}
                    disabled={Boolean(inFlightAction)}
                    loading={inFlightAction === 'deny'}
                    onPress={() => { void handleDeny(task); }}
                  />
                  <ActionButton
                    icon="help-circle"
                    label="Request proof"
                    color={colors.warning}
                    backgroundColor={task.proof_request_open ? '#4A3411' : '#33230C'}
                    disabled={Boolean(inFlightAction)}
                    loading={inFlightAction === 'proof'}
                    onPress={() => { void handleRequestProof(task); }}
                  />
                </View>
              </View>
            );
          })}

          {activeTasks.map((task) => {
            const pill = getStatusPillStyle(task.status);
            return (
              <View key={task.id} style={styles.taskRow}>
                <View style={styles.taskMain}>
                  <Text style={styles.taskTitle} numberOfLines={2}>
                    {task.title}
                  </Text>
                  <View style={styles.taskMetaRow}>
                    <Text style={styles.taskMetaUser} numberOfLines={1}>
                      {(task.user?.username ?? 'Unknown owner').toLowerCase()}
                    </Text>
                    <View style={[
                      styles.statusPill,
                      styles.statusPillInline,
                      {
                        borderColor: pill.borderColor,
                        backgroundColor: pill.backgroundColor,
                      },
                    ]}>
                      <Text style={[styles.statusPillText, { color: pill.textColor }]}>{pill.label}</Text>
                    </View>
                  </View>
                </View>
              </View>
            );
          })}

          {otherVisibleTasks.length > 0 ? (
            <View>
              <Pressable style={styles.sectionHeader} onPress={() => setHistoryOpen((prev) => !prev)}>
                <Feather name={historyOpen ? 'chevron-down' : 'chevron-right'} size={16} color={colors.textMuted} />
                <Text style={styles.sectionTitle}>Vouched</Text>
              </Pressable>

              {historyOpen && otherVisibleTasks.map((task) => {
                const pill = getStatusPillStyle(task.status);
                return (
                  <View key={task.id} style={styles.taskRow}>
                    <View style={styles.taskMain}>
                      <Text style={styles.taskTitle} numberOfLines={2}>
                        {task.title}
                      </Text>
                      <View style={styles.taskMetaRow}>
                        <Text style={styles.taskMetaUser} numberOfLines={1}>
                          {(task.user?.username ?? 'Unknown owner').toLowerCase()}
                        </Text>
                        <View style={[
                          styles.statusPill,
                          styles.statusPillInline,
                          {
                            borderColor: pill.borderColor,
                            backgroundColor: pill.backgroundColor,
                          },
                        ]}>
                          <Text style={[styles.statusPillText, { color: pill.textColor }]}>{pill.label}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  body: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  helperTitle: {
    fontSize: typography.md,
    color: colors.text,
    fontWeight: typography.semibold,
  },
  helperText: {
    color: colors.textMuted,
    fontSize: typography.sm,
    textAlign: 'center',
  },
  taskRow: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  taskMain: {
    flex: 1,
  },
  taskTitle: {
    fontSize: typography.lg,
    color: colors.text,
    fontWeight: typography.semibold,
    lineHeight: 27,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 1,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  statusPillInline: {
    marginTop: 0,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: typography.semibold,
    letterSpacing: 0.4,
  },
  taskMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 4,
  },
  taskMetaUser: {
    fontSize: typography.sm,
    color: '#C084FC',
  },
  proofRequested: {
    fontSize: typography.xs,
    color: colors.warning,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 4,
  },
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  actionButtonDisabled: {
    opacity: 0.55,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.sm,
    color: colors.textMuted,
    fontWeight: typography.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: '#221717',
    borderWidth: 1,
    borderColor: '#4A1D1D',
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorText: {
    color: colors.text,
    fontSize: typography.sm,
    flex: 1,
  },
});
