import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { normalizeAiEmail, normalizeAiUsername } from '@/lib/constants/ai-profile';
import type { BlockedUserOption } from '@/lib/settings/relationships';
import { queryKeys } from '@/lib/query/keys';
import { useRealtimeInvalidation } from '@/lib/query/useRealtimeInvalidation';

async function fetchBlockedUsers(userId: string): Promise<BlockedUserOption[]> {
  const { data, error } = await supabase
    .from('user_blocks')
    .select(`
      blocked_id,
      blocked:profiles!user_blocks_blocked_id_fkey(
        id,
        username,
        email
      )
    `)
    .eq('blocker_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as any[])
    .map((row) => {
      const blocked = row?.blocked as { id?: string; username?: string | null; email?: string | null } | null;
      if (!blocked?.id) return null;
      return {
        id: blocked.id,
        username: normalizeAiUsername(blocked.id, blocked.username, 'Blocked user'),
        email: normalizeAiEmail(blocked.id, blocked.email, ''),
      } satisfies BlockedUserOption;
    })
    .filter((entry): entry is BlockedUserOption => Boolean(entry))
    .sort((a, b) => a.username.localeCompare(b.username));
}

export function useBlockedUsers(userId?: string | null) {
  const { user } = useAuth();
  const resolvedUserId = userId ?? user?.id ?? null;

  const query = useQuery({
    queryKey: queryKeys.blockedUsers(resolvedUserId),
    queryFn: () => fetchBlockedUsers(resolvedUserId!),
    enabled: Boolean(resolvedUserId),
  });

  const subscriptions = useMemo(
    () => resolvedUserId
      ? [
          { table: 'user_blocks', filter: `blocker_id=eq.${resolvedUserId}` },
          { table: 'profiles' },
        ]
      : [],
    [resolvedUserId],
  );

  useRealtimeInvalidation({
    channelName: `blocked-users:${resolvedUserId ?? 'anon'}`,
    enabled: Boolean(resolvedUserId),
    subscriptions,
    invalidateKeys: [queryKeys.blockedUsers(resolvedUserId)],
  });

  return {
    blockedUsers: query.data ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}
