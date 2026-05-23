import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  Platform,
  ScrollView,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSharedValue, withTiming, runOnJS, Easing } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { ImagePickerAsset } from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { spacing } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from '@/components/tasks/styles';
import {
  getTodayParts,
  normalizeEventDurationMinutes,
} from '@/components/tasks/helpers';
import type { TaskRowData } from '@/components/TaskRow';
import { TaskTopBar } from '@/components/tasks/TaskTopBar';
import { TaskBottomActions } from '@/components/tasks/TaskBottomActions';
import { TaskContent } from '@/components/tasks/TaskContent';
import { normalizePomoDurationMinutes, OPTIMISTIC_COMPLETION_TIMEOUT_MS } from '@/lib/constants/timings';
import { useTaskCreatorHandle } from '@/lib/taskCreatorState';
import { useFriends } from '@/lib/hooks/useFriends';
import { useTasks, type DashboardSortMode } from '@/lib/hooks/useTasks';
import { useGoogleCalendarConnection } from '@/hooks/useGoogleCalendarConnection';
import { useAuth } from '@/hooks/useAuth';
import { useReputationScore } from '@/lib/hooks/useReputationScore';
import { queryKeys } from '@/lib/query/keys';
import {
  completeTask,
  deleteTask,
  isTaskWithinDeleteWindow,
  removeTaskProof,
  uploadTaskProof,
} from '@/lib/tasks/task-actions';
import { syncLocalReminderNotificationsAsync } from '@/lib/notifications';
import { TasksScreenCreatorOverlay } from '@/components/tasks/TasksScreenCreatorOverlay';
import { TasksScreenSearchOverlay } from '@/components/tasks/TasksScreenSearchOverlay';
import { TasksScreenPostponeOverlay } from '@/components/tasks/TasksScreenPostponeOverlay';
import { TasksScreenSortMenu } from '@/components/tasks/TasksScreenSortMenu';
import type { TasksScreenSortMenuHandle } from '@/components/tasks/TasksScreenSortMenu';
import { TasksScreenConfettiOverlay } from '@/components/tasks/TasksScreenConfettiOverlay';

import { getFutureBoundaryMs } from '@/lib/utils/date-only';

type OverlayMode = 'closed' | 'create' | 'search';

