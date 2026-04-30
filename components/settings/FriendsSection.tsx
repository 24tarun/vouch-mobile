import type { Dispatch, SetStateAction } from 'react';
import { useMemo } from 'react';

import {
  ActivityIndicator,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/lib/ThemeContext';
import {
  type IncomingFriendRequest,
  type OutgoingFriendRequest,
  type SearchCandidate,
  type UserSummary,
} from '@/lib/settings/relationships';
import { makeStyles } from './styles';

interface FriendsSectionProps {
  friendSearchQuery: string;
  setFriendSearchQuery: Dispatch<SetStateAction<string>>;
  friendSearchLoading: boolean;
  friendSearchError: string | null;
  friendSearchResults: SearchCandidate[];
  relationshipsError: string | null;
  relationshipsLoading: boolean;
  incomingRequests: IncomingFriendRequest[];
  outgoingRequests: OutgoingFriendRequest[];
  friends: UserSummary[];
  relationshipInFlight: Record<string, string | null>;
  onSendFriendRequest: (candidate: SearchCandidate) => Promise<void>;
  onBlockRelationshipUser: (target: UserSummary | SearchCandidate, sourceKey: string) => Promise<void>;
  onAcceptFriendRequest: (request: IncomingFriendRequest) => Promise<void>;
  onRejectFriendRequest: (request: IncomingFriendRequest) => Promise<void>;
  onWithdrawFriendRequest: (request: OutgoingFriendRequest) => Promise<void>;
  onRemoveFriend: (friend: UserSummary) => Promise<void>;
}

export function FriendsSection({
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
  onSendFriendRequest,
  onBlockRelationshipUser,
  onAcceptFriendRequest,
  onRejectFriendRequest,
  onWithdrawFriendRequest,
  onRemoveFriend,
}: FriendsSectionProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isSearchActive = friendSearchQuery.trim().length > 0;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Friends</Text>
      <View style={styles.card}>
        <View style={styles.defaultsContent}>
          <View style={styles.friendSearchRow}>
            <Feather name="search" size={16} color={colors.textMuted} />
            <TextInput
              style={styles.friendSearchInput}
              placeholder="Search by email or username"
              placeholderTextColor={colors.textSubtle}
              autoCapitalize="none"
              autoCorrect={false}
              value={friendSearchQuery}
              onChangeText={setFriendSearchQuery}
            />
            {friendSearchQuery.length > 0 ? (
              <TouchableOpacity onPress={() => setFriendSearchQuery('')} hitSlop={8}>
                <Feather name="x-circle" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>

          {isSearchActive ? (
            <View style={styles.friendsList}>
              {friendSearchLoading ? (
                <Text style={styles.savingText}>Searching...</Text>
              ) : friendSearchError ? (
                <Text style={styles.errorText}>{friendSearchError}</Text>
              ) : friendSearchResults.length === 0 ? null : (
                friendSearchResults.map((candidate) => {
                  const sendKey = `send:${candidate.id}`;
                  const blockKey = `search:${candidate.id}:block`;
                  const isSending = relationshipInFlight[sendKey] === 'send';
                  const isBlocking = relationshipInFlight[blockKey] === 'block';

                  return (
                    <View key={candidate.id} style={styles.friendRow}>
                      <View style={styles.friendMeta}>
                        <View style={styles.friendAvatar}>
                          <Text style={styles.friendAvatarText}>{candidate.username?.[0]?.toUpperCase() || '?'}</Text>
                        </View>
                        <View style={styles.friendText}>
                          <Text style={styles.friendName} numberOfLines={1} ellipsizeMode="clip">{candidate.username}</Text>
                          <Text style={styles.friendEmail} numberOfLines={1} ellipsizeMode="clip">{candidate.email}</Text>
                        </View>
                      </View>
                      <View style={styles.friendActions}>
                        {candidate.already_friends ? (
                          <Text style={styles.friendStateLabel}>Friends</Text>
                        ) : candidate.incoming_request_pending ? (
                          <Text style={styles.friendStateLabel}>Requested you</Text>
                        ) : candidate.outgoing_request_pending ? (
                          <Text style={styles.friendStateLabel}>Requested</Text>
                        ) : (
                          <TouchableOpacity
                            style={[styles.friendButton, (isSending || isBlocking) && styles.friendButtonDisabled]}
                            onPress={() => {
                              void onSendFriendRequest(candidate);
                            }}
                            activeOpacity={0.8}
                            disabled={isSending || isBlocking}
                          >
                            {isSending ? (
                              <ActivityIndicator size="small" color={colors.text} />
                            ) : (
                              <Text style={styles.friendButtonText}>Add Friend</Text>
                            )}
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={[
                            styles.friendButton,
                            styles.friendButtonDestructive,
                            (isSending || isBlocking) && styles.friendButtonDisabled,
                          ]}
                          onPress={() => {
                            void onBlockRelationshipUser(candidate, blockKey);
                          }}
                          activeOpacity={0.8}
                          disabled={isSending || isBlocking}
                        >
                          {isBlocking ? (
                            <ActivityIndicator size="small" color={colors.destructive} />
                          ) : (
                            <Text style={[styles.friendButtonText, styles.friendButtonTextDestructive]}>Block</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          ) : null}

          {!isSearchActive && relationshipsError ? <Text style={styles.errorText}>{relationshipsError}</Text> : null}
          {!isSearchActive && relationshipsLoading ? <Text style={styles.savingText}>Loading friends...</Text> : null}


          {!isSearchActive && !relationshipsLoading ? (
            <View style={styles.friendsList}>
              {incomingRequests.map((request) => {
                const acceptKey = `request:${request.id}:accept`;
                const rejectKey = `request:${request.id}:reject`;
                const blockKey = `request:${request.id}:block`;
                const busy = Boolean(
                  relationshipInFlight[acceptKey]
                  || relationshipInFlight[rejectKey]
                  || relationshipInFlight[blockKey],
                );

                return (
                  <View key={request.id} style={styles.friendRow}>
                    <View style={styles.friendMeta}>
                      <View style={styles.friendAvatar}>
                        <Text style={styles.friendAvatarText}>{request.sender.initial}</Text>
                      </View>
                      <View style={styles.friendText}>
                        <Text style={styles.friendName} numberOfLines={1} ellipsizeMode="clip">{request.sender.username}</Text>
                        <Text style={styles.friendEmail} numberOfLines={1} ellipsizeMode="clip">{request.sender.email}</Text>
                      </View>
                    </View>
                    <View style={styles.friendIconActions}>
                      <TouchableOpacity
                        style={[styles.circleActionButton, { backgroundColor: colors.successMuted }, busy && styles.friendButtonDisabled]}
                        onPress={() => {
                          void onAcceptFriendRequest(request);
                        }}
                        activeOpacity={0.75}
                        disabled={busy}
                      >
                        {relationshipInFlight[acceptKey] === 'accept' ? (
                          <ActivityIndicator size="small" color={colors.success} />
                        ) : (
                          <Feather name="check" size={16} color={colors.success} />
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.circleActionButton, { backgroundColor: colors.destructiveMuted }, busy && styles.friendButtonDisabled]}
                        onPress={() => {
                          void onRejectFriendRequest(request);
                        }}
                        activeOpacity={0.75}
                        disabled={busy}
                      >
                        {relationshipInFlight[rejectKey] === 'reject' ? (
                          <ActivityIndicator size="small" color={colors.destructive} />
                        ) : (
                          <Feather name="x" size={16} color={colors.destructive} />
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.circleActionButton, { backgroundColor: colors.destructiveMuted }, busy && styles.friendButtonDisabled]}
                        onPress={() => {
                          void onBlockRelationshipUser(request.sender, blockKey);
                        }}
                        activeOpacity={0.75}
                        disabled={busy}
                      >
                        {relationshipInFlight[blockKey] === 'block' ? (
                          <ActivityIndicator size="small" color={colors.destructive} />
                        ) : (
                          <Feather name="slash" size={16} color={colors.destructive} />
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}

              {outgoingRequests.map((request) => {
                const withdrawKey = `outgoing:${request.id}:withdraw`;
                const blockKey = `sent-request:${request.id}:block`;
                const isWithdrawing = relationshipInFlight[withdrawKey] === 'withdraw';
                const isBlocking = relationshipInFlight[blockKey] === 'block';
                const busy = isWithdrawing || isBlocking;
                return (
                  <View key={request.id} style={styles.friendRow}>
                    <View style={styles.friendMeta}>
                      <View style={styles.friendAvatar}>
                        <Text style={styles.friendAvatarText}>{request.receiver.initial}</Text>
                      </View>
                      <View style={styles.friendText}>
                        <Text style={styles.friendName} numberOfLines={1} ellipsizeMode="clip">{request.receiver.username}</Text>
                        <Text style={styles.friendEmail} numberOfLines={1} ellipsizeMode="clip">{request.receiver.email}</Text>
                      </View>
                    </View>
                    <View style={styles.friendIconActions}>
                      <TouchableOpacity
                        style={[styles.circleActionButton, { backgroundColor: '#3B2712' }, busy && styles.friendButtonDisabled]}
                        onPress={() => {
                          void onWithdrawFriendRequest(request);
                        }}
                        activeOpacity={0.75}
                        disabled={busy}
                      >
                        {isWithdrawing ? (
                          <ActivityIndicator size="small" color={colors.warning} />
                        ) : (
                          <Feather name="user-x" size={16} color={colors.warning} />
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.circleActionButton, { backgroundColor: colors.destructiveMuted }, busy && styles.friendButtonDisabled]}
                        onPress={() => {
                          void onBlockRelationshipUser(request.receiver, blockKey);
                        }}
                        activeOpacity={0.75}
                        disabled={busy}
                      >
                        {isBlocking ? (
                          <ActivityIndicator size="small" color={colors.destructive} />
                        ) : (
                          <Feather name="slash" size={16} color={colors.destructive} />
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}

              {friends.map((friend) => {
                const removeKey = `friend:${friend.id}:remove`;
                const blockKey = `friend:${friend.id}:block`;
                const isRemoving = relationshipInFlight[removeKey] === 'remove';
                const isBlocking = relationshipInFlight[blockKey] === 'block';
                const busy = isRemoving || isBlocking;

                return (
                  <View key={friend.id} style={styles.friendRow}>
                    <View style={styles.friendMeta}>
                      <View style={styles.friendAvatar}>
                        <Text style={styles.friendAvatarText}>{friend.initial}</Text>
                      </View>
                      <View style={styles.friendText}>
                        <Text style={styles.friendName} numberOfLines={1} ellipsizeMode="clip">{friend.username}</Text>
                        <Text style={styles.friendEmail} numberOfLines={1} ellipsizeMode="clip">{friend.email}</Text>
                      </View>
                    </View>
                    <View style={styles.friendActions}>
                      <TouchableOpacity
                        style={[styles.circleActionButton, { backgroundColor: '#3B2712' }, busy && styles.friendButtonDisabled]}
                        onPress={() => {
                          void onRemoveFriend(friend);
                        }}
                        activeOpacity={0.75}
                        disabled={busy}
                      >
                        {isRemoving ? (
                          <ActivityIndicator size="small" color={colors.warning} />
                        ) : (
                          <Feather name="user-minus" size={16} color={colors.warning} />
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.circleActionButton, { backgroundColor: colors.destructiveMuted }, busy && styles.friendButtonDisabled]}
                        onPress={() => {
                          void onBlockRelationshipUser(friend, blockKey);
                        }}
                        activeOpacity={0.75}
                        disabled={busy}
                      >
                        {isBlocking ? (
                          <ActivityIndicator size="small" color={colors.destructive} />
                        ) : (
                          <Feather name="slash" size={16} color={colors.destructive} />
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
