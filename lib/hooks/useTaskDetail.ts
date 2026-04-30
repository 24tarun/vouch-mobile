import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { RecurrenceRule, Task, TaskEvent, TaskReminder } from '@/lib/types';
import { SIGNED_URL_EXPIRY_SECONDS } from '@/lib/constants/timings';
import { queryKeys } from '@/lib/query/keys';
import { useRealtimeInvalidation } from '@/lib/query/useRealtimeInvalidation';

export interface TaskProofData {
  signedUrl: string;
  mediaKind: 'image' | 'video';
  overlayTimestampText: string;
  bucket: string;
  objectPath: string;
}

export interface TaskDetailData {
  task: Task | null;
  recurrenceRule: RecurrenceRule | null;
  voucherUsername: string | null;
  reminders: TaskReminder[];
  events: TaskEvent[];
  totalFocusedSeconds: number;
  proof: TaskProofData | null;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function fetchTaskDetail(taskId: string, signal: AbortSignal): Promise<TaskDetailData> {
  const { data: taskData, error: taskError } = await supabase
    .from('tasks')
    .select(`
      *,
      voucher:profiles!tasks_voucher_id_fkey(username)
    `)
    .eq('id', taskId)
    .abortSignal(signal)
    .single();

  if (taskError || !taskData) {
    throw new Error(taskError?.message ?? 'Task not found');
  }

  const [remindersRes, eventsRes, sessionsRes] = await Promise.all([
    supabase.from('task_reminders').select('*').eq('parent_task_id', taskId).order('reminder_at', { ascending: true }).abortSignal(signal),
    supabase.from('task_events').select('*').eq('task_id', taskId).order('created_at', { ascending: true }).abortSignal(signal),
    supabase.from('pomo_sessions').select('elapsed_seconds').eq('task_id', taskId).neq('status', 'DELETED').abortSignal(signal),
  ]);

  if (remindersRes.error) throw new Error(remindersRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  if (sessionsRes.error) throw new Error(sessionsRes.error.message);

  const totalFocusedSeconds = ((sessionsRes.data ?? []) as { elapsed_seconds: number | null }[])
    .reduce((sum, session) => sum + Number(session.elapsed_seconds ?? 0), 0);

  const { data: proofRows, error: proofError } = await supabase
    .from('task_completion_proofs')
    .select('bucket, object_path, media_kind, overlay_timestamp_text, upload_state')
    .eq('task_id', taskId)
    .eq('upload_state', 'UPLOADED')
    .order('updated_at', { ascending: false })
    .limit(1)
    .abortSignal(signal);

  if (proofError) throw new Error(proofError.message);

  let recurrenceRule: RecurrenceRule | null = null;
  const recurrenceRuleId = (taskData as any)?.recurrence_rule_id as string | null | undefined;
  if (recurrenceRuleId) {
    const { data: recurrenceData, error: recurrenceError } = await supabase
      .from('recurrence_rules')
      .select('*')
      .eq('id', recurrenceRuleId)
      .abortSignal(signal)
      .single();

    // Don't fail task detail if recurrence rule lookup is unavailable.
    if (!recurrenceError && recurrenceData) {
      recurrenceRule = recurrenceData as RecurrenceRule;
    }
  }

  let proof: TaskProofData | null = null;
  const proofRow = (proofRows?.[0] ?? null) as {
    bucket?: string | null;
    object_path?: string | null;
    media_kind?: string | null;
    overlay_timestamp_text?: string | null;
  } | null;

  if (proofRow?.object_path) {
    const bucket = proofRow.bucket || 'task-proofs';
    const { data: signedData, error: signedError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(proofRow.object_path, SIGNED_URL_EXPIRY_SECONDS);

    const proofUrl = (!signedError && signedData?.signedUrl) ? signedData.signedUrl : null;

    if (proofUrl) {
      proof = {
        signedUrl: proofUrl,
        mediaKind: proofRow.media_kind === 'video' ? 'video' : 'image',
        overlayTimestampText: proofRow.overlay_timestamp_text ?? '',
        bucket,
        objectPath: proofRow.object_path,
      };
    }
  }

  return {
    task: taskData as Task,
    recurrenceRule,
    voucherUsername: ((taskData as any)?.voucher?.username as string | null) ?? null,
    reminders: (remindersRes.data ?? []) as TaskReminder[],
    events: (eventsRes.data ?? []) as TaskEvent[],
    totalFocusedSeconds,
    proof,
  };
}

export function useTaskDetail(taskId: string | null | undefined) {
  const normalizedTaskId = (taskId ?? '').trim();
  const isValidUuid = UUID_REGEX.test(normalizedTaskId);
  const queryTaskId = isValidUuid ? normalizedTaskId : null;

  const query = useQuery({
    queryKey: queryKeys.taskDetail(queryTaskId),
    queryFn: ({ signal }) => fetchTaskDetail(queryTaskId!, signal),
    enabled: Boolean(queryTaskId),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: (queryState) => {
      const status = (queryState.state.data as TaskDetailData | undefined)?.task?.status;
      if (status === 'AWAITING_VOUCHER' || status === 'AWAITING_AI') {
        return 5_000;
      }
      return false;
    },
  });

  const subscriptions = useMemo(
    () => queryTaskId
      ? [
          { table: 'tasks', filter: `id=eq.${queryTaskId}` },
          { table: 'task_reminders', filter: `parent_task_id=eq.${queryTaskId}` },
          { table: 'task_events', filter: `task_id=eq.${queryTaskId}` },
          { table: 'task_completion_proofs', filter: `task_id=eq.${queryTaskId}` },
          { table: 'pomo_sessions', filter: `task_id=eq.${queryTaskId}` },
        ]
      : [],
    [queryTaskId],
  );

  useRealtimeInvalidation({
    channelName: `task-detail:${queryTaskId ?? 'unknown'}`,
    enabled: Boolean(queryTaskId),
    subscriptions,
    invalidateKeys: [queryKeys.taskDetail(queryTaskId)],
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}
