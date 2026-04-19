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
import { purgeTaskProofForFinalState } from '@/lib/task-proof-upload';
import { VOUCHER_ACTIONABLE_STATUSES } from '@/lib/constants/task-status';
import { useFriendQueue, type VoucherTaskRow, type VouchHistoryTaskRow } from '@/lib/hooks/useFriendQueue';
import type { TaskDetailData } from '@/lib/hooks/useTaskDetail';

// ─── Types ────────────────────────────────────────────────────────────────────

type DecisionAction = 'accept' | 'deny' | 'proof';
type TabView = 'pending' | 'history';

interface TaskProof {
  signedUrl: string;
  mediaKind: 'image' | 'video';
  overlayTimestampText: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatCost(cents: number, currency = 'EUR'): string {
  const symbol = currency === 'USD' ? '$' : currency === 'INR' ? '₹' : '€';
  const amount = cents / 100;
  return amount === Math.floor(amount) ? `${symbol}${amount}` : `${symbol}${amount.toFixed(2)}`;
}

// Shows time remaining until voucher review window closes.
// Returns e.g. "47h 23m", "1d 3h", "overdue".
function formatVoucherDeadline(deadline: string | null): string {
  if (!deadline) return '—';
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return 'overdue';
  const totalMins = Math.floor(diff / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hrs < 24) return `${hrs}h ${mins}m`;
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return `${days}d ${remHrs}h`;
}

const AVATAR_PALETTE = [
  '#7C3AED', '#2563EB', '#059669', '#B45309',
  '#DC2626', '#0891B2', '#7E22CE', '#065F46',
];

function getAvatarColor(username: string): string {
  let h = 0;
  for (let i = 0; i < username.length; i++) {
    h = (h * 31 + username.charCodeAt(i)) & 0x7fffffff;
  }
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function getInitials(username: string): string {
  const t = username.trim();
  if (!t) return '?';
  const parts = t.split(/[\s_.-]+/);
  if (parts.length >= 2 && parts[1]) return (parts[0][0] + parts[1][0]).toUpperCase();
  return t.slice(0, 2).toUpperCase();
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function FriendAvatar({ username, size = 34 }: { username: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: getAvatarColor(username) }]}>
      <Text style={[styles.avatarText, { fontSize: Math.round(size * 0.38) }]}>
        {getInitials(username)}
      </Text>
    </View>
  );
}

// ─── Geometric placeholder ────────────────────────────────────────────────────

function GeometricPlaceholder({ seed }: { seed: string }) {
  const hue = (seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0) * 137) % 360;
  const bg = `hsl(${hue}, 22%, 12%)`;
  const accent = `hsl(${(hue + 60) % 360}, 28%, 22%)`;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: bg, overflow: 'hidden' }]}>
      <View style={[styles.geoCircle, { width: 120, height: 120, borderRadius: 60, backgroundColor: accent, top: -30, right: -20 }]} />
      <View style={[styles.geoCircle, { width: 80, height: 80, borderRadius: 40, backgroundColor: accent, bottom: -20, left: 20, opacity: 0.5 }]} />
      <View style={[styles.geoLine, { backgroundColor: accent, transform: [{ rotate: '-35deg' }], top: '40%' }]} />
      <View style={styles.geoIconWrap}>
        <Feather name="image" size={22} color="rgba(255,255,255,0.10)" />
      </View>
    </View>
  );
}

// ─── Video player ─────────────────────────────────────────────────────────────

