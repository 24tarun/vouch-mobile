import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import { normalizeAiUsername } from '@/lib/constants/ai-profile';

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
  const [friends, setFriends] = useState<FriendOption[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UseFriendsResult['profile']>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        // getSession() reads from local AsyncStorage — no server round-trip needed
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;

        if (!userId) {
          if (!cancelled) setLoading(false);
          return;
        }

        if (!cancelled) setCurrentUserId(userId);

        const [friendsRes, blockedRes, profileRes] = await Promise.all([
          supabase
            .from('friendships')
            .select('friend:profiles!friendships_friend_id_fkey(id, username)')
            .eq('user_id', userId),
          supabase
            .from('user_blocks')
            .select('blocked_id')
            .eq('blocker_id', userId),
          supabase
            .from('profiles')
            .select(
              'currency, default_failure_cost_cents, default_voucher_id, deadline_one_hour_warning_enabled, deadline_final_warning_enabled',
            )
            .eq('id', userId)
            .single(),
        ]);

        if (cancelled) return;

        if (friendsRes.error || blockedRes.error) {
          setError(friendsRes.error?.message ?? blockedRes.error?.message ?? 'Failed to load data');
          return;
        }

        const blockedIds = new Set(
          ((blockedRes.data ?? []) as { blocked_id?: string | null }[])
            .map((row) => row.blocked_id)
            .filter((id): id is string => Boolean(id)),
        );

        const list: FriendOption[] = ((friendsRes.data ?? []) as any[])
          .map((row) => row.friend as Pick<Profile, 'id' | 'username'>)
          .filter(Boolean)
          .filter((friend) => !blockedIds.has(friend.id))
          .map((friend) => ({
            ...friend,
            username: normalizeAiUsername(friend.id, friend.username, 'Friend'),
          }))
          .sort((a, b) => a.username.localeCompare(b.username))
          .map((p) => ({
            id: p.id,
            username: p.username,
            initial: p.username[0].toUpperCase(),
          }));

        setFriends(list);

        if (profileRes.data) {
          setProfile(profileRes.data as UseFriendsResult['profile']);
        }
      } catch (err: any) {
        console.error('[useFriends] caught error:', err);
        if (!cancelled) setError(err?.message ?? 'Failed to load data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, []);

  return { friends, currentUserId, profile, loading, error };
}
