import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Modal,
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
import { useVideoPlayer, VideoView } from 'expo-video';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { useAuth } from '@/hooks/useAuth';
import { StatusPill } from '@/components/StatusPill';
import { resolveUserClientInstanceId } from '@/lib/user-client-instance';
import { queryKeys } from '@/lib/query/keys';
import {
  VOUCHER_ACTIONABLE_STATUSES,
} from '@/lib/constants/task-status';
import { useFriendQueue, type VoucherTaskRow, type VouchHistoryTaskRow } from '@/lib/hooks/useFriendQueue';
import type { TaskDetailData } from '@/lib/hooks/useTaskDetail';

type DecisionAction = 'accept' | 'deny' | 'proof';

interface TaskProof {
  signedUrl: string;
  mediaKind: 'image' | 'video';
  overlayTimestampText: string;
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

function VideoProofPlayer({
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
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const sub = player.addListener('playingChange', (e) => {
      setPlaying(e.isPlaying);
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

export default function FriendsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { width: screenWidth } = useWindowDimensions();
  const [searchQuery, setSearchQuery] = useState('');
  const friendQueue = useFriendQueue(user?.id, searchQuery);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inFlightByTaskId, setInFlightByTaskId] = useState<Record<string, DecisionAction | null>>({});
  const [inFlightRectifyByTaskId, setInFlightRectifyByTaskId] = useState<Record<string, boolean>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchAnim = useRef(new Animated.Value(0)).current;
  const searchInputRef = useRef<TextInput>(null);
  const searchBarWidth = screenWidth - spacing.lg * 2 - 40;
  const historyLoadingMore = false;
  const [lightboxProof, setLightboxProof] = useState<TaskProof | null>(null);

  const proofPreviewWidth = screenWidth - spacing.md * 2;

  const q = searchQuery.trim().toLowerCase();
  const tasks = friendQueue.tasks;
  const historyTasks = friendQueue.historyTasks;
  const loading = friendQueue.loading;
  const historyLoading = friendQueue.historyLoading;
  const historyHasMore = friendQueue.historyHasMore;
  const error = actionError ?? friendQueue.error;
  const historyError = friendQueue.historyError;

  const awaitingVoucherTasks = useMemo(
    () => tasks.filter((task) =>
      VOUCHER_ACTIONABLE_STATUSES.includes(task.status) &&
      (!q || task.title.toLowerCase().includes(q) || (task.user?.username ?? '').toLowerCase().includes(q))
    ),
    [tasks, q],
  );
  const activeTasks = useMemo(
    () => tasks.filter((task) =>
      (task.status === 'ACTIVE' || task.status === 'POSTPONED') &&
      (!q || task.title.toLowerCase().includes(q) || (task.user?.username ?? '').toLowerCase().includes(q))
    ),
    [tasks, q],
  );
  const hasPrimaryTasks = awaitingVoucherTasks.length > 0 || activeTasks.length > 0;

  function openSearch() {
    setIsSearchOpen(true);
    Animated.spring(searchAnim, {
      toValue: 1,
      tension: 65,
      friction: 11,
      useNativeDriver: false,
    }).start();
    setTimeout(() => searchInputRef.current?.focus(), 80);
  }

  function closeSearch() {
    setSearchQuery('');
    setActionError(null);
    searchInputRef.current?.blur();
    Animated.spring(searchAnim, {
      toValue: 0,
      tension: 65,
      friction: 11,
      useNativeDriver: false,
    }).start(() => setIsSearchOpen(false));
  }

  function patchFriendQueue(updater: (current: VoucherTaskRow[]) => VoucherTaskRow[]) {
    if (!user) return;

    queryClient.setQueryData<VoucherTaskRow[]>(
      queryKeys.friendQueue(user.id),
      (current) => updater(current ?? []),
    );
  }

  function patchFriendHistory(updater: (current: VouchHistoryTaskRow[]) => VouchHistoryTaskRow[]) {
    if (!user) return;

    queryClient.setQueryData<{ tasks: VouchHistoryTaskRow[]; hasMore: boolean }>(
      queryKeys.friendHistory(user.id, searchQuery),
      (current) => {
        const nextTasks = updater(current?.tasks ?? []);
        return {
          tasks: nextTasks,
          hasMore: current?.hasMore ?? false,
        };
      },
    );
  }

  function patchTaskDetail(taskId: string, updater: (current: TaskDetailData) => TaskDetailData) {
    queryClient.setQueryData<TaskDetailData>(
      queryKeys.taskDetail(taskId),
      (current) => (current ? updater(current) : current),
    );
  }

  async function handleRectify(task: VouchHistoryTaskRow) {
    if (!user || inFlightRectifyByTaskId[task.id]) return;

    const currentPeriod = new Date().toISOString().slice(0, 7);
    const failedPeriod  = new Date(task.updated_at).toISOString().slice(0, 7);

    if (failedPeriod !== currentPeriod) {
      Alert.alert('Rectify expired', 'Rectify can only be authorised for tasks that failed this calendar month.');
      return;
    }

    const { count } = await supabase
      .from('rectify_passes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', task.user?.id ?? '')
      .eq('period', currentPeriod);

    const passesUsed = count ?? 0;
    if (passesUsed >= 5) {
      Alert.alert('Pass limit reached', `${task.user?.username ?? 'This user'} has already used all 5 rectify passes this month.`);
      return;
    }

    const cost = (task.failure_cost_cents / 100).toFixed(2);
    Alert.alert(
      'Authorise Rectify?',
      `This will rectify "${task.title}" and reverse its €${cost} charge. ${task.user?.username ?? 'User'} has used ${passesUsed}/5 passes this month.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Rectify',
          onPress: async () => {
            setInFlightRectifyByTaskId((prev) => ({ ...prev, [task.id]: true }));
            try {
              const fromStatus = task.status;
              const actorUserClientInstanceId = await resolveUserClientInstanceId(user.id);

              const { error: taskErr } = await supabase
                .from('tasks')
                .update({ status: 'RECTIFIED' })
                .eq('id', task.id)
                .eq('voucher_id', user.id);

              if (taskErr) { Alert.alert('Rectify failed', taskErr.message); return; }

              const writeResults = await Promise.all([
                supabase.from('rectify_passes').insert({
                  user_id:       task.user?.id,
                  task_id:       task.id,
                  authorized_by: user.id,
                  period:        currentPeriod,
                }),
                supabase.from('ledger_entries').insert({
                  user_id:      task.user?.id,
                  task_id:      task.id,
                  period:       currentPeriod,
                  amount_cents: -(task.failure_cost_cents),
                  entry_type:   'rectified',
                }),
                supabase.from('task_events').insert({
                  task_id:     task.id,
                  event_type:  'RECTIFY',
                  actor_id:    user.id,
                  actor_user_client_instance_id: actorUserClientInstanceId,
                  from_status: fromStatus,
                  to_status:   'RECTIFIED',
                }),
              ]);

              const writeError = writeResults.find((r) => r.error)?.error;
              if (writeError) {
                Alert.alert('Rectify partially failed', writeError.message);
                return;
              }

              const nextUpdatedAt = new Date().toISOString();
              patchFriendHistory((current) => {
                const nextTask: VouchHistoryTaskRow = {
                  ...task,
                  status: 'RECTIFIED',
                  updated_at: nextUpdatedAt,
                };

                return [nextTask, ...current.filter((candidate) => candidate.id !== task.id)].slice(0, 10);
              });
              patchTaskDetail(task.id, (current) => ({
                ...current,
                task: current.task
                  ? {
                      ...current.task,
                      status: 'RECTIFIED',
                      updated_at: nextUpdatedAt,
                    }
                  : current.task,
              }));
            } finally {
              setInFlightRectifyByTaskId((prev) => ({ ...prev, [task.id]: false }));
            }
          },
        },
      ],
    );
  }

  useEffect(() => {
    if (searchQuery.trim() && !historyOpen) {
      setHistoryOpen(true);
    }
  }, [historyOpen, searchQuery]);

  function updateInFlight(taskId: string, action: DecisionAction | null) {
    setInFlightByTaskId((prev) => ({ ...prev, [taskId]: action }));
  }

  async function handleAccept(task: VoucherTaskRow) {
    if (!user) return;

    setActionError(null);
    updateInFlight(task.id, 'accept');
    try {
      const actorUserClientInstanceId = await resolveUserClientInstanceId(user.id);
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
        .in('status', VOUCHER_ACTIONABLE_STATUSES)
        .select('id');

      if (updateError) {
        Alert.alert('Could not accept task', updateError.message);
        return;
      }
      if (!updatedRows || updatedRows.length === 0) {
        Alert.alert('Task changed', 'This task is no longer waiting for your review.');
        await Promise.resolve(friendQueue.refetchQueue());
        return;
      }

      const { error: eventError } = await supabase.from('task_events').insert({
        task_id: task.id,
        event_type: 'VOUCHER_ACCEPT',
        actor_id: user.id,
        actor_user_client_instance_id: actorUserClientInstanceId,
        from_status: task.status,
        to_status: 'ACCEPTED',
      });

      if (eventError) {
        setActionError('Task accepted, but event logging failed.');
      }

      const nextUpdatedAt = new Date().toISOString();
      patchFriendQueue((current) => current.filter((candidate) => candidate.id !== task.id));
      patchFriendHistory((current) => {
        const nextTask: VouchHistoryTaskRow = {
          id: task.id,
          title: task.title,
          status: 'ACCEPTED',
          updated_at: nextUpdatedAt,
          failure_cost_cents: task.failure_cost_cents,
          user: task.user
            ? {
                id: task.user.id,
                username: task.user.username,
              }
            : null,
        };

        return [nextTask, ...current.filter((candidate) => candidate.id !== task.id)].slice(0, 10);
      });
      patchTaskDetail(task.id, (current) => ({
        ...current,
        task: current.task
          ? {
              ...current.task,
              status: 'ACCEPTED',
              proof_request_open: false,
              proof_requested_at: null,
              proof_requested_by: null,
              updated_at: nextUpdatedAt,
            }
          : current.task,
      }));
    } finally {
      updateInFlight(task.id, null);
    }
  }

  async function handleDeny(task: VoucherTaskRow) {
    if (!user) return;

    setActionError(null);
    updateInFlight(task.id, 'deny');
    try {
      const actorUserClientInstanceId = await resolveUserClientInstanceId(user.id);
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
        .in('status', VOUCHER_ACTIONABLE_STATUSES)
        .select('id');

      if (updateError) {
        Alert.alert('Could not deny task', updateError.message);
        return;
      }
      if (!updatedRows || updatedRows.length === 0) {
        Alert.alert('Task changed', 'This task is no longer waiting for your review.');
        await Promise.resolve(friendQueue.refetchQueue());
        return;
      }

      const { error: eventError } = await supabase.from('task_events').insert({
        task_id: task.id,
        event_type: 'VOUCHER_DENY',
        actor_id: user.id,
        actor_user_client_instance_id: actorUserClientInstanceId,
        from_status: task.status,
        to_status: 'DENIED',
      });

      if (eventError) {
        setActionError('Task denied, but event logging failed.');
      }

      const nextUpdatedAt = new Date().toISOString();
      patchFriendQueue((current) => current.filter((candidate) => candidate.id !== task.id));
      patchFriendHistory((current) => {
        const nextTask: VouchHistoryTaskRow = {
          id: task.id,
          title: task.title,
          status: 'DENIED',
          updated_at: nextUpdatedAt,
          failure_cost_cents: task.failure_cost_cents,
          user: task.user
            ? {
                id: task.user.id,
                username: task.user.username,
              }
            : null,
        };

        return [nextTask, ...current.filter((candidate) => candidate.id !== task.id)].slice(0, 10);
      });
      patchTaskDetail(task.id, (current) => ({
        ...current,
        task: current.task
          ? {
              ...current.task,
              status: 'DENIED',
              proof_request_open: false,
              proof_requested_at: null,
              proof_requested_by: null,
              updated_at: nextUpdatedAt,
            }
          : current.task,
      }));
    } finally {
      updateInFlight(task.id, null);
    }
  }

  async function handleRequestProof(task: VoucherTaskRow) {
    if (!user) return;

    setActionError(null);
    updateInFlight(task.id, 'proof');
    try {
      const actorUserClientInstanceId = await resolveUserClientInstanceId(user.id);
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
        .in('status', VOUCHER_ACTIONABLE_STATUSES)
        .select('id');

      if (updateError) {
        Alert.alert('Could not request proof', updateError.message);
        return;
      }
      if (!updatedRows || updatedRows.length === 0) {
        Alert.alert('Task changed', 'This task is no longer awaiting voucher response.');
        await Promise.resolve(friendQueue.refetchQueue());
        return;
      }

      const { error: eventError } = await supabase.from('task_events').insert({
        task_id: task.id,
        event_type: 'PROOF_REQUESTED',
        actor_id: user.id,
        actor_user_client_instance_id: actorUserClientInstanceId,
        from_status: task.status,
        to_status: task.status,
      });

      if (eventError) {
        setActionError('Proof requested, but event logging failed.');
      }

      patchFriendQueue((current) =>
        current.map((candidate) => (
          candidate.id === task.id
            ? { ...candidate, proof_request_open: true }
            : candidate
        )),
      );
      patchTaskDetail(task.id, (current) => ({
        ...current,
        task: current.task
          ? {
              ...current.task,
              proof_request_open: true,
              proof_requested_at: nowIso,
              proof_requested_by: user.id,
              updated_at: nowIso,
            }
          : current.task,
      }));
    } finally {
      updateInFlight(task.id, null);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        {isSearchOpen ? (
          <Animated.View
            style={[
              styles.searchBarWrap,
              { width: searchAnim.interpolate({ inputRange: [0, 1], outputRange: [0, searchBarWidth] }) },
            ]}
          >
            <View style={styles.searchBar}>
              <Feather name="search" size={15} color={colors.textMuted} />
              <TextInput
                ref={searchInputRef}
                style={styles.searchInput}
                placeholder="Search tasks..."
                placeholderTextColor={colors.textSubtle}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
                  <Feather name="x-circle" size={15} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          </Animated.View>
        ) : (
          <Text style={styles.headerTitle} numberOfLines={1}>Friends</Text>
        )}
        <TouchableOpacity
          style={styles.searchToggle}
          onPress={isSearchOpen ? closeSearch : openSearch}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={isSearchOpen ? 'Close search' : 'Search tasks'}
        >
          <Feather name={isSearchOpen ? 'x' : 'search'} size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.accentCyan} />
          <Text style={styles.helperText}>Loading friend activity…</Text>
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
                Promise.all([
                  friendQueue.refetchQueue(),
                  historyOpen ? friendQueue.refetchHistory() : Promise.resolve(),
                ]).finally(() => setRefreshing(false));
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

          {!hasPrimaryTasks ? (
            <View style={styles.emptyInlineState}>
              <Feather name={error ? 'alert-circle' : 'users'} size={22} color={error ? colors.warning : colors.textSubtle} />
              <Text style={styles.helperTitle}>{error ? 'Could not load friend activity' : 'Nothing to watch yet'}</Text>
              <Text style={styles.helperText}>
                {error ? error : 'Active tasks from your friends will appear here when they are shared with you.'}
              </Text>
            </View>
          ) : null}

          {awaitingVoucherTasks.map((task) => {
            const inFlightAction = inFlightByTaskId[task.id] ?? null;

            return (
              <View key={task.id} style={styles.taskRow}>
                <View style={styles.taskMain}>
                  <Text style={styles.taskTitle} numberOfLines={1}>
                    {task.title}
                  </Text>
                  <View style={styles.taskMetaRow}>
                    <Text style={styles.taskMetaUser} numberOfLines={1}>
                      {(task.user?.username ?? 'Unknown owner').toLowerCase()}
                    </Text>
                    <StatusPill status={task.status} />
                  </View>
                  {task.proof_request_open && !task.has_proof ? (
                    <Text style={styles.proofRequested}>Proof requested</Text>
                  ) : null}

                  {/* Inline proof preview */}
                  {task.proof ? (
                    task.proof.mediaKind === 'image' ? (
                      <TouchableOpacity
                        style={[styles.proofPreviewWrap, { width: proofPreviewWidth }]}
                        onPress={() => setLightboxProof(task.proof)}
                        activeOpacity={0.9}
                      >
                        <Image
                          source={{ uri: task.proof.signedUrl }}
                          style={styles.proofPreviewImage}
                          resizeMode="cover"
                        />
                        {task.proof.overlayTimestampText ? (
                          <View style={styles.proofTimestampWrap}>
                            <Text style={styles.proofTimestampText}>
                              {task.proof.overlayTimestampText}
                            </Text>
                          </View>
                        ) : null}
                        <View style={styles.proofExpandHint}>
                          <Feather name="maximize-2" size={12} color="rgba(255,255,255,0.7)" />
                        </View>
                      </TouchableOpacity>
                    ) : (
                      <VideoProofPlayer
                        signedUrl={task.proof.signedUrl}
                        overlayTimestampText={task.proof.overlayTimestampText}
                        width={proofPreviewWidth}
                      />
                    )
                  ) : null}
                </View>
                <View style={styles.actions}>
                  <ActionButton
                    icon="check"
                    label="Accept"
                    color={colors.success}
                    backgroundColor={colors.successMuted}
                    disabled={Boolean(inFlightAction)}
                    loading={inFlightAction === 'accept'}
                    onPress={() => { void handleAccept(task); }}
                  />
                  <ActionButton
                    icon="x"
                    label="Deny"
                    color={colors.destructive}
                    backgroundColor={colors.destructiveMuted}
                    disabled={Boolean(inFlightAction)}
                    loading={inFlightAction === 'deny'}
                    onPress={() => { void handleDeny(task); }}
                  />
                  {VOUCHER_ACTIONABLE_STATUSES.includes(task.status) ? (
                    <ActionButton
                      icon="help-circle"
                      label="Request proof"
                      color={colors.warning}
                      backgroundColor={task.proof_request_open ? '#4A3411' : '#33230C'}
                      disabled={Boolean(inFlightAction)}
                      loading={inFlightAction === 'proof'}
                      onPress={() => { void handleRequestProof(task); }}
                    />
                  ) : null}
                </View>
              </View>
            );
          })}

          {activeTasks.map((task) => (
            <View key={task.id} style={styles.taskRow}>
              <View style={styles.taskMain}>
                <Text style={styles.taskTitle} numberOfLines={1}>
                  {task.title}
                </Text>
                <View style={styles.taskMetaRow}>
                  <Text style={styles.taskMetaUser} numberOfLines={1}>
                    {(task.user?.username ?? 'Unknown owner').toLowerCase()}
                  </Text>
                  <StatusPill status={task.status} />
                </View>
              </View>
            </View>
          ))}

          <View>
            <Pressable
              style={styles.sectionHeader}
              onPress={() => {
                const next = !historyOpen;
                setHistoryOpen(next);
                if (next && historyTasks.length === 0 && !historyLoading) {
                  void friendQueue.refetchHistory();
                }
              }}
            >
              <Feather name={historyOpen ? 'chevron-down' : 'chevron-right'} size={16} color={colors.textMuted} />
              <Text style={styles.sectionTitle}>Vouch History</Text>
            </Pressable>

            {historyOpen ? (
              <View style={styles.historySection}>
                {historyLoading ? (
                  <View style={styles.historyState}>
                    <ActivityIndicator size="small" color={colors.accentCyan} />
                    <Text style={styles.helperText}>Loading vouch history…</Text>
                  </View>
                ) : historyError ? (
                  <View style={styles.historyState}>
                    <Text style={styles.errorText}>{historyError}</Text>
                  </View>
                ) : historyTasks.length === 0 ? (
                  <View style={styles.historyState}>
                    <Text style={styles.helperText}>
                      {searchQuery.trim() ? 'No matching tasks in vouch history.' : 'No vouch history yet.'}
                    </Text>
                  </View>
                ) : (
                  <>
                    {(() => {
                    const currentPeriod = new Date().toISOString().slice(0, 7);
                    return historyTasks.map((task) => {
                      const failedPeriod  = new Date(task.updated_at).toISOString().slice(0, 7);
                      const canRectify    = (task.status === 'DENIED' || task.status === 'MISSED') && failedPeriod === currentPeriod;
                      const isRectifying  = Boolean(inFlightRectifyByTaskId[task.id]);

                      return (
                        <TouchableOpacity
                          key={task.id}
                          style={styles.taskRow}
                          activeOpacity={0.75}
                          onPress={() => router.push({ pathname: '/tasks/[id]' as any, params: { id: task.id, back: 'friends' } })}
                          accessibilityRole="button"
                          accessibilityLabel={task.title}
                        >
                          <View style={styles.taskMain}>
                            <Text style={styles.taskTitle} numberOfLines={1}>
                              {task.title}
                            </Text>
                            <View style={styles.taskMetaRow}>
                              <Text style={styles.taskMetaUser} numberOfLines={1}>
                                {(task.user?.username ?? 'Unknown owner').toLowerCase()}
                              </Text>
                              <StatusPill status={task.status} />
                            </View>
                          </View>
                          {canRectify ? (
                            <TouchableOpacity
                              style={[styles.rectifyBtn, isRectifying && styles.actionButtonDisabled]}
                              onPress={(e) => { e.stopPropagation(); void handleRectify(task); }}
                              disabled={isRectifying}
                              activeOpacity={0.75}
                              accessibilityRole="button"
                              accessibilityLabel="Rectify task"
                            >
                              {isRectifying
                                ? <ActivityIndicator size="small" color="#22C55E" />
                                : <Text style={styles.rectifyBtnText}>Rectify</Text>
                              }
                            </TouchableOpacity>
                          ) : (
                            <Feather name="external-link" size={15} color={colors.textMuted} />
                          )}
                        </TouchableOpacity>
                      );
                    });
                    })()}
                    {historyHasMore ? (
                      <TouchableOpacity
                        style={[styles.loadMoreButton, historyLoadingMore && styles.actionButtonDisabled]}
                        onPress={() => { void friendQueue.refetchHistory(); }}
                        disabled={historyLoadingMore}
                        activeOpacity={0.8}
                      >
                        {historyLoadingMore ? (
                          <ActivityIndicator size="small" color={colors.textMuted} />
                        ) : (
                          <Text style={styles.loadMoreText}>Load 10 more</Text>
                        )}
                      </TouchableOpacity>
                    ) : null}
                  </>
                )}
              </View>
            ) : null}
          </View>
        </ScrollView>
      )}

      {/* Fullscreen image lightbox */}
      <Modal
        visible={lightboxProof !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setLightboxProof(null)}
      >
        <Pressable style={styles.lightboxBackdrop} onPress={() => setLightboxProof(null)}>
          {lightboxProof ? (
            <View style={styles.lightboxContent}>
              <Image
                source={{ uri: lightboxProof.signedUrl }}
                style={styles.lightboxImage}
                resizeMode="contain"
              />
              {lightboxProof.overlayTimestampText ? (
                <View style={styles.lightboxTimestampWrap}>
                  <Text style={styles.lightboxTimestampText}>
                    {lightboxProof.overlayTimestampText}
                  </Text>
                </View>
              ) : null}
              <TouchableOpacity
                style={styles.lightboxCloseBtn}
                onPress={() => setLightboxProof(null)}
                activeOpacity={0.8}
              >
                <Feather name="x" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  headerTitle: {
    flex: 1,
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: colors.text,
    letterSpacing: -0.5,
  },
  searchToggle: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  searchBarWrap: {
    flex: 1,
    overflow: 'hidden',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    paddingHorizontal: spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: typography.sm,
    paddingVertical: 0,
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
  emptyInlineState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
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
    fontSize: 18,
    color: colors.text,
    lineHeight: 27,
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

  // Proof preview
  proofPreviewWrap: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    overflow: 'hidden',
    height: 200,
    backgroundColor: colors.surface2,
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
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  proofTimestampWrap: {
    position: 'absolute',
    bottom: 8,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
  },
  proofTimestampText: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: '#ffb347',
    letterSpacing: 0.12 * 10,
  },
  proofExpandHint: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 4,
    padding: 4,
  },

  // Lightbox
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxContent: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightboxImage: {
    width: '100%',
    height: '85%',
  },
  lightboxTimestampWrap: {
    position: 'absolute',
    bottom: 48,
    right: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  lightboxTimestampText: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '700',
    color: '#ffb347',
    letterSpacing: 0.12 * 13,
  },
  lightboxCloseBtn: {
    position: 'absolute',
    top: 48,
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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
  historySection: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  historyState: {
    paddingVertical: spacing.sm,
  },
  rectifyBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.4)',
    backgroundColor: 'rgba(34,197,94,0.12)',
    minWidth: 62,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rectifyBtnText: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
    color: '#22C55E',
  },
  loadMoreButton: {
    minHeight: 42,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  loadMoreText: {
    fontSize: typography.sm,
    color: colors.text,
    fontWeight: typography.semibold,
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
