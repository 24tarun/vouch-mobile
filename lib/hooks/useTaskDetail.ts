import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Task, TaskEvent, TaskReminder } from '@/lib/types';
import { queryKeys } from '@/lib/query/keys';
import { useRealtimeInvalidation } from '@/lib/query/useRealtimeInvalidation';

export interface TaskDetailData {
  task: Task | null;
  voucherUsername: string | null;
  reminders: TaskReminder[];
  events: TaskEvent[];
  totalFocusedSeconds: number;
}

async function fetchTaskDetail(taskId: string): Promise<TaskDetailData> {
  const { data: taskData, error: taskError } = await supabase
    .from('tasks')
    .select(`
      *,
      voucher:profiles!tasks_voucher_id_fkey(username)
    `)
    .eq('id', taskId)
    .single();

  if (taskError || !taskData) {
    throw new Error(taskError?.message ?? 'Task not found');
  }

  const [remindersRes, eventsRes, sessionsRes] = await Promise.all([
    supabase.from('task_reminders').select('*').eq('parent_task_id', taskId).order('reminder_at', { ascending: true }),
    supabase.from('task_events').select('*').eq('task_id', taskId).order('created_at', { ascending: true }),
    supabase.from('pomo_sessions').select('elapsed_seconds').eq('task_id', taskId).neq('status', 'DELETED'),
  ]);

  if (remindersRes.error) throw new Error(remindersRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  if (sessionsRes.error) throw new Error(sessionsRes.error.message);

  const totalFocusedSeconds = ((sessionsRes.data ?? []) as { elapsed_seconds: number | null }[])
    .reduce((sum, session) => sum + Number(session.elapsed_seconds ?? 0), 0);

  return {
    task: taskData as Task,
    voucherUsername: ((taskData as any)?.voucher?.username as string | null) ?? null,
    reminders: (remindersRes.data ?? []) as TaskReminder[],
    events: (eventsRes.data ?? []) as TaskEvent[],
    totalFocusedSeconds,
  };
}

export function useTaskDetail(taskId: string | null | undefined) {
  const query = useQuery({
    queryKey: queryKeys.taskDetail(taskId),
    queryFn: () => fetchTaskDetail(taskId!),
    enabled: Boolean(taskId),
  });

  const subscriptions = useMemo(
    () => taskId
      ? [
          { table: 'tasks', filter: `id=eq.${taskId}` },
          { table: 'task_reminders', filter: `parent_task_id=eq.${taskId}` },
          { table: 'task_events', filter: `task_id=eq.${taskId}` },
          { table: 'task_completion_proofs', filter: `task_id=eq.${taskId}` },
          { table: 'pomo_sessions', filter: `task_id=eq.${taskId}` },
        ]
      : [],
    [taskId],
  );

  useRealtimeInvalidation({
    channelName: `task-detail:${taskId ?? 'unknown'}`,
    enabled: Boolean(taskId),
    subscriptions,
    invalidateKeys: [queryKeys.taskDetail(taskId)],
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}
