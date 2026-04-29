import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  Platform,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSharedValue, withTiming, runOnJS, Easing } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import type { ImagePickerAsset } from 'expo-image-picker';
import { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useQueryClient } from '@tanstack/react-query';
import LottieView from 'lottie-react-native';
import Toast from 'react-native-toast-message';
import { spacing } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from '@/components/tasks/styles';
import {
  getTodayParts,
  sortDraftReminders,
  normalizeEventDurationMinutes,
} from '@/components/tasks/helpers';
import {
  type DraftReminder,
  type DraftReminderPresetSource,
  type DraftSubtask,
  type RecurrenceType,
} from '@/components/tasks/types';
import { TaskTopBar } from '@/components/tasks/TaskTopBar';
import { TaskBottomActions } from '@/components/tasks/TaskBottomActions';
import { TaskContent } from '@/components/tasks/TaskContent';
import { PostponeDeadlineModal } from '@/components/tasks/PostponeDeadlineModal';
import { LegacyPostponeCalendarPicker } from '@/components/tasks/LegacyPostponeCalendarPicker';
import { VoucherPickerModal } from '@/components/tasks/VoucherPickerModal';
import { TaskCreatorOverlay } from '@/components/tasks/TaskCreatorOverlay';
import { TaskSearchOverlay } from '@/components/tasks/TaskSearchOverlay';
import { TaskSortMenu } from '@/components/tasks/TaskSortMenu';
import { taskCreatorState } from '@/lib/taskCreatorState';
import {
  EVENT_TOKEN_REGEX,
  type GoogleEventColorId,
  parseProofRequiredFromTitle,
  parseReminderTimesFromTitle,
  parseRepeatTokenFromTitle,
  parseRequiredPomoFromTitle,
  parseTaskTitleAndSubtasks,
  parseTitleForDeadline,
  resolveEventAnchorDate,
  resolveEventSchedule,
  resolveTaskDeadline,
  titleHasDeadlineToken,
} from '@/lib/task-title-parser';
import { useFriends } from '@/lib/hooks/useFriends';
import { useTasks, type DashboardSortMode } from '@/lib/hooks/useTasks';
import { useGoogleCalendarConnection } from '@/hooks/useGoogleCalendarConnection';
import { supabase } from '@/lib/supabase';
import { syncLocalReminderNotificationsAsync } from '@/lib/notifications';
import { syncGoogleCalendarTaskAfterCreate } from '@/lib/google-calendar-mobile-sync';
import { resolveUserClientInstanceId } from '@/lib/user-client-instance';
import type { TaskRowData } from '@/components/TaskRow';
import { useAuth } from '@/hooks/useAuth';
import type { Currency } from '@/lib/types';
import { useReputationScore } from '@/lib/hooks/useReputationScore';
import { AI_PROFILE_ID, normalizeAiUsername } from '@/lib/constants/ai-profile';
import { formatFailureCostFromCents, getFailureCostBounds } from '@/lib/domain/failure-cost';
import { queryKeys } from '@/lib/query/keys';
import {
  completeTask,
  deleteTask,
  postponeTaskDeadline,
  isTaskWithinDeleteWindow,
  removeTaskProof,
  uploadTaskProof,
} from '@/lib/tasks/task-actions';

const SORT_OPTIONS: { mode: DashboardSortMode; label: string }[] = [
  { mode: 'deadline_asc', label: 'Sort by deadline ascending' },
  { mode: 'deadline_desc', label: 'Sort by deadline descending' },
  { mode: 'created_asc', label: 'Sort by time created ascending' },
  { mode: 'created_desc', label: 'Sort by time created descending' },
];
type OverlayMode = 'closed' | 'create' | 'search';

function getFutureBoundaryMs(): number {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const boundary = new Date(startOfToday);
  boundary.setDate(boundary.getDate() + 2);
  return boundary.getTime();
}

