import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import type { TextInput, View } from 'react-native';
import { type SharedValue } from 'react-native-reanimated';
import { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { type QueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { supabase } from '@/lib/supabase';
import { syncLocalReminderNotificationsAsync } from '@/lib/notifications';
import { syncGoogleCalendarTaskAfterCreate } from '@/lib/google-calendar-mobile-sync';
import { resolveUserClientInstanceId } from '@/lib/user-client-instance';
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
import { formatFailureCostFromCents, getFailureCostBounds } from '@/lib/domain/failure-cost';
import { sortDraftReminders } from '@/components/tasks/helpers';
import {
  type DraftReminder,
  type DraftReminderPresetSource,
  type DraftSubtask,
  type RecurrenceType,
} from '@/components/tasks/types';
import { TaskCreatorOverlay } from '@/components/tasks/TaskCreatorOverlay';
import { VoucherPickerModal } from '@/components/tasks/VoucherPickerModal';
import type { FriendOption } from '@/lib/hooks/useFriends';
import type { TaskRowData } from '@/components/TaskRow';
import type { Currency } from '@/lib/types';
import { AI_PROFILE_ID, normalizeAiUsername } from '@/lib/constants/ai-profile';
import { useAiVoucherQuota } from '@/lib/hooks/useAiVoucherQuota';
import { formatAiVoucherQuotaExhaustedMessage } from '@/lib/ai-voucher-quota';

interface CreatorAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FriendProfileShape {
  currency: Currency | null;
  default_failure_cost_cents: number | null;
  default_voucher_id: string | null;
  default_requires_proof_for_all_tasks: boolean | null;
  deadline_one_hour_warning_enabled: boolean | null;
  deadline_final_warning_enabled: boolean | null;
  deadline_due_warning_enabled: boolean | null;
}

interface Props {
  visible: boolean;
  anchor: CreatorAnchor | null;
  expandProgress: SharedValue<number>;
  screenWidth: number;
  screenHeight: number;
  targetTop: number;
  targetHeight: number;
  currentUserId: string | undefined;
  friendProfile: FriendProfileShape | null;
  refetchTasks: () => void;
  queryClient: QueryClient;
  defaultEventDurationMinutes: number;
  defaultGoogleEventColorId: GoogleEventColorId;
  defaultRequiresProofForAllTasks: boolean;
  friends: FriendOption[];
  friendsLoading: boolean;
  friendsError: string | null;
  safeTopInset: number;
  onClose: () => void;
  addOptimisticTask: (task: TaskRowData) => void;
  removeOptimisticTask: (taskId: string) => void;
  updateOptimisticTaskId: (oldId: string, newId: string, recurrenceRuleId: string | null) => void;
}

function buildDefaultDeadlineDate(now: Date = new Date()): Date {
  const candidate = new Date(now);
  candidate.setHours(23, 0, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

function buildDefaultStartBoundaryDate(deadline: Date, durationMinutes: number): Date {
  const candidate = new Date(deadline.getTime() - durationMinutes * 60 * 1000);
  const now = new Date();
  const defaultStart = candidate.getTime() < now.getTime() ? now : candidate;
  defaultStart.setSeconds(0, 0);
  return defaultStart;
}

function buildPresetDeadlineReminders(
  deadline: Date,
  removedPresetSources: DraftReminderPresetSource[],
  oneHourEnabled: boolean,
  finalEnabled: boolean,
  dueEnabled: boolean,
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
  if (dueEnabled && !removedPresetSources.includes('DEFAULT_DEADLINE_DUE')) {
    presetReminders.push({
      id: 'preset-deadline-due',
      source: 'DEFAULT_DEADLINE_DUE',
      reminderAt: new Date(deadline.getTime()),
    });
  }

  return presetReminders;
}

function buildReminderDateOnDeadlineDay(deadline: Date, hours: number, minutes: number): Date {
  const reminderDate = new Date(deadline);
  reminderDate.setHours(hours, minutes, 0, 0);
  return reminderDate;
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

export const TasksScreenCreatorOverlay = memo(function TasksScreenCreatorOverlay({
  visible,
  anchor,
  expandProgress,
  screenWidth,
  screenHeight,
  targetTop,
  targetHeight,
  currentUserId,
  friendProfile,
  refetchTasks,
  queryClient,
  defaultEventDurationMinutes,
  defaultGoogleEventColorId,
  defaultRequiresProofForAllTasks,
  friends,
  friendsLoading,
  friendsError,
  safeTopInset,
  onClose,
  addOptimisticTask,
  removeOptimisticTask,
  updateOptimisticTaskId,
}: Props) {
  const titleInputRef = useRef<TextInput | null>(null);
  const subtaskInputRef = useRef<TextInput | null>(null);
  const failureCostInputRef = useRef<TextInput | null>(null);
  const voucherButtonRef = useRef<View>(null);
  const hasInitializedFailureCostRef = useRef(false);
  const hasInitializedVoucherRef = useRef(false);
  const lastAppliedDefaultVoucherRef = useRef<string | null>(null);

  const [title, setTitle] = useState('');
  const [deadlineDate, setDeadlineDate] = useState<Date>(() => buildDefaultDeadlineDate());
  const [customDeadlineDate, setCustomDeadlineDate] = useState<Date>(() => buildDefaultDeadlineDate());
  const [isDeadlineCustomized, setIsDeadlineCustomized] = useState(false);
  const [customDeadlinePickerMode, setCustomDeadlinePickerMode] = useState<'date' | 'time'>('date');
  const [showCustomDeadlineAndroidPicker, setShowCustomDeadlineAndroidPicker] = useState(false);
  const [showCustomDeadlineAndroidModal, setShowCustomDeadlineAndroidModal] = useState(false);
  const [showCustomDeadlineIosModal, setShowCustomDeadlineIosModal] = useState(false);
  const [voucherValue, setVoucherValue] = useState<string | null>(null);
  const [voucherSearch, setVoucherSearch] = useState('');
  const [failureCostInput, setFailureCostInput] = useState('');
  const [failureCostSelection, setFailureCostSelection] = useState<{ start: number; end: number } | undefined>(undefined);
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
  const [isTitleFocused, setIsTitleFocused] = useState(false);
  const [isSubtaskFocused, setIsSubtaskFocused] = useState(false);
  const [isCreatingTask, setIsCreatingTask] = useState(false);

  const [voucherPickerOpen, setVoucherPickerOpen] = useState(false);
  const [voucherAnchor, setVoucherAnchor] = useState<{ pageX: number; pageY: number; width: number; buttonHeight: number } | null>(null);
  const [voucherDropdownHeight, setVoucherDropdownHeight] = useState(300);

  const {
    quota: aiVoucherQuota,
    loading: aiVoucherQuotaLoading,
    error: aiVoucherQuotaError,
    refetch: refetchAiVoucherQuota,
  } = useAiVoucherQuota(currentUserId ?? null);

  const currencySymbol = friendProfile?.currency === 'EUR' ? '\u20AC'
    : friendProfile?.currency === 'INR' ? '\u20B9'
    : '$';
  const isAiVoucherSelected = voucherValue === AI_PROFILE_ID;

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

  const suggestedStartBoundaryDate = useMemo(
    () => buildDefaultStartBoundaryDate(deadlineDate, defaultEventDurationMinutes),
    [deadlineDate, defaultEventDurationMinutes],
  );

  const resolveDefaultVoucherValue = useCallback((): string | null => {
    if (!friendProfile) return null;
    const defaultVoucherId = friendProfile.default_voucher_id ?? null;
    if (!currentUserId) return null;
    if (defaultVoucherId) {
      if (defaultVoucherId === currentUserId) return 'self';
      if (friendsLoading) return null;
      if (friends.some((friend) => friend.id === defaultVoucherId)) return defaultVoucherId;
    }
    return 'self';
  }, [friendProfile, currentUserId, friendsLoading, friends]);

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

  useEffect(() => {
    if (!visible) {
      resetCreateDraftState();
      return;
    }
    setRecurrenceType('');
    setShowCustomRecurrenceDays(false);
    setRecurrenceDays([]);
    setRequiresProof(defaultRequiresProofForAllTasks);
    titleInputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, defaultRequiresProofForAllTasks]);

  useEffect(() => {
    if (!visible) {
      setSelectedGoogleEventColorId(defaultGoogleEventColorId);
    }
  }, [visible, defaultGoogleEventColorId]);

  useEffect(() => {
    if (!hasInitializedFailureCostRef.current && friendProfile) {
      setFailureCostInput(
        formatFailureCostFromCents(friendProfile.default_failure_cost_cents ?? 0, friendProfile.currency ?? 'USD'),
      );
      hasInitializedFailureCostRef.current = true;
    }

    if (!friendProfile) return;
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
  }, [friendProfile, resolveDefaultVoucherValue, voucherValue]);

  useEffect(() => {
    const oneHourEnabled = friendProfile?.deadline_one_hour_warning_enabled ?? true;
    const finalEnabled = friendProfile?.deadline_final_warning_enabled ?? true;
    const dueEnabled = friendProfile?.deadline_due_warning_enabled ?? true;
    const presetReminders = buildPresetDeadlineReminders(
      deadlineDate,
      removedPresetSources,
      oneHourEnabled,
      finalEnabled,
      dueEnabled,
    );

    setDraftReminders((prev) => {
      const custom = prev.filter((item) => item.source === 'MANUAL');
      return sortDraftReminders([...custom, ...presetReminders]);
    });
  }, [
    deadlineDate,
    removedPresetSources,
    friendProfile?.deadline_one_hour_warning_enabled,
    friendProfile?.deadline_final_warning_enabled,
    friendProfile?.deadline_due_warning_enabled,
  ]);

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

  function resetDeadlineAndRecurrenceSelection() {
    const nextDeadline = buildDefaultDeadlineDate();
    setDeadlineDate(nextDeadline);
    setCustomDeadlineDate(nextDeadline);
    clearRecurrenceSelection();
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

  function resolveVoucherIdFromTitle(rawTitle: string): string | null {
    const selfMatch = rawTitle.match(/(?:\bvouch|\.v)\s+(me|self|myself)(?=\s|$|\/)/i);
    if (selfMatch) return currentUserId ?? null;

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

  function closeVoucherPicker() {
    setVoucherPickerOpen(false);
    setVoucherSearch('');
  }

  function openVoucherPicker() {
    void refetchAiVoucherQuota();
    voucherButtonRef.current?.measureInWindow((x, y, width, height) => {
      setVoucherAnchor({ pageX: x, pageY: y, width, buttonHeight: height });
      setVoucherPickerOpen(true);
    });
  }

  function handleCancel() {
    closeVoucherPicker();
    onClose();
  }

  const handleCreateTaskRef = useRef<(deadlineOverride?: Date) => Promise<void>>(undefined);
  handleCreateTaskRef.current = async (deadlineOverride?: Date) => {
    if (isCreatingTask) return;

    const rawTitle = title.trim();
    if (!rawTitle) {
      handleCancel();
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
    const activeCurrency: Currency = friendProfile?.currency ?? 'USD';
    const failureBounds = getFailureCostBounds(activeCurrency);
    if (failureCostCents < failureBounds.minCents || failureCostCents > failureBounds.maxCents) {
      const symbol = activeCurrency === 'EUR' ? '\u20AC' : activeCurrency === 'INR' ? '\u20B9' : '$';
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

    if (effectiveVoucherId === AI_PROFILE_ID) {
      if (aiVoucherQuotaLoading) {
        Alert.alert('Checking AI credits', 'Your AI voucher balance is still loading. Please try again in a moment.');
        return;
      }
      if (aiVoucherQuotaError || !aiVoucherQuota) {
        Alert.alert('AI credits unavailable', 'Could not load your AI voucher balance. Please try again.');
        return;
      }
      if (aiVoucherQuota.accountTier === 'free' && !aiVoucherQuota.canStartReview) {
        Alert.alert('AI credits used', formatAiVoucherQuotaExhaustedMessage(aiVoucherQuota));
        return;
      }
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
    const oneHourEnabled = friendProfile?.deadline_one_hour_warning_enabled ?? true;
    const finalEnabled = friendProfile?.deadline_final_warning_enabled ?? true;
    const dueEnabled = friendProfile?.deadline_due_warning_enabled ?? true;
    const recalculatedPresetReminders = buildPresetDeadlineReminders(
      deadlineToCreate,
      removedPresetSources,
      oneHourEnabled,
      finalEnabled,
      dueEnabled,
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
    const atomicCreateReminders = remindersToCreate.filter((reminder) => reminder.source !== 'DEFAULT_DEADLINE_DUE');
    const dueReminderToCreate = remindersToCreate.find((reminder) => reminder.source === 'DEFAULT_DEADLINE_DUE') ?? null;
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

    addOptimisticTask(optimisticTask);
    handleCancel();
    Toast.show({
      type: 'proofSuccess',
      text1: formatTimeUntilDeadline(deadlineIso),
      position: 'bottom',
      bottomOffset: 84,
      visibilityTime: 2600,
    });

    setIsCreatingTask(true);
    try {
      const userClientInstanceId = await resolveUserClientInstanceId(currentUserId);
      const isAiVoucher = effectiveVoucherId === AI_PROFILE_ID;
      const finalRequiresProof = isAiVoucher
        ? true
        : (requiresProof || titleRequiresProof);
      const googleEventColorId = effectiveEventSyncEnabled ? selectedGoogleEventColorId : null;
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const recurrenceDaysToUse = effectiveRecurrenceType === 'WEEKLY'
        ? (showCustomRecurrenceDays && recurrenceDays.length > 0 ? recurrenceDays : [deadlineToCreate.getDay()])
        : null;
      const recurrenceTime = effectiveRecurrenceType
        ? new Intl.DateTimeFormat('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: userTimezone,
          }).format(deadlineToCreate)
        : null;
      const reminderOffsetsMs = buildManualReminderOffsetsMs(deadlineToCreate, remindersToCreate);
      const lastGeneratedDate = effectiveRecurrenceType
        ? new Intl.DateTimeFormat('en-CA', {
            timeZone: userTimezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(deadlineToCreate)
        : null;

      const { data, error: createTaskError } = await supabase.rpc('create_task_atomic', {
        p_voucher_id: effectiveVoucherId,
        p_title: taskTitle,
        p_creation_input: rawTitle,
        p_description: null,
        p_failure_cost_cents: failureCostCents,
        p_required_pomo_minutes: requiredPomoParse.requiredPomoMinutes,
        p_requires_proof: finalRequiresProof,
        p_deadline: deadlineIso,
        p_start_at: effectiveTimeBoundEnabled ? boundedStartIso : null,
        p_is_strict: effectiveTimeBoundEnabled,
        p_google_sync_for_task: effectiveEventSyncEnabled,
        p_google_event_start_at: eventStartIso,
        p_google_event_end_at: eventEndIso,
        p_google_event_color_id: googleEventColorId,
        p_created_by_user_client_instance_id: userClientInstanceId,
        p_subtasks: trimmedSubtaskTitles,
        p_reminder_at: atomicCreateReminders.map((reminder) => reminder.reminderAt.toISOString()),
        p_reminder_sources: atomicCreateReminders.map((reminder) => reminder.source),
        p_recurrence_type: effectiveRecurrenceType || null,
        p_recurrence_interval: effectiveRecurrenceType ? 1 : null,
        p_recurrence_days: recurrenceDaysToUse,
        p_recurrence_timezone: effectiveRecurrenceType ? userTimezone : null,
        p_recurrence_time_of_day: recurrenceTime,
        p_time_bound_for_rule: effectiveTimeBoundEnabled,
        p_window_start_offset_minutes: startOffsetMinutes,
        p_google_event_duration_minutes: effectiveEventSyncEnabled ? startOffsetMinutes : null,
        p_last_generated_date: lastGeneratedDate,
        p_manual_reminder_offsets_ms: reminderOffsetsMs,
      });

      const createdRow = Array.isArray(data) ? data[0] : data;
      const createdTaskId = createdRow?.task_id as string | undefined;
      const recurrenceRuleId = (createdRow?.recurrence_rule_id as string | null | undefined) ?? null;

      if (createTaskError || !createdTaskId) {
        removeOptimisticTask(optimisticTaskId);
        Toast.show({
          type: 'proofError',
          text1: 'Task creation failed',
          text2: createTaskError?.message ?? 'Please try again.',
          position: 'bottom',
          bottomOffset: 84,
          visibilityTime: 3200,
        });
        return;
      }

      updateOptimisticTaskId(optimisticTaskId, createdTaskId, recurrenceRuleId);

      if (dueReminderToCreate) {
        const dueReminderIso = dueReminderToCreate.reminderAt.toISOString();
        const { error: dueReminderError } = await supabase
          .from('task_reminders')
          .upsert({
            parent_task_id: createdTaskId,
            user_id: currentUserId,
            reminder_at: dueReminderIso,
            source: 'DEFAULT_DEADLINE_DUE',
            notified_at: null,
          } as any, { onConflict: 'parent_task_id,reminder_at', ignoreDuplicates: true });

        if (dueReminderError) {
          console.warn('[task-creator] failed to insert deadline due reminder:', dueReminderError.message);
        }
      }

      refetchTasks();
      void syncLocalReminderNotificationsAsync(currentUserId);

      if (effectiveEventSyncEnabled) {
        void (async () => {
          const syncResult = await syncGoogleCalendarTaskAfterCreate(createdTaskId);
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
    } catch (error) {
      removeOptimisticTask(optimisticTaskId);
      Toast.show({
        type: 'proofError',
        text1: 'Task creation failed',
        text2: error instanceof Error ? error.message : 'Please try again.',
        position: 'bottom',
        bottomOffset: 84,
        visibilityTime: 3200,
      });
    } finally {
      setIsCreatingTask(false);
    }
  };

  const handleCreateTaskCallback = useCallback((deadlineOverride?: Date) => {
    void handleCreateTaskRef.current?.(deadlineOverride);
  }, []);

  return (
    <>
      <TaskCreatorOverlay
        visible={visible}
        anchor={anchor}
        expandProgress={expandProgress}
        screenWidth={screenWidth}
        screenHeight={screenHeight}
        targetTop={targetTop}
        targetHeight={targetHeight}
        isCreatingTask={isCreatingTask}
        onCancel={handleCancel}
        onCreate={handleCreateTaskCallback}
        titleInputRef={titleInputRef}
        title={title}
        onTitleChange={handleTitleChange}
        isTitleFocused={isTitleFocused}
        setIsTitleFocused={setIsTitleFocused}
        keyboardVisible={false}
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
        onResetDeadlineAndRecurrence={resetDeadlineAndRecurrenceSelection}
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
      <VoucherPickerModal
        visible={voucherPickerOpen}
        anchor={voucherAnchor}
        safeTopInset={safeTopInset}
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
        aiQuota={aiVoucherQuota}
        aiQuotaLoading={aiVoucherQuotaLoading}
        aiQuotaError={aiVoucherQuotaError}
      />
    </>
  );
});
