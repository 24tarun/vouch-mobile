import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { fetchSettingsStats } from '@/lib/stats/calculate-stats';
import { queryKeys } from '@/lib/query/keys';
import { useRealtimeInvalidation } from '@/lib/query/useRealtimeInvalidation';

export function useSettingsStats(userId?: string | null) {
  const { user } = useAuth();
  const resolvedUserId = userId ?? user?.id ?? null;

  const query = useQuery({
    queryKey: queryKeys.settingsStats(resolvedUserId),
    queryFn: async () => {
      const result = await fetchSettingsStats(resolvedUserId!);
      if (result.error) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: Boolean(resolvedUserId),
  });

  const subscriptions = useMemo(
    () => resolvedUserId
      ? [
          { table: 'tasks', filter: `user_id=eq.${resolvedUserId}` },
          { table: 'tasks', filter: `voucher_id=eq.${resolvedUserId}` },
          { table: 'pomo_sessions', filter: `user_id=eq.${resolvedUserId}` },
        ]
      : [],
    [resolvedUserId],
  );

  useRealtimeInvalidation({
    channelName: `settings-stats:${resolvedUserId ?? 'anon'}`,
    enabled: Boolean(resolvedUserId),
    subscriptions,
    invalidateKeys: [queryKeys.settingsStats(resolvedUserId)],
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}
