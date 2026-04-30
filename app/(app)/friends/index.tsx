import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  useWindowDimensions,
  View,
} from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { Swiper, type SwiperCardRefType } from 'rn-swiper-list';
import { supabase } from '@/lib/supabase';
import { type Colors, radius, spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import { useAuth } from '@/hooks/useAuth';
import { StatusPill } from '@/components/StatusPill';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { resolveUserClientInstanceId } from '@/lib/user-client-instance';
import { queryKeys } from '@/lib/query/keys';
import { sendProofRequestedPushNotificationAsync } from '@/lib/notifications';
import { purgeTaskProofForFinalState } from '@/lib/task-proof-upload';
import { VOUCHER_ACTIONABLE_STATUSES, VOUCHER_ACTIVE_VIEW_STATUSES } from '@/lib/constants/task-status';
import { useFriendQueue, type VoucherTaskRow, type VouchHistoryTaskRow } from '@/lib/hooks/useFriendQueue';
import type { TaskDetailData } from '@/lib/hooks/useTaskDetail';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const DECK_TRANSITION_ANIMATION = {
  duration: 240,
  create: { type: 'easeInEaseOut', property: 'opacity' },
  update: { type: 'easeInEaseOut' },
  delete: { type: 'easeInEaseOut', property: 'opacity' },
} as const;

function scheduleDeckLayoutAnimation() {
  LayoutAnimation.configureNext(DECK_TRANSITION_ANIMATION);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type DecisionAction = 'accept' | 'deny' | 'proof';
type TabView = 'pending' | 'active' | 'history';
type DeckIntent = 'accept' | 'deny' | 'next';

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

function formatActiveDeadline(deadline: string): string {
  const parsed = new Date(deadline);
  if (Number.isNaN(parsed.getTime())) return 'No deadline';
  return parsed.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const AVATAR_PALETTE = [
  '#7C3AED', '#2563EB', '#059669', '#B45309',
  '#DC2626', '#0891B2', '#7E22CE', '#065F46',
];

const CAT_IMAGES = [
  require('@/assets/friends-cats/cat-1.jpg'),
  require('@/assets/friends-cats/cat-2.jpg'),
  require('@/assets/friends-cats/cat-3.jpg'),
  require('@/assets/friends-cats/cat-4.jpg'),
  require('@/assets/friends-cats/cat-5.jpg'),
] as const;

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

const FriendAvatar = memo(function FriendAvatar({ username, size = 34 }: { username: string; size?: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: getAvatarColor(username) }]}>
      <Text style={[styles.avatarText, { fontSize: Math.round(size * 0.38) }]}>
        {getInitials(username)}
      </Text>
    </View>
  );
});

// ─── Cat placeholder ──────────────────────────────────────────────────────────

function CatPlaceholder({ seed }: { seed: string }) {
  const imageIndex = seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % CAT_IMAGES.length;
  return (
    <Image source={CAT_IMAGES[imageIndex]} style={StyleSheet.absoluteFill} resizeMode="cover" fadeDuration={0} />
  );
}

// ─── Video player ─────────────────────────────────────────────────────────────

