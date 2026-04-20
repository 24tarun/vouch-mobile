import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Alert,
  Keyboard,
  Platform,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ImagePickerAsset } from 'expo-image-picker';
import { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useQueryClient } from '@tanstack/react-query';
import ConfettiCannon from 'react-native-confetti-cannon';
import Toast from 'react-native-toast-message';
import { spacing } from '@/lib/theme';
import { styles } from '@/components/tasks/styles';
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
import { TaskContent } from '@/components/tasks/TaskContent';
import { PostponeDeadlineModal } from '@/components/tasks/PostponeDeadlineModal';
import { VoucherPickerModal } from '@/components/tasks/VoucherPickerModal';
import { TaskCreatorOverlay } from '@/components/tasks/TaskCreatorOverlay';
import { TaskSortMenu } from '@/components/tasks/TaskSortMenu';
import { taskCreatorState } from '@/lib/taskCreatorState';
import { parseTitleForDeadline } from '@/lib/task-title-parser';
import { useFriends } from '@/lib/hooks/useFriends';
import { useTasks, type DashboardSortMode } from '@/lib/hooks/useTasks';
import { supabase } from '@/lib/supabase';
import { syncLocalReminderNotificationsAsync } from '@/lib/notifications';
import { resolveUserClientInstanceId } from '@/lib/user-client-instance';
import type { TaskRowData } from '@/components/TaskRow';
import { useAuth } from '@/hooks/useAuth';
import type { Currency } from '@/lib/types';
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

function getFutureBoundaryMs(): number {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const boundary = new Date(startOfToday);
  boundary.setDate(boundary.getDate() + 2);
  return boundary.getTime();
}

