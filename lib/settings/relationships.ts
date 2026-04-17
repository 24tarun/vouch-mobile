import { supabase } from '@/lib/supabase';
import {
  AI_PROFILE_EMAIL,
  AI_PROFILE_USERNAME,
  isAiProfileId,
  normalizeAiEmail,
  normalizeAiUsername,
} from '@/lib/constants/ai-profile';

export interface UserSummary {
  id: string;
  username: string;
  email: string;
  initial: string;
}

export interface IncomingFriendRequest {
  id: string;
  sender_id: string;
  created_at: string;
  sender: UserSummary;
}

export interface OutgoingFriendRequest {
  id: string;
  receiver_id: string;
  created_at: string;
  receiver: UserSummary;
}

export interface SearchCandidate {
  id: string;
  email: string;
  username: string;
  already_friends: boolean;
  incoming_request_pending: boolean;
  outgoing_request_pending: boolean;
}

export interface BlockedUserOption {
  id: string;
  username: string;
  email: string;
}

function buildUserSummary(profile: { id?: string; username?: string | null; email?: string | null } | null): UserSummary | null {
  if (!profile?.id) return null;
  const username = normalizeAiUsername(profile.id, profile.username, 'Friend');
  const email = normalizeAiEmail(profile.id, profile.email, '');
  return {
    id: profile.id,
    username,
    email,
    initial: username[0]?.toUpperCase() || '?',
  };
}

export function normalizeSearchCandidate(candidate: SearchCandidate): SearchCandidate {
  if (!isAiProfileId(candidate.id)) return candidate;
  return {
    ...candidate,
    username: AI_PROFILE_USERNAME,
    email: AI_PROFILE_EMAIL,
  };
}

export function normalizeVoucherOption(option: { id: string; username: string }): { id: string; username: string } {
  if (!isAiProfileId(option.id)) return option;
  return { ...option, username: AI_PROFILE_USERNAME };
}

export async function fetchRelationshipsData(userId: string): Promise<{
  friends: UserSummary[];
  incomingRequests: IncomingFriendRequest[];
  outgoingRequests: OutgoingFriendRequest[];
  error: string | null;
}> {
  const empty = { friends: [], incomingRequests: [], outgoingRequests: [] };

  const [friendsRes, incomingRequestsRes, outgoingRequestsRes] = await Promise.all([
    supabase
      .from('friendships')
      .select(`
        friend:profiles!friendships_friend_id_fkey(
          id,
          username,
          email
        )
      `)
      .eq('user_id', userId),
    supabase
      .from('friend_requests')
      .select(`
        id,
        sender_id,
        created_at,
        sender:profiles!friend_requests_sender_id_fkey(
          id,
          username,
          email
        )
      `)
      .eq('receiver_id', userId)
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false }),
    supabase
      .from('friend_requests')
      .select(`
        id,
        receiver_id,
        created_at,
        receiver:profiles!friend_requests_receiver_id_fkey(
          id,
          username,
          email
        )
      `)
      .eq('sender_id', userId)
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false }),
  ]);

  if (friendsRes.error || incomingRequestsRes.error || outgoingRequestsRes.error) {
    return {
      ...empty,
      error:
        friendsRes.error?.message
        || incomingRequestsRes.error?.message
        || outgoingRequestsRes.error?.message
        || 'Failed to load friends',
    };
  }

  const friends = ((friendsRes.data ?? []) as any[])
    .map((row) => buildUserSummary(row.friend as { id?: string; username?: string | null; email?: string | null } | null))
    .filter((entry): entry is UserSummary => Boolean(entry))
    .sort((a, b) => a.username.localeCompare(b.username));

  const incomingRequests = ((incomingRequestsRes.data ?? []) as any[])
    .map((row) => {
      const sender = buildUserSummary(row.sender as { id?: string; username?: string | null; email?: string | null } | null);
      if (!sender || !row.id || !row.sender_id) return null;
      return {
        id: row.id as string,
        sender_id: row.sender_id as string,
        created_at: row.created_at as string,
        sender,
      } satisfies IncomingFriendRequest;
    })
    .filter((entry): entry is IncomingFriendRequest => Boolean(entry));

  const outgoingRequests = ((outgoingRequestsRes.data ?? []) as any[])
    .map((row) => {
      const receiver = buildUserSummary(row.receiver as { id?: string; username?: string | null; email?: string | null } | null);
      if (!receiver || !row.id || !row.receiver_id) return null;
      return {
        id: row.id as string,
        receiver_id: row.receiver_id as string,
        created_at: row.created_at as string,
        receiver,
      } satisfies OutgoingFriendRequest;
    })
    .filter((entry): entry is OutgoingFriendRequest => Boolean(entry));

  return { friends, incomingRequests, outgoingRequests, error: null };
}
