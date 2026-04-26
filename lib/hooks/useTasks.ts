import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { TaskRowData } from '@/components/TaskRow';
import { TASK_ACTIVE_STATUSES, TASK_PAST_STATUSES } from '@/lib/constants/task-status';
import { useAuth } from '@/hooks/useAuth';
import { queryKeys } from '@/lib/query/keys';
import { useRealtimeInvalidation } from '@/lib/query/useRealtimeInvalidation';

const PAST_LIMIT = 10;
const DEFAULT_SORT_MODE = 'deadline_asc' as const;

// Mirrors web's getFutureTaskBoundaryLocal: start of the day after tomorrow.
function getFutureBoundaryMs(): number {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const boundary = new Date(startOfToday);
  boundary.setDate(boundary.getDate() + 2);
  return boundary.getTime();
}

export type DashboardSortMode =
  | 'deadline_asc'
  | 'deadline_desc'
  | 'created_asc'
  | 'created_desc';

type RawTask = {
  id: string;
  user_id?: string;
  title: string;
  deadline: string;
  status: string;
  has_proof?: boolean | null;
  requires_proof?: boolean | null;
  created_at: string;
  updated_at?: string;
  postponed_at?: string | null;
  recurrence_rule_id?: string | null;
};

type TaskRealtimePayload = {
  table?: string;
  eventType?: 'INSERT' | 'UPDATE' | 'DELETE';
  new?: Partial<RawTask> | null;
  old?: Partial<RawTask> | null;
};

function safeTimestamp(value: string): number {
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? 0 : ts;
}

function sortActiveTasks(tasks: TaskRowData[], sortMode: DashboardSortMode): TaskRowData[] {
  return [...tasks].sort((a, b) => {
    const deadlineA = safeTimestamp(a.deadline);
    const deadlineB = safeTimestamp(b.deadline);
    const createdA = safeTimestamp(a.created_at ?? '');
    const createdB = safeTimestamp(b.created_at ?? '');

    if (sortMode === 'deadline_asc') {
      if (deadlineA !== deadlineB) return deadlineA - deadlineB;
      if (createdA !== createdB) return createdB - createdA;
      return 0;
    }

    if (sortMode === 'deadline_desc') {
      if (deadlineA !== deadlineB) return deadlineB - deadlineA;
      if (createdA !== createdB) return createdB - createdA;
      return 0;
    }

    if (sortMode === 'created_asc') {
      if (createdA !== createdB) return createdA - createdB;
      if (deadlineA !== deadlineB) return deadlineA - deadlineB;
      return 0;
    }

    if (createdA !== createdB) return createdB - createdA;
    if (deadlineA !== deadlineB) return deadlineA - deadlineB;
    return 0;
  });
}

function toPastRowData(row: RawTask): TaskRowData {
  return {
    id: row.id,
    title: row.title,
    deadline: row.deadline,
    status: row.status,
    has_proof: Boolean(row.has_proof),
    requires_proof: Boolean(row.requires_proof),
    postponed_at: row.postponed_at ?? null,
    recurrence_rule_id: row.recurrence_rule_id ?? null,
  };
}

export interface TaskBuckets {
  dueSoonTasks: TaskRowData[];
  futureTasks: TaskRowData[];
  pastTasks: TaskRowData[];
  hasMorePast: boolean;
  loadingMore: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  loadMorePastTasks: () => void;
}

interface TaskBucketsData {
  dueSoonTasks: TaskRowData[];
  futureTasks: TaskRowData[];
  pastTasks: TaskRowData[];
  hasMorePast: boolean;
}

const TASK_ACTIVE_STATUS_SET = new Set<string>(TASK_ACTIVE_STATUSES);
const TASK_PAST_STATUS_SET = new Set<string>(TASK_PAST_STATUSES);

