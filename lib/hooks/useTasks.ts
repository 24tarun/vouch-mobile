import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { TaskRowData } from '@/components/TaskRow';
import { TASK_ACTIVE_STATUSES, TASK_PAST_STATUSES } from '@/lib/constants/task-status';

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
  title: string;
  deadline: string;
  status: string;
  created_at: string;
  postponed_at?: string | null;
  recurrence_rule_id?: string | null;
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

export function useTasks(sortMode: DashboardSortMode = DEFAULT_SORT_MODE): TaskBuckets {
  const [dueSoonTasks, setDueSoonTasks] = useState<TaskRowData[]>([]);
  const [futureTasks, setFutureTasks] = useState<TaskRowData[]>([]);
  const [pastTasks, setPastTasks] = useState<TaskRowData[]>([]);
  const [hasMorePast, setHasMorePast] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Stable ref to pastTasks.length so loadMorePastTasks doesn't need it as a dep
  const pastTasksLenRef = useRef(0);
  pastTasksLenRef.current = pastTasks.length;

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;

        if (!userId) {
          if (!cancelled) setLoading(false);
          return;
        }

        const [activeRes, pastRes] = await Promise.all([
          supabase
            .from('tasks')
            .select('id, title, deadline, status, created_at, postponed_at, recurrence_rule_id')
            .eq('user_id', userId)
            .in('status', TASK_ACTIVE_STATUSES)
            .order('deadline', { ascending: true }),
          supabase
            .from('tasks')
            .select('id, title, deadline, status, created_at, postponed_at, recurrence_rule_id')
            .eq('user_id', userId)
            .in('status', TASK_PAST_STATUSES)
            .order('updated_at', { ascending: false })
            .limit(PAST_LIMIT),
        ]);

        if (cancelled) return;

        if (activeRes.error) { setError(activeRes.error.message); return; }
        if (pastRes.error) { setError(pastRes.error.message); return; }

        const activeTasks = (activeRes.data ?? []) as RawTask[];
        const activeIds = activeTasks.map((t) => t.id);

        // Fetch subtask counts for active tasks in one query
        const subtaskCountByTaskId = new Map<string, { total: number; completed: number }>();
        if (activeIds.length > 0) {
          const { data: subtaskRows } = await supabase
            .from('task_subtasks')
            .select('parent_task_id, is_completed')
            .in('parent_task_id', activeIds);

          if (!cancelled) {
            for (const row of (subtaskRows ?? []) as { parent_task_id: string; is_completed: boolean }[]) {
              const counts = subtaskCountByTaskId.get(row.parent_task_id) ?? { total: 0, completed: 0 };
              counts.total += 1;
              if (row.is_completed) counts.completed += 1;
              subtaskCountByTaskId.set(row.parent_task_id, counts);
            }
          }
        }

        if (cancelled) return;

        const toActiveRowData = (row: RawTask): TaskRowData => {
          const counts = subtaskCountByTaskId.get(row.id);
          return {
            id: row.id,
            title: row.title,
            deadline: row.deadline,
            status: row.status,
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

        setDueSoonTasks(sortActiveTasks(dueSoon, sortMode));
        setFutureTasks(sortActiveTasks(future, sortMode));
        setPastTasks(pastData.map(toPastRowData));
        setHasMorePast(pastData.length === PAST_LIMIT);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to load tasks');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [sortMode, tick]);

  const loadMorePastTasks = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;

      const offset = pastTasksLenRef.current;
      const { data, error: fetchError } = await supabase
        .from('tasks')
        .select('id, title, deadline, status, created_at, postponed_at, recurrence_rule_id')
        .eq('user_id', userId)
        .in('status', TASK_PAST_STATUSES)
        .order('updated_at', { ascending: false })
        .range(offset, offset + PAST_LIMIT - 1);

      if (!fetchError && data) {
        const newRows = (data as RawTask[]).map(toPastRowData);
        setPastTasks((prev) => [...prev, ...newRows]);
        setHasMorePast(data.length === PAST_LIMIT);
      }
    } catch {
      // silently ignore load-more errors; existing list stays intact
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore]);

  return {
    dueSoonTasks,
    futureTasks,
    pastTasks,
    hasMorePast,
    loadingMore,
    loading,
    error,
    refetch: () => setTick((t) => t + 1),
    loadMorePastTasks,
  };
}
