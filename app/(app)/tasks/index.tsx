import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Alert,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons } from '@expo/vector-icons';
import type { ImagePickerAsset } from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { taskCreatorState } from '@/lib/taskCreatorState';
import { TaskRow } from '@/components/TaskRow';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { StatusPill } from '@/components/StatusPill';
import { parseTitleForDeadline, titleHasDeadlineToken } from '@/lib/task-title-parser';
import { useFriends } from '@/lib/hooks/useFriends';
import { useTasks, type DashboardSortMode } from '@/lib/hooks/useTasks';
import { supabase } from '@/lib/supabase';
import { postponeTask } from '@/lib/task-postpone';
import { uploadTaskProofAsset } from '@/lib/task-proof-upload';
import { syncLocalReminderNotificationsAsync } from '@/lib/notifications';
import { resolveUserClientInstanceId } from '@/lib/user-client-instance';
import type { TaskRowData } from '@/components/TaskRow';
import { useAuth } from '@/hooks/useAuth';
import type { Currency } from '@/lib/types';


function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

interface TodayParts {
  dayName: string;
  day: number;
  ordinal: string;
  monthName: string;
}

interface FailureCostBounds {
  minMajor: number;
  maxMajor: number;
  minCents: number;
  maxCents: number;
}

type DraftReminderPresetSource = 'DEFAULT_DEADLINE_1H' | 'DEFAULT_DEADLINE_10M';
type DraftReminderSource = DraftReminderPresetSource | 'MANUAL';
type RecurrenceType = '' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

interface DraftReminder {
  id: string;
  reminderAt: Date;
  source: DraftReminderSource;
}

interface DraftSubtask {
  id: string;
  title: string;
  isCompleted: boolean;
}

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const WEEKDAY_SHORT: Record<number, string> = {
  0: 'Su',
  1: 'Mo',
  2: 'Tu',
  3: 'We',
  4: 'Th',
  5: 'Fr',
  6: 'Sa',
};
const TASK_DELETE_WINDOW_MS = 10 * 60 * 1000;
const ORCA_PROFILE_ID = '00000000-0000-0000-0000-000000000001';

function getTodayParts(): TodayParts {
  const now = new Date();
  return {
    dayName: now.toLocaleDateString('en-GB', { weekday: 'long' }),
    day: now.getDate(),
    ordinal: getOrdinalSuffix(now.getDate()),
    monthName: now.toLocaleDateString('en-GB', { month: 'long' }),
  };
}

function sortDraftReminders(reminders: DraftReminder[]): DraftReminder[] {
  return [...reminders].sort((a, b) => a.reminderAt.getTime() - b.reminderAt.getTime());
}

function formatReminderDateTimeLabel(date: Date): string {
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
  return `${time} ${day}`;
}

