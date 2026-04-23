import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query/keys';
import { useRealtimeInvalidation } from '@/lib/query/useRealtimeInvalidation';
import type { TaskStatus } from '@/lib/types';
import {
  VOUCHER_ACTIONABLE_STATUSES,
  VOUCHER_ACTIVE_VIEW_STATUSES,
  VOUCHER_HISTORY_STATUSES,
  VOUCHER_VISIBLE_STATUSES,
} from '@/lib/constants/task-status';

interface TaskProof {
  signedUrl: string;
  mediaKind: 'image' | 'video';
  overlayTimestampText: string;
}

export interface VoucherTaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  failure_cost_cents: number;
  proof_request_open: boolean;
  has_proof: boolean;
  proof: TaskProof | null;
  updated_at: string;
  deadline: string;
  voucher_response_deadline: string | null;
  user: {
    id: string;
    username: string;
    voucher_can_view_active_tasks: boolean;
    currency: string;
  } | null;
}

export interface VouchHistoryTaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  updated_at: string;
  failure_cost_cents: number;
  user: {
    id: string;
    username: string;
  } | null;
}

const HISTORY_PAGE_SIZE = 10;

function getActiveVisibilityWindow(reference: Date = new Date()): { startOfTodayMs: number; startOfDayAfterTomorrowMs: number } {
  const startOfToday = new Date(reference);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfDayAfterTomorrow = new Date(startOfToday);
  startOfDayAfterTomorrow.setDate(startOfDayAfterTomorrow.getDate() + 2);
  return {
    startOfTodayMs: startOfToday.getTime(),
    startOfDayAfterTomorrowMs: startOfDayAfterTomorrow.getTime(),
  };
}

function canVoucherSeeTask(task: VoucherTaskRow): boolean {
  if (VOUCHER_ACTIONABLE_STATUSES.includes(task.status)) return true;
  if (VOUCHER_ACTIVE_VIEW_STATUSES.includes(task.status)) {
    if (!task.user?.voucher_can_view_active_tasks) return false;
    const deadlineMs = Date.parse(task.deadline);
    if (Number.isNaN(deadlineMs)) return false;
    const { startOfTodayMs, startOfDayAfterTomorrowMs } = getActiveVisibilityWindow();
    return deadlineMs >= startOfTodayMs && deadlineMs < startOfDayAfterTomorrowMs;
  }
  return true;
}

async function fetchProofsForTasks(taskIds: string[]): Promise<Record<string, TaskProof>> {
  if (taskIds.length === 0) return {};

  const { data, error } = await supabase
    .from('task_completion_proofs')
    .select('task_id, object_path, media_kind, overlay_timestamp_text, upload_state')
    .in('task_id', taskIds)
    .eq('upload_state', 'UPLOADED');

  if (error || !data) return {};

  const result: Record<string, TaskProof> = {};
  await Promise.all(
    (data as any[]).map(async (row) => {
      const { data: signedData, error: signedError } = await supabase.storage
        .from('task-proofs')
        .createSignedUrl(row.object_path as string, 3600);

      if (signedError || !signedData?.signedUrl) return;

      result[row.task_id as string] = {
        signedUrl: signedData.signedUrl,
        mediaKind: (row.media_kind as string) === 'video' ? 'video' : 'image',
        overlayTimestampText: (row.overlay_timestamp_text as string) ?? '',
      };
    }),
  );

  return result;
}

