import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AI_PROFILE_ID } from '@/lib/constants/ai-profile';

const AI_VOUCHER_MONTHLY_LIMIT = 5;

export function useAiVoucherLimit(userId: string | null): boolean {
  const [limitReached, setLimitReached] = useState(false);

  useEffect(() => {
    if (!userId) return;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    (supabase.from('tasks') as any)
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('voucher_id', AI_PROFILE_ID)
      .gte('created_at', monthStart)
      .then(({ count }: { count: number | null }) => {
        setLimitReached((count ?? 0) >= AI_VOUCHER_MONTHLY_LIMIT);
      });
  }, [userId]);

  return limitReached;
}