function formatTimeUntilDeadline(deadlineIso: string, now: Date = new Date()): string {
  const deadlineMs = new Date(deadlineIso).getTime();
  if (!Number.isFinite(deadlineMs)) return 'Until deadline';

  const totalMinutes = Math.max(1, Math.floor((deadlineMs - now.getTime()) / 60000));
  const minutesPerHour = 60;
  const minutesPerDay = 24 * minutesPerHour;
  const days = Math.floor(totalMinutes / minutesPerDay);
  const remainderAfterDays = totalMinutes % minutesPerDay;
  const hours = Math.floor(remainderAfterDays / minutesPerHour);
  const minutes = remainderAfterDays % minutesPerHour;

  if (days > 0) {
    return `${days} ${days === 1 ? 'day' : 'days'} ${hours} ${hours === 1 ? 'hour' : 'hours'} and ${minutes} mins until deadline`;
  }

  if (hours > 0) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} and ${minutes} mins until deadline`;
  }

  return `${totalMinutes} mins until deadline`;
}

function buildDefaultStartBoundaryDate(deadline: Date, durationMinutes: number): Date {
  const candidate = new Date(deadline.getTime() - durationMinutes * 60 * 1000);
  const now = new Date();
  const defaultStart = candidate.getTime() < now.getTime() ? now : candidate;
  defaultStart.setSeconds(0, 0);
  return defaultStart;
}

function buildDefaultDeadlineDate(now: Date = new Date()): Date {
  const candidate = new Date(now);
  candidate.setHours(23, 0, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

function buildPresetDeadlineReminders(
  deadline: Date,
  removedPresetSources: DraftReminderPresetSource[],
  oneHourEnabled: boolean,
  finalEnabled: boolean,
): DraftReminder[] {
  const presetReminders: DraftReminder[] = [];

  if (oneHourEnabled && !removedPresetSources.includes('DEFAULT_DEADLINE_1H')) {
    presetReminders.push({
      id: 'preset-deadline-1h',
      source: 'DEFAULT_DEADLINE_1H',
      reminderAt: new Date(deadline.getTime() - 60 * 60 * 1000),
    });
  }
  if (finalEnabled && !removedPresetSources.includes('DEFAULT_DEADLINE_10M')) {
    presetReminders.push({
      id: 'preset-deadline-10m',
      source: 'DEFAULT_DEADLINE_10M',
      reminderAt: new Date(deadline.getTime() - 10 * 60 * 1000),
    });
  }

  return presetReminders;
}

export default function TasksScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const { profile: authProfile, user } = useAuth();
  const { data: reputationScore } = useReputationScore(user?.id);
  const { data: googleCalendarConnection } = useGoogleCalendarConnection();
  const defaultEventDurationMinutes = normalizeEventDurationMinutes(authProfile?.default_event_duration_minutes);
  const defaultGoogleEventColorId = googleCalendarConnection?.defaultEventColorId ?? '9';
  const queryClient = useQueryClient();
  const rootRef = useRef<View | null>(null);
  const creatorAnchorRef = useRef<View | null>(null);
  const titleInputRef = useRef<TextInput | null>(null);
  const [sortMode, setSortMode] = useState<DashboardSortMode>('deadline_asc');
  const {
    dueSoonTasks,
    futureTasks,
    pastTasks,
    hasMorePast,
    loadingMore,
    refetch: refetchTasks,
    loadMorePastTasks,
  } = useTasks(sortMode);
  const [refreshing, setRefreshing] = useState(false);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>('closed');
  const expandProgress = useSharedValue(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<TaskRowData[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchInputRef = useRef<TextInput | null>(null);
  const sortButtonRef = useRef<View | null>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortAnchor, setSortAnchor] = useState<{ pageX: number; pageY: number; width: number; height: number } | null>(null);
  const [proofUploadTaskId, setProofUploadTaskId] = useState<string | null>(null);
  const [postponingTaskId, setPostponingTaskId] = useState<string | null>(null);
  const [postponePickerTask, setPostponePickerTask] = useState<TaskRowData | null>(null);
  const [postponePickerDate, setPostponePickerDate] = useState<Date>(new Date());
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [creatorAnchor, setCreatorAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const taskListScrollRef = useRef<ScrollView | null>(null);
  const taskListScrollOffsetYRef = useRef(0);
  const focusedSubtaskInputBottomYRef = useRef<number | null>(null);
  const keyboardTopYRef = useRef(Number.POSITIVE_INFINITY);
  const [taskListKeyboardInset, setTaskListKeyboardInset] = useState(0);
  const [optimisticTasks, setOptimisticTasks] = useState<TaskRowData[]>([]);
  const [optimisticallyCompletingTaskIds, setOptimisticallyCompletingTaskIds] = useState<string[]>([]);
  const [confettiBursts, setConfettiBursts] = useState<number[]>([]);
  const [pendingConfettiBursts, setPendingConfettiBursts] = useState(0);
  const confettiIdRef = useRef(0);
  const [bottomActionsHeight, setBottomActionsHeight] = useState(0);

  const [title, setTitle] = useState('');
  const [deadlineDate, setDeadlineDate] = useState<Date>(() => buildDefaultDeadlineDate());
  const [customDeadlineDate, setCustomDeadlineDate] = useState<Date>(() => buildDefaultDeadlineDate());
  const [isDeadlineCustomized, setIsDeadlineCustomized] = useState(false);
  const [customDeadlinePickerMode, setCustomDeadlinePickerMode] = useState<'date' | 'time'>('date');
  const [showCustomDeadlineAndroidPicker, setShowCustomDeadlineAndroidPicker] = useState(false);
  const [showCustomDeadlineAndroidModal, setShowCustomDeadlineAndroidModal] = useState(false);
  const [showCustomDeadlineIosModal, setShowCustomDeadlineIosModal] = useState(false);
  // voucherValue: null = unset, 'self' = self-vouch, otherwise a friend's user id
  const [voucherValue, setVoucherValue] = useState<string | null>(null);
  const [voucherSearch, setVoucherSearch] = useState('');
  // failureCostCents stored as string so the TextInput can be freeform
  const [failureCostInput, setFailureCostInput] = useState('');
  const hasInitializedFailureCostRef = useRef(false);
  const hasInitializedVoucherRef = useRef(false);
  const lastAppliedDefaultVoucherRef = useRef<string | null>(null);

  const { friends, currentUserId, profile, loading: friendsLoading, error: friendsError } = useFriends();
  const defaultPomoDurationMinutes = authProfile?.default_pomo_duration_minutes ?? 25;
  const defaultRequiresProofForAllTasks = profile?.default_requires_proof_for_all_tasks ?? false;

  const resolveDefaultVoucherValue = useCallback((): string | null => {
    if (!profile) return null;
    const defaultVoucherId = profile.default_voucher_id ?? null;
    if (!currentUserId) return null;
    if (defaultVoucherId) {
      if (defaultVoucherId === currentUserId) return 'self';
      if (friendsLoading) return null;
      if (friends.some((friend) => friend.id === defaultVoucherId)) return defaultVoucherId;
    }
    return 'self';
  }, [profile, currentUserId, friendsLoading, friends]);

  function openOverlay(nextMode: Exclude<OverlayMode, 'closed'>) {
    if (!creatorAnchorRef.current || !rootRef.current) return;

    creatorAnchorRef.current.measureLayout(
      rootRef.current,
      (x, y, width, height) => {
        closeVoucherPicker();
        if (nextMode === 'create') {
          setRecurrenceType('');
          setShowCustomRecurrenceDays(false);
          setRecurrenceDays([]);
        }
        setSortMenuOpen(false);
        setCreatorAnchor({ x, y, width, height });
        expandProgress.value = 0;
        setOverlayMode(nextMode);
        expandProgress.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
        setTimeout(() => {
          if (nextMode === 'create') {
            titleInputRef.current?.focus();
          } else {
            searchInputRef.current?.focus();
          }
        }, 180);
      },
      () => {
        closeVoucherPicker();
        if (nextMode === 'create') {
          setRecurrenceType('');
          setShowCustomRecurrenceDays(false);
          setRecurrenceDays([]);
        }
        setSortMenuOpen(false);
        setCreatorAnchor({
          x: spacing.lg,
          y: spacing.lg * 2,
          width: Math.max(220, screenWidth - spacing.lg * 2),
          height: 48,
        });
        expandProgress.value = 0;
        setOverlayMode(nextMode);
        expandProgress.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
        setTimeout(() => {
          if (nextMode === 'create') {
            titleInputRef.current?.focus();
          } else {
            searchInputRef.current?.focus();
          }
        }, 180);
      },
    );
  }

  function closeOverlay() {
    const closingMode = overlayMode;
    Keyboard.dismiss();
    closeVoucherPicker();
    function afterClose() {
      setOverlayMode('closed');
      setCreatorAnchor(null);
      if (closingMode === 'create') resetCreateDraftState();
      if (closingMode === 'search') {
        setSearchQuery('');
        setSearchResults([]);
        setSearchError(null);
        setSearchLoading(false);
      }
    }
    expandProgress.value = withTiming(0, { duration: 220 }, () => {
      runOnJS(afterClose)();
    });
  }

  // Keep module-level ref in sync so the tab layout can collapse the creator
  // when any nav tab is pressed.
  useEffect(() => {
    taskCreatorState.isExpanded = isOverlayOpen;
    taskCreatorState.collapse = closeOverlay;
  });

  function resetCreateDraftState() {
    setTitle('');
    const nextDeadline = buildDefaultDeadlineDate();
    setDeadlineDate(nextDeadline);
    setRemovedPresetSources([]);
    setDraftReminders([]);
    const nextCustomReminder = new Date(Date.now() + 30 * 60 * 1000);
    nextCustomReminder.setSeconds(0, 0);
    setCustomReminderDate(nextCustomReminder);
    setRecurrenceType('');
    setShowCustomRecurrenceDays(false);
    setRecurrenceDays([]);
    setRequiresProof(defaultRequiresProofForAllTasks);
    setTimeBoundEnabled(false);
    setEventSyncEnabled(false);
    setEventStartDate(null);
    setSelectedGoogleEventColorId(defaultGoogleEventColorId);
    setShowEventStartAndroidPicker(false);
    setDraftSubtasks([]);
    setNewSubtaskDraft('');
    setCustomDeadlineDate(nextDeadline);
    setCustomDeadlinePickerMode('date');
    setShowCustomDeadlineAndroidPicker(false);
    setShowCustomDeadlineIosModal(false);
    setShowCustomReminderAndroidPicker(false);
    setShowCustomReminderIosModal(false);
    setCustomReminderPickerMode('date');
    setIsDeadlineCustomized(false);
  }

  const [draftReminders, setDraftReminders] = useState<DraftReminder[]>([]);
  const [removedPresetSources, setRemovedPresetSources] = useState<DraftReminderPresetSource[]>([]);
  const [customReminderDate, setCustomReminderDate] = useState<Date>(() => {
    const next = new Date(Date.now() + 30 * 60 * 1000);
    next.setSeconds(0, 0);
    return next;
  });
  const [customReminderPickerMode, setCustomReminderPickerMode] = useState<'date' | 'time'>('date');
  const [showCustomReminderAndroidPicker, setShowCustomReminderAndroidPicker] = useState(false);
  const [showCustomReminderIosModal, setShowCustomReminderIosModal] = useState(false);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('');
  const [showCustomRecurrenceDays, setShowCustomRecurrenceDays] = useState(false);
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [requiresProof, setRequiresProof] = useState(defaultRequiresProofForAllTasks);
  const [timeBoundEnabled, setTimeBoundEnabled] = useState(false);
  const [eventSyncEnabled, setEventSyncEnabled] = useState(false);
  const [eventStartDate, setEventStartDate] = useState<Date | null>(null);
  const [selectedGoogleEventColorId, setSelectedGoogleEventColorId] = useState<GoogleEventColorId>(defaultGoogleEventColorId);
  const [showEventStartAndroidPicker, setShowEventStartAndroidPicker] = useState(false);
  const [draftSubtasks, setDraftSubtasks] = useState<DraftSubtask[]>([]);
  const [newSubtaskDraft, setNewSubtaskDraft] = useState('');
  const subtaskInputRef = useRef<TextInput | null>(null);
  const failureCostInputRef = useRef<TextInput | null>(null);
  const [failureCostSelection, setFailureCostSelection] = useState<{ start: number; end: number } | undefined>(undefined);
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const [isSubtaskFocused, setIsSubtaskFocused] = useState(false);
  const isCreateOverlayOpen = overlayMode === 'create';
  const isSearchOverlayOpen = overlayMode === 'search';
  const isOverlayOpen = overlayMode !== 'closed';
  const trimmedSearchQuery = searchQuery.trim();
  const isSearchActive = isSearchOverlayOpen && trimmedSearchQuery.length > 0;
  const suggestedStartBoundaryDate = useMemo(
    () => buildDefaultStartBoundaryDate(deadlineDate, defaultEventDurationMinutes),
    [deadlineDate, defaultEventDurationMinutes],
  );

  useEffect(() => {
    // Queue overflow bursts instead of cancelling active ones.
    if (pendingConfettiBursts <= 0) return;
    if (confettiBursts.length >= 2) return;
    confettiIdRef.current += 1;
    const queuedBurstId = Date.now() + confettiIdRef.current;
    setConfettiBursts((prev) => [...prev, queuedBurstId]);
    setPendingConfettiBursts((prev) => Math.max(0, prev - 1));
  }, [pendingConfettiBursts, confettiBursts.length]);

  const mergedDueSoonTasks = useMemo(() => {
    const existingIds = new Set(dueSoonTasks.map((task) => task.id));
    const futureBoundaryMs = getFutureBoundaryMs();
    const optimisticDueSoon = optimisticTasks.filter((task) => {
      if (existingIds.has(task.id)) return false;
      const deadlineMs = Date.parse(task.deadline);
      return Number.isNaN(deadlineMs) || deadlineMs < futureBoundaryMs;
    });
    return [...optimisticDueSoon, ...dueSoonTasks].filter(
      (task) => !optimisticallyCompletingTaskIds.includes(task.id),
    );
  }, [dueSoonTasks, optimisticTasks, optimisticallyCompletingTaskIds]);

  const mergedFutureTasks = useMemo(() => {
    const existingIds = new Set(futureTasks.map((task) => task.id));
    const futureBoundaryMs = getFutureBoundaryMs();
    const optimisticFuture = optimisticTasks.filter((task) => {
      if (existingIds.has(task.id)) return false;
      const deadlineMs = Date.parse(task.deadline);
      return !Number.isNaN(deadlineMs) && deadlineMs >= futureBoundaryMs;
    });
    return [...optimisticFuture, ...futureTasks].filter(
      (task) => !optimisticallyCompletingTaskIds.includes(task.id),
    );
  }, [futureTasks, optimisticTasks, optimisticallyCompletingTaskIds]);

  const visiblePastTasks = useMemo(
    () => pastTasks.filter((task) => !optimisticallyCompletingTaskIds.includes(task.id)),
    [pastTasks, optimisticallyCompletingTaskIds],
  );

  // Safety net: realtime can miss events during reconnect / backgrounding.
  // Refetching on focus guarantees the Past bucket reflects voucher
  // decisions (ACCEPTED/DENIED) the moment the user lands back here.
  useFocusEffect(
    useCallback(() => {
      refetchTasks();
    }, [refetchTasks]),
  );

  useEffect(() => {
    if (optimisticTasks.length === 0) return;
    const serverIds = new Set([...dueSoonTasks, ...futureTasks].map((task) => task.id));
    setOptimisticTasks((prev) => {
      const next = prev.filter((task) => !serverIds.has(task.id));
      return next.length === prev.length ? prev : next;
    });
  }, [dueSoonTasks, futureTasks, optimisticTasks.length]);

  useEffect(() => {
    if (optimisticallyCompletingTaskIds.length === 0) return;
    // Release the guard ONLY once the task has materialized in the past bucket
    // (confirming the server committed the completion). Clearing earlier —
    // e.g. the moment the optimistic removal leaves all buckets empty — lets a
    // pending refetch that raced the write return the stale ACTIVE row and
    // briefly "ghost" the task back into the list.
    const pastIds = new Set(pastTasks.map((task) => task.id));
    setOptimisticallyCompletingTaskIds((prev) => {
      const next = prev.filter((id) => !pastIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [pastTasks, optimisticallyCompletingTaskIds.length]);

  // Safety net: if realtime/refetch never surfaces the task in past (dropped
  // event, network drop), don't strand the guard forever. 6s is long enough
  // that any legitimate refetch has returned and been reconciled.
  useEffect(() => {
    if (optimisticallyCompletingTaskIds.length === 0) return;
    const idsAtSchedule = optimisticallyCompletingTaskIds;
    const timeout = setTimeout(() => {
      setOptimisticallyCompletingTaskIds((prev) =>
        prev.filter((id) => !idsAtSchedule.includes(id)),
      );
    }, 6000);
    return () => clearTimeout(timeout);
  }, [optimisticallyCompletingTaskIds]);

  useEffect(() => {
    if (!isSearchActive) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) {
          if (!cancelled) {
            setSearchResults([]);
            setSearchLoading(false);
          }
          return;
        }

        const { data, error } = await supabase
          .from('tasks')
          .select('id, title, deadline, status, has_proof')
          .eq('user_id', userId)
          .neq('status', 'DELETED')
          .ilike('title', `%${trimmedSearchQuery}%`)
          .order('updated_at', { ascending: false })
          .limit(100);

        if (cancelled) return;
        if (error) {
          setSearchResults([]);
          setSearchError(error.message || 'Search failed');
          setSearchLoading(false);
          return;
        }

        setSearchResults((data as TaskRowData[]) ?? []);
        setSearchError(null);
        setSearchLoading(false);
      } catch (error: any) {
        if (cancelled) return;
        setSearchResults([]);
        setSearchError(error?.message ?? 'Search failed');
        setSearchLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [isSearchActive, trimmedSearchQuery]);

  function handleTitleChange(text: string) {
    setTitle(text);
    const parsed = parseTitleForDeadline(text, deadlineDate);
    if (parsed) {
      setDeadlineDate(parsed);
      setIsDeadlineCustomized(true);
    }
  }

  function updateCustomDeadlineDatePart(dateValue: Date) {
    setCustomDeadlineDate((prev) => {
      const next = new Date(prev);
      next.setFullYear(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate());
      return next;
    });
  }

  function handleCustomDeadlineAndroidPickerChange(_event: DateTimePickerEvent, selected?: Date) {
    setShowCustomDeadlineAndroidPicker(false);
    if (_event.type === 'dismissed' || !selected) return;

    if (customDeadlinePickerMode === 'date') {
      updateCustomDeadlineDatePart(selected);
      setCustomDeadlinePickerMode('time');
      setTimeout(() => setShowCustomDeadlineAndroidPicker(true), 0);
      return;
    }

    const candidate = new Date(customDeadlineDate);
    candidate.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    setCustomDeadlineDate(candidate);
    setCustomDeadlinePickerMode('date');
    handleConfirmCustomDeadline(candidate);
  }

  function handleConfirmCustomDeadline(input?: Date) {
    const candidate = new Date(input ?? customDeadlineDate);
    candidate.setSeconds(0, 0);
    if (Number.isNaN(candidate.getTime()) || candidate.getTime() <= Date.now()) {
      Alert.alert('Invalid deadline', 'Please choose a future deadline.');
      return false;
    }
    setDeadlineDate(candidate);
    setIsDeadlineCustomized(true);
    return true;
  }

  function openDeadlinePickerFlow() {
    const now = Date.now();
    const candidate = new Date(deadlineDate);
    candidate.setSeconds(0, 0);

    if (Number.isNaN(candidate.getTime()) || candidate.getTime() <= now) {
      candidate.setTime(now + 30 * 60 * 1000);
      candidate.setSeconds(0, 0);
    }

    setCustomDeadlineDate(candidate);

    if (Platform.OS === 'ios') {
      setShowCustomDeadlineIosModal(true);
      return;
    }

    setShowCustomDeadlineAndroidModal(true);
  }

  useEffect(() => {
    const oneHourEnabled = profile?.deadline_one_hour_warning_enabled ?? true;
    const finalEnabled = profile?.deadline_final_warning_enabled ?? true;
    const presetReminders = buildPresetDeadlineReminders(
      deadlineDate,
      removedPresetSources,
      oneHourEnabled,
      finalEnabled,
    );

    setDraftReminders((prev) => {
      const custom = prev.filter((item) => item.source === 'MANUAL');
      return sortDraftReminders([...custom, ...presetReminders]);
    });
  }, [
    deadlineDate,
    removedPresetSources,
    profile?.deadline_one_hour_warning_enabled,
    profile?.deadline_final_warning_enabled,
  ]);

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
    handleAddCustomReminder(candidate);
  }

  function handleRemoveReminder(reminder: DraftReminder) {
    setDraftReminders((prev) => prev.filter((item) => item.id !== reminder.id));
    if (reminder.source !== 'MANUAL') {
      const presetSource = reminder.source as DraftReminderPresetSource;
      setRemovedPresetSources((prev) => (
        prev.includes(presetSource) ? prev : [...prev, presetSource]
      ));
    }
  }

  function handleAddCustomReminder(input?: Date) {
    const candidate = new Date(input ?? customReminderDate);
    candidate.setSeconds(0, 0);

    if (Number.isNaN(candidate.getTime())) {
      Alert.alert('Invalid reminder', 'Please choose a valid reminder date and time.');
      return;
    }
    if (candidate.getTime() <= Date.now()) {
      Alert.alert('Invalid reminder', 'Reminder must be in the future.');
      return;
    }
    if (candidate.getTime() >= deadlineDate.getTime()) {
      Alert.alert('Invalid reminder', 'Reminder must be earlier than the task deadline.');
      return;
    }

    const duplicateExists = draftReminders.some(
      (item) => item.reminderAt.getTime() === candidate.getTime(),
    );
    if (duplicateExists) {
      Alert.alert('Duplicate reminder', 'A reminder already exists for this date and time.');
      return;
    }

    setDraftReminders((prev) => sortDraftReminders([
      ...prev,
      {
        id: `custom-${Date.now()}`,
        reminderAt: candidate,
        source: 'MANUAL',
      },
    ]));

    return true;
  }

  function openAddReminderFlow() {
    const now = Date.now();
    const candidate = new Date(customReminderDate);
    candidate.setSeconds(0, 0);

    if (Number.isNaN(candidate.getTime()) || candidate.getTime() <= now) {
      candidate.setTime(now + 30 * 60 * 1000);
      candidate.setSeconds(0, 0);
    }

    const latestAllowedMs = deadlineDate.getTime() - 60 * 1000;
    if (candidate.getTime() >= latestAllowedMs) {
      candidate.setTime(latestAllowedMs);
      candidate.setSeconds(0, 0);
    }

    if (Number.isNaN(candidate.getTime()) || candidate.getTime() <= now || candidate.getTime() >= deadlineDate.getTime()) {
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

  function handleAddDraftSubtask() {
    const value = newSubtaskDraft.trim();
    if (!value) return;
    setDraftSubtasks((prev) => [
      ...prev,
      { id: `subtask-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, title: value, isCompleted: false },
    ]);
    setNewSubtaskDraft('');
    setTimeout(() => subtaskInputRef.current?.focus(), 20);
  }

  function handleToggleDraftSubtask(id: string) {
    setDraftSubtasks((prev) => prev.map((subtask) => (
      subtask.id === id ? { ...subtask, isCompleted: !subtask.isCompleted } : subtask
    )));
  }

  function handleDeleteDraftSubtask(id: string) {
    setDraftSubtasks((prev) => prev.filter((subtask) => subtask.id !== id));
  }

  function selectRecurrenceType(type: RecurrenceType) {
    setRecurrenceType(type);
    setShowCustomRecurrenceDays(false);
  }

  function clearRecurrenceSelection() {
    setRecurrenceType('');
    setShowCustomRecurrenceDays(false);
    setRecurrenceDays([]);
  }

  function toggleCustomRecurrenceDays() {
    setRecurrenceType('WEEKLY');
    setShowCustomRecurrenceDays((prev) => !prev);
    setRecurrenceDays((prev) => (prev.length > 0 ? prev : [new Date().getDay()]));
  }

  function toggleRecurrenceDay(day: number) {
    setRecurrenceDays((prev) => {
      const next = prev.includes(day)
        ? prev.filter((currentDay) => currentDay !== day)
        : [...prev, day];
      return next.length > 0 ? next : [day];
    });
  }

  function buildManualReminderOffsetsMs(deadline: Date, reminders: DraftReminder[]): number[] {
    const deadlineMs = deadline.getTime();
    if (Number.isNaN(deadlineMs)) return [];

    const unique = new Set<number>();
    for (const reminder of reminders) {
      const reminderMs = reminder.reminderAt.getTime();
      if (Number.isNaN(reminderMs)) continue;
      const offset = deadlineMs - reminderMs;
      if (offset > 0) unique.add(offset);
    }

    return Array.from(unique.values()).sort((a, b) => a - b);
  }

  function buildReminderDateOnDeadlineDay(deadline: Date, hours: number, minutes: number): Date {
    const reminderDate = new Date(deadline);
    reminderDate.setHours(hours, minutes, 0, 0);
    return reminderDate;
  }

  function resolveVoucherIdFromTitle(rawTitle: string): string | null {
    const selfMatch = rawTitle.match(/(?:\bvouch|\.v)\s+(me|self|myself)(?=\s|$|\/)/i);
    if (selfMatch) return currentUserId;

    const vouchMatch = rawTitle.match(/(?:\bvouch|\.v)\s+([^\s/]+)/i);
    if (!vouchMatch) return null;

    const name = vouchMatch[1]
      .toLowerCase()
      .replace(/^[^a-z0-9@._+-]+/i, '')
      .replace(/[^a-z0-9@._+-]+$/i, '');
    if (!name) return null;

    const match = normalizedFriends.find(
      (friend) => friend.username.toLowerCase().includes(name),
    );
    return match?.id ?? null;
  }

  async function handleCreateTask(deadlineOverride?: Date) {
    if (isCreatingTask) return;

    const rawTitle = title.trim();
    if (!rawTitle) {
      closeOverlay();
      return;
    }

    if (!currentUserId) {
      Alert.alert('Not authenticated', 'Please sign in again and retry.');
      return;
    }

    const resolvedVoucherId =
      voucherValue === 'self'
        ? currentUserId
        : voucherValue;

    const normalizedFailureCost = failureCostInput.trim();
    const parsedFailureCostMajor = Number(normalizedFailureCost);
    if (!normalizedFailureCost || !Number.isFinite(parsedFailureCostMajor)) {
      Alert.alert('Invalid failure cost', 'Please enter a valid failure cost.');
      return;
    }

    const failureCostCents = Math.round(parsedFailureCostMajor * 100);
    const activeCurrency: Currency = profile?.currency ?? 'USD';
    const failureBounds = getFailureCostBounds(activeCurrency);
    if (failureCostCents < failureBounds.minCents || failureCostCents > failureBounds.maxCents) {
      const symbol = activeCurrency === 'EUR' ? '€' : activeCurrency === 'INR' ? '₹' : '$';
      Alert.alert(
        'Invalid failure cost',
        `Failure cost must be between ${symbol}${failureBounds.minMajor} and ${symbol}${failureBounds.maxMajor}.`,
      );
      return;
    }

    const eventDurationMinutes = defaultEventDurationMinutes;
    const parsedTask = parseTaskTitleAndSubtasks(rawTitle);
    const taskTitle = parsedTask.title.trim();
    if (!taskTitle) {
      Alert.alert('Missing title', 'Please enter a task title.');
      return;
    }

    const requiredPomoParse = parseRequiredPomoFromTitle(rawTitle);
    if (requiredPomoParse.error) {
      Alert.alert('Invalid pomodoro requirement', requiredPomoParse.error);
      return;
    }

    const parsedVoucherId = resolveVoucherIdFromTitle(rawTitle);
    const effectiveVoucherId = parsedVoucherId ?? resolvedVoucherId;
    if (!effectiveVoucherId) {
      Alert.alert('Missing voucher', 'Please select a voucher.');
      return;
    }

    const parsedEventToken = EVENT_TOKEN_REGEX.test(rawTitle);
    const effectiveEventSyncEnabled = eventSyncEnabled || parsedEventToken;
    const isStrict = /(^|\s)-strict(?=\s|$)/i.test(rawTitle);
    const effectiveTimeBoundEnabled = timeBoundEnabled || isStrict;

    let deadlineToCreate = new Date(deadlineOverride ?? deadlineDate);
    deadlineToCreate.setSeconds(0, 0);
    if (!isDeadlineCustomized && deadlineToCreate.getTime() <= Date.now()) {
      deadlineToCreate = buildDefaultDeadlineDate();
      setDeadlineDate(deadlineToCreate);
      setCustomDeadlineDate(deadlineToCreate);
    }
    const titleHasParserDeadline = titleHasDeadlineToken(rawTitle) || parsedEventToken;
    if (titleHasParserDeadline) {
      const parserResolution = resolveTaskDeadline(rawTitle, new Date(), eventDurationMinutes);
      if (parserResolution.error) {
        Alert.alert('Invalid deadline', parserResolution.error);
        return;
      }
      deadlineToCreate = parserResolution.deadline;
    }

    if (Number.isNaN(deadlineToCreate.getTime()) || deadlineToCreate.getTime() <= Date.now()) {
      Alert.alert('Invalid deadline', 'Please choose a future deadline.');
      return;
    }

    let eventStartIso: string | null = null;
    let eventEndIso: string | null = null;
    let boundedStartIso: string | null = null;
    let startOffsetMinutes: number | null = null;
    if (parsedEventToken) {
      const anchorResolution = resolveEventAnchorDate(rawTitle, new Date());
      if (anchorResolution.error) {
        Alert.alert('Invalid event date', anchorResolution.error);
        return;
      }

      const eventResolution = resolveEventSchedule({
        rawTitle,
        anchorDate: anchorResolution.anchorDate,
        defaultDurationMinutes: eventDurationMinutes,
        now: new Date(),
      });

      if (eventResolution.error || !eventResolution.startDate || !eventResolution.endDate) {
        Alert.alert('Invalid event schedule', eventResolution.error ?? 'Event time is invalid.');
        return;
      }

      deadlineToCreate = eventResolution.endDate;
      eventStartIso = eventResolution.startDate.toISOString();
      eventEndIso = eventResolution.endDate.toISOString();
      startOffsetMinutes = Math.max(
        1,
        Math.round((eventResolution.endDate.getTime() - eventResolution.startDate.getTime()) / 60000),
      );
      if (effectiveTimeBoundEnabled) {
        boundedStartIso = eventStartIso;
      }
    } else if (effectiveEventSyncEnabled || effectiveTimeBoundEnabled) {
      const selectedStartDate = eventStartDate ?? buildDefaultStartBoundaryDate(deadlineToCreate, eventDurationMinutes);
      if (Number.isNaN(selectedStartDate.getTime())) {
        Alert.alert('Invalid start time', 'Please pick a valid start time.');
        return;
      }

      if (selectedStartDate.getTime() < Date.now()) {
        Alert.alert('Invalid start time', 'Start time must be now or later.');
        return;
      }

      if (selectedStartDate.getTime() >= deadlineToCreate.getTime()) {
        Alert.alert('Invalid start time', 'Start time must be before the deadline.');
        return;
      }

      boundedStartIso = selectedStartDate.toISOString();
      startOffsetMinutes = Math.max(
        1,
        Math.round((deadlineToCreate.getTime() - selectedStartDate.getTime()) / 60000),
      );

      if (effectiveEventSyncEnabled) {
        eventStartIso = boundedStartIso;
        eventEndIso = deadlineToCreate.toISOString();
      }
    }

    const parsedReminderTimes = parseReminderTimesFromTitle(rawTitle);
    const oneHourEnabled = profile?.deadline_one_hour_warning_enabled ?? true;
    const finalEnabled = profile?.deadline_final_warning_enabled ?? true;
    const recalculatedPresetReminders = buildPresetDeadlineReminders(
      deadlineToCreate,
      removedPresetSources,
      oneHourEnabled,
      finalEnabled,
    );
    const manualDraftReminders = draftReminders.filter((item) => item.source === 'MANUAL');
    const effectiveDraftReminders = sortDraftReminders([...manualDraftReminders, ...recalculatedPresetReminders]);
    const parserReminderEntries: DraftReminder[] = parsedReminderTimes.map(({ hours, minutes }, index) => ({
      id: `parser-reminder-${index}-${hours}-${minutes}`,
      source: 'MANUAL',
      reminderAt: buildReminderDateOnDeadlineDay(deadlineToCreate, hours, minutes),
    }));
    const reminderByIso = new Map<string, DraftReminder>();
    for (const reminder of [...effectiveDraftReminders, ...parserReminderEntries]) {
      const iso = reminder.reminderAt.toISOString();
      if (!reminderByIso.has(iso)) reminderByIso.set(iso, reminder);
    }
    const remindersToCreate = sortDraftReminders(Array.from(reminderByIso.values()));
    const hasReminderAfterDeadline = remindersToCreate.some(
      (reminder) => reminder.reminderAt.getTime() > deadlineToCreate.getTime(),
    );
    if (hasReminderAfterDeadline) {
      Alert.alert('Invalid reminder', 'Reminders must be before or at the deadline.');
      return;
    }

    const pendingSubtaskTitle = newSubtaskDraft.trim();
    const trimmedSubtaskTitles = [
      ...parsedTask.subtasks,
      ...draftSubtasks.map((subtask) => subtask.title.trim()).filter((subtaskTitle) => subtaskTitle.length > 0),
      ...(pendingSubtaskTitle.length > 0 ? [pendingSubtaskTitle] : []),
    ];

    const parsedRepeatType = parseRepeatTokenFromTitle(rawTitle);
    const effectiveRecurrenceType = parsedRepeatType ?? recurrenceType;
    const titleRequiresProof = parseProofRequiredFromTitle(rawTitle);

    const nowIso = new Date().toISOString();
    const deadlineIso = deadlineToCreate.toISOString();

    const optimisticTaskId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticTask: TaskRowData = {
      id: optimisticTaskId,
      title: taskTitle,
      deadline: deadlineIso,
      status: 'ACTIVE',
      has_proof: false,
      postponed_at: null,
      recurrence_rule_id: null,
      created_at: nowIso,
      subtaskTotal: trimmedSubtaskTitles.length,
      subtaskCompleted: 0,
    };

    setOptimisticTasks((prev) => [optimisticTask, ...prev]);
    closeOverlay();
    Toast.show({
      type: 'proofSuccess',
      text1: formatTimeUntilDeadline(deadlineIso),
      position: 'bottom',
      bottomOffset: 84,
      visibilityTime: 2600,
    });

    setIsCreatingTask(true);
    let createdTaskId: string | null = null;
    try {
      const userClientInstanceId = await resolveUserClientInstanceId(currentUserId);
      let recurrenceRuleId: string | null = null;
      const isAiVoucher = effectiveVoucherId === AI_PROFILE_ID;
      const finalRequiresProof = isAiVoucher
        ? true
        : (defaultRequiresProofForAllTasks || requiresProof || titleRequiresProof);
      const googleEventColorId = effectiveEventSyncEnabled ? selectedGoogleEventColorId : null;

      if (effectiveRecurrenceType) {
        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const recurrenceTime = new Intl.DateTimeFormat('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: userTimezone,
        }).format(deadlineToCreate);

        const ruleConfig: Record<string, unknown> = {
          frequency: effectiveRecurrenceType,
          interval: 1,
          time_of_day: recurrenceTime,
        };

        if (effectiveRecurrenceType === 'WEEKLY') {
          const recurrenceDaysToUse = showCustomRecurrenceDays && recurrenceDays.length > 0
            ? recurrenceDays
            : [deadlineToCreate.getDay()];
          ruleConfig.days_of_week = recurrenceDaysToUse;
        }

        const reminderOffsetsMs = buildManualReminderOffsetsMs(deadlineToCreate, remindersToCreate);
        const lastGeneratedDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: userTimezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(deadlineToCreate);

        const { data: insertedRule, error: recurrenceRuleInsertError } = await supabase
          .from('recurrence_rules')
          .insert({
            user_id: currentUserId,
            voucher_id: effectiveVoucherId,
            title: taskTitle,
            description: null,
            failure_cost_cents: failureCostCents,
            required_pomo_minutes: requiredPomoParse.requiredPomoMinutes,
            requires_proof: finalRequiresProof,
            rule_config: ruleConfig as any,
            timezone: userTimezone,
            google_sync_for_rule: effectiveEventSyncEnabled,
            time_bound_for_rule: effectiveTimeBoundEnabled,
            window_start_offset_minutes: startOffsetMinutes,
            google_event_duration_minutes: effectiveEventSyncEnabled ? startOffsetMinutes : null,
            google_event_color_id: googleEventColorId,
            manual_reminder_offsets_ms: reminderOffsetsMs.length > 0 ? reminderOffsetsMs : null,
            last_generated_date: lastGeneratedDate,
          } as any)
          .select('id')
          .single();

        if (recurrenceRuleInsertError || !insertedRule?.id) {
          setOptimisticTasks((prev) => prev.filter((task) => task.id !== optimisticTaskId));
          Toast.show({
            type: 'proofError',
            text1: 'A task failed to create',
            position: 'bottom',
            bottomOffset: 84,
            visibilityTime: 2600,
          });
          return;
        }
        recurrenceRuleId = insertedRule.id as string;
      }

      const { data: createdTask, error: taskInsertError } = await supabase
        .from('tasks')
        .insert({
          user_id: currentUserId,
          voucher_id: effectiveVoucherId,
          title: taskTitle,
          description: null,
          failure_cost_cents: failureCostCents,
          required_pomo_minutes: requiredPomoParse.requiredPomoMinutes,
          requires_proof: finalRequiresProof,
          deadline: deadlineIso,
          status: 'ACTIVE',
          start_at: effectiveTimeBoundEnabled ? boundedStartIso : null,
          is_strict: effectiveTimeBoundEnabled,
          google_sync_for_task: effectiveEventSyncEnabled,
          google_event_start_at: eventStartIso,
          google_event_end_at: eventEndIso,
          google_event_color_id: googleEventColorId,
          recurrence_rule_id: recurrenceRuleId,
          created_by_user_client_instance_id: userClientInstanceId,
          updated_at: nowIso,
        } as any)
        .select('id')
        .single();

      if (taskInsertError || !createdTask?.id) {
        if (recurrenceRuleId) {
          await supabase
            .from('recurrence_rules')
            .delete()
            .eq('id', recurrenceRuleId)
            .eq('user_id', currentUserId);
        }
        setOptimisticTasks((prev) => prev.filter((task) => task.id !== optimisticTaskId));
        Toast.show({
          type: 'proofError',
          text1: 'A task failed to create',
          position: 'bottom',
          bottomOffset: 84,
          visibilityTime: 2600,
        });
        return;
      }

      createdTaskId = createdTask.id;
      setOptimisticTasks((prev) => prev.map((task) => (
        task.id === optimisticTaskId
          ? {
              ...task,
              id: createdTask.id,
              recurrence_rule_id: recurrenceRuleId,
            }
          : task
      )));

      const subtaskRows = trimmedSubtaskTitles.map((subtaskTitle) => ({
          parent_task_id: createdTask.id,
          user_id: currentUserId,
          title: subtaskTitle,
          is_completed: false,
          completed_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        }));

      if (subtaskRows.length > 0) {
        const { error: subtaskInsertError } = await supabase
          .from('task_subtasks')
          .insert(subtaskRows as any);

        if (subtaskInsertError) {
          await supabase
            .from('tasks')
            .delete()
            .eq('id', createdTask.id)
            .eq('user_id', currentUserId);
          if (recurrenceRuleId) {
            await supabase
              .from('recurrence_rules')
              .delete()
              .eq('id', recurrenceRuleId)
              .eq('user_id', currentUserId);
          }
          setOptimisticTasks((prev) => prev.filter((task) => (
            task.id !== optimisticTaskId && task.id !== createdTask.id
          )));
          Toast.show({
            type: 'proofError',
            text1: 'A task failed to create',
            position: 'bottom',
            bottomOffset: 84,
            visibilityTime: 2600,
          });
          return;
        }
      }

      const reminderRows = remindersToCreate.map((reminder) => {
        const reminderIso = reminder.reminderAt.toISOString();
        return {
          parent_task_id: createdTask.id,
          user_id: currentUserId,
          reminder_at: reminderIso,
          source: reminder.source,
          notified_at: reminder.reminderAt.getTime() <= Date.now() ? nowIso : null,
          created_at: nowIso,
          updated_at: nowIso,
        };
      });

      if (reminderRows.length > 0) {
        const { error: reminderInsertError } = await supabase
          .from('task_reminders')
          .insert(reminderRows as any);

        if (reminderInsertError) {
          await supabase
            .from('tasks')
            .delete()
            .eq('id', createdTask.id)
            .eq('user_id', currentUserId);
          if (recurrenceRuleId) {
            await supabase
              .from('recurrence_rules')
              .delete()
              .eq('id', recurrenceRuleId)
              .eq('user_id', currentUserId);
          }
          setOptimisticTasks((prev) => prev.filter((task) => (
            task.id !== optimisticTaskId && task.id !== createdTask.id
          )));
          Toast.show({
            type: 'proofError',
            text1: 'A task failed to create',
            position: 'bottom',
            bottomOffset: 84,
            visibilityTime: 2600,
          });
          return;
        }
      }

      refetchTasks();
      void syncLocalReminderNotificationsAsync(currentUserId);

      if (effectiveEventSyncEnabled) {
        void (async () => {
          const syncResult = await syncGoogleCalendarTaskAfterCreate(createdTask.id);
          if (syncResult.message) {
            Toast.show({
              type: 'proofError',
              text1: syncResult.message,
              position: 'bottom',
              bottomOffset: 84,
              visibilityTime: 3200,
            });
          }
        })();
      }
    } catch {
      setOptimisticTasks((prev) => prev.filter((task) => (
        task.id !== optimisticTaskId && task.id !== createdTaskId
      )));
      Toast.show({
        type: 'proofError',
        text1: 'A task failed to create',
        position: 'bottom',
        bottomOffset: 84,
        visibilityTime: 2600,
      });
    } finally {
      setIsCreatingTask(false);
    }
  }

  useEffect(() => {
    if (isCreateOverlayOpen) return;
    setSelectedGoogleEventColorId(defaultGoogleEventColorId);
  }, [isCreateOverlayOpen, defaultGoogleEventColorId]);


  // Initialize defaults as soon as profile/friends are available on initial screen load.
  // Also re-apply updated profile defaults later if the user has not manually overridden
  // the voucher selection in the current app session.
  useEffect(() => {
    if (!hasInitializedFailureCostRef.current && profile) {
      setFailureCostInput(
        formatFailureCostFromCents(profile.default_failure_cost_cents, profile.currency),
      );
      hasInitializedFailureCostRef.current = true;
    }

    if (!profile) return;
    const resolvedDefaultVoucher = resolveDefaultVoucherValue();
    if (resolvedDefaultVoucher === null) return;

    if (!hasInitializedVoucherRef.current) {
      setVoucherValue(resolvedDefaultVoucher);
      lastAppliedDefaultVoucherRef.current = resolvedDefaultVoucher;
      hasInitializedVoucherRef.current = true;
      return;
    }

    const lastAppliedDefaultVoucher = lastAppliedDefaultVoucherRef.current;
    const userOverrodeVoucher = voucherValue !== null && voucherValue !== lastAppliedDefaultVoucher;
    if (userOverrodeVoucher) return;

    if (voucherValue !== resolvedDefaultVoucher) {
      setVoucherValue(resolvedDefaultVoucher);
    }
    lastAppliedDefaultVoucherRef.current = resolvedDefaultVoucher;
  }, [profile, resolveDefaultVoucherValue, voucherValue]);

  useEffect(() => {
    if (!isCreateOverlayOpen) return;
    setRequiresProof(defaultRequiresProofForAllTasks);
  }, [isCreateOverlayOpen, defaultRequiresProofForAllTasks]);

  const normalizedFriends = useMemo(
    () =>
      friends.map((friend) => ({
        ...friend,
        username: normalizeAiUsername(friend.id, friend.username, 'Friend'),
      })),
    [friends],
  );

  const voucherLabel = useMemo(() => {
    if (!voucherValue) return 'Select voucher';
    if (voucherValue === 'self') return 'Self vouch';
    return normalizedFriends.find((f) => f.id === voucherValue)?.username ?? 'Select voucher';
  }, [voucherValue, normalizedFriends]);

  const filteredFriends = useMemo(() => {
    const q = voucherSearch.trim().toLowerCase();
    if (!q) return normalizedFriends;
    return normalizedFriends.filter((f) => f.username.toLowerCase().includes(q));
  }, [normalizedFriends, voucherSearch]);

  const [voucherPickerOpen, setVoucherPickerOpen] = useState(false);
  const voucherButtonRef = useRef<View>(null);
  const [voucherAnchor, setVoucherAnchor] = useState<{ pageX: number; pageY: number; width: number; buttonHeight: number } | null>(null);
  const [voucherDropdownHeight, setVoucherDropdownHeight] = useState(300);
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const sortMenuWidth = Math.min(screenWidth - spacing.lg * 2, 320);
  const bottomDockOffset = spacing.xl + spacing.sm + spacing.xs; // 44px
  const bottomDockReservedInset = bottomDockOffset + bottomActionsHeight + spacing.sm;
  const creatorTargetTop = Math.max(insets.top + spacing.md, Math.round(screenHeight * 0.17));
  const creatorTargetHeight = Math.max(200, screenHeight - creatorTargetTop);

  const scrollFocusedSubtaskIntoView = useCallback((inputBottomY: number | null = focusedSubtaskInputBottomYRef.current) => {
    if (inputBottomY == null) return;

    const keyboardTopY = keyboardTopYRef.current;
    if (!Number.isFinite(keyboardTopY)) return;

    const visibilityGap = spacing.md;
    const overlap = inputBottomY + visibilityGap - keyboardTopY;
    if (overlap <= 0) return;

    const nextOffsetY = Math.max(0, taskListScrollOffsetYRef.current + overlap);
    taskListScrollRef.current?.scrollTo({ y: nextOffsetY, animated: true });
  }, []);

  const handleSubtaskComposerFocus = useCallback((inputBottomY: number) => {
    focusedSubtaskInputBottomYRef.current = inputBottomY;
    requestAnimationFrame(() => {
      scrollFocusedSubtaskIntoView(inputBottomY);
    });
  }, [scrollFocusedSubtaskIntoView]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const show = Keyboard.addListener(showEvent, (e) => {
      const nextHeight = Math.max(0, e.endCoordinates?.height ?? 0);
      const nextScreenY = e.endCoordinates?.screenY ?? (screenHeight - nextHeight);

      keyboardTopYRef.current = nextScreenY;
      setTaskListKeyboardInset(nextHeight);

      const focusedBottomY = focusedSubtaskInputBottomYRef.current;
      if (focusedBottomY != null) {
        requestAnimationFrame(() => {
          scrollFocusedSubtaskIntoView(focusedBottomY);
        });
      }
    });

    const hide = Keyboard.addListener(hideEvent, () => {
      keyboardTopYRef.current = Number.POSITIVE_INFINITY;
      setTaskListKeyboardInset(0);
    });

    return () => {
      show.remove();
      hide.remove();
    };
  }, [screenHeight, scrollFocusedSubtaskIntoView]);

  function openSortMenu() {
    if (isOverlayOpen) return;
    sortButtonRef.current?.measureInWindow((x, y, width, height) => {
      setSortAnchor({ pageX: x, pageY: y, width, height });
      setSortMenuOpen(true);
    });
  }

  function openCreateSheet() {
    setSortMenuOpen(false);
    openOverlay('create');
  }

  function openSearchSheet() {
    setSortMenuOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setSearchError(null);
    openOverlay('search');
  }

  function handleSearchResultPress(task: TaskRowData) {
    closeOverlay();
    router.push(`/tasks/${task.id}` as any);
  }

  useEffect(() => {
    if (isSearchOverlayOpen) {
      const focusTimeout = setTimeout(() => searchInputRef.current?.focus(), 50);
      return () => clearTimeout(focusTimeout);
    }
    searchInputRef.current?.blur();
  }, [isSearchOverlayOpen]);

  function closeVoucherPicker() {
    setVoucherPickerOpen(false);
    setVoucherSearch('');
  }


  function openVoucherPicker() {
    // measureInWindow gives true screen coords regardless of parent transforms
    voucherButtonRef.current?.measureInWindow((x, y, width, height) => {
      setVoucherAnchor({ pageX: x, pageY: y, width, buttonHeight: height });
      setVoucherPickerOpen(true);
    });
  }

  const currencySymbol = profile?.currency === 'EUR' ? '€'
    : profile?.currency === 'INR' ? '₹'
    : '$';
  const isAiVoucherSelected = voucherValue === AI_PROFILE_ID;
  const displayName = (authProfile?.username ?? 'there').trim() || 'there';
  const todayParts = getTodayParts();

  function handlePostponeTask(task: TaskRowData) {
    if (task.id.startsWith('optimistic-')) {
      Alert.alert('Please wait', 'Task is still being created.');
      return;
    }

    if (postponingTaskId) {
      Alert.alert('Postpone in progress', 'Please wait for the current postpone action to finish.');
      return;
    }

    if (task.postponed_at) {
      Alert.alert('Already postponed', 'Task has already been postponed once.');
      return;
    }

    // Default to current deadline so the picker opens pre-filled
    const currentDeadline = new Date(task.deadline);
    const initial = Number.isNaN(currentDeadline.getTime()) ? new Date() : currentDeadline;
    setPostponePickerDate(initial);
    setPostponePickerTask(task);
  }

  // iOS: single datetime callback
  function handlePostponePickerChange(_event: DateTimePickerEvent, selected?: Date) {
    if (selected) setPostponePickerDate(selected);
  }

  // Android: separate date-only and time-only callbacks
  function handlePostponeAndroidDateChange(_event: DateTimePickerEvent, selected?: Date) {
    if (!selected) return;
    const next = new Date(selected);
    next.setHours(postponePickerDate.getHours(), postponePickerDate.getMinutes(), 0, 0);
    setPostponePickerDate(next);
  }

  function handlePostponeAndroidTimeChange(_event: DateTimePickerEvent, selected?: Date) {
    if (!selected) return;
    const next = new Date(postponePickerDate);
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    setPostponePickerDate(next);
  }

  async function confirmPostponeWithPicker() {
    if (!postponePickerTask) return;

    const task = postponePickerTask;
    const minDate = task.created_at ? new Date(task.created_at) : new Date(0);

    if (postponePickerDate.getTime() <= minDate.getTime()) {
      Alert.alert('Invalid deadline', 'New deadline must be after the task was created.');
      return;
    }

    setPostponePickerTask(null);
    setPostponingTaskId(task.id);
    try {
      const result = await postponeTaskDeadline(task.id, postponePickerDate.toISOString());
      if (!result.success) {
        Alert.alert('Could not move deadline', result.error ?? 'Unknown error');
        return;
      }
      refetchTasks();
      if (result.userId) {
        void syncLocalReminderNotificationsAsync(result.userId);
      }
    } finally {
      setPostponingTaskId((prev) => (prev === task.id ? null : prev));
    }
  }

  async function handleProofPicked(taskId: string, asset: ImagePickerAsset) {
    if (taskId.startsWith('optimistic-')) {
      Alert.alert('Please wait', 'Task is still being created.');
      return;
    }

    if (proofUploadTaskId) {
      Alert.alert('Upload in progress', 'Please wait for the current proof upload to finish.');
      return;
    }

    setProofUploadTaskId(taskId);
    try {
      const result = await uploadTaskProof(taskId, asset);
      if (!result.success) {
        Alert.alert('Could not attach proof', result.error);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskDetail(taskId) });
      refetchTasks();
      Toast.show({
        type: 'proofSuccess',
        text1: 'Proof uploaded',
        position: 'bottom',
        bottomOffset: 84,
        visibilityTime: 1800,
      });
    } finally {
      setProofUploadTaskId((prev) => (prev === taskId ? null : prev));
    }
  }

  async function handleProofRemoved(taskId: string) {
    if (taskId.startsWith('optimistic-')) {
      Alert.alert('Please wait', 'Task is still being created.');
      return;
    }

    if (proofUploadTaskId) {
      Alert.alert('Upload in progress', 'Please wait for the current proof action to finish.');
      return;
    }

    setProofUploadTaskId(taskId);
    try {
      const result = await removeTaskProof(taskId);
      if (!result.success) {
        Alert.alert('Could not remove proof', result.error ?? 'Unknown error');
        return;
      }
      refetchTasks();
    } finally {
      setProofUploadTaskId((prev) => (prev === taskId ? null : prev));
    }
  }

  async function handleCompleteTask(taskId: string) {
    if (taskId.startsWith('optimistic-')) {
      Alert.alert('Please wait', 'Task is still being created.');
      return;
    }

    if (optimisticallyCompletingTaskIds.includes(taskId)) return;

    type TaskListsCache = {
      dueSoonTasks: TaskRowData[];
      futureTasks: TaskRowData[];
      pastTasks: TaskRowData[];
      hasMorePast: boolean;
    };
    const taskListKey = queryKeys.taskLists(user?.id, sortMode);
    const cachedLists = queryClient.getQueryData<TaskListsCache>(taskListKey);
    const allCached = [
      ...(cachedLists?.dueSoonTasks ?? []),
      ...(cachedLists?.futureTasks ?? []),
      ...(cachedLists?.pastTasks ?? []),
      ...optimisticTasks,
    ];
    const task = allCached.find((t) => t.id === taskId);
    if (task && (task.subtaskTotal ?? 0) > 0 && (task.subtaskCompleted ?? 0) < (task.subtaskTotal ?? 0)) {
      Toast.show({
        type: 'error',
        text1: 'All subtasks must be completed',
        position: 'bottom',
        bottomOffset: 84,
        visibilityTime: 2500,
      });
      return;
    }

    confettiIdRef.current += 1;
    const burstId = Date.now() + confettiIdRef.current;
    if (confettiBursts.length >= 2) {
      setPendingConfettiBursts((prev) => prev + 1);
    } else {
      setConfettiBursts((prev) => [...prev, burstId]);
    }

    setOptimisticallyCompletingTaskIds((prev) => (prev.includes(taskId) ? prev : [...prev, taskId]));
    setOptimisticTasks((prev) => prev.filter((task) => task.id !== taskId));

    const previousTaskLists = queryClient.getQueryData<TaskListsCache>(taskListKey);
    queryClient.setQueryData<TaskListsCache>(taskListKey, (current) => {
      if (!current) return current;
      return {
        ...current,
        dueSoonTasks: current.dueSoonTasks.filter((task) => task.id !== taskId),
        futureTasks: current.futureTasks.filter((task) => task.id !== taskId),
        pastTasks: current.pastTasks.filter((task) => task.id !== taskId),
      };
    });

    const result = await completeTask(taskId);
    if (!result.success) {
      if (previousTaskLists) {
        queryClient.setQueryData(taskListKey, previousTaskLists);
      }
      setOptimisticallyCompletingTaskIds((prev) => prev.filter((id) => id !== taskId));
      Alert.alert('Could not complete task', result.error ?? 'Unknown error');
      return;
    }

    void queryClient.invalidateQueries({ queryKey: queryKeys.taskDetail(taskId) });
    refetchTasks();
    if (result.userId) void syncLocalReminderNotificationsAsync(result.userId);
  }

  async function handleDeleteTask(task: TaskRowData) {
    if (task.id.startsWith('optimistic-')) {
      Alert.alert('Please wait', 'Task is still being created.');
      return;
    }

    const isWithinDeleteWindow = isTaskWithinDeleteWindow(task.created_at);
    if (!isWithinDeleteWindow) {
      Alert.alert('Delete unavailable', 'Tasks can only be deleted within 10 minutes of creation.');
      return;
    }

    const result = await deleteTask(task.id);
    if (!result.success) {
      Alert.alert('Could not delete task', result.error ?? 'Unknown error');
      return;
    }

    if (result.warningMessage) {
      Toast.show({
        type: 'proofError',
        text1: result.warningMessage,
        position: 'bottom',
        bottomOffset: 84,
        visibilityTime: 3200,
      });
    }

    refetchTasks();
    if (result.userId) {
      void syncLocalReminderNotificationsAsync(result.userId);
    }
  }

  const handleCreateTaskRef = useRef(handleCreateTask);
  handleCreateTaskRef.current = handleCreateTask;
  const handleCreateTaskCallback = useCallback((deadlineOverride?: Date) => {
    void handleCreateTaskRef.current(deadlineOverride);
  }, []);

  return (
    <SafeAreaView ref={rootRef} style={styles.safe} edges={['top']}>
      <TaskCreatorOverlay
        visible={isCreateOverlayOpen}
        anchor={creatorAnchor}
        expandProgress={expandProgress}
        screenWidth={screenWidth}
        screenHeight={screenHeight}
        targetTop={creatorTargetTop}
        targetHeight={creatorTargetHeight}
        isCreatingTask={isCreatingTask}
        onCancel={closeOverlay}
        onCreate={handleCreateTaskCallback}
        titleInputRef={titleInputRef}
        title={title}
        onTitleChange={handleTitleChange}
        isTitleFocused={isTitleFocused}
        setIsTitleFocused={setIsTitleFocused}

        keyboardVisible={taskListKeyboardInset > 0}
        draftSubtasks={draftSubtasks}
        onToggleDraftSubtask={handleToggleDraftSubtask}
        onDeleteDraftSubtask={handleDeleteDraftSubtask}
        isSubtaskFocused={isSubtaskFocused}
        setIsSubtaskFocused={setIsSubtaskFocused}
        subtaskInputRef={subtaskInputRef}
        newSubtaskDraft={newSubtaskDraft}
        setNewSubtaskDraft={setNewSubtaskDraft}
        onAddDraftSubtask={handleAddDraftSubtask}
        deadlineDate={deadlineDate}
        customDeadlineDate={customDeadlineDate}
        customDeadlinePickerMode={customDeadlinePickerMode}
        showCustomDeadlineAndroidPicker={showCustomDeadlineAndroidPicker}
        onCustomDeadlineAndroidPickerChange={handleCustomDeadlineAndroidPickerChange}
        onOpenDeadlinePickerFlow={openDeadlinePickerFlow}
        showCustomDeadlineIosModal={showCustomDeadlineIosModal}
        setShowCustomDeadlineIosModal={setShowCustomDeadlineIosModal}
        showCustomDeadlineAndroidModal={showCustomDeadlineAndroidModal}
        setShowCustomDeadlineAndroidModal={setShowCustomDeadlineAndroidModal}
        setCustomDeadlineDate={setCustomDeadlineDate}
        onConfirmCustomDeadline={handleConfirmCustomDeadline}
        voucherButtonRef={voucherButtonRef}
        voucherLabel={voucherLabel}
        voucherValue={voucherValue}
        onOpenVoucherPicker={openVoucherPicker}
        currencySymbol={currencySymbol}
        failureCostInputRef={failureCostInputRef}
        failureCostInput={failureCostInput}
        setFailureCostInput={setFailureCostInput}
        friendsLoading={friendsLoading}
        failureCostSelection={failureCostSelection}
        setFailureCostSelection={setFailureCostSelection}
        draftReminders={draftReminders}
        onRemoveReminder={handleRemoveReminder}
        showCustomReminderAndroidPicker={showCustomReminderAndroidPicker}
        customReminderDate={customReminderDate}
        customReminderPickerMode={customReminderPickerMode}
        onCustomReminderAndroidPickerChange={handleCustomReminderAndroidPickerChange}
        onOpenAddReminderFlow={openAddReminderFlow}
        showCustomReminderIosModal={showCustomReminderIosModal}
        setShowCustomReminderIosModal={setShowCustomReminderIosModal}
        setCustomReminderDate={setCustomReminderDate}
        onAddCustomReminder={handleAddCustomReminder}
        recurrenceType={recurrenceType}
        showCustomRecurrenceDays={showCustomRecurrenceDays}
        onClearRecurrence={clearRecurrenceSelection}
        onSelectRecurrenceType={selectRecurrenceType}
        onToggleCustomRecurrenceDays={toggleCustomRecurrenceDays}
        recurrenceDays={recurrenceDays}
        onToggleRecurrenceDay={toggleRecurrenceDay}
        isAiVoucherSelected={isAiVoucherSelected}
        requiresProof={requiresProof}
        setRequiresProof={setRequiresProof}
        timeBoundEnabled={timeBoundEnabled}
        setTimeBoundEnabled={setTimeBoundEnabled}
        eventSyncEnabled={eventSyncEnabled}
        setEventSyncEnabled={setEventSyncEnabled}
        eventStartDate={eventStartDate}
        setEventStartDate={setEventStartDate}
        selectedGoogleEventColorId={selectedGoogleEventColorId}
        setSelectedGoogleEventColorId={setSelectedGoogleEventColorId}
        suggestedStartDate={suggestedStartBoundaryDate}
        showEventStartAndroidPicker={showEventStartAndroidPicker}
        setShowEventStartAndroidPicker={setShowEventStartAndroidPicker}
      />
      <TaskSearchOverlay
        visible={isSearchOverlayOpen}
        anchor={creatorAnchor}
        expandProgress={expandProgress}
        screenWidth={screenWidth}
        targetTop={creatorTargetTop}
        targetHeight={creatorTargetHeight}
        searchInputRef={searchInputRef}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchLoading={searchLoading}
        searchError={searchError}
        searchResults={searchResults}
        onResultPress={handleSearchResultPress}
        onClose={closeOverlay}
      />

      <TaskSortMenu
        open={sortMenuOpen}
        anchor={sortAnchor}
        sortMenuWidth={sortMenuWidth}
        safeTopInset={insets.top + spacing.sm}
        options={SORT_OPTIONS}
        sortMode={sortMode}
        onChangeSortMode={setSortMode}
        onClose={() => setSortMenuOpen(false)}
      />
      <TaskContent
        header={(
          <TaskTopBar
            displayName={displayName}
            todayParts={todayParts}
            reputationScore={reputationScore}
            showReputationBar={authProfile?.display_rp_bar_on_dashboard ?? false}
          />
        )}
        isSearchActive={false}
        searchLoading={searchLoading}
        searchError={searchError}
        searchResults={searchResults}
        dueSoonTasks={mergedDueSoonTasks}
        futureTasks={mergedFutureTasks}
        pastTasks={visiblePastTasks}
        hasMorePast={hasMorePast}
        loadingMore={loadingMore}
        loadMorePastTasks={loadMorePastTasks}
        refreshing={refreshing}
        onRefresh={async () => {
          setRefreshing(true);
          refetchTasks();
          setRefreshing(false);
        }}
        onComplete={handleCompleteTask}
        onProofPicked={handleProofPicked}
        onProofRemoved={handleProofRemoved}
        onPostpone={handlePostponeTask}
        onDelete={handleDeleteTask}
        defaultPomoDurationMinutes={defaultPomoDurationMinutes}
        scrollRef={taskListScrollRef}
        onScrollOffsetChange={(offsetY) => {
          taskListScrollOffsetYRef.current = offsetY;
        }}
        keyboardBottomInset={taskListKeyboardInset}
        bottomInsetOffset={bottomDockReservedInset}
        onSubtaskComposerFocus={handleSubtaskComposerFocus}
        proofUploadTaskId={proofUploadTaskId}
      />
      <TaskBottomActions
        creatorAnchorRef={creatorAnchorRef}
        sortButtonRef={sortButtonRef}
        onOpenSearchSheet={openSearchSheet}
        onOpenCreateSheet={openCreateSheet}
        onOpenSortMenu={openSortMenu}
        onMeasuredHeight={setBottomActionsHeight}
        overlayOpen={isOverlayOpen}
        bottomOffset={bottomDockOffset}
      />

      {Platform.OS === 'ios' ? (
        <LegacyPostponeCalendarPicker
          task={postponePickerTask}
          date={postponePickerDate}
          setTask={setPostponePickerTask}
          onDateChange={handlePostponePickerChange}
          onAndroidDateChange={handlePostponeAndroidDateChange}
          onAndroidTimeChange={handlePostponeAndroidTimeChange}
          onConfirm={confirmPostponeWithPicker}
        />
      ) : (
        <PostponeDeadlineModal
          task={postponePickerTask}
          date={postponePickerDate}
          setTask={setPostponePickerTask}
          onDateChange={handlePostponePickerChange}
          onConfirm={confirmPostponeWithPicker}
        />
      )}

      <VoucherPickerModal
        visible={voucherPickerOpen}
        anchor={voucherAnchor}
        safeTopInset={insets.top}
        voucherDropdownHeight={voucherDropdownHeight}
        setVoucherDropdownHeight={setVoucherDropdownHeight}
        voucherSearch={voucherSearch}
        setVoucherSearch={setVoucherSearch}
        voucherValue={voucherValue}
        setVoucherValue={setVoucherValue}
        closeVoucherPicker={closeVoucherPicker}
        friendsLoading={friendsLoading}
        friendsError={friendsError}
        filteredFriends={filteredFriends}
      />

      {confettiBursts.length > 0 ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
          {confettiBursts.map((burstId) => (
            <LottieView
              key={`lottie-${burstId}`}
              source={require('../../../assets/animations/confetti.json')}
              autoPlay
              loop={false}
              speed={1.05}
              resizeMode="cover"
              style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
              onAnimationFinish={() => setConfettiBursts((prev) => prev.filter((id) => id !== burstId))}
            />
          ))}
        </View>
      ) : null}
    </SafeAreaView>
  );
}