function VideoProofPlayer({ signedUrl, overlayTimestampText }: { signedUrl: string; overlayTimestampText: string }) {
  const player = useVideoPlayer(signedUrl, (p) => { p.loop = false; p.muted = false; });
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const sub = player.addListener('playingChange', (e) => setPlaying(e.isPlaying));
    return () => sub.remove();
  }, [player]);

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={() => { if (playing) { player.pause(); } else { player.play(); } }}>
      <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} />
      {!playing && (
        <View style={styles.videoPlayOverlay}>
          <Feather name="play-circle" size={38} color="rgba(255,255,255,0.9)" />
        </View>
      )}
      {overlayTimestampText ? (
        <View style={styles.timestampWrap}>
          <Text style={styles.timestampText}>{overlayTimestampText}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// ─── Media box ────────────────────────────────────────────────────────────────

function MediaBox({ proof, taskId, onExpand }: { proof: TaskProof | null; taskId: string; onExpand: () => void }) {
  const filename = proof ? (proof.mediaKind === 'video' ? 'proof_video.mp4' : 'proof_photo.jpg') : null;

  return (
    <View style={styles.mediaBox}>
      {proof ? (
        <>
          {proof.mediaKind === 'image' ? (
            <Image source={{ uri: proof.signedUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <VideoProofPlayer signedUrl={proof.signedUrl} overlayTimestampText={proof.overlayTimestampText} />
          )}
          {proof.overlayTimestampText && proof.mediaKind === 'image' ? (
            <View style={styles.timestampWrap}>
              <Text style={styles.timestampText}>{proof.overlayTimestampText}</Text>
            </View>
          ) : null}
          {filename ? (
            <View style={styles.mediaFilenameTag}>
              <Feather name="file" size={9} color="rgba(255,255,255,0.65)" />
              <Text style={styles.mediaFilenameText}>{filename}</Text>
            </View>
          ) : null}
          <TouchableOpacity style={styles.mediaExpandBtn} onPress={onExpand} activeOpacity={0.8}>
            <Feather name="maximize-2" size={13} color="rgba(255,255,255,0.85)" />
          </TouchableOpacity>
        </>
      ) : (
        <GeometricPlaceholder seed={taskId} />
      )}
    </View>
  );
}

// ─── Segmented control ────────────────────────────────────────────────────────

function SegmentedControl({
  labels,
  activeIndex,
  badge,
  onSelect,
}: {
  labels: string[];
  activeIndex: number;
  badge?: number;
  onSelect: (i: number) => void;
}) {
  return (
    <View style={styles.segControl}>
      {labels.map((label, i) => (
        <TouchableOpacity
          key={label}
          style={[styles.segOption, i === activeIndex && styles.segOptionActive]}
          onPress={() => onSelect(i)}
          activeOpacity={0.8}
        >
          <Text style={[styles.segLabel, i === activeIndex && styles.segLabelActive]}>{label}</Text>
          {i === 0 && badge != null && badge > 0 ? (
            <View style={styles.segBadge}>
              <Text style={styles.segBadgeText}>{badge > 99 ? '99+' : badge}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Deck action buttons ──────────────────────────────────────────────────────

function DeckActions({
  task,
  inFlightAction,
  isActionable,
  hasNext,
  onAccept,
  onDeny,
  onProof,
  onNext,
}: {
  task: VoucherTaskRow;
  inFlightAction: DecisionAction | null;
  isActionable: boolean;
  hasNext: boolean;
  onAccept: () => void;
  onDeny: () => void;
  onProof: () => void;
  onNext: () => void;
}) {
  const busy = Boolean(inFlightAction);
  const dimmed = !isActionable;

  return (
    <View style={styles.actionsRow}>
      {/* Accept */}
      <TouchableOpacity
        style={[styles.actionBtn, styles.actionBtnAccept, (busy || dimmed) && styles.actionBtnDisabled]}
        onPress={onAccept}
        disabled={busy || dimmed}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Accept task"
      >
        {inFlightAction === 'accept'
          ? <ActivityIndicator size="small" color="#34D399" />
          : <Feather name="check" size={22} color="#34D399" />}
      </TouchableOpacity>

      {/* Deny */}
      <TouchableOpacity
        style={[styles.actionBtn, styles.actionBtnDeny, (busy || dimmed) && styles.actionBtnDisabled]}
        onPress={onDeny}
        disabled={busy || dimmed}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Deny task"
      >
        {inFlightAction === 'deny'
          ? <ActivityIndicator size="small" color="#F87171" />
          : <Feather name="x" size={22} color="#F87171" />}
      </TouchableOpacity>

      {/* Clarify / request proof */}
      <TouchableOpacity
        style={[styles.actionBtn, styles.actionBtnClarify, (busy || dimmed) && styles.actionBtnDisabled, task.proof_request_open && styles.actionBtnClarifyActive]}
        onPress={onProof}
        disabled={busy || dimmed}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Request proof"
      >
        {inFlightAction === 'proof'
          ? <ActivityIndicator size="small" color="#FBBF24" />
          : <Feather name="help-circle" size={22} color="#FBBF24" />}
      </TouchableOpacity>

      {/* Next card — always present so all 4 columns stay equal */}
      <TouchableOpacity
        style={[styles.actionBtn, styles.actionBtnNext, !hasNext && styles.actionBtnHidden]}
        onPress={onNext}
        disabled={!hasNext}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Next task in deck"
      >
        <Feather name="chevron-right" size={20} color={hasNext ? colors.textMuted : 'transparent'} />
      </TouchableOpacity>
    </View>
  );
}

// ─── Friend deck ──────────────────────────────────────────────────────────────

function FriendDeck({
  friendId,
  friend,
  tasks,
  activeIndex,
  slideAnim,
  inFlightByTaskId,
  onAccept,
  onDeny,
  onProof,
  onCycle,
  onExpand,
}: {
  friendId: string;
  friend: VoucherTaskRow['user'];
  tasks: VoucherTaskRow[];
  activeIndex: number;
  slideAnim: Animated.Value;
  inFlightByTaskId: Record<string, DecisionAction | null>;
  onAccept: (t: VoucherTaskRow) => void;
  onDeny: (t: VoucherTaskRow) => void;
  onProof: (t: VoucherTaskRow) => void;
  onCycle: (id: string) => void;
  onExpand: (proof: TaskProof) => void;
}) {
  const task = tasks[activeIndex];
  if (!task) return null;

  const total = tasks.length;
  const isActionable = VOUCHER_ACTIONABLE_STATUSES.includes(task.status);
  const inFlight = inFlightByTaskId[task.id] ?? null;
  const username = friend?.username ?? 'Unknown';

  // Derive opacity from absolute distance from centre so both exit and enter fade naturally
  const opacity = slideAnim.interpolate({
    inputRange: [-60, 0, 60],
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.deckOuter}>
      {/* Stacked ghost cards */}
      {total > 2 && <View style={styles.ghostCard3} />}
      {total > 1 && <View style={styles.ghostCard2} />}
      <View style={styles.ghostCard1} />

      {/* Clip wrapper so the slide stays within card bounds */}
      <View style={styles.deckClip}>
      {/* Main animated card */}
      <Animated.View style={[styles.mainCard, { opacity, transform: [{ translateX: slideAnim }] }]}>
        {/* Card header */}
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <FriendAvatar username={username} size={32} />
            <View style={styles.cardHeaderMeta}>
              <Text style={styles.cardFriendName}>{username.toLowerCase()}</Text>
              <Text style={styles.cardSubmittedTime}>{timeAgo(task.updated_at)}</Text>
            </View>
          </View>
          <StatusPill status={task.status} />
        </View>

        {/* Media */}
        <MediaBox
          proof={task.proof}
          taskId={task.id}
          onExpand={() => { if (task.proof) onExpand(task.proof); }}
        />

        {/* Task info */}
        <View style={styles.cardBody}>
          <Text style={styles.cardTaskTitle} numberOfLines={3}>{task.title}</Text>

          <View style={styles.cardChips}>
            {task.failure_cost_cents > 0 && (
              <View style={styles.chip}>
                <Text style={[styles.chipText, { color: '#FBBF24', fontFamily: 'monospace' }]}>
                  {formatCost(task.failure_cost_cents, task.user?.currency)}
                </Text>
              </View>
            )}
            <View style={styles.chip}>
              <Feather name="clock" size={11} color={colors.textMuted} />
              <Text style={[styles.chipText, { fontFamily: 'monospace' }]}>
                {formatVoucherDeadline(task.voucher_response_deadline)}
              </Text>
            </View>
          </View>

          {task.proof_request_open && !task.has_proof ? (
            <View style={styles.proofReqBadge}>
              <Feather name="alert-circle" size={11} color={colors.warning} />
              <Text style={styles.proofReqText}>Proof requested</Text>
            </View>
          ) : null}
        </View>

        {/* Divider */}
        <View style={styles.cardDivider} />

        {/* Actions */}
        <DeckActions
          task={task}
          inFlightAction={inFlight}
          isActionable={isActionable}
          hasNext={total > 1}
          onAccept={() => onAccept(task)}
          onDeny={() => onDeny(task)}
          onProof={() => onProof(task)}
          onNext={() => onCycle(friendId)}
        />
      </Animated.View>
      </View>
    </View>
  );
}

// ─── History row ──────────────────────────────────────────────────────────────

function HistoryRow({
  task,
  isRectifying,
  canRectify,
  onPress,
  onRectify,
}: {
  task: VouchHistoryTaskRow;
  isRectifying: boolean;
  canRectify: boolean;
  onPress: () => void;
  onRectify: () => void;
}) {
  const username = task.user?.username ?? 'Unknown';
  return (
    <TouchableOpacity style={styles.historyRow} activeOpacity={0.75} onPress={onPress} accessibilityRole="button">
      <FriendAvatar username={username} size={28} />
      <View style={styles.historyRowBody}>
        <Text style={styles.historyTaskTitle} numberOfLines={1}>{task.title}</Text>
        <Text style={styles.historyTaskMeta} numberOfLines={1}>
          {username.toLowerCase()} · {timeAgo(task.updated_at)}
        </Text>
      </View>
      <View style={styles.historyRowRight}>
        <StatusPill status={task.status} />
        {canRectify ? (
          <TouchableOpacity
            style={[styles.rectifyBtn, isRectifying && { opacity: 0.55 }]}
            onPress={(e) => { e.stopPropagation(); onRectify(); }}
            disabled={isRectifying}
            activeOpacity={0.75}
          >
            {isRectifying
              ? <ActivityIndicator size="small" color="#22C55E" />
              : <Text style={styles.rectifyBtnText}>Rectify</Text>}
          </TouchableOpacity>
        ) : (
          <Feather name="chevron-right" size={15} color={colors.textSubtle} />
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FriendsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { width: screenWidth } = useWindowDimensions();
  const [searchQuery] = useState('');
  const friendQueue = useFriendQueue(user?.id, searchQuery);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inFlightByTaskId, setInFlightByTaskId] = useState<Record<string, DecisionAction | null>>({});
  const [inFlightRectifyByTaskId, setInFlightRectifyByTaskId] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<TabView>('pending');
  const [deckIndices, setDeckIndices] = useState<Record<string, number>>({});
  const deckSlideAnims = useRef<Record<string, Animated.Value>>({});
  const [lightboxProof, setLightboxProof] = useState<TaskProof | null>(null);

  const tasks = friendQueue.tasks;
  const historyTasks = friendQueue.historyTasks;
  const loading = friendQueue.loading;
  const historyLoading = friendQueue.historyLoading;
  const historyHasMore = friendQueue.historyHasMore;
  const error = actionError ?? friendQueue.error;
  const historyError = friendQueue.historyError;

  const awaitingVoucherTasks = useMemo(
    () => tasks.filter((t) => VOUCHER_ACTIONABLE_STATUSES.includes(t.status)),
    [tasks],
  );

  // Group only actionable tasks by friend for deck layout
  const decksByFriend = useMemo(() => {
    const map = new Map<string, { friend: VoucherTaskRow['user']; tasks: VoucherTaskRow[] }>();
    for (const task of awaitingVoucherTasks) {
      const key = task.user?.id ?? 'unknown';
      if (!map.has(key)) map.set(key, { friend: task.user, tasks: [] });
      map.get(key)!.tasks.push(task);
    }
    return Array.from(map.entries()).map(([friendId, group]) => ({ friendId, ...group }));
  }, [awaitingVoucherTasks]);

  function getDeckSlideAnim(friendId: string): Animated.Value {
    if (!deckSlideAnims.current[friendId]) {
      deckSlideAnims.current[friendId] = new Animated.Value(0);
    }
    return deckSlideAnims.current[friendId];
  }

  function cycleDeck(friendId: string) {
    const group = decksByFriend.find((d) => d.friendId === friendId);
    if (!group || group.tasks.length < 2) return;
    const current = deckIndices[friendId] ?? 0;
    const next = (current + 1) % group.tasks.length;
    const anim = getDeckSlideAnim(friendId);
    // Slide current card out to the left
    Animated.timing(anim, { toValue: -60, duration: 180, useNativeDriver: true }).start(() => {
      // Snap to right side, update index, then spring in from right
      anim.setValue(60);
      setDeckIndices((prev) => ({ ...prev, [friendId]: next }));
      Animated.spring(anim, { toValue: 0, tension: 75, friction: 10, useNativeDriver: true }).start();
    });
  }

  function updateInFlight(taskId: string, action: DecisionAction | null) {
    setInFlightByTaskId((prev) => ({ ...prev, [taskId]: action }));
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
      (current) => ({ tasks: updater(current?.tasks ?? []), hasMore: current?.hasMore ?? false }),
    );
  }

  function patchTaskDetail(taskId: string, updater: (current: TaskDetailData) => TaskDetailData) {
    queryClient.setQueryData<TaskDetailData>(
      queryKeys.taskDetail(taskId),
      (current) => (current ? updater(current) : current),
    );
  }

  async function handleAccept(task: VoucherTaskRow) {
    if (!user) return;
    setActionError(null);
    updateInFlight(task.id, 'accept');
    const nextUpdatedAt = new Date().toISOString();
    const queueKey = queryKeys.friendQueue(user.id);
    const historyKey = queryKeys.friendHistory(user.id, searchQuery);
    const detailKey = queryKeys.taskDetail(task.id);
    const prevQueue = queryClient.getQueryData<VoucherTaskRow[]>(queueKey);
    const prevHistory = queryClient.getQueryData<{ tasks: VouchHistoryTaskRow[]; hasMore: boolean }>(historyKey);
    const prevDetail = queryClient.getQueryData<TaskDetailData>(detailKey);

    patchFriendQueue((c) => c.filter((t) => t.id !== task.id));
    patchFriendHistory((c) => {
      const next: VouchHistoryTaskRow = {
        id: task.id, title: task.title, status: 'ACCEPTED', updated_at: nextUpdatedAt,
        failure_cost_cents: task.failure_cost_cents,
        user: task.user ? { id: task.user.id, username: task.user.username } : null,
      };
      return [next, ...c.filter((t) => t.id !== task.id)].slice(0, 10);
    });
    patchTaskDetail(task.id, (c) => ({
      ...c,
      task: c.task ? { ...c.task, status: 'ACCEPTED', has_proof: false, proof_request_open: false, proof_requested_at: null, proof_requested_by: null, updated_at: nextUpdatedAt } : c.task,
      proof: null,
    }));

    try {
      const instanceId = await resolveUserClientInstanceId(user.id);
      const { data: rows, error: updateError } = await supabase
        .from('tasks')
        .update({ status: 'ACCEPTED', proof_request_open: false, proof_requested_at: null, proof_requested_by: null, updated_at: nextUpdatedAt })
        .eq('id', task.id).eq('voucher_id', user.id).in('status', VOUCHER_ACTIONABLE_STATUSES)
        .select('id');

      if (updateError) {
        if (prevQueue) queryClient.setQueryData(queueKey, prevQueue);
        if (prevHistory) queryClient.setQueryData(historyKey, prevHistory);
        if (prevDetail) queryClient.setQueryData(detailKey, prevDetail);
        Alert.alert('Could not accept task', updateError.message); return;
      }
      if (!rows || rows.length === 0) {
        if (prevQueue) queryClient.setQueryData(queueKey, prevQueue);
        if (prevHistory) queryClient.setQueryData(historyKey, prevHistory);
        if (prevDetail) queryClient.setQueryData(detailKey, prevDetail);
        Alert.alert('Task changed', 'This task is no longer waiting for your review.');
        await Promise.resolve(friendQueue.refetchQueue()); return;
      }

      const { error: eventError } = await supabase.from('task_events').insert({
        task_id: task.id, event_type: 'VOUCHER_ACCEPT', actor_id: user.id,
        actor_user_client_instance_id: instanceId, from_status: task.status, to_status: 'ACCEPTED',
      });
      if (eventError) setActionError('Task accepted, but event logging failed.');

      const purge = await purgeTaskProofForFinalState(task.id);
      if (!purge.success) setActionError(`Task accepted, but proof cleanup failed: ${purge.error}`);
    } finally {
      updateInFlight(task.id, null);
    }
  }

  async function handleDeny(task: VoucherTaskRow) {
    if (!user) return;
    setActionError(null);
    updateInFlight(task.id, 'deny');
    const nextUpdatedAt = new Date().toISOString();
    const queueKey = queryKeys.friendQueue(user.id);
    const historyKey = queryKeys.friendHistory(user.id, searchQuery);
    const detailKey = queryKeys.taskDetail(task.id);
    const prevQueue = queryClient.getQueryData<VoucherTaskRow[]>(queueKey);
    const prevHistory = queryClient.getQueryData<{ tasks: VouchHistoryTaskRow[]; hasMore: boolean }>(historyKey);
    const prevDetail = queryClient.getQueryData<TaskDetailData>(detailKey);

    patchFriendQueue((c) => c.filter((t) => t.id !== task.id));
    patchFriendHistory((c) => {
      const next: VouchHistoryTaskRow = {
        id: task.id, title: task.title, status: 'DENIED', updated_at: nextUpdatedAt,
        failure_cost_cents: task.failure_cost_cents,
        user: task.user ? { id: task.user.id, username: task.user.username } : null,
      };
      return [next, ...c.filter((t) => t.id !== task.id)].slice(0, 10);
    });
    patchTaskDetail(task.id, (c) => ({
      ...c,
      task: c.task ? { ...c.task, status: 'DENIED', has_proof: false, proof_request_open: false, proof_requested_at: null, proof_requested_by: null, updated_at: nextUpdatedAt } : c.task,
      proof: null,
    }));

    try {
      const instanceId = await resolveUserClientInstanceId(user.id);
      const { data: rows, error: updateError } = await supabase
        .from('tasks')
        .update({ status: 'DENIED', proof_request_open: false, proof_requested_at: null, proof_requested_by: null, updated_at: nextUpdatedAt })
        .eq('id', task.id).eq('voucher_id', user.id).in('status', VOUCHER_ACTIONABLE_STATUSES)
        .select('id');

      if (updateError) {
        if (prevQueue) queryClient.setQueryData(queueKey, prevQueue);
        if (prevHistory) queryClient.setQueryData(historyKey, prevHistory);
        if (prevDetail) queryClient.setQueryData(detailKey, prevDetail);
        Alert.alert('Could not deny task', updateError.message); return;
      }
      if (!rows || rows.length === 0) {
        if (prevQueue) queryClient.setQueryData(queueKey, prevQueue);
        if (prevHistory) queryClient.setQueryData(historyKey, prevHistory);
        if (prevDetail) queryClient.setQueryData(detailKey, prevDetail);
        Alert.alert('Task changed', 'This task is no longer waiting for your review.');
        await Promise.resolve(friendQueue.refetchQueue()); return;
      }

      const { error: eventError } = await supabase.from('task_events').insert({
        task_id: task.id, event_type: 'VOUCHER_DENY', actor_id: user.id,
        actor_user_client_instance_id: instanceId, from_status: task.status, to_status: 'DENIED',
      });
      if (eventError) setActionError('Task denied, but event logging failed.');

      const purge = await purgeTaskProofForFinalState(task.id);
      if (!purge.success) setActionError(`Task denied, but proof cleanup failed: ${purge.error}`);
    } finally {
      updateInFlight(task.id, null);
    }
  }

  async function handleRequestProof(task: VoucherTaskRow) {
    if (!user) return;
    setActionError(null);
    updateInFlight(task.id, 'proof');
    const nowIso = new Date().toISOString();
    const queueKey = queryKeys.friendQueue(user.id);
    const detailKey = queryKeys.taskDetail(task.id);
    const prevQueue = queryClient.getQueryData<VoucherTaskRow[]>(queueKey);
    const prevDetail = queryClient.getQueryData<TaskDetailData>(detailKey);

    patchFriendQueue((c) =>
      c.map((t) => t.id === task.id
        ? { ...t, proof_request_open: true, proof_requested_at: nowIso, proof_requested_by: user.id, updated_at: nowIso }
        : t),
    );
    patchTaskDetail(task.id, (c) => ({
      ...c,
      task: c.task ? { ...c.task, proof_request_open: true, proof_requested_at: nowIso, proof_requested_by: user.id, updated_at: nowIso } : c.task,
    }));

    try {
      const instanceId = await resolveUserClientInstanceId(user.id);
      const { data: rows, error: updateError } = await supabase
        .from('tasks')
        .update({ proof_request_open: true, proof_requested_at: nowIso, proof_requested_by: user.id, updated_at: nowIso })
        .eq('id', task.id).eq('voucher_id', user.id).in('status', VOUCHER_ACTIONABLE_STATUSES)
        .select('id');

      if (updateError) {
        if (prevQueue) queryClient.setQueryData(queueKey, prevQueue);
        if (prevDetail) queryClient.setQueryData(detailKey, prevDetail);
        Alert.alert('Could not request proof', updateError.message); return;
      }
      if (!rows || rows.length === 0) {
        if (prevQueue) queryClient.setQueryData(queueKey, prevQueue);
        if (prevDetail) queryClient.setQueryData(detailKey, prevDetail);
        Alert.alert('Task changed', 'This task is no longer awaiting voucher response.');
        await Promise.resolve(friendQueue.refetchQueue()); return;
      }

      const { error: eventError } = await supabase.from('task_events').insert({
        task_id: task.id, event_type: 'PROOF_REQUESTED', actor_id: user.id,
        actor_user_client_instance_id: instanceId, from_status: task.status, to_status: task.status,
      });
      if (eventError) setActionError('Proof requested, but event logging failed.');
    } finally {
      updateInFlight(task.id, null);
    }
  }

  async function handleRectify(task: VouchHistoryTaskRow) {
    if (!user || inFlightRectifyByTaskId[task.id]) return;

    const currentPeriod = new Date().toISOString().slice(0, 7);
    const failedPeriod = new Date(task.updated_at).toISOString().slice(0, 7);
    if (failedPeriod !== currentPeriod) {
      Alert.alert('Rectify expired', 'Rectify can only be authorised for tasks that failed this calendar month.');
      return;
    }

    const { count } = await supabase
      .from('rectify_passes').select('*', { count: 'exact', head: true })
      .eq('user_id', task.user?.id ?? '').eq('period', currentPeriod);

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
              const instanceId = await resolveUserClientInstanceId(user.id);
              const { error: taskErr } = await supabase.from('tasks')
                .update({ status: 'RECTIFIED' }).eq('id', task.id).eq('voucher_id', user.id);
              if (taskErr) { Alert.alert('Rectify failed', taskErr.message); return; }

              const results = await Promise.all([
                supabase.from('rectify_passes').insert({ user_id: task.user?.id, task_id: task.id, authorized_by: user.id, period: currentPeriod }),
                supabase.from('ledger_entries').insert({ user_id: task.user?.id, task_id: task.id, period: currentPeriod, amount_cents: -(task.failure_cost_cents), entry_type: 'rectified' }),
                supabase.from('task_events').insert({ task_id: task.id, event_type: 'RECTIFY', actor_id: user.id, actor_user_client_instance_id: instanceId, from_status: fromStatus, to_status: 'RECTIFIED' }),
              ]);
              const writeError = results.find((r) => r.error)?.error;
              if (writeError) { Alert.alert('Rectify partially failed', writeError.message); return; }

              const purge = await purgeTaskProofForFinalState(task.id);
              if (!purge.success) setActionError(`Rectified, but proof cleanup failed: ${purge.error}`);

              const nextUpdatedAt = new Date().toISOString();
              patchFriendHistory((c) => {
                const next: VouchHistoryTaskRow = { ...task, status: 'RECTIFIED', updated_at: nextUpdatedAt };
                return [next, ...c.filter((t) => t.id !== task.id)].slice(0, 10);
              });
              patchTaskDetail(task.id, (c) => ({
                ...c,
                task: c.task ? { ...c.task, status: 'RECTIFIED', has_proof: false, updated_at: nextUpdatedAt } : c.task,
                proof: null,
              }));
            } finally {
              setInFlightRectifyByTaskId((prev) => ({ ...prev, [task.id]: false }));
            }
          },
        },
      ],
    );
  }

  const currentPeriod = new Date().toISOString().slice(0, 7);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Friends</Text>
        <SegmentedControl
          labels={['Pending', 'History']}
          activeIndex={activeTab === 'pending' ? 0 : 1}
          badge={awaitingVoucherTasks.length}
          onSelect={(i) => {
            const tab: TabView = i === 0 ? 'pending' : 'history';
            setActiveTab(tab);
            if (tab === 'history' && historyTasks.length === 0 && !historyLoading) {
              void friendQueue.refetchHistory();
            }
          }}
        />
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
                  activeTab === 'history' ? friendQueue.refetchHistory() : Promise.resolve(),
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

          {/* ── Pending tab ── */}
          {activeTab === 'pending' ? (
            decksByFriend.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="check-circle" size={30} color={colors.textSubtle} />
                <Text style={styles.emptyTitle}>All clear</Text>
                <Text style={styles.emptyText}>
                  No pending reviews. Tasks from your friends will appear here when they need your sign-off.
                </Text>
              </View>
            ) : (
              <View style={styles.deckList}>
                {decksByFriend.map(({ friendId, friend, tasks: groupTasks }) => (
                  <FriendDeck
                    key={friendId}
                    friendId={friendId}
                    friend={friend}
                    tasks={groupTasks}
                    activeIndex={deckIndices[friendId] ?? 0}
                    slideAnim={getDeckSlideAnim(friendId)}
                    inFlightByTaskId={inFlightByTaskId}
                    onAccept={(t) => { void handleAccept(t); }}
                    onDeny={(t) => { void handleDeny(t); }}
                    onProof={(t) => { void handleRequestProof(t); }}
                    onCycle={cycleDeck}
                    onExpand={setLightboxProof}
                  />
                ))}
              </View>
            )

          ) : (
            /* ── History tab ── */
            historyLoading ? (
              <View style={styles.centerState}>
                <ActivityIndicator size="small" color={colors.accentCyan} />
                <Text style={styles.helperText}>Loading vouch history…</Text>
              </View>
            ) : historyError ? (
              <View style={styles.centerState}>
                <Text style={styles.errorText}>{historyError}</Text>
              </View>
            ) : historyTasks.length === 0 ? (
              <View style={styles.emptyState}>
                <Feather name="clock" size={30} color={colors.textSubtle} />
                <Text style={styles.emptyTitle}>No history yet</Text>
                <Text style={styles.emptyText}>Your past vouching decisions will appear here.</Text>
              </View>
            ) : (
              <View style={styles.historyList}>
                {historyTasks.map((task) => {
                  const failedPeriod = new Date(task.updated_at).toISOString().slice(0, 7);
                  const canRectify = (task.status === 'DENIED' || task.status === 'MISSED') && failedPeriod === currentPeriod;
                  return (
                    <HistoryRow
                      key={task.id}
                      task={task}
                      canRectify={canRectify}
                      isRectifying={Boolean(inFlightRectifyByTaskId[task.id])}
                      onPress={() => router.push({ pathname: '/tasks/[id]' as any, params: { id: task.id, back: 'friends' } })}
                      onRectify={() => { void handleRectify(task); }}
                    />
                  );
                })}
                {historyHasMore ? (
                  <TouchableOpacity style={styles.loadMoreBtn} onPress={() => { void friendQueue.refetchHistory(); }} activeOpacity={0.8}>
                    <Text style={styles.loadMoreText}>Load more</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )
          )}
        </ScrollView>
      )}

      {/* ── Lightbox ── */}
      <Modal visible={lightboxProof !== null} transparent animationType="fade" onRequestClose={() => setLightboxProof(null)}>
        <Pressable style={styles.lightboxBackdrop} onPress={() => setLightboxProof(null)}>
          {lightboxProof ? (
            <View style={styles.lightboxContent}>
              {lightboxProof.mediaKind === 'image' ? (
                <Image source={{ uri: lightboxProof.signedUrl }} style={styles.lightboxImage} resizeMode="contain" />
              ) : (
                <View style={{ width: screenWidth, height: '85%' }}>
                  <VideoProofPlayer signedUrl={lightboxProof.signedUrl} overlayTimestampText={lightboxProof.overlayTimestampText} />
                </View>
              )}
              {lightboxProof.overlayTimestampText && lightboxProof.mediaKind === 'image' ? (
                <View style={styles.lightboxTimestamp}>
                  <Text style={styles.lightboxTimestampText}>{lightboxProof.overlayTimestampText}</Text>
                </View>
              ) : null}
              <TouchableOpacity style={styles.lightboxCloseBtn} onPress={() => setLightboxProof(null)} activeOpacity={0.8}>
                <Feather name="x" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CARD_RADIUS = 16;
const MEDIA_HEIGHT = 186;

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: colors.text,
    letterSpacing: -0.5,
  },

  // Segmented control
  segControl: {
    flexDirection: 'row',
    backgroundColor: '#111827',
    borderRadius: 999,
    padding: 3,
    gap: 2,
  },
  segOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  segOptionActive: {
    backgroundColor: '#1E293B',
  },
  segLabel: {
    fontSize: typography.sm,
    fontWeight: typography.medium,
    color: colors.textSubtle,
  },
  segLabelActive: {
    color: colors.text,
  },
  segBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#F97316',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  segBadgeText: {
    fontSize: 10,
    fontWeight: typography.bold,
    color: '#fff',
  },

  // Body
  body: { flex: 1 },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl + spacing.lg,
  },

  // States
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  helperText: {
    color: colors.textMuted,
    fontSize: typography.sm,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  emptyTitle: {
    fontSize: typography.md,
    fontWeight: typography.semibold,
    color: colors.text,
    marginTop: 4,
  },
  emptyText: {
    fontSize: typography.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: '#221717',
    borderWidth: 1,
    borderColor: '#4A1D1D',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorText: {
    color: colors.text,
    fontSize: typography.sm,
    flex: 1,
  },

  // Avatar
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarText: {
    color: '#fff',
    fontWeight: typography.bold,
    letterSpacing: 0.5,
  },

  // Geometric placeholder
  geoCircle: {
    position: 'absolute',
    opacity: 0.7,
  },
  geoLine: {
    position: 'absolute',
    left: -20,
    right: -20,
    height: 1,
    opacity: 0.4,
  },
  geoIconWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Video
  videoPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  timestampWrap: {
    position: 'absolute',
    bottom: 8,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 3,
  },
  timestampText: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
    color: '#ffb347',
    letterSpacing: 1.2,
  },

  // Media box
  mediaBox: {
    height: MEDIA_HEIGHT,
    borderRadius: CARD_RADIUS - 2,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  mediaFilenameTag: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 5,
  },
  mediaFilenameText: {
    fontFamily: 'monospace',
    fontSize: 10,
    color: 'rgba(255,255,255,0.75)',
  },
  mediaExpandBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: 'rgba(0,0,0,0.50)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Deck layout
  deckList: {
    gap: spacing.xl,
  },
  deckOuter: {
    position: 'relative',
    paddingTop: 14,
  },
  ghostCard3: {
    position: 'absolute',
    top: 0,
    left: 12,
    right: 12,
    height: 20,
    borderRadius: CARD_RADIUS,
    backgroundColor: '#0C1623',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  ghostCard2: {
    position: 'absolute',
    top: 5,
    left: 7,
    right: 7,
    height: 20,
    borderRadius: CARD_RADIUS,
    backgroundColor: '#0F1C2C',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  ghostCard1: {
    position: 'absolute',
    top: 9,
    left: 3,
    right: 3,
    height: 20,
    borderRadius: CARD_RADIUS,
    backgroundColor: '#132032',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  mainCard: {
    backgroundColor: '#0F172A',
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden',
    // Subtle shadow for depth
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },

  // Card header
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  cardHeaderMeta: {
    flex: 1,
  },
  cardFriendName: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: colors.text,
    letterSpacing: -0.2,
  },
  cardSubmittedTime: {
    fontSize: typography.xs,
    color: colors.textMuted,
    fontFamily: 'monospace',
    marginTop: 1,
  },
  submittedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(217, 119, 6, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(217, 119, 6, 0.30)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  submittedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D97706',
  },
  submittedPillText: {
    fontSize: 11,
    fontWeight: typography.semibold,
    color: '#D97706',
    letterSpacing: 0.3,
  },

  // Card body
  cardBody: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  cardTaskTitle: {
    fontSize: 18,
    fontWeight: typography.semibold,
    color: colors.text,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  cardChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  chipText: {
    fontSize: typography.xs,
    fontWeight: typography.medium,
    color: colors.textMuted,
    letterSpacing: 0.3,
  },
  proofReqBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  proofReqText: {
    fontSize: typography.xs,
    color: colors.warning,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.07)',
    marginHorizontal: spacing.md,
  },

  // Deck clip wrapper — keeps slide animation within card bounds
  deckClip: {
    overflow: 'hidden',
    borderRadius: CARD_RADIUS,
  },

  // Action buttons — all 4 equal flex: 1 so they fill the row uniformly
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  actionBtn: {
    flex: 1,
    height: 58,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  actionBtnAccept: {
    backgroundColor: 'rgba(52, 211, 153, 0.10)',
    borderColor: 'rgba(52, 211, 153, 0.28)',
  },
  actionBtnDeny: {
    backgroundColor: 'rgba(248, 113, 113, 0.10)',
    borderColor: 'rgba(248, 113, 113, 0.25)',
  },
  actionBtnClarify: {
    backgroundColor: 'rgba(251, 191, 36, 0.08)',
    borderColor: 'rgba(251, 191, 36, 0.22)',
  },
  actionBtnClarifyActive: {
    backgroundColor: 'rgba(251, 191, 36, 0.18)',
    borderColor: 'rgba(251, 191, 36, 0.45)',
  },
  actionBtnNext: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  actionBtnHidden: {
    opacity: 0,
  },
  actionBtnDisabled: {
    opacity: 0.35,
  },

  // History
  historyList: {
    gap: 1,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  historyRowBody: {
    flex: 1,
  },
  historyTaskTitle: {
    fontSize: typography.base,
    fontWeight: typography.medium,
    color: colors.text,
  },
  historyTaskMeta: {
    fontSize: typography.xs,
    color: colors.textMuted,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  historyRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 0,
  },
  rectifyBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.4)',
    backgroundColor: 'rgba(34,197,94,0.10)',
    minWidth: 62,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rectifyBtnText: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
    color: '#22C55E',
  },
  loadMoreBtn: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  loadMoreText: {
    fontSize: typography.sm,
    color: colors.text,
    fontWeight: typography.semibold,
  },

  // Lightbox
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.93)',
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
  lightboxTimestamp: {
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
    letterSpacing: 1.2,
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
});