export default function TasksScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { profile: authProfile, user } = useAuth();
  const { data: reputationScore } = useReputationScore(user?.id);
  const { data: googleCalendarConnection } = useGoogleCalendarConnection();
  const defaultEventDurationMinutes = normalizeEventDurationMinutes(authProfile?.default_event_duration_minutes);
  const defaultGoogleEventColorId = googleCalendarConnection?.defaultEventColorId ?? '9';
  const queryClient = useQueryClient();
  const rootRef = useRef<View | null>(null);
  const creatorAnchorRef = useRef<View | null>(null);
  const sortButtonRef = useRef<View | null>(null);
  const sortMenuRef = useRef<TasksScreenSortMenuHandle>(null);
  const taskCreatorHandle = useTaskCreatorHandle();

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
  const [creatorAnchor, setCreatorAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [proofUploadTaskId, setProofUploadTaskId] = useState<string | null>(null);
  const proofUploadLockRef = useRef(false);
  const [optimisticTasks, setOptimisticTasks] = useState<TaskRowData[]>([]);
  const [optimisticallyCompletingTaskIds, setOptimisticallyCompletingTaskIds] = useState<string[]>([]);
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const [bottomActionsHeight, setBottomActionsHeight] = useState(0);

  const [postponeTargetTask, setPostponeTargetTask] = useState<TaskRowData | null>(null);
  const [confettiBurstCount, setConfettiBurstCount] = useState(0);

  const taskListScrollRef = useRef<ScrollView | null>(null);
  const taskListScrollOffsetYRef = useRef(0);
  const focusedSubtaskInputBottomYRef = useRef<number | null>(null);
  const keyboardTopYRef = useRef(Number.POSITIVE_INFINITY);
  const [taskListKeyboardInset, setTaskListKeyboardInset] = useState(0);

  const { friends, currentUserId, profile, loading: friendsLoading, error: friendsError } = useFriends();
  const defaultRequiresProofForAllTasks = profile?.default_requires_proof_for_all_tasks ?? false;
  const defaultPomoDurationMinutes = normalizePomoDurationMinutes(authProfile?.default_pomo_duration_minutes);

  const isCreateOverlayOpen = overlayMode === 'create';
  const isSearchOverlayOpen = overlayMode === 'search';
  const isOverlayOpen = overlayMode !== 'closed';

  const bottomDockOffset = spacing.xl + spacing.sm + spacing.xs;
  const bottomDockReservedInset = bottomDockOffset + bottomActionsHeight + spacing.sm;
  const creatorTargetTop = 0;
  const creatorTargetHeight = screenHeight;
  const searchTargetTop = insets.top;
  const searchTargetHeight = screenHeight - insets.top;
  const sortMenuWidth = Math.min(screenWidth - spacing.lg * 2, 320);

  const displayName = (authProfile?.username ?? 'there').trim() || 'there';
  const todayParts = getTodayParts();

  const closeOverlay = useCallback(() => {
    Keyboard.dismiss();
    function afterClose() {
      setOverlayMode('closed');
      setCreatorAnchor(null);
    }
    expandProgress.value = withTiming(0, { duration: 220 }, () => {
      runOnJS(afterClose)();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    taskCreatorHandle.current.isExpanded = isOverlayOpen;
    taskCreatorHandle.current.collapse = closeOverlay;
  }, [isOverlayOpen, closeOverlay, taskCreatorHandle]);

  const openOverlay = useCallback((nextMode: Exclude<OverlayMode, 'closed'>) => {
    if (!creatorAnchorRef.current || !rootRef.current) return;

    creatorAnchorRef.current.measureLayout(
      rootRef.current,
      (x, y, width, height) => {
        setCreatorAnchor({ x, y, width, height });
        expandProgress.value = 0;
        setOverlayMode(nextMode);
        expandProgress.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
      },
      () => {
        setCreatorAnchor({
          x: spacing.lg,
          y: spacing.lg * 2,
          width: Math.max(220, screenWidth - spacing.lg * 2),
          height: 48,
        });
        expandProgress.value = 0;
        setOverlayMode(nextMode);
        expandProgress.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenWidth]);

  const openCreateSheet = useCallback(() => {
    openOverlay('create');
  }, [openOverlay]);

  const openSearchSheet = useCallback(() => {
    openOverlay('search');
  }, [openOverlay]);

  const openSortMenu = useCallback(() => {
    if (isOverlayOpen) return;
    sortButtonRef.current?.measureInWindow((x, y, width, height) => {
      sortMenuRef.current?.open({ pageX: x, pageY: y, width, height });
    });
  }, [isOverlayOpen]);

  useFocusEffect(
    useCallback(() => {
      refetchTasks();
    }, [refetchTasks]),
  );

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
    const pastIds = new Set(pastTasks.map((task) => task.id));
    setOptimisticallyCompletingTaskIds((prev) => {
      const next = prev.filter((id) => !pastIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [pastTasks, optimisticallyCompletingTaskIds.length]);

  useEffect(() => {
    if (optimisticallyCompletingTaskIds.length === 0) return;
    const idsAtSchedule = optimisticallyCompletingTaskIds;
    const timeout = setTimeout(() => {
      setOptimisticallyCompletingTaskIds((prev) =>
        prev.filter((id) => !idsAtSchedule.includes(id)),
      );
    }, OPTIMISTIC_COMPLETION_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [optimisticallyCompletingTaskIds]);

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

  const handleProofPickedRef = useRef<(taskId: string, asset: ImagePickerAsset) => Promise<void>>(undefined);
  handleProofPickedRef.current = async (taskId: string, asset: ImagePickerAsset) => {
    if (taskId.startsWith('optimistic-')) {
      Alert.alert('Please wait', 'Task is still being created.');
      return;
    }

    if (proofUploadLockRef.current) {
      Alert.alert('Upload in progress', 'Please wait for the current proof upload to finish.');
      return;
    }

    proofUploadLockRef.current = true;
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
      proofUploadLockRef.current = false;
      setProofUploadTaskId((prev) => (prev === taskId ? null : prev));
    }
  };
  const handleProofPicked = useCallback((taskId: string, asset: ImagePickerAsset) => {
    return handleProofPickedRef.current!(taskId, asset);
  }, []);

  const handleProofRemovedRef = useRef<(taskId: string) => Promise<void>>(undefined);
  handleProofRemovedRef.current = async (taskId: string) => {
    if (taskId.startsWith('optimistic-')) {
      Alert.alert('Please wait', 'Task is still being created.');
      return;
    }

    if (proofUploadLockRef.current) {
      Alert.alert('Upload in progress', 'Please wait for the current proof action to finish.');
      return;
    }

    proofUploadLockRef.current = true;
    setProofUploadTaskId(taskId);
    try {
      const result = await removeTaskProof(taskId);
      if (!result.success) {
        Alert.alert('Could not remove proof', result.error ?? 'Unknown error');
        return;
      }
      refetchTasks();
    } finally {
      proofUploadLockRef.current = false;
      setProofUploadTaskId((prev) => (prev === taskId ? null : prev));
    }
  };
  const handleProofRemoved = useCallback((taskId: string) => {
    return handleProofRemovedRef.current!(taskId);
  }, []);

  const handleCompleteTaskRef = useRef<(taskId: string) => Promise<void>>(undefined);
  handleCompleteTaskRef.current = async (taskId: string) => {
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

    setOptimisticallyCompletingTaskIds((prev) => (prev.includes(taskId) ? prev : [...prev, taskId]));
    setOptimisticTasks((prev) => prev.filter((task) => task.id !== taskId));

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
      setOptimisticallyCompletingTaskIds((prev) => prev.filter((id) => id !== taskId));
      if (task) {
        queryClient.setQueryData<TaskListsCache>(taskListKey, (current) => {
          if (!current) return current;
          const alreadyPresent = current.dueSoonTasks.some((t) => t.id === taskId)
            || current.futureTasks.some((t) => t.id === taskId)
            || current.pastTasks.some((t) => t.id === taskId);
          if (alreadyPresent) return current;
          return { ...current, dueSoonTasks: [task, ...current.dueSoonTasks] };
        });
      }
      refetchTasks();
      Alert.alert('Could not complete task', result.error ?? 'Unknown error');
      return;
    }

    setConfettiBurstCount((prev) => prev + 1);

    void queryClient.invalidateQueries({ queryKey: queryKeys.taskDetail(taskId) });
    refetchTasks();
    if (result.userId) void syncLocalReminderNotificationsAsync(result.userId);
  };
  const handleCompleteTask = useCallback((taskId: string) => {
    return handleCompleteTaskRef.current!(taskId);
  }, []);

  const handleDeleteTaskRef = useRef<(task: TaskRowData) => Promise<void>>(undefined);
  handleDeleteTaskRef.current = async (task: TaskRowData) => {
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
  };
  const handleDeleteTask = useCallback((task: TaskRowData) => {
    return handleDeleteTaskRef.current!(task);
  }, []);

  const handlePostponeTask = useCallback((task: TaskRowData) => {
    if (task.id.startsWith('optimistic-')) {
      Alert.alert('Please wait', 'Task is still being created.');
      return;
    }

    if (task.postponed_at) {
      Alert.alert('Already postponed', 'Task has already been postponed once.');
      return;
    }

    setPostponeTargetTask(task);
  }, []);

  const addOptimisticTask = useCallback((task: TaskRowData) => {
    setOptimisticTasks((prev) => [task, ...prev]);
  }, []);

  const removeOptimisticTask = useCallback((taskId: string) => {
    setOptimisticTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  const updateOptimisticTaskId = useCallback((oldId: string, newId: string, recurrenceRuleId: string | null) => {
    setOptimisticTasks((prev) => prev.map((t) =>
      t.id === oldId
        ? { ...t, id: newId, recurrence_rule_id: recurrenceRuleId }
        : t,
    ));
  }, []);

  const taskListHeader = useMemo(() => (
    <TaskTopBar
      displayName={displayName}
      todayParts={todayParts}
      reputationScore={reputationScore}
      showReputationBar={authProfile?.display_rp_bar_on_dashboard ?? false}
    />
  ), [displayName, todayParts, reputationScore, authProfile?.display_rp_bar_on_dashboard]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    refetchTasks();
    setRefreshing(false);
  }, [refetchTasks]);

  const handleScrollOffsetChange = useCallback((offsetY: number) => {
    taskListScrollOffsetYRef.current = offsetY;
  }, []);

  const handlePostponeClose = useCallback(() => {
    setPostponeTargetTask(null);
  }, []);

  return (
    <SafeAreaView ref={rootRef} style={styles.safe} edges={['top']}>
      <TasksScreenCreatorOverlay
        visible={isCreateOverlayOpen}
        anchor={creatorAnchor}
        expandProgress={expandProgress}
        screenWidth={screenWidth}
        screenHeight={screenHeight}
        targetTop={creatorTargetTop}
        targetHeight={creatorTargetHeight}
        currentUserId={currentUserId ?? undefined}
        friendProfile={profile}
        refetchTasks={refetchTasks}
        queryClient={queryClient}
        defaultEventDurationMinutes={defaultEventDurationMinutes}
        defaultGoogleEventColorId={defaultGoogleEventColorId}
        defaultRequiresProofForAllTasks={defaultRequiresProofForAllTasks}
        friends={friends}
        friendsLoading={friendsLoading}
        friendsError={friendsError}
        safeTopInset={insets.top}
        onClose={closeOverlay}
        addOptimisticTask={addOptimisticTask}
        removeOptimisticTask={removeOptimisticTask}
        updateOptimisticTaskId={updateOptimisticTaskId}
      />
      <TasksScreenSearchOverlay
        visible={isSearchOverlayOpen}
        anchor={creatorAnchor}
        expandProgress={expandProgress}
        screenWidth={screenWidth}
        targetTop={searchTargetTop}
        targetHeight={searchTargetHeight}
        onClose={closeOverlay}
      />
      <TasksScreenSortMenu
        ref={sortMenuRef}
        sortMenuWidth={sortMenuWidth}
        safeTopInset={insets.top + spacing.sm}
        sortMode={sortMode}
        onChangeSortMode={setSortMode}
      />
      <TaskContent
        header={taskListHeader}
        isSearchActive={false}
        searchLoading={false}
        searchError={null}
        searchResults={[]}
        dueSoonTasks={mergedDueSoonTasks}
        futureTasks={mergedFutureTasks}
        pastTasks={visiblePastTasks}
        hasMorePast={hasMorePast}
        loadingMore={loadingMore}
        loadMorePastTasks={loadMorePastTasks}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        onComplete={handleCompleteTask}
        onProofPicked={handleProofPicked}
        onProofRemoved={handleProofRemoved}
        onPostpone={handlePostponeTask}
        onDelete={handleDeleteTask}
        defaultPomoDurationMinutes={defaultPomoDurationMinutes}
        scrollRef={taskListScrollRef}
        onScrollOffsetChange={handleScrollOffsetChange}
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
      <TasksScreenPostponeOverlay
        task={postponeTargetTask}
        refetchTasks={refetchTasks}
        onClose={handlePostponeClose}
      />
      <TasksScreenConfettiOverlay burstCount={confettiBurstCount} />
    </SafeAreaView>
  );
}
