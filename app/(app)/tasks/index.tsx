import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSharedValue, withTiming, runOnJS, Easing } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { ImagePickerAsset } from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';
import { spacing } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from '@/components/tasks/styles';
import { normalizeEventDurationMinutes } from '@/components/tasks/helpers';
import type { TaskCompletionIntentResult, TaskRowData } from '@/components/TaskRow';
import { ReputationBar } from '@/components/ReputationBar';
import { TaskBottomActions } from '@/components/tasks/TaskBottomActions';
import { TaskContent } from '@/components/tasks/TaskContent';
import { ProofCaptureModal } from '@/components/tasks/ProofCaptureModal';
import { OPTIMISTIC_COMPLETION_TIMEOUT_MS } from '@/lib/constants/timings';
import { useTaskCreatorHandle } from '@/lib/taskCreatorState';
import { useFriends } from '@/lib/hooks/useFriends';
import { useTasks } from '@/lib/hooks/useTasks';
import { useOnboarding } from '@/lib/hooks/useOnboarding';
import { useGoogleCalendarConnection } from '@/hooks/useGoogleCalendarConnection';
import { useAuth } from '@/hooks/useAuth';
import { useReputationScore } from '@/lib/hooks/useReputationScore';
import { queryKeys } from '@/lib/query/keys';
import { completeTask, uploadTaskProof } from '@/lib/tasks/task-actions';
import { syncLocalReminderNotificationsAsync } from '@/lib/notifications';
import { TasksScreenCreatorOverlay } from '@/components/tasks/TasksScreenCreatorOverlay';
import { TasksScreenPostponeOverlay } from '@/components/tasks/TasksScreenPostponeOverlay';
import { useTaskSortMode } from '@/lib/hooks/useTaskSortMode';
import { TasksScreenConfettiOverlay } from '@/components/tasks/TasksScreenConfettiOverlay';
import {
  TaskProofActionQueue,
  type TaskProofQueueSnapshot,
} from '@/lib/tasks/task-proof-action-queue';

import { getFutureBoundaryMs } from '@/lib/utils/date-only';
import { createTaskDetailPrefetcher } from '@/lib/tasks/task-detail-prefetch';
import { isOptimisticTaskId } from '@/lib/tasks/task-id';
import {
  getPostProofUploadAction,
  getTaskCompletionDecision,
  getTaskPostponeBlockReason,
} from '@/lib/tasks/task-completion-intent';

type OverlayMode = 'closed' | 'create';

interface TaskListsCache {
  dueSoonTasks: TaskRowData[];
  futureTasks: TaskRowData[];
  pastTasks: TaskRowData[];
  hasMorePast: boolean;
}