async function fetchTaskBuckets(userId: string, sortMode: DashboardSortMode): Promise<TaskBucketsData> {
  const [activeRes, pastRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, title, deadline, status, has_proof, requires_proof, created_at, postponed_at, recurrence_rule_id')
      .eq('user_id', userId)
      .in('status', TASK_ACTIVE_STATUSES)
      .order('deadline', { ascending: true }),
    supabase
      .from('tasks')
      .select('id, title, deadline, status, has_proof, requires_proof, created_at, postponed_at, recurrence_rule_id')
      .eq('user_id', userId)
      .in('status', TASK_PAST_STATUSES)
      .order('updated_at', { ascending: false })
      .limit(PAST_LIMIT + 1),
  ]);

  if (activeRes.error) throw new Error(activeRes.error.message);
  if (pastRes.error) throw new Error(pastRes.error.message);

  const activeTasks = (activeRes.data ?? []) as RawTask[];
  const activeIds = activeTasks.map((task) => task.id);
  const subtaskCountByTaskId = new Map<string, { total: number; completed: number }>();

  if (activeIds.length > 0) {
    const { data: subtaskRows, error: subtaskError } = await supabase
      .from('task_subtasks')
      .select('parent_task_id, is_completed')
      .in('parent_task_id', activeIds);

    if (subtaskError) {
      throw new Error(subtaskError.message);
    }

    for (const row of (subtaskRows ?? []) as { parent_task_id: string; is_completed: boolean }[]) {
      const counts = subtaskCountByTaskId.get(row.parent_task_id) ?? { total: 0, completed: 0 };
      counts.total += 1;
      if (row.is_completed) counts.completed += 1;
      subtaskCountByTaskId.set(row.parent_task_id, counts);
    }
  }

  const toActiveRowData = (row: RawTask): TaskRowData => {
    const counts = subtaskCountByTaskId.get(row.id);
    return {
      id: row.id,
      title: row.title,
      deadline: row.deadline,
      status: row.status,
      has_proof: Boolean(row.has_proof),
      requires_proof: Boolean(row.requires_proof),
      postponed_at: row.postponed_at ?? null,
      recurrence_rule_id: row.recurrence_rule_id ?? null,
      subtaskTotal: counts?.total,
      subtaskCompleted: counts?.completed,
      created_at: row.created_at,
    };
  };

  const futureBoundaryMs = getFutureBoundaryMs();
  const dueSoon: TaskRowData[] = [];
  const future: TaskRowData[] = [];

  for (const row of activeTasks) {
    const deadlineMs = Date.parse(row.deadline);
    if (Number.isNaN(deadlineMs) || deadlineMs < futureBoundaryMs) {
      dueSoon.push(toActiveRowData(row));
    } else {
      future.push(toActiveRowData(row));
    }
  }

  const pastData = (pastRes.data ?? []) as RawTask[];
  const hasMorePast = pastData.length > PAST_LIMIT;

  return {
    dueSoonTasks: sortActiveTasks(dueSoon, sortMode),
    futureTasks: sortActiveTasks(future, sortMode),
    pastTasks: pastData.slice(0, PAST_LIMIT).map(toPastRowData),
    hasMorePast,
  };
}

