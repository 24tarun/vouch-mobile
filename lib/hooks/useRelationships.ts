import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import {
  fetchRelationshipsData,
  type IncomingFriendRequest,
  type OutgoingFriendRequest,
  type UserSummary,
} from '@/lib/settings/relationships';
import { queryKeys } from '@/lib/query/keys';
import { useRealtimeInvalidation } from '@/lib/query/useRealtimeInvalidation';

export interface RelationshipsData {
  friends: UserSummary[];
  incomingRequests: IncomingFriendRequest[];
  outgoingRequests: OutgoingFriendRequest[];
}

async function fetchRelationships(userId: string): Promise<RelationshipsData> {
  const result = await fetchRelationshipsData(userId);
  if (result.error) {
    throw new Error(result.error);
  }

  return {
    friends: result.friends,
    incomingRequests: result.incomingRequests,
    outgoingRequests: result.outgoingRequests,
  };
}

export function useRelationships(userId?: string | null) {
  const { user } = useAuth();
  const resolvedUserId = userId ?? user?.id ?? null;

  const query = useQuery({
    queryKey: queryKeys.relationships(resolvedUserId),
    queryFn: () => fetchRelationships(resolvedUserId!),
    enabled: Boolean(resolvedUserId),
  });

  const subscriptions = useMemo(
    () => resolvedUserId
      ? [
          { table: 'friend_requests', filter: `sender_id=eq.${resolvedUserId}` },
          { table: 'friend_requests', filter: `receiver_id=eq.${resolvedUserId}` },
          { table: 'friendships', filter: `user_id=eq.${resolvedUserId}` },
          { table: 'user_blocks', filter: `blocker_id=eq.${resolvedUserId}` },
          { table: 'profiles' },
        ]
      : [],
    [resolvedUserId],
  );

  useRealtimeInvalidation({
    channelName: `relationships:${resolvedUserId ?? 'anon'}`,
    enabled: Boolean(resolvedUserId),
    subscriptions,
    invalidateKeys: [queryKeys.relationships(resolvedUserId)],
  });

  return {
    friends: query.data?.friends ?? [],
    incomingRequests: query.data?.incomingRequests ?? [],
    outgoingRequests: query.data?.outgoingRequests ?? [],
    loading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refetch: query.refetch,
  };
}