async function fetchFriendQueue(userId: string): Promise<VoucherTaskRow[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(`
      id,
      title,
      status,
      failure_cost_cents,
      proof_request_open,
      has_proof,
      updated_at,
      deadline,
      voucher_response_deadline,
      user:profiles!tasks_user_id_fkey(
        id,
        username,
        voucher_can_view_active_tasks,
        currency
      )
    `)
    .eq('voucher_id', userId)
    .neq('user_id', userId)
    .in('status', VOUCHER_VISIBLE_STATUSES)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows = ((data ?? []) as any[]).map((row) => {
    const owner = row.user as {
      id?: string;
      username?: string;
      voucher_can_view_active_tasks?: boolean;
      currency?: string;
    } | null;

    return {
      id: row.id as string,
      title: (row.title as string) || 'Untitled task',
      status: row.status as TaskStatus,
      failure_cost_cents: Number(row.failure_cost_cents ?? 0),
      proof_request_open: Boolean(row.proof_request_open),
      has_proof: Boolean(row.has_proof),
      proof: null,
      updated_at: (row.updated_at as string) ?? new Date().toISOString(),
      deadline: (row.deadline as string) ?? new Date().toISOString(),
      voucher_response_deadline: (row.voucher_response_deadline as string | null) ?? null,
      user: owner?.id
        ? {
            id: owner.id,
            username: owner.username ?? 'Unknown owner',
            voucher_can_view_active_tasks: Boolean(owner.voucher_can_view_active_tasks),
            currency: (owner.currency as string) ?? 'EUR',
          }
        : null,
    } satisfies VoucherTaskRow;
  });

  const filtered = rows.filter(canVoucherSeeTask);
  const proofsByTaskId = await fetchProofsForTasks(
    filtered
      .filter((task) => task.has_proof || task.status === 'AWAITING_VOUCHER')
      .map((task) => task.id),
  );

  return filtered.map((task) => ({
    ...task,
    proof: proofsByTaskId[task.id] ?? null,
  }));
}

async function fetchFriendHistory(userId: string, searchQuery: string): Promise<{ tasks: VouchHistoryTaskRow[]; hasMore: boolean }> {
  let query = supabase
    .from('tasks')
    .select(`
      id,
      title,
      status,
      updated_at,
      failure_cost_cents,
      user:profiles!tasks_user_id_fkey(
        id,
        username
      )
    `)
    .eq('voucher_id', userId)
    .neq('user_id', userId)
    .in('status', VOUCHER_HISTORY_STATUSES)
    .order('updated_at', { ascending: false })
    .range(0, HISTORY_PAGE_SIZE - 1);

  if (searchQuery.trim().length > 0) {
    query = query.ilike('title', `%${searchQuery.trim()}%`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const tasks = ((data ?? []) as any[]).map((row) => {
    const owner = row.user as { id?: string; username?: string } | null;
    return {
      id: row.id as string,
      title: (row.title as string) || 'Untitled task',
      status: row.status as TaskStatus,
      updated_at: row.updated_at as string,
      failure_cost_cents: Number(row.failure_cost_cents ?? 0),
      user: owner?.id
        ? {
            id: owner.id,
            username: owner.username ?? 'Unknown owner',
          }
        : null,
    } satisfies VouchHistoryTaskRow;
  });

  return {
    tasks,
    hasMore: tasks.length === HISTORY_PAGE_SIZE,
  };
}

export function useFriendQueue(userId: string | null | undefined, searchQuery: string) {
  const queueQuery = useQuery({
    queryKey: queryKeys.friendQueue(userId),
    queryFn: () => fetchFriendQueue(userId!),
    enabled: Boolean(userId),
  });

  const historyQuery = useQuery({
    queryKey: queryKeys.friendHistory(userId, searchQuery),
    queryFn: () => fetchFriendHistory(userId!, searchQuery),
    enabled: Boolean(userId),
  });

  const subscriptions = useMemo(
    () => userId
      ? [
          { table: 'tasks', filter: `voucher_id=eq.${userId}` },
          { table: 'task_completion_proofs' },
          { table: 'profiles' },
          { table: 'rectify_passes' },
          { table: 'ledger_entries' },
        ]
      : [],
    [userId],
  );

  useRealtimeInvalidation({
    channelName: `friend-queue:${userId ?? 'anon'}`,
    enabled: Boolean(userId),
    subscriptions,
    // Direct refetch instead of invalidate — invalidateQueries doesn't reliably
    // trigger a background refetch in React Native when the app is already focused.
    onPayload: userId ? () => { void queueQuery.refetch(); } : undefined,
    invalidateKeys: [queryKeys.friendHistory(userId, searchQuery)],
  });

  return {
    tasks: queueQuery.data ?? [],
    loading: queueQuery.isLoading,
    error: queueQuery.error instanceof Error ? queueQuery.error.message : null,
    refetchQueue: queueQuery.refetch,
    historyTasks: historyQuery.data?.tasks ?? [],
    historyHasMore: historyQuery.data?.hasMore ?? false,
    historyLoading: historyQuery.isLoading,
    historyError: historyQuery.error instanceof Error ? historyQuery.error.message : null,
    refetchHistory: historyQuery.refetch,
  };
}
