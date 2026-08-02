import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { AiVouch, RecurrenceRule, RectificationRequest, Task, TaskEvent, TaskReminder } from '@/lib/types';
import { SIGNED_URL_EXPIRY_SECONDS } from '@/lib/constants/timings';
import { queryKeys } from '@/lib/query/keys';
import { useRealtimeInvalidation } from '@/lib/query/useRealtimeInvalidation';
import { formatProofTimestampOverlay } from '@/lib/proof-timestamp-mobile';

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
  recurrenceVoucherUsername: string | null;
  voucherUsername: string | null;
  reminders: TaskReminder[];
  events: TaskEvent[];
  aiVouches: AiVouch[];
  totalFocusedSeconds: number;
  proof: TaskProofData | null;
  rectificationRequest: RectificationRequest | null;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const TASK_DETAIL_STALE_TIME_MS = 60_000;

interface CachedProofUrl {
  revision: string;
  signedUrl: string;
  expiresAt: number;
}

const proofUrlCache = new Map<string, CachedProofUrl>();
const SIGNED_URL_REFRESH_BUFFER_MS = 60_000;

async function getProofSignedUrl(bucket: string, objectPath: string, revision: string): Promise<string | null> {
  const cacheKey = `${bucket}:${objectPath}`;
  const cached = proofUrlCache.get(cacheKey);

  if (
    cached?.revision === revision &&
    cached.expiresAt - SIGNED_URL_REFRESH_BUFFER_MS > Date.now()
  ) {
    return cached.signedUrl;
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(objectPath, SIGNED_URL_EXPIRY_SECONDS);

  if (error || !data?.signedUrl) return null;

  proofUrlCache.set(cacheKey, {
    revision,
    signedUrl: data.signedUrl,
    expiresAt: Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1_000,
  });

  return data.signedUrl;
}

async function fetchTaskDetail(taskId: string, signal: AbortSignal): Promise<TaskDetailData> {
  const { data: taskData, error: taskError } = await supabase
    .from('tasks')
    .select(`
      *,
      voucher:profiles!tasks_voucher_id_fkey(username),
      ai_vouches(*)
    `)
    .eq('id', taskId)
    .abortSignal(signal)
    .single();

  if (taskError || !taskData) {
    throw new Error(taskError?.message ?? 'Task not found');
  }

  const [remindersRes, eventsRes, sessionsRes, rectificationRes] = await Promise.all([
    supabase.from('task_reminders').select('*').eq('parent_task_id', taskId).order('reminder_at', { ascending: true }).abortSignal(signal),
    supabase.from('task_events').select('*').eq('task_id', taskId).order('created_at', { ascending: true }).abortSignal(signal),
    supabase.from('pomo_sessions').select('elapsed_seconds').eq('task_id', taskId).neq('status', 'DELETED').abortSignal(signal),
    supabase.from('rectification_requests').select('*').eq('task_id', taskId)
      .order('created_at', { ascending: false }).limit(1).abortSignal(signal).maybeSingle(),
  ]);

  if (remindersRes.error) throw new Error(remindersRes.error.message);
  if (eventsRes.error) throw new Error(eventsRes.error.message);
  if (sessionsRes.error) throw new Error(sessionsRes.error.message);
  if (rectificationRes.error) throw new Error(rectificationRes.error.message);

  const totalFocusedSeconds = ((sessionsRes.data ?? []) as { elapsed_seconds: number | null }[])
    .reduce((sum, session) => sum + Number(session.elapsed_seconds ?? 0), 0);

  const { data: proofRows, error: proofError } = await supabase
    .from('task_completion_proofs')
    .select('bucket, object_path, media_kind, overlay_timestamp_text, proof_timestamp_source, upload_state, updated_at')
    .eq('task_id', taskId)
    .eq('upload_state', 'UPLOADED')
    .order('updated_at', { ascending: false })
    .limit(1)
    .abortSignal(signal);

  if (proofError) throw new Error(proofError.message);

  let recurrenceRule: RecurrenceRule | null = null;
  let recurrenceVoucherUsername: string | null = null;
  const recurrenceRuleId = (taskData as any)?.recurrence_rule_id as string | null | undefined;
  if (recurrenceRuleId) {
    const { data: recurrenceData, error: recurrenceError } = await supabase
      .from('recurrence_rules')
      .select('*, voucher:profiles!recurrence_rules_voucher_id_fkey(username)')
      .eq('id', recurrenceRuleId)
      .abortSignal(signal)
      .single();

    // Don't fail task detail if recurrence rule lookup is unavailable.
    if (!recurrenceError && recurrenceData) {
      recurrenceRule = recurrenceData as RecurrenceRule;
      recurrenceVoucherUsername =
        ((recurrenceData as any)?.voucher?.username as string | null | undefined) ?? null;
    }
  }

  let proof: TaskProofData | null = null;
  const proofRow = (proofRows?.[0] ?? null) as {
    bucket?: string | null;
    object_path?: string | null;
    media_kind?: string | null;
    overlay_timestamp_text?: string | null;
    proof_timestamp_source?: string | null;
    updated_at?: string | null;
  } | null;

  if (proofRow?.object_path) {
    const bucket = proofRow.bucket || 'task-proofs';
    const proofUrl = await getProofSignedUrl(
      bucket,
      proofRow.object_path,
      proofRow.updated_at ?? '',
    );

    if (proofUrl) {
      proof = {
        signedUrl: proofUrl,
        mediaKind: proofRow.media_kind === 'video' ? 'video' : 'image',
        overlayTimestampText: formatProofTimestampOverlay(
          proofRow.overlay_timestamp_text,
          proofRow.proof_timestamp_source,
        ),
        bucket,
        objectPath: proofRow.object_path,
      };
    }
  }

  return {
    task: taskData as Task,
    recurrenceRule,
    recurrenceVoucherUsername,
    voucherUsername: ((taskData as any)?.voucher?.username as string | null) ?? null,
    reminders: (remindersRes.data ?? []) as TaskReminder[],
    events: (eventsRes.data ?? []) as TaskEvent[],
    aiVouches: (((taskData as any)?.ai_vouches ?? []) as AiVouch[]).sort((a, b) => a.attempt_number - b.attempt_number),
    totalFocusedSeconds,
    proof,
    rectificationRequest: (rectificationRes.data as RectificationRequest | null) ?? null,
  };
}

export function taskDetailQueryOptions(taskId: string) {
  return {
    queryKey: queryKeys.taskDetail(taskId),
    queryFn: ({ signal }: { signal: AbortSignal }) => fetchTaskDetail(taskId, signal),
    staleTime: TASK_DETAIL_STALE_TIME_MS,
  } as const;
}

export function useTaskDetail(taskId: string | null | undefined) {
  const normalizedTaskId = (taskId ?? '').trim();
  const isValidUuid = UUID_REGEX.test(normalizedTaskId);
  const queryTaskId = isValidUuid ? normalizedTaskId : null;

  const query = useQuery({
    ...(queryTaskId
      ? taskDetailQueryOptions(queryTaskId)
      : {
          queryKey: queryKeys.taskDetail(null),
          queryFn: async () => {
            throw new Error('A valid task ID is required');
          },
          staleTime: TASK_DETAIL_STALE_TIME_MS,
        }),
    enabled: Boolean(queryTaskId),
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: (queryState) => {
      const status = (queryState.state.data as TaskDetailData | undefined)?.task?.status;
      if (status === 'AWAITING_VOUCHER' || status === 'AWAITING_AI' || status === 'AWAITING_RECTIFICATION') {
        return 5_000;
      }
      return false;
    },
  });
  const recurrenceRuleId = query.data?.task?.recurrence_rule_id ?? null;

  const subscriptions = useMemo(
    () => queryTaskId
      ? [
          { table: 'tasks', filter: `id=eq.${queryTaskId}` },
          { table: 'task_reminders', filter: `parent_task_id=eq.${queryTaskId}` },
          { table: 'task_events', filter: `task_id=eq.${queryTaskId}` },
          { table: 'task_completion_proofs', filter: `task_id=eq.${queryTaskId}` },
          { table: 'rectification_requests', filter: `task_id=eq.${queryTaskId}` },
          { table: 'pomo_sessions', filter: `task_id=eq.${queryTaskId}` },
          ...(recurrenceRuleId
            ? [{ table: 'recurrence_rules', filter: `id=eq.${recurrenceRuleId}` }]
            : []),
        ]
      : [],
    [queryTaskId, recurrenceRuleId],
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
