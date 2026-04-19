import { useMemo } from 'react';
import type { Profile } from '@/lib/types';
import { normalizeAiUsername } from '@/lib/constants/ai-profile';
import { useAuth } from '@/hooks/useAuth';
import { useRelationships } from '@/lib/hooks/useRelationships';

export interface FriendOption {
  id: string;
  username: string;
  initial: string;
}

interface UseFriendsResult {
  friends: FriendOption[];
  currentUserId: string | null;
  profile: Pick<
    Profile,
    | 'currency'
    | 'default_failure_cost_cents'
    | 'default_voucher_id'
    | 'deadline_one_hour_warning_enabled'
    | 'deadline_final_warning_enabled'
  > | null;
  loading: boolean;
  error: string | null;
}

export function useFriends(): UseFriendsResult {
  const { user, profile } = useAuth();
  const relationships = useRelationships(user?.id);

  const friends = useMemo(
    () =>
      relationships.friends
        .map((friend) => ({
          id: friend.id,
          username: normalizeAiUsername(friend.id, friend.username, 'Friend'),
          initial: normalizeAiUsername(friend.id, friend.username, 'Friend')[0].toUpperCase(),
        }))
        .sort((a, b) => a.username.localeCompare(b.username)),
    [relationships.friends],
  );

  return {
    friends,
    currentUserId: user?.id ?? null,
    profile: profile
      ? {
          currency: profile.currency,
          default_failure_cost_cents: profile.default_failure_cost_cents,
          default_voucher_id: profile.default_voucher_id,
          deadline_one_hour_warning_enabled: profile.deadline_one_hour_warning_enabled,
          deadline_final_warning_enabled: profile.deadline_final_warning_enabled,
        }
      : null,
    loading: relationships.loading,
    error: relationships.error,
  };
}
