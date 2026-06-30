import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query/keys';
import type { AccountTier, AiVoucherQuota } from '@/lib/types';

interface AiVoucherQuotaRow {
  account_tier: AccountTier;
  used: number;
  pending: number;
  monthly_limit: number | null;
  remaining: number | null;
  resets_at: string;
  can_start_review: boolean;
}

export async function fetchAiVoucherQuota(): Promise<AiVoucherQuota> {
  const { data, error } = await (supabase.rpc as any)('get_ai_voucher_quota');
  if (error) throw new Error(error.message);

  const row = (Array.isArray(data) ? data[0] : data) as AiVoucherQuotaRow | null;
  if (!row) throw new Error('AI voucher quota was unavailable.');

  return {
    accountTier: row.account_tier,
    used: Number(row.used ?? 0),
    pending: Number(row.pending ?? 0),
    limit: row.monthly_limit == null ? null : Number(row.monthly_limit),
    remaining: row.remaining == null ? null : Number(row.remaining),
    resetsAt: row.resets_at,
    canStartReview: Boolean(row.can_start_review),
  };
}

export function useAiVoucherQuota(userId: string | null) {
  const query = useQuery({
    queryKey: queryKeys.aiVoucherQuota(userId),
    queryFn: fetchAiVoucherQuota,
    enabled: Boolean(userId),
    staleTime: 30_000,
  });

  return {
    quota: query.data ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}
