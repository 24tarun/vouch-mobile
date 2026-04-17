import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Commitment, CommitmentStatus, CommitmentTaskLink, Currency } from '@/lib/types';

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

export function useCommitments(): UseCommitmentsResult {
  const [commitments, setCommitments] = useState<CommitmentListItem[]>([]);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

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

        // Fetch commitments and profile in parallel
        const [commitmentsRes, profileRes] = await Promise.all([
          supabase
            .from('commitments')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false }),
          supabase
            .from('profiles')
            .select('currency')
            .eq('id', userId)
            .single(),
        ]);

        if (cancelled) return;
        if (commitmentsRes.error) { setError(commitmentsRes.error.message); return; }

        const rawCommitments = (commitmentsRes.data ?? []) as Commitment[];
        if (profileRes.data?.currency) {
          setCurrency(profileRes.data.currency as Currency);
        }

        if (rawCommitments.length === 0) {
          setCommitments([]);
          return;
        }

        const commitmentIds = rawCommitments.map((c) => c.id);

        // Fetch links
        const { data: linksData, error: linksError } = await supabase
          .from('commitment_task_links')
          .select('*')
          .in('commitment_id', commitmentIds)
          .order('created_at', { ascending: true });

        if (cancelled) return;
        if (linksError) { setError(linksError.message); return; }

        const links = (linksData ?? []) as CommitmentTaskLink[];

        // Collect task IDs and recurrence rule IDs
        const taskIds = [...new Set(links.map((l) => l.task_id).filter((id): id is string => Boolean(id)))];
        const ruleIds = [...new Set(links.map((l) => l.recurrence_rule_id).filter((id): id is string => Boolean(id)))];

        // Date window for recurring instances
        const allStarts = rawCommitments.map((c) => c.start_date).sort();
        const allEnds = rawCommitments.map((c) => c.end_date).sort();
        const minStart = allStarts[0];
        const maxEnd = allEnds[allEnds.length - 1];

        // Fetch one-off tasks and recurring instances in parallel
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

        if (cancelled) return;

        const oneOffById = new Map<string, CommitmentTaskLite>();
        for (const t of ((oneOffRes.data ?? []) as CommitmentTaskLite[])) {
          oneOffById.set(t.id, t);
        }
        const recurringInstances = (recurringRes.data ?? []) as CommitmentTaskLite[];

        // Build commitment task map
        const linksByCommitmentId = new Map<string, CommitmentTaskLink[]>();
        for (const link of links) {
          const arr = linksByCommitmentId.get(link.commitment_id) ?? [];
          arr.push(link);
          linksByCommitmentId.set(link.commitment_id, arr);
        }

        // Compute derived data for each commitment
        const items: CommitmentListItem[] = rawCommitments.map((c) => {
          const commitmentLinks = linksByCommitmentId.get(c.id) ?? [];
          const ruleIdsForThis = new Set(
            commitmentLinks.map((l) => l.recurrence_rule_id).filter((id): id is string => Boolean(id)),
          );

          const linkedTasks: CommitmentTaskLite[] = [];
          for (const link of commitmentLinks) {
            if (link.task_id) {
              const t = oneOffById.get(link.task_id);
              if (t) linkedTasks.push(t);
            }
          }
          for (const t of recurringInstances) {
            if (!t.recurrence_rule_id || !ruleIdsForThis.has(t.recurrence_rule_id)) continue;
            const d = toDateOnly(t.deadline);
            if (!d || d < c.start_date || d > c.end_date) continue;
            linkedTasks.push(t);
          }

          return {
            ...c,
            derived_status: computeDerivedStatus(c, linkedTasks),
            earned_so_far_cents: computeEarnedSoFar(linkedTasks, c.start_date, c.end_date),
            total_target_cents: computeTotalTarget(linkedTasks, c.start_date, c.end_date),
            days_total: dayDiffInclusive(c.start_date, c.end_date),
            days_remaining: Math.max(0, dayDiffFromToday(c.end_date)),
            starts_in_days: dayDiffFromToday(c.start_date),
            day_statuses: getDayStatuses(linkedTasks, c.start_date, c.end_date),
          };
        });

        if (!cancelled) setCommitments(items);
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to load commitments');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [tick]);

  return {
    commitments,
    currency,
    loading,
    error,
    refetch: useCallback(() => setTick((t) => t + 1), []),
  };
}