export default function TasksScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { profile: authProfile, user } = useAuth();
  const { data: reputationScore } = useReputationScore(user?.id);
  const { data: googleCalendarConnection } = useGoogleCalendarConnection();
  const defaultEventDurationMinutes = normalizeEventDurationMinutes(authProfile?.default_event_duration_minutes);
  const defaultGoogleEventColorId = googleCalendarConnection?.defaultEventColorId ?? '9';
  const queryClient = useQueryClient();
  const taskDetailPrefetcherRef = useRef<ReturnType<typeof createTaskDetailPrefetcher> | null>(null);
  if (!taskDetailPrefetcherRef.current) {
    taskDetailPrefetcherRef.current = createTaskDetailPrefetcher(queryClient, 2);
  }
  const rootRef = useRef<View | null>(null);
  const creatorAnchorRef = useRef<View | null>(null);
  const taskCreatorHandle = useTaskCreatorHandle();

  const [sortMode] = useTaskSortMode();
  const {
    dueSoonTasks,
    futureTasks,
    pastTasks,
    hasMorePast,
    loadingMore: loadingMorePast,
    loading: tasksLoading,
    refetch: refetchTasks,
    loadMorePastTasks,
  } = useTasks(sortMode);
  const { onboardingComplete, loading: onboardingLoading, completeOnboarding } = useOnboarding();
  const [refreshing, setRefreshing] = useState(false);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>('closed');
  const expandProgress = useSharedValue(0);
  const [creatorAnchor, setCreatorAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [proofQueueSnapshot, setProofQueueSnapshot] = useState<TaskProofQueueSnapshot>({
    activeTaskId: null,
    pendingTaskIds: [],
  });
  const proofActionQueueRef = useRef<TaskProofActionQueue | null>(null);
  if (!proofActionQueueRef.current) {
    proofActionQueueRef.current = new TaskProofActionQueue((error) => {
      console.error('[tasks] queued proof action failed unexpectedly:', error);
      Alert.alert('Proof action failed', 'Please try again. Other queued uploads will continue.');
    });
  }
  const [optimisticTasks, setOptimisticTasks] = useState<TaskRowData[]>([]);
  const [optimisticallyCompletingTaskIds, setOptimisticallyCompletingTaskIds] = useState<string[]>([]);
  const [proofTargetTask, setProofTargetTask] = useState<TaskRowData | null>(null);
  const [postponeTargetTask, setPostponeTargetTask] = useState<TaskRowData | null>(null);
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const [bottomActionsHeight, setBottomActionsHeight] = useState(0);

  const [confettiBurstCount, setConfettiBurstCount] = useState(0);

  const { friends, currentUserId, profile, loading: friendsLoading } = useFriends();
  const defaultRequiresProofForAllTasks = profile?.default_requires_proof_for_all_tasks ?? false;
  const autoSubmitAfterProofUpload = authProfile?.auto_submit_after_proof_upload ?? profile?.auto_submit_after_proof_upload ?? true;
  const alwaysShowActiveTasks = authProfile?.always_show_active_tasks ?? false;

  const isCreateOverlayOpen = overlayMode === 'create';
  const isOverlayOpen = overlayMode !== 'closed';

  const bottomDockOffset = spacing.xl + spacing.sm + spacing.xs;
  const bottomDockReservedInset = bottomDockOffset + bottomActionsHeight + spacing.sm;
  const creatorTargetTop = 0;
  const creatorTargetHeight = screenHeight;

  useEffect(() => proofActionQueueRef.current!.subscribe(setProofQueueSnapshot), []);

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
    const idsAtSchedule = optimisticallyCompletingTaskIds;
    const timeout = setTimeout(() => {
      setOptimisticallyCompletingTaskIds((prev) =>
        prev.filter((id) => !idsAtSchedule.includes(id)),
      );
    }, OPTIMISTIC_COMPLETION_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [optimisticallyCompletingTaskIds]);

  const handleProofPickedRef = useRef<(taskId: string, asset: ImagePickerAsset) => Promise<void>>(undefined);
  handleProofPickedRef.current = async (taskId: string, asset: ImagePickerAsset) => {
    if (taskId.startsWith('optimistic-')) {
      Alert.alert('Please wait', 'Task is still being created.');
      return;
    }

    const queued = proofActionQueueRef.current!.enqueue(taskId, async () => {
      const result = await uploadTaskProof(taskId, asset);
      if (!result.success) {
        Alert.alert('Could not attach proof', result.error);
        return;
      }
      queryClient.setQueriesData<TaskListsCache>(
        { queryKey: ['task-lists'], exact: false },
        (current) => {
          if (!current) return current;
          const attachProof = (tasks: TaskRowData[]) => tasks.map((task) => (
            task.id === taskId ? { ...task, has_proof: true } : task
          ));
          return {
            ...current,
            dueSoonTasks: attachProof(current.dueSoonTasks),
            futureTasks: attachProof(current.futureTasks),
            pastTasks: attachProof(current.pastTasks),
          };
        },
      );
      setOptimisticTasks((current) => current.map((task) => (
        task.id === taskId ? { ...task, has_proof: true } : task
      )));
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskDetail(taskId) });
      refetchTasks();
      Toast.show({
        type: 'proofSuccess',
        text1: autoSubmitAfterProofUpload ? 'Proof uploaded. Submitting...' : 'Proof uploaded',
        position: 'bottom',
        bottomOffset: 84,
        visibilityTime: 1800,
      });
      if (getPostProofUploadAction(autoSubmitAfterProofUpload) === 'complete') {
        await handleCompleteTaskRef.current!(taskId);
      }
    });

    if (!queued.accepted) {
      Toast.show({
        type: 'info',
        text1: 'Proof upload in progress',
        position: 'bottom',
        bottomOffset: 84,
        visibilityTime: 1800,
      });
    }

    await queued.done;
  };
  const handleProofPicked = useCallback((taskId: string, asset: ImagePickerAsset) => {
    return handleProofPickedRef.current!(taskId, asset);
  }, []);

  const handleCompleteTaskRef = useRef<(taskId: string) => Promise<void>>(undefined);
  handleCompleteTaskRef.current = async (taskId: string) => {
    if (taskId.startsWith('optimistic-')) {
      Alert.alert('Please wait', 'Task is still being created.');
      return;
    }

    if (optimisticallyCompletingTaskIds.includes(taskId)) return;

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

    setConfettiBurstCount((prev) => prev + 1);

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

    void queryClient.invalidateQueries({ queryKey: queryKeys.taskDetail(taskId) });
    refetchTasks();
    if (result.userId) await syncLocalReminderNotificationsAsync(result.userId);
  };
  const handleCompleteTask = useCallback((taskId: string) => {
    return handleCompleteTaskRef.current!(taskId);
  }, []);

  const handleCompletionIntent = useCallback((task: TaskRowData): TaskCompletionIntentResult => {
    const decision = getTaskCompletionDecision(
      task,
      optimisticallyCompletingTaskIds.includes(task.id)
        || proofQueueSnapshot.pendingTaskIds.includes(task.id),
    );

    if (decision.result === 'blocked' && decision.reason === 'optimistic') {
      Alert.alert('Please wait', 'Task is still being created.');
      return 'blocked';
    }
    if (decision.result === 'blocked' && decision.reason === 'busy') {
      return 'blocked';
    }
    if (decision.result === 'blocked' && decision.reason === 'incomplete-subtasks') {
      Toast.show({
        type: 'error',
        text1: 'All subtasks must be completed',
        position: 'bottom',
        bottomOffset: 84,
        visibilityTime: 2500,
      });
      return 'blocked';
    }
    if (decision.result === 'proof-required') {
      setProofTargetTask(task);
      return 'proof-required';
    }

    void handleCompleteTask(task.id);
    return 'accepted';
  }, [handleCompleteTask, optimisticallyCompletingTaskIds, proofQueueSnapshot.pendingTaskIds]);

  const handlePrefetchTask = useCallback((taskId: string) => {
    if (isOptimisticTaskId(taskId)) return;
    void taskDetailPrefetcherRef.current!.prefetch(taskId);
  }, []);

  const handlePostponeIntent = useCallback((task: TaskRowData) => {
    const blockReason = getTaskPostponeBlockReason(task);
    if (blockReason === 'optimistic') {
      Alert.alert('Please wait', 'Task is still being created.');
      return;
    }
    if (blockReason === 'already-postponed') {
      Alert.alert('Already postponed', 'Task has already been postponed once.');
      return;
    }
    setPostponeTargetTask(task);
  }, []);

  const addOptimisticTask = useCallback((task: TaskRowData) => {
    setOptimisticTasks((prev) => [task, ...prev]);
    if (!onboardingComplete) {
      void completeOnboarding();
    }
  }, [onboardingComplete, completeOnboarding]);

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

  const taskListHeader = authProfile?.display_rp_bar_on_dashboard && reputationScore != null ? (
    <View style={styles.reputationBarWrap}>
      <ReputationBar data={reputationScore} />
    </View>
  ) : null;

  const completionTaskIds = useMemo(() => Array.from(new Set([
    ...optimisticallyCompletingTaskIds,
    ...proofQueueSnapshot.pendingTaskIds,
  ])), [optimisticallyCompletingTaskIds, proofQueueSnapshot.pendingTaskIds]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    refetchTasks();
    setRefreshing(false);
  }, [refetchTasks]);

  return (
    <SafeAreaView ref={rootRef} style={styles.safe} edges={['top']}>
      <ProofCaptureModal
        visible={proofTargetTask != null}
        onClose={() => setProofTargetTask(null)}
        onAssetPicked={async (asset) => {
          if (!proofTargetTask) return;
          await handleProofPicked(proofTargetTask.id, asset);
        }}
      />
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
        onClose={closeOverlay}
        addOptimisticTask={addOptimisticTask}
        removeOptimisticTask={removeOptimisticTask}
        updateOptimisticTaskId={updateOptimisticTaskId}
      />
      <TaskContent
        header={taskListHeader}
        dueSoonTasks={mergedDueSoonTasks}
        futureTasks={mergedFutureTasks}
        pastTasks={pastTasks}
        hasMorePast={hasMorePast}
        loadingMorePast={loadingMorePast}
        onLoadMorePast={loadMorePastTasks}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        onCompletionIntent={handleCompletionIntent}
        onPostponeIntent={handlePostponeIntent}
        onPrefetchTask={handlePrefetchTask}
        bottomInsetOffset={bottomDockReservedInset}
        completionTaskIds={completionTaskIds}
        initialLoading={tasksLoading || onboardingLoading}
        alwaysShowActiveTasks={alwaysShowActiveTasks}
      />
      <TaskBottomActions
        creatorAnchorRef={creatorAnchorRef}
        onOpenCreateSheet={openCreateSheet}
        onMeasuredHeight={setBottomActionsHeight}
        overlayOpen={isOverlayOpen}
        bottomOffset={bottomDockOffset}
      />
      <TasksScreenPostponeOverlay
        task={postponeTargetTask}
        refetchTasks={refetchTasks}
        onClose={() => setPostponeTargetTask(null)}
      />
      <TasksScreenConfettiOverlay burstCount={confettiBurstCount} />
    </SafeAreaView>
  );
}