export default function TasksScreen() {
  const { profile: authProfile, user } = useAuth();
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
  const [creatorExpanded, setCreatorExpanded] = useState(false);
  const expandAnim = useRef(new Animated.Value(0)).current;
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
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
  const [showCompletionConfetti, setShowCompletionConfetti] = useState(false);
  const [confettiBurstKey, setConfettiBurstKey] = useState(0);
  const confettiHideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [title, setTitle] = useState('');
  const [deadlineDate, setDeadlineDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(23, 59, 0, 0);
    return d;
  });
  const [datePickerMode, setDatePickerMode] = useState<'date' | 'time'>('date');
  const [showAndroidPicker, setShowAndroidPicker] = useState(false);
  // voucherValue: null = unset, 'self' = self-vouch, otherwise a friend's user id
  const [voucherValue, setVoucherValue] = useState<string | null>(null);
  const [voucherSearch, setVoucherSearch] = useState('');
  // failureCostCents stored as string so the TextInput can be freeform
  const [failureCostInput, setFailureCostInput] = useState('');
  const hasInitializedFailureCostRef = useRef(false);
  const hasInitializedVoucherRef = useRef(false);

  const { friends, currentUserId, profile, loading: friendsLoading, error: friendsError } = useFriends();
  const defaultPomoDurationMinutes = authProfile?.default_pomo_duration_minutes ?? 25;

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

  function expandCreator() {
    closeVoucherPicker();
    setRecurrenceType('');
    setShowCustomRecurrenceDays(false);
    setRecurrenceDays([]);
    if (!creatorAnchorRef.current || !rootRef.current) return;

    creatorAnchorRef.current.measureLayout(
      rootRef.current,
      (x, y, width, height) => {
        setCreatorAnchor({ x, y, width, height });
        expandAnim.setValue(0);
        setCreatorExpanded(true);
        Animated.spring(expandAnim, {
          toValue: 1,
          tension: 60,
          friction: 11,
          useNativeDriver: false,
        }).start();
        setTimeout(() => titleInputRef.current?.focus(), 180);
      },
      () => {
        setCreatorAnchor({
          x: spacing.lg,
          y: spacing.lg * 2,
          width: Math.max(220, screenWidth - spacing.lg * 2),
          height: 48,
        });
        expandAnim.setValue(0);
        setCreatorExpanded(true);
        Animated.spring(expandAnim, {
          toValue: 1,
          tension: 60,
          friction: 11,
          useNativeDriver: false,
        }).start();
        setTimeout(() => titleInputRef.current?.focus(), 180);
      },
    );
  }

  function collapseCreator() {
    Keyboard.dismiss();
    closeVoucherPicker();
    Animated.timing(expandAnim, {
      toValue: 0,
      duration: 220,
      useNativeDriver: false,
    }).start(() => {
      setCreatorExpanded(false);
      setCreatorAnchor(null);
      resetCreateDraftState();
    });
  }

  // Keep module-level ref in sync so the tab layout can collapse the creator
  // when any nav tab is pressed.
  useEffect(() => {
    taskCreatorState.isExpanded = creatorExpanded;
    taskCreatorState.collapse = collapseCreator;
  });

  function resetCreateDraftState() {
    setTitle('');
    const nextDeadline = new Date();
    nextDeadline.setHours(23, 59, 0, 0);
    setDeadlineDate(nextDeadline);
    setRemovedPresetSources([]);
    setDraftReminders([]);
    const nextCustomReminder = new Date(Date.now() + 30 * 60 * 1000);
    nextCustomReminder.setSeconds(0, 0);
    setCustomReminderDate(nextCustomReminder);
    setRecurrenceType('');
    setShowCustomRecurrenceDays(false);
    setRecurrenceDays([]);
    setRequiresProof(false);
    setEventSyncEnabled(false);
    setDraftSubtasks([]);
    setNewSubtaskDraft('');
    setShowAndroidPicker(false);
    setShowCustomReminderAndroidPicker(false);
    setShowCustomReminderIosModal(false);
    setCustomReminderPickerMode('date');
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
  const [requiresProof, setRequiresProof] = useState(false);
  const [eventSyncEnabled, setEventSyncEnabled] = useState(false);
  const [draftSubtasks, setDraftSubtasks] = useState<DraftSubtask[]>([]);
  const [newSubtaskDraft, setNewSubtaskDraft] = useState('');
  const subtaskInputRef = useRef<TextInput | null>(null);
  const failureCostInputRef = useRef<TextInput | null>(null);
  const [failureCostSelection, setFailureCostSelection] = useState<{ start: number; end: number } | undefined>(undefined);
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const [isSubtaskFocused, setIsSubtaskFocused] = useState(false);
  const trimmedSearchQuery = searchQuery.trim();
  const isSearchActive = trimmedSearchQuery.length > 0;

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
    const knownTaskIds = new Set([
      ...dueSoonTasks.map((task) => task.id),
      ...futureTasks.map((task) => task.id),
      ...pastTasks.map((task) => task.id),
      ...optimisticTasks.map((task) => task.id),
    ]);

    setOptimisticallyCompletingTaskIds((prev) => {
      const next = prev.filter((id) => knownTaskIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [dueSoonTasks, futureTasks, pastTasks, optimisticTasks, optimisticallyCompletingTaskIds.length]);

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
    if (parsed) setDeadlineDate(parsed);
  }

  function handleDatePickerChange(_event: DateTimePickerEvent, selected?: Date) {
    if (Platform.OS === 'android') setShowAndroidPicker(false);
    if (!selected) return;
    // iOS compact datetime picker provides the full selected datetime directly.
    if (Platform.OS === 'ios') {
      setDeadlineDate(selected);
      return;
    }
    // Android uses separate date/time pickers, so merge the picked part manually.
    if (datePickerMode === 'date') {
      const next = new Date(selected);
      next.setHours(deadlineDate.getHours(), deadlineDate.getMinutes(), 0, 0);
      setDeadlineDate(next);
    } else {
      const next = new Date(deadlineDate);
      next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
      setDeadlineDate(next);
    }
  }

  useEffect(() => {
    const presetReminders: DraftReminder[] = [];
    const oneHourEnabled = profile?.deadline_one_hour_warning_enabled ?? true;
    const finalEnabled = profile?.deadline_final_warning_enabled ?? true;

    if (oneHourEnabled && !removedPresetSources.includes('DEFAULT_DEADLINE_1H')) {
      presetReminders.push({
        id: 'preset-deadline-1h',
        source: 'DEFAULT_DEADLINE_1H',
        reminderAt: new Date(deadlineDate.getTime() - 60 * 60 * 1000),
      });
    }
    if (finalEnabled && !removedPresetSources.includes('DEFAULT_DEADLINE_10M')) {
      presetReminders.push({
        id: 'preset-deadline-10m',
        source: 'DEFAULT_DEADLINE_10M',
        reminderAt: new Date(deadlineDate.getTime() - 10 * 60 * 1000),
      });
    }

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

  async function handleCreateTask() {
    if (isCreatingTask) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      Alert.alert('Missing title', 'Please enter a task title.');
      return;
    }

    if (Number.isNaN(deadlineDate.getTime()) || deadlineDate.getTime() <= Date.now()) {
      Alert.alert('Invalid deadline', 'Please choose a future deadline.');
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
    if (!resolvedVoucherId) {
      Alert.alert('Missing voucher', 'Please select a voucher.');
      return;
    }

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

    const nowIso = new Date().toISOString();
    const deadlineIso = deadlineDate.toISOString();
    const trimmedSubtaskTitles = draftSubtasks
      .map((subtask) => subtask.title.trim())
      .filter((subtaskTitle) => subtaskTitle.length > 0);

    const optimisticTaskId = `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticTask: TaskRowData = {
      id: optimisticTaskId,
      title: trimmedTitle,
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
    collapseCreator();

    setIsCreatingTask(true);
    let createdTaskId: string | null = null;
    try {
      const userClientInstanceId = await resolveUserClientInstanceId(currentUserId);
      let recurrenceRuleId: string | null = null;
      const isAiVoucher = resolvedVoucherId === AI_PROFILE_ID;
      const finalRequiresProof = isAiVoucher ? true : requiresProof;
      const eventDurationMinutes = normalizeEventDurationMinutes(authProfile?.default_event_duration_minutes);
      const eventEndIso = eventSyncEnabled ? deadlineIso : null;
      const eventStartIso = eventSyncEnabled
        ? new Date(deadlineDate.getTime() - eventDurationMinutes * 60 * 1000).toISOString()
        : null;

      if (recurrenceType) {
        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const recurrenceTime = new Intl.DateTimeFormat('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZone: userTimezone,
        }).format(deadlineDate);

        const ruleConfig: Record<string, unknown> = {
          frequency: recurrenceType,
          interval: 1,
          time_of_day: recurrenceTime,
        };

        if (recurrenceType === 'WEEKLY' && showCustomRecurrenceDays && recurrenceDays.length > 0) {
          ruleConfig.days_of_week = recurrenceDays;
        }

        const reminderOffsetsMs = buildManualReminderOffsetsMs(deadlineDate, draftReminders);
        const lastGeneratedDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: userTimezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(deadlineDate);

        const { data: insertedRule, error: recurrenceRuleInsertError } = await supabase
          .from('recurrence_rules')
          .insert({
            user_id: currentUserId,
            voucher_id: resolvedVoucherId,
            title: trimmedTitle,
            description: null,
            failure_cost_cents: failureCostCents,
            required_pomo_minutes: null,
            requires_proof: finalRequiresProof,
            rule_config: ruleConfig as any,
            timezone: userTimezone,
            google_sync_for_rule: eventSyncEnabled,
            google_event_duration_minutes: eventSyncEnabled ? eventDurationMinutes : null,
            google_event_color_id: null,
            manual_reminder_offsets_ms: reminderOffsetsMs.length > 0 ? reminderOffsetsMs : null,
            last_generated_date: lastGeneratedDate,
          } as any)
          .select('id')
          .single();

        if (recurrenceRuleInsertError || !insertedRule?.id) {
          setOptimisticTasks((prev) => prev.filter((task) => task.id !== optimisticTaskId));
          Alert.alert('Could not create task', recurrenceRuleInsertError?.message ?? 'Recurrence rule insert failed.');
          return;
        }
        recurrenceRuleId = insertedRule.id as string;
      }

      const { data: createdTask, error: taskInsertError } = await supabase
        .from('tasks')
        .insert({
          user_id: currentUserId,
          voucher_id: resolvedVoucherId,
          title: trimmedTitle,
          description: null,
          failure_cost_cents: failureCostCents,
          requires_proof: finalRequiresProof,
          deadline: deadlineIso,
          status: 'ACTIVE',
          google_sync_for_task: eventSyncEnabled,
          google_event_start_at: eventStartIso,
          google_event_end_at: eventEndIso,
          google_event_color_id: null,
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
        Alert.alert('Could not create task', taskInsertError?.message ?? 'Task insert failed.');
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
          Alert.alert('Could not create task', subtaskInsertError.message);
          return;
        }
      }

      const reminderRows = sortDraftReminders(draftReminders).map((reminder) => {
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
          Alert.alert('Could not create task', reminderInsertError.message);
          return;
        }
      }

      refetchTasks();
      void syncLocalReminderNotificationsAsync(currentUserId);
    } catch (error: any) {
      setOptimisticTasks((prev) => prev.filter((task) => (
        task.id !== optimisticTaskId && task.id !== createdTaskId
      )));
      Alert.alert('Could not create task', error?.message ?? 'Unknown error');
    } finally {
      setIsCreatingTask(false);
    }
  }

  useEffect(() => {
    if (!creatorExpanded) return;
    const id = setTimeout(() => titleInputRef.current?.focus(), 180);
    return () => clearTimeout(id);
  }, [creatorExpanded]);

  useEffect(() => (
    () => {
      if (confettiHideTimeoutRef.current) {
        clearTimeout(confettiHideTimeoutRef.current);
      }
    }
  ), []);

  // Initialize defaults as soon as profile/friends are available on initial screen load.
  useEffect(() => {
    if (!hasInitializedFailureCostRef.current && profile) {
      setFailureCostInput(
        formatFailureCostFromCents(profile.default_failure_cost_cents, profile.currency),
      );
      hasInitializedFailureCostRef.current = true;
    }

    if (!hasInitializedVoucherRef.current && profile) {
      const resolvedDefaultVoucher = resolveDefaultVoucherValue();
      if (resolvedDefaultVoucher !== null) {
        setVoucherValue(resolvedDefaultVoucher);
        hasInitializedVoucherRef.current = true;
      }
    }
  }, [profile, resolveDefaultVoucherValue]);

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
    sortButtonRef.current?.measureInWindow((x, y, width, height) => {
      setSortAnchor({ pageX: x, pageY: y, width, height });
      setSortMenuOpen(true);
    });
  }

  useEffect(() => {
    if (isSearchOpen) {
      const focusTimeout = setTimeout(() => searchInputRef.current?.focus(), 50);
      return () => clearTimeout(focusTimeout);
    }
    searchInputRef.current?.blur();
  }, [isSearchOpen]);

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

    if (confettiHideTimeoutRef.current) {
      clearTimeout(confettiHideTimeoutRef.current);
    }
    setConfettiBurstKey((prev) => prev + 1);
    setShowCompletionConfetti(true);
    confettiHideTimeoutRef.current = setTimeout(() => {
      setShowCompletionConfetti(false);
      confettiHideTimeoutRef.current = null;
    }, 1500);

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

    refetchTasks();
    if (result.userId) {
      void syncLocalReminderNotificationsAsync(result.userId);
    }
  }

  return (
    <SafeAreaView ref={rootRef} style={styles.safe} edges={['top']}>
      <TaskCreatorOverlay
        visible={creatorExpanded}
        anchor={creatorAnchor}
        expandAnim={expandAnim}
        screenWidth={screenWidth}
        screenHeight={screenHeight}
        isCreatingTask={isCreatingTask}
        onCancel={collapseCreator}
        onCreate={() => {
          void handleCreateTask();
        }}
        titleInputRef={titleInputRef}
        title={title}
        onTitleChange={handleTitleChange}
        isTitleFocused={isTitleFocused}
        setIsTitleFocused={setIsTitleFocused}
        keyboardHeight={taskListKeyboardInset}
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
        datePickerMode={datePickerMode}
        setDatePickerMode={setDatePickerMode}
        showAndroidPicker={showAndroidPicker}
        setShowAndroidPicker={setShowAndroidPicker}
        onDatePickerChange={handleDatePickerChange}
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
        onSelectRecurrenceType={selectRecurrenceType}
        onToggleCustomRecurrenceDays={toggleCustomRecurrenceDays}
        recurrenceDays={recurrenceDays}
        onToggleRecurrenceDay={toggleRecurrenceDay}
        isAiVoucherSelected={isAiVoucherSelected}
        requiresProof={requiresProof}
        setRequiresProof={setRequiresProof}
        eventSyncEnabled={eventSyncEnabled}
        setEventSyncEnabled={setEventSyncEnabled}
      />

      <TaskSortMenu
        open={sortMenuOpen}
        anchor={sortAnchor}
        sortMenuWidth={sortMenuWidth}
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
            creatorAnchorRef={creatorAnchorRef}
            sortButtonRef={sortButtonRef}
            searchInputRef={searchInputRef}
            isSearchOpen={isSearchOpen}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            setIsSearchOpen={setIsSearchOpen}
            expandCreator={expandCreator}
            openSortMenu={openSortMenu}
          />
        )}
        isSearchActive={isSearchActive}
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
        onSubtaskComposerFocus={handleSubtaskComposerFocus}
      />

      <PostponeDeadlineModal
        task={postponePickerTask}
        date={postponePickerDate}
        setTask={setPostponePickerTask}
        onDateChange={handlePostponePickerChange}
        onAndroidDateChange={handlePostponeAndroidDateChange}
        onAndroidTimeChange={handlePostponeAndroidTimeChange}
        onConfirm={confirmPostponeWithPicker}
      />

      <VoucherPickerModal
        visible={voucherPickerOpen}
        anchor={voucherAnchor}
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

      {showCompletionConfetti ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}>
          <ConfettiCannon
            key={`left-${confettiBurstKey}`}
            count={45}
            origin={{ x: -20, y: Math.round(screenHeight * 0.5) }}
            explosionSpeed={350}
            fallSpeed={1150}
            fadeOut
            autoStart
          />
          <ConfettiCannon
            key={`right-${confettiBurstKey}`}
            count={45}
            origin={{ x: screenWidth + 20, y: Math.round(screenHeight * 0.5) }}
            explosionSpeed={350}
            fallSpeed={1150}
            fadeOut
            autoStart
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}