function formatReminderDateChip(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatReminderTimeChip(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function getFailureCostBounds(currency: Currency): FailureCostBounds {
  if (currency === 'INR') {
    return {
      minMajor: 50,
      maxMajor: 1000,
      minCents: 5000,
      maxCents: 100000,
    };
  }

  return {
    minMajor: 1,
    maxMajor: 100,
    minCents: 100,
    maxCents: 10000,
  };
}

function normalizeEventDurationMinutes(value: number | null | undefined): number {
  const numeric = typeof value === 'number' ? value : NaN;
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 720) return numeric;
  return 60;
}

const SORT_OPTIONS: { mode: DashboardSortMode; label: string }[] = [
  { mode: 'deadline_asc', label: 'Sort by deadline ascending' },
  { mode: 'deadline_desc', label: 'Sort by deadline descending' },
  { mode: 'created_asc', label: 'Sort by time created ascending' },
  { mode: 'created_desc', label: 'Sort by time created descending' },
];

export default function TasksScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile: authProfile, user } = useAuth();
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

  function formatFailureCostFromDefaults(defaultFailureCostCents: number, currency: string): string {
    const amount = defaultFailureCostCents / 100;
    if (currency === 'INR') {
      return String(Math.round(amount));
    }
    return amount.toFixed(2).replace(/\.00$/, '');
  }

  function resolveDefaultVoucherValue(): string | null {
    if (!profile) return null;
    const defaultVoucherId = profile.default_voucher_id ?? null;
    if (!currentUserId) return null;
    if (defaultVoucherId) {
      if (defaultVoucherId === currentUserId) return 'self';
      if (friendsLoading) return null;
      if (friends.some((friend) => friend.id === defaultVoucherId)) return defaultVoucherId;
    }
    return 'self';
  }

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
  const [reminderNowMs, setReminderNowMs] = useState(Date.now());
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('');
  const [showCustomRecurrenceDays, setShowCustomRecurrenceDays] = useState(false);
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [requiresProof, setRequiresProof] = useState(false);
  const [eventSyncEnabled, setEventSyncEnabled] = useState(false);
  const [androidKeyboardHeight, setAndroidKeyboardHeight] = useState(0);
  const [draftSubtasks, setDraftSubtasks] = useState<DraftSubtask[]>([]);
  const [newSubtaskDraft, setNewSubtaskDraft] = useState('');
  const subtaskInputRef = useRef<TextInput | null>(null);
  const failureCostInputRef = useRef<TextInput | null>(null);
  const [failureCostSelection, setFailureCostSelection] = useState<{ start: number; end: number } | undefined>(undefined);
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const [isSubtaskFocused, setIsSubtaskFocused] = useState(false);
  const trimmedSearchQuery = searchQuery.trim();
  const isSearchActive = trimmedSearchQuery.length > 0;

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
          .select('id, title, deadline, status')
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
    const intervalId = setInterval(() => {
      setReminderNowMs(Date.now());
    }, 30000);
    return () => clearInterval(intervalId);
  }, []);

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

  function updateCustomReminderTimePart(timeValue: Date) {
    setCustomReminderDate((prev) => {
      const next = new Date(prev);
      next.setHours(timeValue.getHours(), timeValue.getMinutes(), 0, 0);
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

    setIsCreatingTask(true);
    try {
      const nowIso = new Date().toISOString();
      const userClientInstanceId = await resolveUserClientInstanceId(currentUserId);
      let recurrenceRuleId: string | null = null;
      const isAiVoucher = resolvedVoucherId === ORCA_PROFILE_ID;
      const finalRequiresProof = isAiVoucher ? true : requiresProof;
      const eventDurationMinutes = normalizeEventDurationMinutes(authProfile?.default_event_duration_minutes);

      // Send deadline as an explicit UTC ISO string so the TIMESTAMPTZ column
      // is never ambiguous regardless of the server's session timezone.
      const deadlineIso = deadlineDate.toISOString();
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
        Alert.alert('Could not create task', taskInsertError?.message ?? 'Task insert failed.');
        return;
      }

      const subtaskRows = draftSubtasks
        .map((subtask) => subtask.title.trim())
        .filter((subtaskTitle) => subtaskTitle.length > 0)
        .map((subtaskTitle) => ({
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
          Alert.alert('Could not create task', reminderInsertError.message);
          return;
        }
      }

      resetCreateDraftState();
      collapseCreator();
      refetchTasks();
      void syncLocalReminderNotificationsAsync(currentUserId);
    } finally {
      setIsCreatingTask(false);
    }
  }

  useEffect(() => {
    if (!creatorExpanded) return;
    const id = setTimeout(() => titleInputRef.current?.focus(), 180);
    return () => clearTimeout(id);
  }, [creatorExpanded]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      setAndroidKeyboardHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setAndroidKeyboardHeight(0);
    });
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Initialize defaults as soon as profile/friends are available on initial screen load.
  useEffect(() => {
    if (!hasInitializedFailureCostRef.current && profile) {
      setFailureCostInput(
        formatFailureCostFromDefaults(profile.default_failure_cost_cents, profile.currency),
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
  }, [profile, currentUserId, friends, friendsLoading]);

  const voucherLabel = useMemo(() => {
    if (!voucherValue) return 'Select voucher';
    if (voucherValue === 'self') return 'Self vouch';
    return friends.find((f) => f.id === voucherValue)?.username ?? 'Select voucher';
  }, [voucherValue, friends]);

  const filteredFriends = useMemo(() => {
    const q = voucherSearch.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((f) => f.username.toLowerCase().includes(q));
  }, [friends, voucherSearch]);

  const [voucherPickerOpen, setVoucherPickerOpen] = useState(false);
  const voucherButtonRef = useRef<View>(null);
  const [voucherAnchor, setVoucherAnchor] = useState<{ pageX: number; pageY: number; width: number; buttonHeight: number } | null>(null);
  const [voucherDropdownHeight, setVoucherDropdownHeight] = useState(300);
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const sortMenuWidth = Math.min(screenWidth - spacing.lg * 2, 320);

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
  const isAiVoucherSelected = voucherValue === ORCA_PROFILE_ID;
  const displayName = (authProfile?.username || user?.email?.split('@')[0] || 'there').trim();
  const todayParts = getTodayParts();

  function handlePostponeTask(task: TaskRowData) {
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
      const result = await postponeTask(task.id, postponePickerDate.toISOString());
      if (!result.success) {
        Alert.alert('Could not move deadline', result.error);
        return;
      }
      refetchTasks();
      if (user?.id) {
        void syncLocalReminderNotificationsAsync(user.id);
      }
    } finally {
      setPostponingTaskId((prev) => (prev === task.id ? null : prev));
    }
  }

  async function handleProofPicked(taskId: string, asset: ImagePickerAsset) {
    if (proofUploadTaskId) {
      Alert.alert('Upload in progress', 'Please wait for the current proof upload to finish.');
      return;
    }

    setProofUploadTaskId(taskId);
    try {
      const result = await uploadTaskProofAsset(taskId, asset);
      if (!result.success) {
        Alert.alert('Could not attach proof', result.error);
        return;
      }
      refetchTasks();
      Alert.alert('Proof attached', result.mediaKind === 'video' ? 'Video proof uploaded.' : 'Photo proof uploaded.');
    } finally {
      setProofUploadTaskId((prev) => (prev === taskId ? null : prev));
    }
  }

  async function handleCompleteTask(taskId: string) {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      Alert.alert('Not authenticated', 'Please sign in again and retry.');
      return;
    }

    const { error } = await supabase
      .from('tasks')
      .update({ status: 'MARKED_COMPLETE', updated_at: new Date().toISOString() } as any)
      .eq('id', taskId)
      .eq('user_id', userId);

    if (error) {
      Alert.alert('Could not complete task', error.message);
      return;
    }

    refetchTasks();
    if (userId) void syncLocalReminderNotificationsAsync(userId);
  }

  async function handleDeleteTask(task: TaskRowData) {
    const createdAtMs = task.created_at ? new Date(task.created_at).getTime() : NaN;
    const isWithinDeleteWindow = Number.isFinite(createdAtMs) && (Date.now() - createdAtMs) <= TASK_DELETE_WINDOW_MS;
    if (!isWithinDeleteWindow) {
      Alert.alert('Delete unavailable', 'Tasks can only be deleted within 10 minutes of creation.');
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      Alert.alert('Not authenticated', 'Please sign in again and retry.');
      return;
    }

    const nowIso = new Date().toISOString();
    const { error } = await supabase
      .from('tasks')
      .update({
        status: 'DELETED',
        updated_at: nowIso,
      } as any)
      .eq('id', task.id)
      .eq('user_id', userId);

    if (error) {
      Alert.alert('Could not delete task', error.message);
      return;
    }

    refetchTasks();
    void syncLocalReminderNotificationsAsync(userId);
  }

  return (
    <SafeAreaView ref={rootRef} style={styles.safe} edges={['top']}>
      <View style={styles.taskHeader}>
        <Text style={styles.taskGreeting}>Hello, {displayName}</Text>
        <View style={styles.taskDateRow}>
          <Text style={styles.taskDateIts}>Its</Text>
          <Text style={styles.taskDate}>{todayParts.dayName} {todayParts.day}</Text>
          <Text style={styles.taskDateOrdinal}>{todayParts.ordinal}</Text>
          <Text style={styles.taskDate}> {todayParts.monthName}.</Text>
        </View>
      </View>
      {/* Anchored task creator trigger + sort + search */}
      <View ref={creatorAnchorRef} collapsable={false} style={styles.inlineCreatorWrap}>
        <Pressable
          style={styles.inlineCreatorBar}
          onPress={expandCreator}
          android_ripple={{ color: colors.inputBg, radius: 0 }}
        >
          {isSearchOpen ? (
            <View style={styles.inlineCreatorSearchArea}>
              <TextInput
                ref={searchInputRef}
                style={styles.searchInput}
                placeholderTextColor={colors.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
                  <Feather name="x-circle" size={16} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View
              style={styles.inlineCreatorMain}
              pointerEvents="none"
            >
              <Text style={styles.inlineCreatorPlaceholder}>Add, sort, search tasks</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.sortTriggerButton}
            onPress={expandCreator}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Add a new task"
          >
            <Feather name="plus" size={16} color={colors.textMuted} />
          </TouchableOpacity>

          <View ref={sortButtonRef} collapsable={false}>
            <TouchableOpacity
              style={styles.sortTriggerButton}
              onPress={openSortMenu}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Sort tasks"
            >
              <Ionicons name="swap-vertical-outline" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.searchIconButton}
            onPress={isSearchOpen
              ? () => { setSearchQuery(''); setIsSearchOpen(false); }
              : () => setIsSearchOpen(true)
            }
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={isSearchOpen ? 'Close search' : 'Open task search'}
          >
            <Feather name={isSearchOpen ? 'x' : 'search'} size={16} color={colors.textMuted} />
          </TouchableOpacity>
        </Pressable>
      </View>

      {creatorExpanded && creatorAnchor && (
        <>
          <Pressable style={styles.creatorOverlayBackdrop} onPress={collapseCreator} />
          <Animated.View
            style={[
              styles.creatorFloatingActions,
              {
                top: creatorAnchor.y - 78,
                opacity: expandAnim.interpolate({
                  inputRange: [0.6, 1],
                  outputRange: [0, 1],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          >
            <View style={styles.creatorButtonStack}>
              <TouchableOpacity
                style={styles.sheetCancelButton}
                onPress={collapseCreator}
                activeOpacity={0.8}
              >
                <Text style={styles.sheetCancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sheetCreateButton, isCreatingTask && styles.sheetCreateButtonDisabled]}
                onPress={() => { void handleCreateTask(); }}
                disabled={isCreatingTask}
                activeOpacity={0.8}
              >
                {isCreatingTask
                  ? <ActivityIndicator size="small" color={colors.primaryFg} />
                  : <Text style={styles.sheetCreateButtonText}>Create</Text>
                }
              </TouchableOpacity>
            </View>
          </Animated.View>
          <Animated.View
            style={[
              styles.creatorOverlay,
              {
                top: expandAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [creatorAnchor.y, creatorAnchor.y],
                }),
                left: expandAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [creatorAnchor.x, 0],
                }),
                width: expandAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [creatorAnchor.width, screenWidth],
                }),
                height: expandAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [creatorAnchor.height, screenHeight - creatorAnchor.y],
                }),
                borderTopLeftRadius: expandAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [radius.lg, radius.xl],
                }),
                borderTopRightRadius: expandAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [radius.lg, radius.xl],
                }),
                borderBottomLeftRadius: expandAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [radius.lg, 0],
                }),
                borderBottomRightRadius: expandAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [radius.lg, 0],
                }),
                borderColor: expandAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [colors.border, colors.borderStrong],
                }),
              },
            ]}
          >
            <Pressable
              style={[styles.inlineCreatorBar, isTitleFocused && styles.inlineCreatorBarFocused]}
              onPress={() => titleInputRef.current?.focus()}
            >
              <TextInput
                ref={titleInputRef}
                style={styles.inlineCreatorTitleInput}
                placeholder="Task title"
                placeholderTextColor={colors.textMuted}
                value={title}
                onChangeText={handleTitleChange}
                returnKeyType="done"
                onFocus={() => setIsTitleFocused(true)}
                onBlur={() => setIsTitleFocused(false)}
              />
            </Pressable>

            <ScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              automaticallyAdjustKeyboardInsets
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[
                styles.sheetContent,
                androidKeyboardHeight > 0 && { paddingBottom: androidKeyboardHeight + spacing.xxl },
              ]}
            >
          <View style={styles.creatorSubtasksCard}>
            {draftSubtasks.map((subtask) => (
              <View key={subtask.id} style={styles.creatorSubtaskItemRow}>
                <TouchableOpacity
                  onPress={() => handleToggleDraftSubtask(subtask.id)}
                  style={[styles.creatorSubtaskCircle, subtask.isCompleted && styles.creatorSubtaskCircleCompleted]}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  {subtask.isCompleted && <Feather name="check" size={11} color={colors.success} />}
                </TouchableOpacity>
                <Text
                  style={[styles.creatorSubtaskItemTitle, subtask.isCompleted && styles.creatorSubtaskItemTitleCompleted]}
                  numberOfLines={2}
                >
                  {subtask.title}
                </Text>
                <TouchableOpacity
                  onPress={() => handleDeleteDraftSubtask(subtask.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  <Feather name="x" size={14} color={colors.destructive} />
                </TouchableOpacity>
              </View>
            ))}
            <Pressable
              style={[styles.creatorSubtaskComposerRow, isSubtaskFocused && styles.creatorSubtaskComposerRowFocused]}
              onPress={() => subtaskInputRef.current?.focus()}
            >
              <Feather name="plus" size={16} color={isSubtaskFocused ? colors.accentCyan : colors.textMuted} />
              <TextInput
                ref={subtaskInputRef}
                style={styles.creatorSubtaskInput}
                placeholder="Add subtask..."
                placeholderTextColor={colors.textMuted}
                value={newSubtaskDraft}
                onChangeText={setNewSubtaskDraft}
                returnKeyType="done"
                blurOnSubmit={false}
                onSubmitEditing={handleAddDraftSubtask}
                onFocus={() => setIsSubtaskFocused(true)}
                onBlur={() => setIsSubtaskFocused(false)}
              />
              {newSubtaskDraft.trim().length > 0 && (
                <TouchableOpacity
                  onPress={handleAddDraftSubtask}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  activeOpacity={0.7}
                >
                  <Feather name="check" size={16} color={colors.success} />
                </TouchableOpacity>
              )}
            </Pressable>
          </View>

          <View style={styles.section}>
            <View style={styles.field}>
              <View style={styles.deadlineField}>
                <View style={styles.deadlineLabelWrap}>
                  <Text style={styles.fieldLabel}>Deadline</Text>
                  {titleHasDeadlineToken(title) && (
                    <View style={styles.parsedDot} />
                  )}
                </View>
                {Platform.OS === 'ios' ? (
                  <DateTimePicker
                    value={deadlineDate}
                    mode="datetime"
                    display="compact"
                    minimumDate={new Date()}
                    onChange={handleDatePickerChange}
                    themeVariant="dark"
                    accentColor={colors.warning}
                    style={styles.datePicker}
                  />
                ) : (
                  <View style={styles.deadlineChipsWrap}>
                    <TouchableOpacity
                      style={styles.reminderChip}
                      activeOpacity={0.8}
                      onPress={() => { setDatePickerMode('date'); setShowAndroidPicker(true); }}
                    >
                      <Feather name="calendar" size={14} color={colors.textMuted} />
                      <Text style={styles.reminderChipText}>{formatReminderDateChip(deadlineDate)}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.reminderChip}
                      activeOpacity={0.8}
                      onPress={() => { setDatePickerMode('time'); setShowAndroidPicker(true); }}
                    >
                      <Feather name="clock" size={14} color={colors.textMuted} />
                      <Text style={styles.reminderChipText}>{formatReminderTimeChip(deadlineDate)}</Text>
                    </TouchableOpacity>
                    {showAndroidPicker && (
                      <DateTimePicker
                        value={deadlineDate}
                        mode={datePickerMode}
                        display="default"
                        minimumDate={new Date()}
                        onChange={handleDatePickerChange}
                      />
                    )}
                  </View>
                )}
              </View>
            </View>

            <View style={styles.fieldsRow}>
              <View style={[styles.field, styles.fieldInRow]} ref={voucherButtonRef} collapsable={false}>
                <TouchableOpacity
                  style={styles.inlineLabeledField}
                  onPress={openVoucherPicker}
                  activeOpacity={0.8}
                >
                  <Feather name="users" size={18} color={colors.textMuted} />
                  <View style={styles.inlineFieldValueWrap}>
                    <Text style={[styles.inlineFieldValue, !voucherValue && { color: colors.textSubtle }]}>
                      {voucherLabel}
                    </Text>
                    <Feather name="chevron-down" size={18} color={colors.textMuted} />
                  </View>
                </TouchableOpacity>
              </View>

              <View style={[styles.field, styles.fieldInRow]}>
                <Pressable style={styles.inlineLabeledField} onPress={() => failureCostInputRef.current?.focus()}>
                  <View style={styles.currencyIconsWrap}>
                    <Text style={styles.currencyIconSymbol}>{currencySymbol}</Text>
                    <Text style={styles.currencyIconSymbol}>{currencySymbol}</Text>
                  </View>
                  <TextInput
                    ref={failureCostInputRef}
                    style={styles.inlineFailureCostInput}
                    value={failureCostInput}
                    onChangeText={(t) => setFailureCostInput(t.replace(/[^0-9.]/g, ''))}
                    keyboardType="decimal-pad"
                    placeholder={friendsLoading ? '…' : '0'}
                    placeholderTextColor={colors.textSubtle}
                    returnKeyType="done"
                    selection={failureCostSelection}
                    onFocus={() => setFailureCostSelection({ start: failureCostInput.length, end: failureCostInput.length })}
                    onSelectionChange={() => setFailureCostSelection(undefined)}
                  />
                </Pressable>
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.reminderCard}>
              <View style={styles.reminderHeaderRow}>
                <Text style={styles.placeholderRowTitle}>Reminders</Text>
              </View>
              {draftReminders.length === 0 ? (
                <Text style={styles.reminderEmpty}>No reminders set.</Text>
              ) : (
                draftReminders.map((reminder, index) => {
                  const sent = reminder.reminderAt.getTime() <= reminderNowMs;
                  return (
                    <View key={reminder.id} style={styles.reminderRow}>
                      <View style={styles.reminderIndexWrap}>
                        <Text style={styles.reminderIndex}>#{index + 1}</Text>
                      </View>
                      <View style={styles.reminderBody}>
                        <Text style={styles.reminderAt}>{formatReminderDateTimeLabel(reminder.reminderAt)}</Text>
                      </View>
                      <Text style={styles.reminderStatus}>{sent ? 'Sent' : 'Scheduled'}</Text>
                      <TouchableOpacity
                        onPress={() => handleRemoveReminder(reminder)}
                        activeOpacity={0.75}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove reminder #${index + 1}`}
                        hitSlop={8}
                      >
                        <Feather name="trash-2" size={16} color={colors.destructive} />
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
              <View style={styles.reminderComposer}>
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
                  style={styles.addReminderButton}
                  activeOpacity={0.85}
                  onPress={openAddReminderFlow}
                  accessibilityRole="button"
                  accessibilityLabel="Add reminder"
                >
                  <Feather name="plus" size={16} color="#FBBF24" />
                  <Text style={styles.addReminderText}>Add reminder</Text>
                </TouchableOpacity>
              </View>
            </View>

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
                    maximumDate={new Date(deadlineDate.getTime() - 60 * 1000)}
                    onChange={(_event, selected) => { if (selected) setCustomReminderDate(selected); }}
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
                      style={styles.reminderPickerConfirm}
                      activeOpacity={0.85}
                      onPress={() => {
                        const didAdd = handleAddCustomReminder(customReminderDate);
                        if (didAdd) setShowCustomReminderIosModal(false);
                      }}
                    >
                      <Text style={styles.reminderPickerConfirmText}>Add reminder</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </Modal>
            )}

            <View style={styles.recurrenceCard}>
              <View style={styles.recurrenceChipWrap}>
                <TouchableOpacity
                  style={[styles.recurrenceChip, recurrenceType === '' && !showCustomRecurrenceDays && styles.recurrenceChipActive]}
                  activeOpacity={0.8}
                  onPress={() => selectRecurrenceType('')}
                >
                  <Text style={[styles.recurrenceChipText, recurrenceType === '' && !showCustomRecurrenceDays && styles.recurrenceChipTextActive]}>None</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.recurrenceChip, recurrenceType === 'DAILY' && !showCustomRecurrenceDays && styles.recurrenceChipActive]}
                  activeOpacity={0.8}
                  onPress={() => selectRecurrenceType('DAILY')}
                >
                  <Text style={[styles.recurrenceChipText, recurrenceType === 'DAILY' && !showCustomRecurrenceDays && styles.recurrenceChipTextActive]}>Daily</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.recurrenceChip, recurrenceType === 'WEEKLY' && !showCustomRecurrenceDays && styles.recurrenceChipActive]}
                  activeOpacity={0.8}
                  onPress={() => selectRecurrenceType('WEEKLY')}
                >
                  <Text style={[styles.recurrenceChipText, recurrenceType === 'WEEKLY' && !showCustomRecurrenceDays && styles.recurrenceChipTextActive]}>Weekly</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.recurrenceChip, recurrenceType === 'MONTHLY' && !showCustomRecurrenceDays && styles.recurrenceChipActive]}
                  activeOpacity={0.8}
                  onPress={() => selectRecurrenceType('MONTHLY')}
                >
                  <Text style={[styles.recurrenceChipText, recurrenceType === 'MONTHLY' && !showCustomRecurrenceDays && styles.recurrenceChipTextActive]}>Monthly</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.recurrenceChip, showCustomRecurrenceDays && styles.recurrenceChipActive]}
                  activeOpacity={0.8}
                  onPress={toggleCustomRecurrenceDays}
                >
                  <Feather name="repeat" size={12} color={showCustomRecurrenceDays ? '#C084FC' : colors.textMuted} />
                  <Text style={[styles.recurrenceChipText, showCustomRecurrenceDays && styles.recurrenceChipTextActive]}>Custom</Text>
                </TouchableOpacity>
              </View>
              {showCustomRecurrenceDays && (
                <View style={styles.recurrenceDaysRow}>
                  {WEEKDAY_ORDER.map((day) => {
                    const selected = recurrenceDays.includes(day);
                    return (
                      <TouchableOpacity
                        key={day}
                        style={[styles.recurrenceDayBtn, selected && styles.recurrenceDayBtnActive]}
                        activeOpacity={0.8}
                        onPress={() => toggleRecurrenceDay(day)}
                      >
                        <Text style={[styles.recurrenceDayText, selected && styles.recurrenceDayTextActive]}>
                          {WEEKDAY_SHORT[day]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>

            <View style={styles.placeholderRow}>
              <View style={styles.placeholderRowTextWrap}>
                <Text style={styles.placeholderRowTitle}>Require proof</Text>
              </View>
              <Switch
                value={isAiVoucherSelected ? true : requiresProof}
                onValueChange={setRequiresProof}
                disabled={isAiVoucherSelected}
                trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                thumbColor={colors.text}
              />
            </View>

            <View style={styles.placeholderRow}>
              <View style={styles.placeholderRowTextWrap}>
                <Text style={styles.placeholderRowTitle}>Is event</Text>
              </View>
              <Switch
                value={eventSyncEnabled}
                onValueChange={setEventSyncEnabled}
                trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                thumbColor={colors.text}
              />
            </View>
          </View>
            </ScrollView>
          </Animated.View>
        </>
      )}

      {sortMenuOpen && sortAnchor && (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSortMenuOpen(false)} />
          <View
            style={[
              styles.sortDropdown,
              {
                top: sortAnchor.pageY + sortAnchor.height + 8,
                left: Math.max(spacing.lg, sortAnchor.pageX + sortAnchor.width - sortMenuWidth),
                width: sortMenuWidth,
              },
            ]}
          >
            {SORT_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.mode}
                style={styles.sortDropdownItem}
                activeOpacity={0.75}
                onPress={() => {
                  setSortMode(option.mode);
                  setSortMenuOpen(false);
                }}
                accessibilityRole="button"
                accessibilityLabel={option.label}
              >
                <Text style={styles.sortDropdownText}>{option.label}</Text>
                {sortMode === option.mode && (
                  <Feather name="check" size={16} color={colors.accentCyan} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </>
      )}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.taskList}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              refetchTasks();
              setRefreshing(false);
            }}
            tintColor={colors.textMuted}
            colors={[colors.textMuted]}
          />
        }
      >
        {isSearchActive ? (
          <>
            {searchLoading ? (
              <Text style={styles.placeholder}>Searching tasks…</Text>
            ) : searchError ? (
              <Text style={[styles.placeholder, { color: colors.destructive }]}>{searchError}</Text>
            ) : searchResults.length === 0 ? (
              <Text style={styles.placeholder}>No matching tasks found.</Text>
            ) : (
              searchResults.map((task) => (
                <TouchableOpacity
                  key={`search-${task.id}`}
                  style={styles.searchResultRow}
                  activeOpacity={0.7}
                  onPress={() => router.push(`/tasks/${task.id}` as any)}
                  accessibilityRole="button"
                  accessibilityLabel={task.title}
                >
                  <Text style={styles.searchResultTitle} numberOfLines={1}>
                    {task.title}
                  </Text>
                  <View style={styles.searchResultMeta}>
                    {task.status && <StatusPill status={task.status} />}
                    <Feather name="external-link" size={14} color={colors.textMuted} />
                  </View>
                </TouchableOpacity>
              ))
            )}
          </>
        ) : dueSoonTasks.length === 0 && futureTasks.length === 0 && pastTasks.length === 0 ? (
          <Text style={styles.placeholder}>Your tasks will appear here.</Text>
        ) : (
          <>
            {dueSoonTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onComplete={handleCompleteTask}
                onProofPicked={handleProofPicked}
                onPostpone={handlePostponeTask}
                onDelete={handleDeleteTask}
                defaultPomoDurationMinutes={defaultPomoDurationMinutes}
              />
            ))}
            <CollapsibleSection
              title="Future"
              tasks={futureTasks}
              onComplete={handleCompleteTask}
              onProofPicked={handleProofPicked}
              onPostpone={handlePostponeTask}
              onDelete={handleDeleteTask}
              defaultPomoDurationMinutes={defaultPomoDurationMinutes}
            />
            <CollapsibleSection
              title="Past"
              tasks={pastTasks}
              hasMore={hasMorePast}
              loadingMore={loadingMore}
              onLoadMore={loadMorePastTasks}
              onComplete={handleCompleteTask}
              onProofPicked={handleProofPicked}
              onPostpone={handlePostponeTask}
              onDelete={handleDeleteTask}
              defaultPomoDurationMinutes={defaultPomoDurationMinutes}
            />
          </>
        )}
      </ScrollView>

      {/* Postpone deadline picker */}
      <Modal
        visible={postponePickerTask !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPostponePickerTask(null)}
      >
        <Pressable style={styles.postponeBackdrop} onPress={() => setPostponePickerTask(null)} />
        <View style={styles.postponeSheet}>
          <Text style={styles.postponeTitle}>Move Deadline</Text>
          {postponePickerTask && (
            <Text style={styles.postponeSubtitle} numberOfLines={1}>
              {postponePickerTask.title}
            </Text>
          )}

          {Platform.OS === 'ios' ? (
            <DateTimePicker
              value={postponePickerDate}
              mode="datetime"
              display="inline"
              minimumDate={postponePickerTask?.created_at ? new Date(postponePickerTask.created_at) : undefined}
              onChange={handlePostponePickerChange}
              themeVariant="dark"
              accentColor={colors.warning}
              style={styles.postponeIosPicker}
            />
          ) : (
            <View style={styles.postponeAndroidRow}>
              <DateTimePicker
                value={postponePickerDate}
                mode="date"
                display="calendar"
                minimumDate={postponePickerTask?.created_at ? new Date(postponePickerTask.created_at) : undefined}
                onChange={handlePostponeAndroidDateChange}
              />
              <DateTimePicker
                value={postponePickerDate}
                mode="time"
                display="spinner"
                onChange={handlePostponeAndroidTimeChange}
              />
            </View>
          )}

          <View style={styles.postponeActions}>
            <TouchableOpacity
              style={styles.postponeCancelBtn}
              onPress={() => setPostponePickerTask(null)}
              activeOpacity={0.7}
            >
              <Text style={styles.postponeCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.postponeConfirmBtn}
              onPress={() => { void confirmPostponeWithPicker(); }}
              activeOpacity={0.7}
            >
              <Text style={styles.postponeConfirmText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Voucher picker — modal overlay so measureInWindow coords are window-accurate */}

      <Modal
        visible={voucherPickerOpen && voucherAnchor != null}
        transparent
        animationType="none"
        onRequestClose={closeVoucherPicker}
        statusBarTranslucent
      >
        {voucherAnchor && (
        <>
          <Pressable style={styles.voucherBackdrop} onPress={closeVoucherPicker} />
          <View
            onLayout={(e) => setVoucherDropdownHeight(e.nativeEvent.layout.height)}
            style={[
              styles.voucherDropdown,
              {
                left: voucherAnchor.pageX,
                width: voucherAnchor.width,
                top: Math.max(8, voucherAnchor.pageY - voucherDropdownHeight - 6),
              },
            ]}
          >
            <View style={styles.voucherSearch}>
              <Feather name="search" size={14} color={colors.textMuted} />
              <TextInput
                style={styles.voucherSearchInput}
                placeholder="Search friends..."
                placeholderTextColor={colors.textMuted}
                value={voucherSearch}
                onChangeText={setVoucherSearch}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {voucherSearch.length > 0 && (
                <TouchableOpacity onPress={() => setVoucherSearch('')} hitSlop={8}>
                  <Feather name="x-circle" size={14} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={styles.voucherDropdownScroll}
            >
              {!voucherSearch && (
                <TouchableOpacity
                  style={[styles.voucherRow, voucherValue === 'self' && styles.voucherRowSelected]}
                  onPress={() => { setVoucherValue('self'); closeVoucherPicker(); }}
                  activeOpacity={0.75}
                >
                  <View style={[styles.avatar, styles.avatarSelf]}>
                    <Feather name="user" size={14} color={colors.textMuted} />
                  </View>
                  <View style={styles.voucherRowText}>
                    <Text style={styles.voucherName}>Self vouch</Text>
                    <Text style={styles.voucherSub}>Only you can verify</Text>
                  </View>
                  {voucherValue === 'self' && (
                    <Feather name="check" size={16} color={colors.text} />
                  )}
                </TouchableOpacity>
              )}
              {friendsLoading ? (
                <Text style={styles.voucherHint}>Loading friends…</Text>
              ) : friendsError ? (
                <Text style={[styles.voucherHint, { color: colors.destructive }]}>{friendsError}</Text>
              ) : filteredFriends.length === 0 ? (
                <Text style={styles.voucherHint}>
                  {voucherSearch ? 'No matches.' : 'No friends yet.'}
                </Text>
              ) : (
                filteredFriends.map((friend) => (
                  <TouchableOpacity
                    key={friend.id}
                    style={[styles.voucherRow, voucherValue === friend.id && styles.voucherRowSelected]}
                    onPress={() => { setVoucherValue(friend.id); closeVoucherPicker(); }}
                    activeOpacity={0.75}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{friend.initial}</Text>
                    </View>
                    <Text style={styles.voucherName}>{friend.username}</Text>
                    {voucherValue === friend.id && (
                      <Feather name="check" size={16} color={colors.text} />
                    )}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </>
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  taskHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    gap: 2,
  },
  taskGreeting: {
    flexShrink: 1,
    fontSize: 29,
    fontWeight: typography.bold,
    color: colors.text,
    letterSpacing: -0.5,
  },
  taskDateRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  taskDateIts: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: colors.text,
    letterSpacing: -0.5,
    marginRight: 6,
  },
  taskDate: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: '#BEF264',
    letterSpacing: -0.5,
    textShadowColor: 'rgba(190,242,100,0.4)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  taskDateOrdinal: {
    fontSize: 11,
    fontWeight: typography.bold,
    color: '#BEF264',
    marginTop: 3,
  },
  inlineCreatorWrap: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  inlineCreatorBar: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  inlineCreatorBarFocused: {
    borderBottomColor: colors.accentCyan,
    backgroundColor: '#00D9FF08',
  },
  inlineCreatorMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  inlineCreatorSearchArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  inlineCreatorTitleInput: {
    flex: 1,
    color: colors.text,
    fontSize: 22,
    fontWeight: '500',
  },
  inlineCreatorPlaceholder: {
    flex: 1,
    color: colors.textMuted,
    fontSize: typography.base,
  },
  creatorOverlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
    zIndex: 39,
  },
  creatorFloatingActions: {
    position: 'absolute',
    zIndex: 41,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  creatorButtonStack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  creatorOverlay: {
    position: 'absolute',
    zIndex: 40,
    borderWidth: 1,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  sortTriggerButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  searchIconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
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
  taskList: {
    flexGrow: 1,
    paddingTop: spacing.sm,
  },
  placeholder: {
    fontSize: typography.sm,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xxl,
  },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchResultTitle: {
    flex: 1,
    fontSize: typography.base,
    color: colors.text,
  },
  searchResultMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 0,
  },
  sortDropdown: {
    position: 'absolute',
    backgroundColor: '#0b1a38',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: '#20345d',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 14,
    zIndex: 30,
  },
  sortDropdownItem: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  sortDropdownText: {
    flex: 1,
    fontSize: typography.base,
    color: '#d7dce8',
  },
  sheetCreateButton: {
    minWidth: 100,
    height: 40,
    borderRadius: 20,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCreateButtonDisabled: {
    opacity: 0.7,
  },
  sheetCreateButtonText: {
    fontSize: typography.sm,
    color: colors.primaryFg,
    fontWeight: typography.semibold,
  },
  sheetCancelButton: {
    minWidth: 100,
    height: 38,
    borderRadius: 19,
    paddingHorizontal: spacing.md,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCancelButtonText: {
    fontSize: typography.sm,
    color: '#FFFFFF',
    fontWeight: typography.semibold,
  },
  sheetContent: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    gap: spacing.lg,
    paddingBottom: 160,
  },
  creatorSubtasksCard: {
    gap: 0,
  },
  creatorSubtaskItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    gap: spacing.sm,
  },
  creatorSubtaskCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  creatorSubtaskCircleCompleted: {
    borderColor: colors.success,
    backgroundColor: colors.successMuted,
  },
  creatorSubtaskItemTitle: {
    flex: 1,
    fontSize: typography.sm,
    color: colors.text,
  },
  creatorSubtaskItemTitleCompleted: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  creatorSubtaskComposerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    gap: spacing.sm,
  },
  creatorSubtaskComposerRowFocused: {
    borderColor: colors.accentCyan,
    backgroundColor: '#00D9FF08',
  },
  creatorSubtaskInput: {
    flex: 1,
    fontSize: typography.sm,
    color: colors.textMuted,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: typography.sm,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: typography.semibold,
  },
  field: {
    gap: spacing.sm,
  },
  fieldsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  fieldInRow: {
    flex: 1,
  },
  deadlineField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deadlineLabelWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  deadlineChipsWrap: {
    flexDirection: 'row',
    gap: spacing.sm,
    flex: 1,
    justifyContent: 'flex-end',
  },
  fieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  fieldLabel: {
    fontSize: typography.sm,
    color: colors.textMuted,
    fontWeight: typography.medium,
  },
  parsedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.warning,
  },
  textInput: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: typography.base,
  },
  selectButton: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inlineLabeledField: {
    minHeight: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  inlineFieldLabel: {
    fontSize: typography.base,
    color: colors.textMuted,
    fontWeight: typography.medium,
  },
  inlineFieldValueWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  inlineFieldValue: {
    fontSize: typography.base,
    color: colors.text,
    textAlign: 'right',
    flexShrink: 1,
  },
  inlineFailureCostValueWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
  inlineFailureCostInput: {
    minWidth: 56,
    maxWidth: 130,
    fontSize: typography.base,
    color: colors.text,
    textAlign: 'right',
    paddingVertical: 0,
  },
  selectLabel: {
    fontSize: typography.base,
    color: colors.text,
    flex: 1,
    paddingRight: spacing.sm,
  },
  datePicker: {
    alignSelf: 'flex-start',
  },
  reminderCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    padding: spacing.md,
    gap: spacing.sm,
  },
  reminderHeaderRow: {
    gap: 2,
  },
  reminderEmpty: {
    fontSize: typography.sm,
    color: colors.textMuted,
    paddingVertical: spacing.xs,
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 0,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  reminderIndexWrap: {
    width: 36,
    alignItems: 'flex-start',
  },
  reminderIndex: {
    fontSize: typography.sm,
    color: colors.textMuted,
    fontWeight: typography.semibold,
  },
  reminderBody: {
    flex: 1,
    gap: 1,
  },
  reminderAt: {
    fontSize: typography.sm,
    color: colors.text,
    fontWeight: typography.semibold,
  },
  reminderStatus: {
    fontSize: typography.xs,
    color: colors.textMuted,
    fontWeight: typography.medium,
  },
  reminderComposer: {
    marginTop: spacing.xs,
    gap: spacing.sm,
  },
  reminderIOSPickers: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reminderChipsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  reminderChip: {
    height: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  reminderChipText: {
    fontSize: typography.sm,
    color: colors.text,
    fontWeight: typography.medium,
  },
  addReminderButton: {
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FBBF2459',
    backgroundColor: '#FBBF2426',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  addReminderText: {
    fontSize: typography.sm,
    color: '#FBBF24',
    fontWeight: typography.semibold,
  },
  reminderPickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  reminderPickerSheet: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    top: '24%',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  reminderPickerTitle: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: colors.text,
  },
  reminderPickerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  reminderPickerCancel: {
    flex: 1,
    height: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
  },
  reminderPickerCancelText: {
    fontSize: typography.sm,
    color: colors.textMuted,
    fontWeight: typography.semibold,
  },
  reminderPickerConfirm: {
    flex: 1,
    height: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#FBBF2459',
    backgroundColor: '#FBBF2426',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reminderPickerConfirmText: {
    fontSize: typography.sm,
    color: '#FBBF24',
    fontWeight: typography.semibold,
  },
  recurrenceCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    padding: spacing.md,
    gap: spacing.sm,
  },
  recurrenceChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  recurrenceChip: {
    minHeight: 30,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recurrenceChipActive: {
    borderColor: '#C084FC59',
    backgroundColor: '#C084FC1A',
  },
  recurrenceChipText: {
    fontSize: typography.xs,
    color: colors.textMuted,
    fontWeight: typography.semibold,
  },
  recurrenceChipTextActive: {
    color: '#C084FC',
  },
  recurrenceDaysRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: 2,
  },
  recurrenceDayBtn: {
    width: 30,
    height: 30,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recurrenceDayBtnActive: {
    borderColor: '#C084FC66',
    backgroundColor: '#C084FC26',
  },
  recurrenceDayText: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: typography.semibold,
  },
  recurrenceDayTextActive: {
    color: '#C084FC',
  },
  placeholderRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  placeholderRowTextWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  placeholderRowTitle: {
    fontSize: typography.base,
    color: colors.text,
    fontWeight: typography.medium,
  },
  placeholderRowSub: {
    fontSize: typography.sm,
    color: colors.textMuted,
    lineHeight: 18,
  },
  // Failure cost
  failureCostRow: {
    flexDirection: 'row',
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    overflow: 'hidden',
  },
  currencyBadge: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: colors.inputBorder,
    backgroundColor: colors.surface2,
  },
  currencySymbol: {
    fontSize: typography.base,
    color: colors.textMuted,
    fontWeight: typography.medium,
  },
  currencyIconsWrap: {
    flexDirection: 'row',
    gap: spacing.xs * 0.5,
    alignItems: 'center',
  },
  currencyIconSymbol: {
    fontSize: typography.base,
    color: colors.textMuted,
    fontWeight: typography.bold,
    lineHeight: typography.base * 1.2,
  },
  failureCostInput: {
    flex: 1,
    paddingHorizontal: spacing.md,
    fontSize: typography.base,
    color: colors.text,
  },
  // Voucher dropdown
  selectedFriendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  avatarSmall: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarSmallText: {
    fontSize: typography.xs,
    color: colors.text,
    fontWeight: typography.semibold,
  },
  voucherDropdown: {
    position: 'absolute',
    zIndex: 80,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 30,
    overflow: 'hidden',
  },
  voucherBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  voucherDropdownScroll: {
    maxHeight: 260,
  },
  voucherSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: spacing.sm,
    paddingHorizontal: spacing.sm,
    height: 36,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    gap: spacing.sm,
  },
  voucherSearchInput: {
    flex: 1,
    fontSize: typography.sm,
    color: colors.text,
    paddingVertical: 0,
  },
  voucherRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  voucherRowSelected: {
    backgroundColor: colors.surface2,
  },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  avatarSelf: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  avatarText: {
    fontSize: typography.sm,
    color: colors.text,
    fontWeight: typography.semibold,
  },
  voucherRowText: {
    flex: 1,
    gap: 1,
  },
  voucherName: {
    flex: 1,
    fontSize: typography.sm,
    color: colors.text,
  },
  voucherSub: {
    fontSize: typography.xs,
    color: colors.textMuted,
  },
  voucherHint: {
    fontSize: typography.sm,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },

  // Postpone deadline picker modal
  postponeBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  postponeSheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl + 8,
    gap: spacing.md,
  },
  postponeTitle: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: colors.text,
  },
  postponeSubtitle: {
    fontSize: typography.sm,
    color: colors.textMuted,
  },
  postponeIosPicker: {
    alignSelf: 'center',
  },
  postponeAndroidRow: {
    gap: spacing.xs,
  },
  postponeActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  postponeCancelBtn: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  postponeCancelText: {
    fontSize: typography.sm,
    color: colors.textMuted,
  },
  postponeConfirmBtn: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    backgroundColor: colors.warning,
    alignItems: 'center',
  },
  postponeConfirmText: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    color: colors.bg,
  },
});