function VideoProofPlayer({ signedUrl, overlayTimestampText }: { signedUrl: string; overlayTimestampText: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const filename = proof ? (proof.mediaKind === 'video' ? 'proof_video.mp4' : 'proof_photo.jpg') : null;
  const mediaKey = proof
    ? `${taskId}:${proof.mediaKind}:${proof.signedUrl}`
    : `${taskId}:placeholder`;

  return (
    <View style={styles.mediaBox} key={mediaKey}>
      {proof ? (
        <>
          {proof.mediaKind === 'image' ? (
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={0.95} onPress={onExpand}>
              <Image
                source={{ uri: proof.signedUrl }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                fadeDuration={0}
              />
            </TouchableOpacity>
          ) : (
            <VideoProofPlayer
              key={proof.signedUrl}
              signedUrl={proof.signedUrl}
              overlayTimestampText={proof.overlayTimestampText}
            />
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
        <CatPlaceholder key={`${taskId}:placeholder`} seed={taskId} />
      )}
    </View>
  );
}

// ─── Deck action buttons ──────────────────────────────────────────────────────

function DeckActions({
  task,
  inFlightAction,
  isActionable,
  onAccept,
  onDeny,
  onProof,
  onNext,
}: {
  task: VoucherTaskRow;
  inFlightAction: DecisionAction | null;
  isActionable: boolean;
  onAccept: () => void;
  onDeny: () => void;
  onProof: () => void;
  onNext: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const busy = Boolean(inFlightAction);
  const dimmed = !isActionable;
  const trafficIconColor = '#0f172a';

  return (
    <View style={styles.actionsRow}>
      {/* Deny */}
      <TouchableOpacity
        style={[styles.actionLightBtn, styles.actionBtnDeny, (busy || dimmed) && styles.actionBtnDisabled]}
        onPress={onDeny}
        disabled={busy || dimmed}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Deny task"
      >
        {inFlightAction === 'deny'
          ? <ActivityIndicator size="small" color={trafficIconColor} />
          : <Feather name="x" size={22} color={trafficIconColor} />}
      </TouchableOpacity>

      {/* Clarify / request proof */}
      <TouchableOpacity
        style={[styles.actionLightBtn, styles.actionBtnClarify, (busy || dimmed) && styles.actionBtnDisabled]}
        onPress={onProof}
        disabled={busy || dimmed}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Request proof"
      >
        {inFlightAction === 'proof'
          ? <ActivityIndicator size="small" color={trafficIconColor} />
          : <Text style={styles.actionQuestionMark}>?</Text>}
      </TouchableOpacity>

      {/* Accept */}
      <TouchableOpacity
        style={[styles.actionLightBtn, styles.actionBtnAccept, (busy || dimmed) && styles.actionBtnDisabled]}
        onPress={onAccept}
        disabled={busy || dimmed}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Accept task"
      >
        {inFlightAction === 'accept'
          ? <ActivityIndicator size="small" color={trafficIconColor} />
          : <Feather name="check" size={22} color={trafficIconColor} />}
      </TouchableOpacity>

      {/* Next card — always present so all 4 columns stay equal */}
      <TouchableOpacity
        style={styles.actionBtnNext}
        onPress={onNext}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Next task in deck"
      >
        <Feather name="chevron-right" size={20} color={trafficIconColor} />
      </TouchableOpacity>
    </View>
  );
}

// ─── Friend deck ──────────────────────────────────────────────────────────────

function CardContent({
  task,
  friend,
  inFlight,
  isActionable,
  onAccept,
  onDeny,
  onProof,
  onCycle,
  onExpand,
}: {
  task: VoucherTaskRow;
  friend: VoucherTaskRow['user'];
  inFlight: DecisionAction | null;
  isActionable: boolean;
  onAccept: () => void;
  onDeny: () => void;
  onProof: () => void;
  onCycle: () => void;
  onExpand: (proof: TaskProof) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const username = friend?.username ?? 'Unknown';
  return (
    <>
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
      <MediaBox
        proof={task.proof}
        taskId={task.id}
        onExpand={() => { if (task.proof) onExpand(task.proof); }}
      />
      <View style={styles.cardBody}>
        <Text style={styles.cardTaskTitle} numberOfLines={2}>{task.title}</Text>
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
          {task.proof_request_open && !task.has_proof ? (
            <View style={styles.proofReqChip}>
              <Feather name="alert-circle" size={11} color={colors.warning} />
              <Text style={styles.proofReqChipText}>Proof requested</Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.cardDivider} />
      <DeckActions
        task={task}
        inFlightAction={inFlight}
        isActionable={isActionable}
        onAccept={onAccept}
        onDeny={onDeny}
        onProof={onProof}
        onNext={onCycle}
      />
    </>
  );
}

function FriendDeck({
  friend,
  tasks,
  inFlightByTaskId,
  onAccept,
  onDeny,
  onProof,
  onExpand,
}: {
  friend: VoucherTaskRow['user'];
  tasks: VoucherTaskRow[];
  inFlightByTaskId: Record<string, DecisionAction | null>;
  onAccept: (t: VoucherTaskRow) => void;
  onDeny: (t: VoucherTaskRow) => void;
  onProof: (t: VoucherTaskRow) => void;
  onExpand: (proof: TaskProof) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const swiperRef = useRef<SwiperCardRefType>(undefined);
  const pendingIntentRef = useRef<DeckIntent | null>(null);
  const pendingTaskIdRef = useRef<string | null>(null);
  const measuredCardHeightsRef = useRef<Record<string, number>>({});
  const [deckHeight, setDeckHeight] = useState(1);
  const hasNext = tasks.length > 1;

  // Must be after all hooks — early return here would violate Rules of Hooks.
  useEffect(() => {
    const activeTaskIds = new Set(tasks.map((task) => task.id));
    const nextHeights: Record<string, number> = {};
    for (const [taskId, height] of Object.entries(measuredCardHeightsRef.current)) {
      if (activeTaskIds.has(taskId)) {
        nextHeights[taskId] = height;
      }
    }
    measuredCardHeightsRef.current = nextHeights;

    // Don't collapse to 1px while waiting for the replacement card's onLayout.
    // Keep the previous height until at least one measurement is available.
    if (Object.keys(nextHeights).length > 0) {
      setDeckHeight(Math.max(...Object.values(nextHeights)));
    }
  }, [tasks]);

  if (tasks.length === 0) return null;

  function handleCardLayout(taskId: string, measuredHeight: number) {
    const normalizedHeight = Math.max(1, Math.ceil(measuredHeight));
    if (measuredCardHeightsRef.current[taskId] === normalizedHeight) return;

    measuredCardHeightsRef.current[taskId] = normalizedHeight;
    const maxMeasuredHeight = Math.max(1, ...Object.values(measuredCardHeightsRef.current));
    if (maxMeasuredHeight !== deckHeight) {
      setDeckHeight(maxMeasuredHeight);
    }
  }

  function clearPendingSwipeIntent() {
    pendingIntentRef.current = null;
    pendingTaskIdRef.current = null;
  }

  function resolveSwipeTask(cardIndex: number): VoucherTaskRow | null {
    if (cardIndex < 0 || cardIndex >= tasks.length) return null;
    return tasks[cardIndex] ?? null;
  }

  function triggerDeckSwipe(intent: DeckIntent, task: VoucherTaskRow) {
    // With loop=true and a single card, updateActiveIndex resets activeIndex to 0 on
    // the JS thread while SwiperCard.swipeRight schedules activeIndex++ on the UI thread.
    // The UI thread increment fires after the reset, leaving activeIndex=1 with no refs[1].
    // Subsequent presses silently no-op. Bypass the swipe library for single-card decks.
    if (!hasNext) {
      if (intent === 'accept') onAccept(task);
      else if (intent === 'deny') onDeny(task);
      return;
    }

    const swiper = swiperRef.current;
    if (!swiper) {
      if (intent === 'accept') onAccept(task);
      else if (intent === 'deny') onDeny(task);
      return;
    }

    pendingIntentRef.current = intent;
    pendingTaskIdRef.current = task.id;

    if (intent === 'accept') {
      swiper.swipeRight();
      return;
    }

    swiper.swipeLeft();
  }

  function handleSwipeRight(cardIndex: number) {
    const swipedTask = resolveSwipeTask(cardIndex);
    const intent = pendingIntentRef.current;
    const pendingTaskId = pendingTaskIdRef.current;
    clearPendingSwipeIntent();

    if (!swipedTask || intent !== 'accept') return;
    if (pendingTaskId && pendingTaskId !== swipedTask.id) return;
    onAccept(swipedTask);
  }

  function handleSwipeLeft(cardIndex: number) {
    const swipedTask = resolveSwipeTask(cardIndex);
    const intent = pendingIntentRef.current;
    const pendingTaskId = pendingTaskIdRef.current;
    clearPendingSwipeIntent();

    if (!swipedTask) return;
    if (pendingTaskId && pendingTaskId !== swipedTask.id) return;
    if (intent === 'deny') onDeny(swipedTask);
  }

  return (
    <View style={styles.deckOuter}>
      <View style={[styles.deckClip, { height: deckHeight }]}>
        <Swiper
          key={tasks[0]?.id ?? 'empty'}
          ref={swiperRef}
          data={tasks}
          keyExtractor={(task) => task.id}
          renderCard={(task) => {
            const isActionable = VOUCHER_ACTIONABLE_STATUSES.includes(task.status);
            const inFlight = inFlightByTaskId[task.id] ?? null;

            return (
              <View
                style={styles.cardContentWrap}
                onLayout={(event) => handleCardLayout(task.id, event.nativeEvent.layout.height)}
              >
                <CardContent
                  task={task}
                  friend={friend}
                  inFlight={inFlight}
                  isActionable={isActionable}
                  onAccept={() => triggerDeckSwipe('accept', task)}
                  onDeny={() => triggerDeckSwipe('deny', task)}
                  onProof={() => onProof(task)}
                  onCycle={() => triggerDeckSwipe('next', task)}
                  onExpand={onExpand}
                />
              </View>
            );
          }}
          cardStyle={deckHeight > 1 ? [styles.mainCard, { height: deckHeight }] : styles.mainCard}
          prerenderItems={2}
          loop
          disableLeftSwipe
          disableRightSwipe
          disableTopSwipe
          disableBottomSwipe
          onSwipeRight={handleSwipeRight}
          onSwipeLeft={handleSwipeLeft}
        />
      </View>
    </View>
  );
}

// ─── History row ──────────────────────────────────────────────────────────────

const HistoryRow = memo(function HistoryRow({
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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const username = task.user?.username ?? 'Unknown';
  return (
    <TouchableOpacity style={styles.historyRow} activeOpacity={0.75} onPress={onPress} accessibilityRole="button">
      <FriendAvatar username={username} size={28} />
      <View style={styles.historyRowBody}>
        <Text style={styles.historyTaskTitle} numberOfLines={1}>{task.title}</Text>
        <View style={styles.historyRowPillRow}>
          <StatusPill status={task.status} />
          <Text style={styles.historyTaskMeta} numberOfLines={1}>
            {username.toLowerCase()} · {timeAgo(task.updated_at)}
          </Text>
        </View>
      </View>
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
        <Feather name="external-link" size={14} color={colors.textSubtle} />
      )}
    </TouchableOpacity>
  );
});

const ActiveRow = memo(function ActiveRow({ task }: { task: VoucherTaskRow }) {
  const styles = makeStyles(useTheme().colors);
  const username = task.user?.username ?? 'Unknown';
  return (
    <View style={styles.activeRow}>
      <FriendAvatar username={username} size={28} />
      <View style={styles.activeRowBody}>
        <Text style={styles.historyTaskTitle} numberOfLines={1}>{task.title}</Text>
        <Text style={styles.historyTaskMeta} numberOfLines={1}>
          {username.toLowerCase()} · due {formatActiveDeadline(task.deadline)}
        </Text>
      </View>
      <View style={styles.activeRowRight}>
        <StatusPill status={task.status} />
      </View>
    </View>
  );
});

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function FriendsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { width: screenWidth } = useWindowDimensions();
  const [searchQuery] = useState('');
  const friendQueue = useFriendQueue(user?.id, searchQuery);
  const [refreshing, setRefreshing] = useState(false);
  const [inFlightByTaskId, setInFlightByTaskId] = useState<Record<string, DecisionAction | null>>({});
  const [inFlightRectifyByTaskId, setInFlightRectifyByTaskId] = useState<Record<string, boolean>>({});
  // Ids the user has optimistically accepted/denied. Kept separate from
  // inFlightByTaskId because rapid clicks trigger concurrent realtime refetches;
  // an intermediate refetch that started before the second click can return the
  // second task still in an actionable status, re-injecting it into the cache
  // and ghosting it into the deck. Filter until history confirms terminal state.
  const [resolvedTaskIds, setResolvedTaskIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TabView>('pending');
  const [pendingFocusAutoTabToken, setPendingFocusAutoTabToken] = useState(0);
  const [lightboxProof, setLightboxProof] = useState<TaskProof | null>(null);

  const tasks = friendQueue.tasks;
  const historyTasks = friendQueue.historyTasks;
  const loading = friendQueue.loading;
  const historyLoading = friendQueue.historyLoading;
  const historyHasMore = friendQueue.historyHasMore;
  const historyLoadingMore = friendQueue.historyLoadingMore;
  const error = friendQueue.error;
  const historyError = friendQueue.historyError;

  const resolvedIdSet = useMemo(() => new Set(resolvedTaskIds), [resolvedTaskIds]);
  const awaitingVoucherTasks = useMemo(
    () => tasks.filter((t) => VOUCHER_ACTIONABLE_STATUSES.includes(t.status) && !resolvedIdSet.has(t.id)),
    [tasks, resolvedIdSet],
  );
  const activeTasks = useMemo(
    () => tasks.filter((t) => VOUCHER_ACTIVE_VIEW_STATUSES.includes(t.status) && !resolvedIdSet.has(t.id)),
    [tasks, resolvedIdSet],
  );

  useEffect(() => {
    if (pendingFocusAutoTabToken === 0 || loading) return;
    const preferredTab: TabView | null = awaitingVoucherTasks.length > 0
      ? 'pending'
      : activeTasks.length > 0
        ? 'active'
        : null;
    if (preferredTab) {
      setActiveTab(preferredTab);
    }
    setPendingFocusAutoTabToken(0);
  }, [activeTasks.length, awaitingVoucherTasks.length, loading, pendingFocusAutoTabToken]);

  // Safety net: realtime can drop events during reconnect, app backgrounding,
  // or when the screen was unmounted. Refetch on focus so the list always
  // reflects server state the moment the user lands here.
  const { refetchQueue, refetchHistory } = friendQueue;
  useFocusEffect(
    useCallback(() => {
      setPendingFocusAutoTabToken((prev) => prev + 1);
      void refetchQueue();
      void refetchHistory();
    }, [refetchQueue, refetchHistory]),
  );

  // Release the resolved guard once history confirms the task has landed in a
  // terminal status — server has fully committed and no refetch can ghost it back.
  useEffect(() => {
    if (resolvedTaskIds.length === 0) return;
    const historyIds = new Set(historyTasks.map((t) => t.id));
    setResolvedTaskIds((prev) => {
      const next = prev.filter((id) => !historyIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [historyTasks, resolvedTaskIds.length]);

  // Safety net for dropped realtime / offline: force-release after 6s so guard
  // never strands even if the confirmation signal never arrives.
  useEffect(() => {
    if (resolvedTaskIds.length === 0) return;
    const idsAtSchedule = resolvedTaskIds;
    const timeout = setTimeout(() => {
      setResolvedTaskIds((prev) => prev.filter((id) => !idsAtSchedule.includes(id)));
    }, 6000);
    return () => clearTimeout(timeout);
  }, [resolvedTaskIds]);

  const markTaskResolved = useCallback((taskId: string) => {
    setResolvedTaskIds((prev) => (prev.includes(taskId) ? prev : [...prev, taskId]));
  }, []);

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
    updateInFlight(task.id, 'accept');
    const nextUpdatedAt = new Date().toISOString();
    const queueKey = queryKeys.friendQueue(user.id);
    const historyKey = queryKeys.friendHistory(user.id, searchQuery);
    const detailKey = queryKeys.taskDetail(task.id);
    const prevQueue = queryClient.getQueryData<VoucherTaskRow[]>(queueKey);
    const prevHistory = queryClient.getQueryData<{ tasks: VouchHistoryTaskRow[]; hasMore: boolean }>(historyKey);
    const prevDetail = queryClient.getQueryData<TaskDetailData>(detailKey);

    scheduleDeckLayoutAnimation();
    markTaskResolved(task.id);
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
      if (eventError) Toast.show({ type: 'proofError', text1: 'Task accepted, but event logging failed.', position: 'bottom' });

      if (task.has_proof) {
        const purge = await purgeTaskProofForFinalState(task.id);
        if (!purge.success) Toast.show({ type: 'proofError', text1: `Task accepted, but proof cleanup failed: ${purge.error}`, position: 'bottom' });
      }
    } finally {
      updateInFlight(task.id, null);
    }
  }

  async function handleDeny(task: VoucherTaskRow) {
    if (!user) return;
    updateInFlight(task.id, 'deny');
    const nextUpdatedAt = new Date().toISOString();
    const queueKey = queryKeys.friendQueue(user.id);
    const historyKey = queryKeys.friendHistory(user.id, searchQuery);
    const detailKey = queryKeys.taskDetail(task.id);
    const prevQueue = queryClient.getQueryData<VoucherTaskRow[]>(queueKey);
    const prevHistory = queryClient.getQueryData<{ tasks: VouchHistoryTaskRow[]; hasMore: boolean }>(historyKey);
    const prevDetail = queryClient.getQueryData<TaskDetailData>(detailKey);

    scheduleDeckLayoutAnimation();
    markTaskResolved(task.id);
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
      if (eventError) Toast.show({ type: 'proofError', text1: 'Task denied, but event logging failed.', position: 'bottom' });

      if (task.has_proof) {
        const purge = await purgeTaskProofForFinalState(task.id);
        if (!purge.success) Toast.show({ type: 'proofError', text1: `Task denied, but proof cleanup failed: ${purge.error}`, position: 'bottom' });
      }
    } finally {
      updateInFlight(task.id, null);
    }
  }

  async function handleRequestProof(task: VoucherTaskRow) {
    if (!user) return;
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
      if (eventError) Toast.show({ type: 'proofError', text1: 'Proof requested, but event logging failed.', position: 'bottom' });

      if (task.user?.id) {
        const pushDispatch = await sendProofRequestedPushNotificationAsync({
          taskId: task.id,
          recipientUserId: task.user.id,
        });
        if (!pushDispatch.success && !pushDispatch.skipped) {
          Toast.show({
            type: 'proofError',
            text1: `Proof requested, but push notification failed: ${pushDispatch.error ?? 'Unknown error'}`,
            position: 'bottom',
          });
        }
      }
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
              if (!purge.success) Toast.show({ type: 'proofError', text1: `Rectified, but proof cleanup failed: ${purge.error}`, position: 'bottom' });

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
          items={[
            { key: 'active', label: 'Active', badgeCount: activeTasks.length, color: colors.destructive },
            { key: 'pending', label: 'Pending', badgeCount: awaitingVoucherTasks.length, color: colors.warning },
            { key: 'history', label: 'History', showBadge: false, color: colors.success },
          ]}
          activeKey={activeTab}
          variant="signal"
          onChange={(key) => {
            const tab = key as TabView;
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
                <Text style={styles.emptyTitle}>No pending requests</Text>
              </View>
            ) : (
              <View style={styles.deckList}>
                {decksByFriend.map(({ friendId, friend, tasks: groupTasks }) => (
                  <FriendDeck
                    key={friendId}
                    friend={friend}
                    tasks={groupTasks}
                    inFlightByTaskId={inFlightByTaskId}
                    onAccept={(t) => { void handleAccept(t); }}
                    onDeny={(t) => { void handleDeny(t); }}
                    onProof={(t) => { void handleRequestProof(t); }}
                    onExpand={setLightboxProof}
                  />
                ))}
              </View>
            )

          ) : activeTab === 'active' ? (
            activeTasks.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No Activity from friends...</Text>
              </View>
            ) : (
              <View style={styles.activeList}>
                {activeTasks.map((task) => (
                  <ActiveRow key={task.id} task={task} />
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
                <Text style={styles.emptyTitle}>No History yet</Text>
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
                  <TouchableOpacity
                    style={styles.loadMoreBtn}
                    onPress={() => { void friendQueue.loadMoreHistory(); }}
                    disabled={historyLoadingMore}
                    activeOpacity={0.8}
                  >
                    {historyLoadingMore
                      ? <ActivityIndicator size="small" color={colors.textMuted} />
                      : <Text style={styles.loadMoreText}>Load more</Text>}
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
const MEDIA_MIN_HEIGHT = 176;
const MEDIA_MAX_HEIGHT = 248;

const makeStyles = (colors: Colors) => StyleSheet.create({
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
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: colors.text,
    letterSpacing: -0.5,
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
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    fontSize: typography.md,
    fontWeight: typography.semibold,
    color: colors.text,
    textAlign: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.destructiveMuted,
    borderWidth: 1,
    borderColor: colors.destructive,
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
    aspectRatio: 4 / 3,
    minHeight: MEDIA_MIN_HEIGHT,
    maxHeight: MEDIA_MAX_HEIGHT,
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
  },
  backStackCard: {
    position: 'absolute',
    top: -7,
    left: 8,
    right: 8,
    height: 24,
    borderRadius: CARD_RADIUS,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    opacity: 0.9,
    zIndex: 0,
  },
  ghostCard: {
    position: 'absolute',
    top: -13,
    left: 16,
    right: 16,
    height: 18,
    borderRadius: CARD_RADIUS,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 0,
  },
  backCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  mainCard: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
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
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
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
  proofReqChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.32)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
  },
  proofReqChipText: {
    fontSize: typography.xs,
    fontWeight: typography.medium,
    color: colors.warning,
    letterSpacing: 0.3,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },

  // Deck clip wrapper — keeps slide animation within card bounds
  deckClip: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: CARD_RADIUS,
    zIndex: 2,
  },
  cardContentWrap: {
    width: '100%',
  },

  // Action buttons — four circular traffic-light style controls
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  actionLightBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    flexShrink: 0,
    borderColor: '#00000024',
  },
  actionBtnAccept: {
    backgroundColor: colors.success,
    shadowColor: colors.success,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  actionBtnDeny: {
    backgroundColor: colors.destructive,
    shadowColor: colors.destructive,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  actionBtnClarify: {
    backgroundColor: colors.warning,
    shadowColor: colors.warning,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  actionBtnNext: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    flexShrink: 0,
    backgroundColor: '#D946EF',
    borderColor: '#00000024',
    shadowColor: '#D946EF',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  actionBtnDisabled: {
    opacity: 0.35,
  },
  actionQuestionMark: {
    color: '#0f172a',
    fontSize: 24,
    fontWeight: '400',
    lineHeight: 24,
  },

  // History
  historyList: {
    gap: 1,
  },
  activeList: {
    gap: 1,
  },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  activeRowBody: {
    flex: 1,
  },
  activeRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 0,
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
    minWidth: 0,
  },
  historyTaskTitle: {
    fontSize: typography.base,
    fontWeight: typography.medium,
    color: colors.text,
    marginBottom: 4,
  },
  historyRowPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  historyTaskMeta: {
    fontSize: typography.xs,
    color: colors.textMuted,
    flexShrink: 1,
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
