import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query/keys';
import { useRealtimeInvalidation } from '@/lib/query/useRealtimeInvalidation';
import type { TaskStatus } from '@/lib/types';
import { SIGNED_URL_EXPIRY_SECONDS } from '@/lib/constants/timings';
import {
  VOUCHER_ACTIONABLE_STATUSES,
  VOUCHER_ACTIVE_VIEW_STATUSES,
  VOUCHER_HISTORY_STATUSES,
  VOUCHER_VISIBLE_STATUSES,
} from '@/lib/constants/task-status';

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }
}

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

async function fetchProofsForTasks(
  taskIds: string[],
  signal?: AbortSignal,
): Promise<Record<string, TaskProof>> {
  if (taskIds.length === 0) return {};

  throwIfAborted(signal);

  const { data, error } = await supabase
    .from('task_completion_proofs')
    .select('task_id, object_path, media_kind, overlay_timestamp_text, upload_state')
    .in('task_id', taskIds)
    .eq('upload_state', 'UPLOADED');

  if (error || !data) return {};

  throwIfAborted(signal);

  const result: Record<string, TaskProof> = {};
  await Promise.all(
    (data as any[]).map(async (row) => {
      throwIfAborted(signal);

      const { data: signedData, error: signedError } = await supabase.storage
        .from('task-proofs')
        .createSignedUrl(row.object_path as string, SIGNED_URL_EXPIRY_SECONDS);

      if (signedError || !signedData?.signedUrl) return;

      throwIfAborted(signal);

      result[row.task_id as string] = {
        signedUrl: signedData.signedUrl,
        mediaKind: (row.media_kind as string) === 'video' ? 'video' : 'image',
        overlayTimestampText: (row.overlay_timestamp_text as string) ?? '',
      };
    }),
  );

  return result;
}

export async function fetchFriendQueue(userId: string, signal?: AbortSignal): Promise<VoucherTaskRow[]> {
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
    signal,
  );

  return filtered.map((task) => ({
    ...task,
    proof: proofsByTaskId[task.id] ?? null,
  }));
}

async function fetchFriendHistory(userId: string, searchQuery: string, offset = 0): Promise<{ tasks: VouchHistoryTaskRow[]; hasMore: boolean }> {
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
    .range(offset, offset + HISTORY_PAGE_SIZE);

  if (searchQuery.trim().length > 0) {
    query = query.ilike('title', `%${searchQuery.trim()}%`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const rawBatch = ((data ?? []) as any[]).map((row) => {
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
    tasks: rawBatch.slice(0, HISTORY_PAGE_SIZE),
    hasMore: rawBatch.length > HISTORY_PAGE_SIZE,
  };
}

export function useFriendQueue(userId: string | null | undefined, searchQuery: string) {
  const queryClient = useQueryClient();

  const queueQuery = useQuery({
    queryKey: queryKeys.friendQueue(userId),
    queryFn: ({ signal }) => fetchFriendQueue(userId!, signal),
    enabled: Boolean(userId),
  });

  const historyQuery = useQuery({
    queryKey: queryKeys.friendHistory(userId, searchQuery),
    queryFn: () => fetchFriendHistory(userId!, searchQuery, 0),
    enabled: Boolean(userId),
  });

  // Stable refs so useFocusEffect deps in the screen never change reference,
  // which would cause useFocusEffect to re-run while focused and wipe pagination.
  const queueRefetchRef = useRef(queueQuery.refetch);
  queueRefetchRef.current = queueQuery.refetch;
  const refetchQueue = useCallback(() => { void queueRefetchRef.current(); }, []);

  const historyRefetchRef = useRef(historyQuery.refetch);
  historyRefetchRef.current = historyQuery.refetch;
  const refetchHistory = useCallback(() => { void historyRefetchRef.current(); }, []);

  const historyLenRef = useRef((historyQuery.data?.tasks ?? []).length);
  historyLenRef.current = (historyQuery.data?.tasks ?? []).length;

  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);

  const loadMoreHistory = useCallback(async () => {
    if (!userId || historyLoadingMore) return;
    const offset = historyLenRef.current;
    setHistoryLoadingMore(true);
    try {
      const result = await fetchFriendHistory(userId, searchQuery, offset);
      queryClient.setQueryData<{ tasks: VouchHistoryTaskRow[]; hasMore: boolean }>(
        queryKeys.friendHistory(userId, searchQuery),
        (current) => {
          if (!current) return current;
          const existingIds = new Set(current.tasks.map((t) => t.id));
          return {
            tasks: [...current.tasks, ...result.tasks.filter((t) => !existingIds.has(t.id))],
            hasMore: result.hasMore,
          };
        },
      );
    } finally {
      setHistoryLoadingMore(false);
    }
  }, [historyLoadingMore, userId, searchQuery, queryClient]);

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
    onPayload: userId ? () => { void queueRefetchRef.current(); } : undefined,
    invalidateKeys: [queryKeys.friendHistory(userId, searchQuery)],
  });

  return {
    tasks: queueQuery.data ?? [],
    loading: queueQuery.isLoading,
    error: queueQuery.error instanceof Error ? queueQuery.error.message : null,
    refetchQueue,
    historyTasks: historyQuery.data?.tasks ?? [],
    historyHasMore: historyQuery.data?.hasMore ?? false,
    historyLoading: historyQuery.isLoading,
    historyLoadingMore,
    historyError: historyQuery.error instanceof Error ? historyQuery.error.message : null,
    refetchHistory,
    loadMoreHistory,
  };
}
