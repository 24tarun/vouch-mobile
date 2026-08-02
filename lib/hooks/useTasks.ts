import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { SubtaskRowData, TaskRowData } from '@/components/TaskRow';
import { TASK_ACTIVE_STATUSES, TASK_PAST_STATUSES } from '@/lib/constants/task-status';
import { useAuth } from '@/hooks/useAuth';
import { queryKeys } from '@/lib/query/keys';
import { useRealtimeInvalidation } from '@/lib/query/useRealtimeInvalidation';
import { getFutureBoundaryMs } from '@/lib/utils/date-only';
import {
  sortDashboardTasks,
  sortPastTasksLatest,
  type DashboardSortMode,
} from '@/lib/tasks/task-dashboard-sort';
import {
  DEFAULT_PAST_TASK_PAGE_SIZE,
  getPastTaskRefreshLimit,
} from '@/lib/tasks/task-history-pagination';

export type { DashboardSortMode } from '@/lib/tasks/task-dashboard-sort';

const PAST_LIMIT = DEFAULT_PAST_TASK_PAGE_SIZE;
const DEFAULT_SORT_MODE = 'deadline_asc' as const;

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
  recurrence_rule?: { paused_at?: string | null } | null;
};

type TaskRealtimePayload = {
  table?: string;
  eventType?: 'INSERT' | 'UPDATE' | 'DELETE';
  new?: Partial<RawTask> | null;
  old?: Partial<RawTask> | null;
};

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
    recurrence_paused_at: row.recurrence_rule?.paused_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
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

async function fetchTaskBuckets(
  userId: string,
  sortMode: DashboardSortMode,
  pastLimit = PAST_LIMIT,
): Promise<TaskBucketsData> {
  const pastQuery = supabase
    .from('tasks')
    .select('id, title, deadline, status, has_proof, requires_proof, created_at, updated_at, postponed_at, recurrence_rule_id, recurrence_rule:recurrence_rules(paused_at)')
    .eq('user_id', userId)
    .in('status', TASK_PAST_STATUSES)
    .order('updated_at', { ascending: false })
    .order('id', { ascending: true });

  const [activeRes, pastRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, title, deadline, status, has_proof, requires_proof, created_at, postponed_at, recurrence_rule_id, recurrence_rule:recurrence_rules(paused_at)')
      .eq('user_id', userId)
      .in('status', TASK_ACTIVE_STATUSES)
      .order('deadline', { ascending: true }),
    pastQuery.limit(pastLimit + 1),
  ]);

  if (activeRes.error) throw new Error(activeRes.error.message);
  if (pastRes.error) throw new Error(pastRes.error.message);

  const activeTasks = (activeRes.data ?? []) as RawTask[];
  const activeIds = activeTasks.map((task) => task.id);
  const subtasksByTaskId = new Map<string, SubtaskRowData[]>();

  if (activeIds.length > 0) {
    const { data: subtaskRows, error: subtaskError } = await supabase
      .from('task_subtasks')
      .select('id, parent_task_id, title, is_completed, completed_at')
      .in('parent_task_id', activeIds)
      .order('created_at', { ascending: true });

    if (subtaskError) {
      throw new Error(subtaskError.message);
    }

    for (const row of (subtaskRows ?? []) as (SubtaskRowData & { parent_task_id: string })[]) {
      const list = subtasksByTaskId.get(row.parent_task_id) ?? [];
      list.push({ id: row.id, title: row.title, is_completed: row.is_completed, completed_at: row.completed_at });
      subtasksByTaskId.set(row.parent_task_id, list);
    }
  }

  const toActiveRowData = (row: RawTask): TaskRowData => {
    const subs = subtasksByTaskId.get(row.id);
    return {
      id: row.id,
      title: row.title,
      deadline: row.deadline,
      status: row.status,
      has_proof: Boolean(row.has_proof),
      requires_proof: Boolean(row.requires_proof),
      postponed_at: row.postponed_at ?? null,
      recurrence_rule_id: row.recurrence_rule_id ?? null,
      recurrence_paused_at: row.recurrence_rule?.paused_at ?? null,
      subtasks: subs,
      subtaskTotal: subs?.length,
      subtaskCompleted: subs?.filter((s) => s.is_completed).length,
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
  const hasMorePast = pastData.length > pastLimit;

  return {
    dueSoonTasks: sortDashboardTasks(dueSoon, sortMode),
    futureTasks: sortDashboardTasks(future, sortMode),
    pastTasks: sortPastTasksLatest(pastData.slice(0, pastLimit).map(toPastRowData)),
    hasMorePast,
  };
}

function useTaskLists(sortMode: DashboardSortMode = DEFAULT_SORT_MODE): TaskBuckets {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const taskListKey = queryKeys.taskLists(user?.id, sortMode);

  const query = useQuery({
    queryKey: taskListKey,
    queryFn: () => {
      const cached = queryClient.getQueryData<TaskBucketsData>(taskListKey);
      const pastLimit = getPastTaskRefreshLimit(cached?.pastTasks.length);
      return fetchTaskBuckets(user!.id, sortMode, pastLimit);
    },
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
  const loadingMoreRef = useRef(loadingMore);
  loadingMoreRef.current = loadingMore;
  const hasMorePastRef = useRef(query.data?.hasMorePast ?? false);
  hasMorePastRef.current = query.data?.hasMorePast ?? false;

  const loadMorePastTasks = useCallback(async () => {
    if (!user?.id || loadingMoreRef.current || !hasMorePastRef.current) return;
    const offset = pastTasksLenRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const query = supabase
        .from('tasks')
        .select('id, title, deadline, status, has_proof, requires_proof, created_at, updated_at, postponed_at, recurrence_rule_id, recurrence_rule:recurrence_rules(paused_at)')
        .eq('user_id', user.id)
        .in('status', TASK_PAST_STATUSES)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: true });
      const { data, error } = await query.range(offset, offset + PAST_LIMIT);

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
            pastTasks: sortPastTasksLatest(nextPastTasks),
            hasMorePast,
          };
        },
      );
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [queryClient, sortMode, user?.id]);

  const subscriptions = useMemo(
    () => user?.id
      ? [
          { table: 'tasks', filter: `user_id=eq.${user.id}` },
          { table: 'task_subtasks', filter: `user_id=eq.${user.id}` },
          { table: 'recurrence_rules', filter: `user_id=eq.${user.id}` },
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
        const recurrencePausedAt = existing?.recurrence_paused_at ?? null;
        const createdAt = row.created_at ?? existing?.created_at;
        const updatedAt = row.updated_at ?? existing?.updated_at;

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
            recurrence_paused_at: recurrencePausedAt,
            created_at: createdAt,
            updated_at: updatedAt,
            subtaskTotal: existing?.subtaskTotal,
            subtaskCompleted: existing?.subtaskCompleted,
          };

          const futureBoundaryMs = getFutureBoundaryMs();
          const deadlineMs = Date.parse(deadline);
          const isDueSoon = Number.isNaN(deadlineMs) || deadlineMs < futureBoundaryMs;

          return {
            ...current,
            dueSoonTasks: sortDashboardTasks(
              isDueSoon ? [...dueSoonWithout, activeTask] : dueSoonWithout,
              sortMode,
            ),
            futureTasks: sortDashboardTasks(
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
            recurrence_paused_at: recurrencePausedAt,
            created_at: createdAt,
            updated_at: updatedAt,
          };

          return {
            ...current,
            dueSoonTasks: dueSoonWithout,
            futureTasks: futureWithout,
            pastTasks: sortPastTasksLatest([pastTask, ...pastWithout]),
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