function useTaskLists(sortMode: DashboardSortMode = DEFAULT_SORT_MODE): TaskBuckets {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.taskLists(user?.id, sortMode),
    queryFn: () => fetchTaskBuckets(user!.id, sortMode),
    enabled: Boolean(user?.id),
  });
  // Stable ref to pastTasks.length so loadMorePastTasks doesn't need it as a dep
  const pastTasksLenRef = useRef((query.data?.pastTasks ?? []).length);
  pastTasksLenRef.current = (query.data?.pastTasks ?? []).length;

  // Stable refetch reference — useFocusEffect in the tasks screen depends on this
  // via useCallback; an unstable reference would cause useFocusEffect to re-run
  // every time the query re-renders, overwriting any load-more pagination state.
  const queryRefetchRef = useRef(query.refetch);
  queryRefetchRef.current = query.refetch;
  const refetch = useCallback(() => { void queryRefetchRef.current(); }, []);

  const [loadingMore, setLoadingMore] = useState(false);

  const loadMorePastTasks = useCallback(async () => {
    if (!user?.id || loadingMore) return;
    const offset = pastTasksLenRef.current;
    setLoadingMore(true);
    try {
      const { data, error } = await supabase
        .from('tasks')
        .select('id, title, deadline, status, has_proof, requires_proof, created_at, postponed_at, recurrence_rule_id')
        .eq('user_id', user.id)
        .in('status', TASK_PAST_STATUSES)
        .order('updated_at', { ascending: false })
        .range(offset, offset + PAST_LIMIT);

      if (error || !data) return;
      queryClient.setQueryData<TaskBucketsData>(
        queryKeys.taskLists(user.id, sortMode),
        (current) => {
          if (!current) return current;
          const rawBatch = data as RawTask[];
          const hasMorePast = rawBatch.length > PAST_LIMIT;
          const appendedPastTasks = rawBatch.slice(0, PAST_LIMIT).map(toPastRowData);
          const existingIds = new Set(current.pastTasks.map((task) => task.id));
          const nextPastTasks = [
            ...current.pastTasks,
            ...appendedPastTasks.filter((task) => !existingIds.has(task.id)),
          ];

          return {
            ...current,
            pastTasks: nextPastTasks,
            hasMorePast,
          };
        },
      );
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, queryClient, sortMode, user?.id]);

  const subscriptions = useMemo(
    () => user?.id
      ? [
          { table: 'tasks', filter: `user_id=eq.${user.id}` },
          { table: 'task_subtasks', filter: `user_id=eq.${user.id}` },
        ]
      : [],
    [user?.id],
  );

  const handleTaskListPayload = useCallback((payload: unknown) => {
    if (!user?.id) return;
    const typedPayload = payload as TaskRealtimePayload;
    if (typedPayload.table !== 'tasks') return;

    const row = (typedPayload.eventType === 'DELETE' ? typedPayload.old : typedPayload.new)
      ?? typedPayload.new
      ?? typedPayload.old;
    if (!row?.id) return;
    if (row.user_id && row.user_id !== user.id) return;

    queryClient.setQueryData<TaskBucketsData>(
      queryKeys.taskLists(user.id, sortMode),
      (current) => {
        if (!current) return current;

        const taskId = row.id;
        if (!taskId) return current;

        const existing = current.dueSoonTasks.find((task) => task.id === taskId)
          ?? current.futureTasks.find((task) => task.id === taskId)
          ?? current.pastTasks.find((task) => task.id === taskId);

        const dueSoonWithout = current.dueSoonTasks.filter((task) => task.id !== taskId);
        const futureWithout = current.futureTasks.filter((task) => task.id !== taskId);
        const pastWithout = current.pastTasks.filter((task) => task.id !== taskId);

        const nextStatus = row.status ?? existing?.status ?? null;
        if (!nextStatus || typedPayload.eventType === 'DELETE' || nextStatus === 'DELETED') {
          return {
            ...current,
            dueSoonTasks: dueSoonWithout,
            futureTasks: futureWithout,
            pastTasks: pastWithout,
          };
        }

        const deadline = row.deadline ?? existing?.deadline ?? null;
        const title = row.title ?? existing?.title ?? '';
        const hasProof = Boolean(row.has_proof ?? existing?.has_proof);
        const requiresProof = Boolean(row.requires_proof ?? existing?.requires_proof);
        const postponedAt = row.postponed_at ?? existing?.postponed_at ?? null;
        const recurrenceRuleId = row.recurrence_rule_id ?? existing?.recurrence_rule_id ?? null;
        const createdAt = row.created_at ?? existing?.created_at;

        if (!deadline || !title) {
          return current;
        }

        if (TASK_ACTIVE_STATUS_SET.has(nextStatus)) {
          const activeTask: TaskRowData = {
            id: taskId,
            title,
            deadline,
            status: nextStatus,
            has_proof: hasProof,
            requires_proof: requiresProof,
            postponed_at: postponedAt,
            recurrence_rule_id: recurrenceRuleId,
            created_at: createdAt,
            subtaskTotal: existing?.subtaskTotal,
            subtaskCompleted: existing?.subtaskCompleted,
          };

          const futureBoundaryMs = getFutureBoundaryMs();
          const deadlineMs = Date.parse(deadline);
          const isDueSoon = Number.isNaN(deadlineMs) || deadlineMs < futureBoundaryMs;

          return {
            ...current,
            dueSoonTasks: sortActiveTasks(
              isDueSoon ? [...dueSoonWithout, activeTask] : dueSoonWithout,
              sortMode,
            ),
            futureTasks: sortActiveTasks(
              isDueSoon ? futureWithout : [...futureWithout, activeTask],
              sortMode,
            ),
            pastTasks: pastWithout,
          };
        }

        if (TASK_PAST_STATUS_SET.has(nextStatus)) {
          const pastTask: TaskRowData = {
            id: taskId,
            title,
            deadline,
            status: nextStatus,
            has_proof: hasProof,
            requires_proof: requiresProof,
            postponed_at: postponedAt,
            recurrence_rule_id: recurrenceRuleId,
          };

          return {
            ...current,
            dueSoonTasks: dueSoonWithout,
            futureTasks: futureWithout,
            pastTasks: [pastTask, ...pastWithout],
          };
        }

        return current;
      },
    );
  }, [queryClient, sortMode, user?.id]);

  useRealtimeInvalidation({
    channelName: `task-lists:${user?.id ?? 'anon'}:${sortMode}`,
    enabled: Boolean(user?.id),
    subscriptions,
    onPayload: handleTaskListPayload,
    invalidateKeys: [queryKeys.taskLists(user?.id, sortMode)],
    maxInvalidationsPerMinute: 120,
    minInvalidateIntervalMs: 250,
  });

  return {
    dueSoonTasks: query.data?.dueSoonTasks ?? [],
    futureTasks: query.data?.futureTasks ?? [],
    pastTasks: query.data?.pastTasks ?? [],
    hasMorePast: query.data?.hasMorePast ?? false,
    loadingMore,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch,
    loadMorePastTasks,
  };
}

export function useTasks(sortMode: DashboardSortMode = DEFAULT_SORT_MODE): TaskBuckets {
  return useTaskLists(sortMode);
}
