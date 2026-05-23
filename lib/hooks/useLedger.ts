import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query/keys';
import { useRealtimeInvalidation } from '@/lib/query/useRealtimeInvalidation';
import type { Currency } from '@/lib/types';

export type CurrencyCode = Currency;
export type LedgerEntryKind = 'failure' | 'rectified' | 'override' | 'voucher_timeout_penalty' | 'other';

export interface LedgerEntryRowData {
  id: string;
  taskId: string | null;
  periodId: string;
  title: string;
  amountCents: number;
  createdAt: string;
  kind: LedgerEntryKind;
}

export interface LedgerMonth {
  id: string;
  label: string;
  projectedDonationCents: number;
  rectifyPassesUsed: number;
  keptCents: number;
  failures: number;
  totalCents: number;
  entries: LedgerEntryRowData[];
}

export interface LedgerData {
  currentMonth: LedgerMonth;
  previousMonths: LedgerMonth[];
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function formatMonthId(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function parsePeriodToLabel(periodId: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(periodId);
  if (!match) return periodId;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  return formatMonthLabel(new Date(year, month, 1));
}

function formatDateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parsePeriodFromCreatedAt(createdAt: string | null | undefined, fallbackPeriod: string): string {
  if (!createdAt) return fallbackPeriod;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return fallbackPeriod;
  return formatMonthId(monthStart(date));
}

function normalizeEntryKind(raw: string): LedgerEntryKind {
  if (raw === 'failure') return 'failure';
  if (raw === 'rectified') return 'rectified';
  if (raw === 'override') return 'override';
  if (raw === 'voucher_timeout_penalty') return 'voucher_timeout_penalty';
  return 'other';
}

function fallbackTitle(kind: LedgerEntryKind): string {
  if (kind === 'rectified') return 'Rectified Task';
  if (kind === 'override') return 'Override';
  if (kind === 'voucher_timeout_penalty') return 'Voucher Timeout Penalty';
  return 'Task Penalty';
}

function monthTotals(entries: LedgerEntryRowData[]): { totalCents: number; failures: number } {
  return entries.reduce(
    (acc, entry) => {
      acc.totalCents += entry.amountCents;
      if (entry.kind === 'failure') acc.failures += 1;
      return acc;
    },
    { totalCents: 0, failures: 0 },
  );
}

function emptyCurrentMonth(periodId: string): LedgerMonth {
  return {
    id: periodId,
    label: parsePeriodToLabel(periodId),
    projectedDonationCents: 0,
    rectifyPassesUsed: 0,
    keptCents: 0,
    failures: 0,
    totalCents: 0,
    entries: [],
  };
}

export async function fetchLedger(userId: string): Promise<LedgerData> {
  const currentPeriodId = formatMonthId(monthStart(new Date()));
  const currentStart = monthStart(new Date());
  const nextStart = addMonths(currentStart, 1);
  const periodStartDate = `${formatMonthId(currentStart)}-01`;
  const periodEndDate = formatDateOnly(nextStart);

  const [ledgerRes, rectifyRes, keptRes] = await Promise.all([
    supabase
      .from('ledger_entries')
      .select(`
        id,
        period,
        amount_cents,
        entry_type,
        created_at,
        task:tasks(id, title, status)
      `)
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('rectify_passes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('period', currentPeriodId),
    supabase
      .from('tasks')
      .select('failure_cost_cents')
      .eq('user_id', userId)
      .in('status', ['ACCEPTED', 'AUTO_ACCEPTED', 'AI_ACCEPTED'])
      .gte('deadline', periodStartDate)
      .lt('deadline', periodEndDate),
  ]);

  if (ledgerRes.error) throw new Error(ledgerRes.error.message);
  if (rectifyRes.error) throw new Error(rectifyRes.error.message);
  if (keptRes.error) throw new Error(keptRes.error.message);

  const mappedEntries: LedgerEntryRowData[] = ((ledgerRes.data ?? []) as any[]).map((row) => {
    const kind = normalizeEntryKind(String(row.entry_type ?? ''));
    const task = Array.isArray(row.task) ? row.task[0] : row.task;
    const periodId = typeof row.period === 'string' && /^\d{4}-\d{2}$/.test(row.period)
      ? row.period
      : parsePeriodFromCreatedAt(row.created_at, currentPeriodId);

    return {
      id: String(row.id),
      taskId: task?.id ? String(task.id) : null,
      periodId,
      title: (task?.title as string | undefined)?.trim() || fallbackTitle(kind),
      amountCents: Number(row.amount_cents ?? 0),
      createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
      kind,
    };
  });

  const entriesByPeriod = new Map<string, LedgerEntryRowData[]>();
  for (const entry of mappedEntries) {
    const bucket = entriesByPeriod.get(entry.periodId) ?? [];
    bucket.push(entry);
    entriesByPeriod.set(entry.periodId, bucket);
  }

  for (const [periodId, entries] of entriesByPeriod.entries()) {
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    entriesByPeriod.set(periodId, entries);
  }

  const currentEntries = entriesByPeriod.get(currentPeriodId) ?? [];
  const currentComputed = monthTotals(currentEntries);
  const keptCents = ((keptRes.data ?? []) as { failure_cost_cents: number | null }[])
    .reduce((sum, row) => sum + Number(row.failure_cost_cents ?? 0), 0);

  const currentMonth: LedgerMonth = {
    id: currentPeriodId,
    label: parsePeriodToLabel(currentPeriodId),
    projectedDonationCents: currentComputed.totalCents,
    rectifyPassesUsed: rectifyRes.count ?? 0,
    keptCents,
    failures: currentComputed.failures,
    totalCents: currentComputed.totalCents,
    entries: currentEntries,
  };

  const previousMonths = Array.from(entriesByPeriod.keys())
    .filter((periodId) => periodId !== currentPeriodId)
    .sort((a, b) => b.localeCompare(a))
    .map((periodId) => {
      const entries = entriesByPeriod.get(periodId) ?? [];
      const computed = monthTotals(entries);
      return {
        id: periodId,
        label: parsePeriodToLabel(periodId),
        projectedDonationCents: computed.totalCents,
        rectifyPassesUsed: 0,
        keptCents: 0,
        failures: computed.failures,
        totalCents: computed.totalCents,
        entries,
      } satisfies LedgerMonth;
    });

  return {
    currentMonth: currentMonth ?? emptyCurrentMonth(currentPeriodId),
    previousMonths,
  };
}

export function useLedger(userId?: string | null) {
  const { user } = useAuth();
  const resolvedUserId = userId ?? user?.id ?? null;

  const query = useQuery({
    queryKey: queryKeys.ledger(resolvedUserId),
    queryFn: () => fetchLedger(resolvedUserId!),
    enabled: Boolean(resolvedUserId),
  });

  const subscriptions = useMemo(
    () => resolvedUserId
      ? [
          { table: 'ledger_entries', filter: `user_id=eq.${resolvedUserId}` },
          { table: 'tasks', filter: `user_id=eq.${resolvedUserId}` },
          { table: 'rectify_passes', filter: `user_id=eq.${resolvedUserId}` },
          { table: 'overrides', filter: `user_id=eq.${resolvedUserId}` },
        ]
      : [],
    [resolvedUserId],
  );

  useRealtimeInvalidation({
    channelName: `ledger:${resolvedUserId ?? 'anon'}`,
    enabled: Boolean(resolvedUserId),
    subscriptions,
    invalidateKeys: [queryKeys.ledger(resolvedUserId)],
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}
