import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Commitment, CommitmentStatus, CommitmentTaskLink, Currency } from '@/lib/types';
import { useAuth } from '@/hooks/useAuth';
import { queryKeys } from '@/lib/query/keys';
import { useRealtimeInvalidation } from '@/lib/query/useRealtimeInvalidation';

// ─── Day status ───────────────────────────────────────────────────────────────

export type DayStatus = 'passed' | 'failed' | 'pending' | 'future';

export interface DayStatusEntry {
  date: string;
  status: DayStatus;
}

// ─── Lite task shape used for computation ─────────────────────────────────────

interface CommitmentTaskLite {
  id: string;
  title: string;
  status: string;
  deadline: string;
  failure_cost_cents: number;
  recurrence_rule_id: string | null;
}

// ─── Derived list item ────────────────────────────────────────────────────────

export interface CommitmentListItem extends Commitment {
  derived_status: CommitmentStatus;
  earned_so_far_cents: number;
  total_target_cents: number;
  days_total: number;
  days_remaining: number;
  starts_in_days: number;
  day_statuses: DayStatusEntry[];
}

// ─── Hook result ──────────────────────────────────────────────────────────────

export interface UseCommitmentsResult {
  commitments: CommitmentListItem[];
  currency: Currency;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─── Status sets (mirrored from web commitment-status.ts) ─────────────────────

const PENDING_STATUSES = new Set([
  'ACTIVE', 'POSTPONED', 'AWAITING_VOUCHER', 'AWAITING_AI',
  'MARKED_COMPLETE', 'AWAITING_USER', 'ESCALATED',
]);
const PASSING_STATUSES = new Set(['ACCEPTED', 'AUTO_ACCEPTED', 'AI_ACCEPTED', 'RECTIFIED']);
const FAILING_STATUSES = new Set(['DENIED', 'MISSED']);

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function getTodayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function toDateOnly(timestamp: string): string | null {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function dayDiffFromToday(dateOnly: string): number {
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const target = new Date(`${dateOnly}T00:00:00.000Z`);
  if (Number.isNaN(target.getTime())) return 0;
  return Math.floor((target.getTime() - todayUtc) / 86_400_000);
}

function dayDiffInclusive(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function filterTasksInWindow(
  tasks: CommitmentTaskLite[],
  startDate: string,
  endDate: string,
): CommitmentTaskLite[] {
  return tasks.filter((t) => {
    const d = toDateOnly(t.deadline);
    return d !== null && d >= startDate && d <= endDate;
  });
}

function computeDerivedStatus(
  commitment: Pick<Commitment, 'status' | 'start_date' | 'end_date'>,
  linkedTasks: CommitmentTaskLite[],
): CommitmentStatus {
  if (commitment.status === 'DRAFT') return 'DRAFT';
  const inWindow = filterTasksInWindow(linkedTasks, commitment.start_date, commitment.end_date);
  if (inWindow.some((t) => FAILING_STATUSES.has(t.status))) return 'FAILED';
  if (inWindow.some((t) => PENDING_STATUSES.has(t.status))) return 'ACTIVE';
  if (getTodayUtc() > commitment.end_date) return 'COMPLETED';
  return 'ACTIVE';
}

function computeEarnedSoFar(
  linkedTasks: CommitmentTaskLite[],
  startDate: string,
  endDate: string,
): number {
  const today = getTodayUtc();
  return filterTasksInWindow(linkedTasks, startDate, endDate).reduce((sum, t) => {
    const d = toDateOnly(t.deadline);
    if (!d || d > today) return sum;
    if (!PASSING_STATUSES.has(t.status)) return sum;
    return sum + (Number(t.failure_cost_cents) || 0);
  }, 0);
}

function computeTotalTarget(
  linkedTasks: CommitmentTaskLite[],
  startDate: string,
  endDate: string,
): number {
  return filterTasksInWindow(linkedTasks, startDate, endDate).reduce(
    (sum, task) => sum + (Number(task.failure_cost_cents) || 0),
    0,
  );
}

function getDayStatuses(
  linkedTasks: CommitmentTaskLite[],
  startDate: string,
  endDate: string,
): DayStatusEntry[] {
  const inWindow = filterTasksInWindow(linkedTasks, startDate, endDate);
  const byDate = new Map<string, CommitmentTaskLite[]>();
  const today = getTodayUtc();

  for (const t of inWindow) {
    const d = toDateOnly(t.deadline);
    if (!d) continue;
    const arr = byDate.get(d) ?? [];
    arr.push(t);
    byDate.set(d, arr);
  }

  const result: DayStatusEntry[] = [];
  for (const [date, tasks] of Array.from(byDate.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    if (tasks.some((t) => FAILING_STATUSES.has(t.status))) {
      result.push({ date, status: 'failed' });
    } else if (tasks.every((t) => PASSING_STATUSES.has(t.status))) {
      result.push({ date, status: 'passed' });
    } else if (date > today) {
      result.push({ date, status: 'future' });
    } else {
      result.push({ date, status: 'pending' });
    }
  }
  return result;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

async function fetchCommitments(userId: string): Promise<CommitmentListItem[]> {
  const { data: commitmentsData, error: commitmentsError } = await supabase
    .from('commitments')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (commitmentsError) {
    throw new Error(commitmentsError.message);
  }

  const rawCommitments = (commitmentsData ?? []) as Commitment[];
  if (rawCommitments.length === 0) {
    return [];
  }

  const commitmentIds = rawCommitments.map((commitment) => commitment.id);
  const { data: linksData, error: linksError } = await supabase
    .from('commitment_task_links')
    .select('*')
    .in('commitment_id', commitmentIds)
    .order('created_at', { ascending: true });

  if (linksError) {
    throw new Error(linksError.message);
  }

  const links = (linksData ?? []) as CommitmentTaskLink[];
  const taskIds = [...new Set(links.map((link) => link.task_id).filter((id): id is string => Boolean(id)))];
  const ruleIds = [...new Set(links.map((link) => link.recurrence_rule_id).filter((id): id is string => Boolean(id)))];
  const allStarts = rawCommitments.map((commitment) => commitment.start_date).sort();
  const allEnds = rawCommitments.map((commitment) => commitment.end_date).sort();
  const minStart = allStarts[0];
  const maxEnd = allEnds[allEnds.length - 1];

  const [oneOffRes, recurringRes] = await Promise.all([
    taskIds.length > 0
      ? supabase
          .from('tasks')
          .select('id, title, status, deadline, failure_cost_cents, recurrence_rule_id')
          .eq('user_id', userId)
          .in('id', taskIds)
          .neq('status', 'DELETED')
      : Promise.resolve({ data: [], error: null }),
    ruleIds.length > 0 && minStart && maxEnd
      ? supabase
          .from('tasks')
          .select('id, title, status, deadline, failure_cost_cents, recurrence_rule_id')
          .eq('user_id', userId)
          .in('recurrence_rule_id', ruleIds)
          .gte('deadline', `${minStart}T00:00:00.000Z`)
          .lte('deadline', `${maxEnd}T23:59:59.999Z`)
          .neq('status', 'DELETED')
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (oneOffRes.error) throw new Error(oneOffRes.error.message);
  if (recurringRes.error) throw new Error(recurringRes.error.message);

  const oneOffById = new Map<string, CommitmentTaskLite>();
  for (const task of ((oneOffRes.data ?? []) as CommitmentTaskLite[])) {
    oneOffById.set(task.id, task);
  }
  const recurringInstances = (recurringRes.data ?? []) as CommitmentTaskLite[];

  const linksByCommitmentId = new Map<string, CommitmentTaskLink[]>();
  for (const link of links) {
    const bucket = linksByCommitmentId.get(link.commitment_id) ?? [];
    bucket.push(link);
    linksByCommitmentId.set(link.commitment_id, bucket);
  }

  return rawCommitments.map((commitment) => {
    const commitmentLinks = linksByCommitmentId.get(commitment.id) ?? [];
    const ruleIdsForThis = new Set(
      commitmentLinks
        .map((link) => link.recurrence_rule_id)
        .filter((id): id is string => Boolean(id)),
    );

    const linkedTasks: CommitmentTaskLite[] = [];
    for (const link of commitmentLinks) {
      if (link.task_id) {
        const task = oneOffById.get(link.task_id);
        if (task) linkedTasks.push(task);
      }
    }

    for (const task of recurringInstances) {
      if (!task.recurrence_rule_id || !ruleIdsForThis.has(task.recurrence_rule_id)) continue;
      const deadlineDate = toDateOnly(task.deadline);
      if (!deadlineDate || deadlineDate < commitment.start_date || deadlineDate > commitment.end_date) continue;
      linkedTasks.push(task);
    }

    return {
      ...commitment,
      derived_status: computeDerivedStatus(commitment, linkedTasks),
      earned_so_far_cents: computeEarnedSoFar(linkedTasks, commitment.start_date, commitment.end_date),
      total_target_cents: computeTotalTarget(linkedTasks, commitment.start_date, commitment.end_date),
      days_total: dayDiffInclusive(commitment.start_date, commitment.end_date),
      days_remaining: Math.max(0, dayDiffFromToday(commitment.end_date)),
      starts_in_days: dayDiffFromToday(commitment.start_date),
      day_statuses: getDayStatuses(linkedTasks, commitment.start_date, commitment.end_date),
    };
  });
}

export function useCommitments(): UseCommitmentsResult {
  const { user, profile } = useAuth();
  const query = useQuery({
    queryKey: queryKeys.commitments(user?.id),
    queryFn: () => fetchCommitments(user!.id),
    enabled: Boolean(user?.id),
  });

  const subscriptions = useMemo(
    () => user?.id
      ? [
          { table: 'commitments', filter: `user_id=eq.${user.id}` },
          { table: 'commitment_task_links' },
          { table: 'tasks', filter: `user_id=eq.${user.id}` },
        ]
      : [],
    [user?.id],
  );

  useRealtimeInvalidation({
    channelName: `commitments:${user?.id ?? 'anon'}`,
    enabled: Boolean(user?.id),
    subscriptions,
    invalidateKeys: [queryKeys.commitments(user?.id)],
  });

  return {
    commitments: query.data ?? [],
    currency: (profile?.currency ?? 'USD') as Currency,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: useCallback(() => {
      void query.refetch();
    }, [query]),
  };
}
