import { Alert } from 'react-native';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/query/keys';
import { useRelationships, type RelationshipsData } from '@/lib/hooks/useRelationships';
import { useBlockedUsers } from '@/lib/hooks/useBlockedUsers';
import {
  type BlockedUserOption,
  type IncomingFriendRequest,
  type OutgoingFriendRequest,
  type SearchCandidate,
  type UserSummary,
  normalizeSearchCandidate,
} from '@/lib/settings/relationships';
import {
  AI_PROFILE_ID,
  normalizeAiEmail,
  normalizeAiUsername,
} from '@/lib/constants/ai-profile';

export type RelationshipAction = 'send' | 'accept' | 'reject' | 'remove' | 'block' | 'withdraw';

function buildUserSummaryFromCandidate(candidate: SearchCandidate): UserSummary {
  return {
    id: candidate.id,
    username: normalizeAiUsername(candidate.id, candidate.username, 'Friend'),
    email: normalizeAiEmail(candidate.id, candidate.email, ''),
    initial: normalizeAiUsername(candidate.id, candidate.username, 'Friend')[0]?.toUpperCase() || '?',
  };
}

export function useManageFriends() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const relationshipsQuery = useRelationships(user?.id);
  const blockedUsersQuery = useBlockedUsers(user?.id);

  const [relationshipInFlight, setRelationshipInFlight] = useState<Record<string, RelationshipAction | null>>({});
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [friendSearchResults, setFriendSearchResults] = useState<SearchCandidate[]>([]);
  const [friendSearchLoading, setFriendSearchLoading] = useState(false);
  const [friendSearchError, setFriendSearchError] = useState<string | null>(null);
  const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null);

  const friends = relationshipsQuery.friends;
  const incomingRequests = relationshipsQuery.incomingRequests;
  const outgoingRequests = relationshipsQuery.outgoingRequests;
  const relationshipsLoading = relationshipsQuery.loading;
  const relationshipsError = relationshipsQuery.error;
  const blockedUsers = blockedUsersQuery.blockedUsers;
  const blockedUsersLoading = blockedUsersQuery.loading;
  const blockedUsersError = blockedUsersQuery.error;

  useEffect(() => {
    const query = friendSearchQuery.trim();
    if (!user || query.length === 0) {
      setFriendSearchResults([]);
      setFriendSearchError(null);
      setFriendSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setFriendSearchLoading(true);
      const { data, error } = await supabase.rpc('search_users_for_friendship', {
        p_query: query,
        p_limit: 20,
      });

      if (cancelled) return;

      if (error) {
        setFriendSearchResults([]);
        setFriendSearchError(error.message);
        setFriendSearchLoading(false);
        return;
      }

      setFriendSearchResults(
        ((data ?? []) as SearchCandidate[])
          .map((candidate) => normalizeSearchCandidate(candidate))
          .filter((c) => !c.already_friends)
          .sort((a, b) => a.username.localeCompare(b.username)),
      );
      setFriendSearchError(null);
      setFriendSearchLoading(false);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [friendSearchQuery, user]);

  function updateRelationshipInFlight(key: string, action: RelationshipAction | null) {
    setRelationshipInFlight((prev) => ({ ...prev, [key]: action }));
  }

  function patchRelationshipsCache(
    updater: (current: RelationshipsData) => RelationshipsData,
  ) {
    if (!user) return;
    queryClient.setQueryData<RelationshipsData>(
      queryKeys.relationships(user.id),
      (current) => (current ? updater(current) : current),
    );
  }

  function patchBlockedUsersCache(
    updater: (current: BlockedUserOption[]) => BlockedUserOption[],
  ) {
    if (!user) return;
    queryClient.setQueryData<BlockedUserOption[]>(
      queryKeys.blockedUsers(user.id),
      (current) => updater(current ?? []),
    );
  }

  function patchFriendSearchResults(
    updater: (current: SearchCandidate[]) => SearchCandidate[],
  ) {
    setFriendSearchResults((current) => updater(current));
  }

  function invalidateRelationshipCaches() {
    if (!user) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.relationships(user.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.blockedUsers(user.id) });
  }

  async function refreshRelationshipsAndSearch() {
    if (!user) return;
    await relationshipsQuery.refetch();

    if (friendSearchQuery.trim()) {
      const { data, error } = await supabase.rpc('search_users_for_friendship', {
        p_query: friendSearchQuery.trim(),
        p_limit: 20,
      });

      if (error) {
        setFriendSearchResults([]);
        setFriendSearchError(error.message);
        return;
      }

      setFriendSearchResults(
        ((data ?? []) as SearchCandidate[])
          .map((candidate) => normalizeSearchCandidate(candidate))
          .filter((c) => !c.already_friends)
          .sort((a, b) => a.username.localeCompare(b.username)),
      );
      setFriendSearchError(null);
    }
  }

  async function refreshManageFriends() {
    await Promise.all([
      refreshRelationshipsAndSearch(),
      blockedUsersQuery.refetch(),
    ]);
  }

  async function handleUnblockUser(blockedUser: BlockedUserOption) {
    if (!user) return;
    setUnblockingUserId(blockedUser.id);
    const previousBlockedUsers = queryClient.getQueryData<BlockedUserOption[]>(queryKeys.blockedUsers(user.id));
    queryClient.setQueryData<BlockedUserOption[]>(
      queryKeys.blockedUsers(user.id),
      (previous) => (previous ?? []).filter((entry) => entry.id !== blockedUser.id),
    );

    try {
      const { error } = await supabase.rpc('unblock_user', {
        p_target_user_id: blockedUser.id,
      });

      if (error) {
        queryClient.setQueryData(queryKeys.blockedUsers(user.id), previousBlockedUsers);
        Alert.alert('Could not unblock user', error.message);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.blockedUsers(user.id) });
    } finally {
      setUnblockingUserId(null);
    }
  }

  async function handleSendFriendRequest(candidate: SearchCandidate) {
    if (!user) return;
    const key = `send:${candidate.id}`;
    updateRelationshipInFlight(key, 'send');
    const previousRelationships = queryClient.getQueryData<RelationshipsData>(queryKeys.relationships(user.id));
    const previousSearchResults = friendSearchResults;
    const receiver = buildUserSummaryFromCandidate(candidate);

    patchRelationshipsCache((current) => ({
      ...current,
      outgoingRequests: [
        {
          id: `pending-outgoing:${candidate.id}`,
          receiver_id: candidate.id,
          created_at: new Date().toISOString(),
          receiver,
        },
        ...current.outgoingRequests.filter((entry) => entry.receiver_id !== candidate.id),
      ],
    }));
    patchFriendSearchResults((current) =>
      current.map((entry) => (
        entry.id === candidate.id
          ? { ...entry, outgoing_request_pending: true, incoming_request_pending: false }
          : entry
      )),
    );

    try {
      const { error } = await supabase.rpc('send_friend_request', {
        p_target_user_id: candidate.id,
      });

      if (error) {
        queryClient.setQueryData(queryKeys.relationships(user.id), previousRelationships);
        setFriendSearchResults(previousSearchResults);
        Alert.alert('Could not send request', error.message);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.relationships(user.id) });
    } finally {
      updateRelationshipInFlight(key, null);
    }
  }

  async function handleAcceptFriendRequest(request: IncomingFriendRequest) {
    if (!user) return;
    const key = `request:${request.id}:accept`;
    updateRelationshipInFlight(key, 'accept');
    const previousRelationships = queryClient.getQueryData<RelationshipsData>(queryKeys.relationships(user.id));
    const previousSearchResults = friendSearchResults;

    patchRelationshipsCache((current) => ({
      ...current,
      incomingRequests: current.incomingRequests.filter((entry) => entry.id !== request.id),
      friends: [...current.friends, request.sender]
        .filter((entry, index, list) => list.findIndex((candidate) => candidate.id === entry.id) === index)
        .sort((a, b) => a.username.localeCompare(b.username)),
    }));
    patchFriendSearchResults((current) =>
      current.map((entry) => (
        entry.id === request.sender.id
          ? {
              ...entry,
              already_friends: true,
              incoming_request_pending: false,
              outgoing_request_pending: false,
            }
          : entry
      )),
    );

    try {
      const { error } = await supabase.rpc('accept_friend_request', {
        p_request_id: request.id,
      });

      if (error) {
        queryClient.setQueryData(queryKeys.relationships(user.id), previousRelationships);
        setFriendSearchResults(previousSearchResults);
        Alert.alert('Could not accept request', error.message);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.relationships(user.id) });
    } finally {
      updateRelationshipInFlight(key, null);
    }
  }

  async function handleRejectFriendRequest(request: IncomingFriendRequest) {
    if (!user) return;
    const key = `request:${request.id}:reject`;
    updateRelationshipInFlight(key, 'reject');
    const previousRelationships = queryClient.getQueryData<RelationshipsData>(queryKeys.relationships(user.id));
    const previousSearchResults = friendSearchResults;

    patchRelationshipsCache((current) => ({
      ...current,
      incomingRequests: current.incomingRequests.filter((entry) => entry.id !== request.id),
    }));
    patchFriendSearchResults((current) =>
      current.map((entry) => (
        entry.id === request.sender.id
          ? { ...entry, incoming_request_pending: false }
          : entry
      )),
    );

    try {
      const { error } = await supabase.rpc('reject_friend_request', {
        p_request_id: request.id,
      });

      if (error) {
        queryClient.setQueryData(queryKeys.relationships(user.id), previousRelationships);
        setFriendSearchResults(previousSearchResults);
        Alert.alert('Could not reject request', error.message);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.relationships(user.id) });
    } finally {
      updateRelationshipInFlight(key, null);
    }
  }

  async function handleWithdrawFriendRequest(request: OutgoingFriendRequest) {
    if (!user) return;
    const key = `outgoing:${request.id}:withdraw`;
    updateRelationshipInFlight(key, 'withdraw');
    const previousRelationships = queryClient.getQueryData<RelationshipsData>(queryKeys.relationships(user.id));
    const previousSearchResults = friendSearchResults;

    patchRelationshipsCache((current) => ({
      ...current,
      outgoingRequests: current.outgoingRequests.filter((entry) => entry.id !== request.id),
    }));
    patchFriendSearchResults((current) =>
      current.map((entry) => (
        entry.id === request.receiver_id
          ? { ...entry, outgoing_request_pending: false }
          : entry
      )),
    );

    try {
      const { error } = await supabase.rpc('withdraw_friend_request', {
        p_request_id: request.id,
      });

      if (error) {
        if (error.message?.toLowerCase().includes('no longer pending')) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.relationships(user.id) });
          return;
        }
        queryClient.setQueryData(queryKeys.relationships(user.id), previousRelationships);
        setFriendSearchResults(previousSearchResults);
        Alert.alert('Could not withdraw request', error.message);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.relationships(user.id) });
    } finally {
      updateRelationshipInFlight(key, null);
    }
  }

  async function handleRemoveFriend(friend: UserSummary) {
    if (!user) return;
    const key = `friend:${friend.id}:remove`;
    updateRelationshipInFlight(key, 'remove');
    const isAiFriend = friend.id === AI_PROFILE_ID;
    const previousRelationships = queryClient.getQueryData<RelationshipsData>(queryKeys.relationships(user.id));
    const previousProfile = queryClient.getQueryData(queryKeys.currentProfile(user.id));
    const previousSearchResults = friendSearchResults;

    patchRelationshipsCache((current) => ({
      ...current,
      friends: current.friends.filter((entry) => entry.id !== friend.id),
    }));
    patchFriendSearchResults((current) =>
      current.map((entry) => (
        entry.id === friend.id
          ? {
              ...entry,
              already_friends: false,
              incoming_request_pending: false,
              outgoing_request_pending: false,
            }
          : entry
      )),
    );
    if (isAiFriend) {
      queryClient.setQueryData(queryKeys.currentProfile(user.id), (current: any) =>
        current ? { ...current, ai_friend_opt_in: false } : current,
      );
    }

    try {
      const removeFriendPromise = supabase.rpc('remove_friend', { p_target_user_id: friend.id });
      const aiProfileUpdatePromise = isAiFriend
        ? supabase.from('profiles').update({ ai_friend_opt_in: false }).eq('id', user.id)
        : Promise.resolve(null);

      const [removeRes] = await Promise.all([removeFriendPromise, aiProfileUpdatePromise]);

      if (removeRes.error) {
        queryClient.setQueryData(queryKeys.relationships(user.id), previousRelationships);
        queryClient.setQueryData(queryKeys.currentProfile(user.id), previousProfile);
        setFriendSearchResults(previousSearchResults);
        Alert.alert('Could not remove friend', removeRes.error.message);
        return;
      }

      invalidateRelationshipCaches();
    } finally {
      updateRelationshipInFlight(key, null);
    }
  }

  async function handleBlockRelationshipUser(target: UserSummary | SearchCandidate, sourceKey: string) {
    if (!user) return;
    updateRelationshipInFlight(sourceKey, 'block');
    const previousRelationships = queryClient.getQueryData<RelationshipsData>(queryKeys.relationships(user.id));
    const previousBlockedUsers = queryClient.getQueryData<BlockedUserOption[]>(queryKeys.blockedUsers(user.id));
    const previousSearchResults = friendSearchResults;
    const blockedEntry: BlockedUserOption = {
      id: target.id,
      username: normalizeAiUsername(target.id, target.username, 'Blocked user'),
      email: normalizeAiEmail(target.id, target.email, ''),
    };

    patchRelationshipsCache((current) => ({
      ...current,
      friends: current.friends.filter((entry) => entry.id !== target.id),
      incomingRequests: current.incomingRequests.filter((entry) => entry.sender.id !== target.id),
      outgoingRequests: current.outgoingRequests.filter((entry) => entry.receiver.id !== target.id),
    }));
    patchBlockedUsersCache((current) => {
      if (current.some((entry) => entry.id === target.id)) return current;
      return [blockedEntry, ...current].sort((a, b) => a.username.localeCompare(b.username));
    });
    patchFriendSearchResults((current) => current.filter((entry) => entry.id !== target.id));

    try {
      const { error } = await supabase.rpc('block_user', {
        p_target_user_id: target.id,
      });

      if (error) {
        queryClient.setQueryData(queryKeys.relationships(user.id), previousRelationships);
        queryClient.setQueryData(queryKeys.blockedUsers(user.id), previousBlockedUsers);
        setFriendSearchResults(previousSearchResults);
        Alert.alert('Could not block user', error.message);
        return;
      }
      invalidateRelationshipCaches();
    } finally {
      updateRelationshipInFlight(sourceKey, null);
    }
  }

  return {
    friendSearchQuery,
    setFriendSearchQuery,
    friendSearchLoading,
    friendSearchError,
    friendSearchResults,
    relationshipsError,
    relationshipsLoading,
    incomingRequests,
    outgoingRequests,
    friends,
    relationshipInFlight,
    blockedUsersLoading,
    blockedUsersError,
    blockedUsers,
    unblockingUserId,
    onSendFriendRequest: handleSendFriendRequest,
    onBlockRelationshipUser: handleBlockRelationshipUser,
    onAcceptFriendRequest: handleAcceptFriendRequest,
    onRejectFriendRequest: handleRejectFriendRequest,
    onWithdrawFriendRequest: handleWithdrawFriendRequest,
    onRemoveFriend: handleRemoveFriend,
    onUnblockUser: handleUnblockUser,
    refreshManageFriends,
  };
}
