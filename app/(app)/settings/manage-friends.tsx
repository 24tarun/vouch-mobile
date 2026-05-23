import { useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from '@/components/settings/styles';
import { FriendsSection } from '@/components/settings/FriendsSection';
import { BlockedUsersSection } from '@/components/settings/BlockedUsersSection';
import { useManageFriends } from '@/lib/hooks/useManageFriends';

export default function ManageFriendsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [refreshing, setRefreshing] = useState(false);
  const {
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
    onSendFriendRequest,
    onBlockRelationshipUser,
    onAcceptFriendRequest,
    onRejectFriendRequest,
    onWithdrawFriendRequest,
    onRemoveFriend,
    onUnblockUser,
    refreshManageFriends,
  } = useManageFriends();

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await refreshManageFriends();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.manageFriendsHeader}>
        <TouchableOpacity
          style={styles.manageFriendsBackButton}
          onPress={() => router.back()}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="chevron-left" size={20} color={colors.text} />
          <Text style={styles.manageFriendsBackText}>Settings</Text>
        </TouchableOpacity>
        <Text style={styles.manageFriendsTitle}>Manage Friends</Text>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { void handleRefresh(); }}
            tintColor={colors.textMuted}
            colors={[colors.textMuted]}
          />
        }
      >
        <FriendsSection
          friendSearchQuery={friendSearchQuery}
          setFriendSearchQuery={setFriendSearchQuery}
          friendSearchLoading={friendSearchLoading}
          friendSearchError={friendSearchError}
          friendSearchResults={friendSearchResults}
          relationshipsError={relationshipsError}
          relationshipsLoading={relationshipsLoading}
          incomingRequests={incomingRequests}
          outgoingRequests={outgoingRequests}
          friends={friends}
          relationshipInFlight={relationshipInFlight}
          onSendFriendRequest={onSendFriendRequest}
          onBlockRelationshipUser={onBlockRelationshipUser}
          onAcceptFriendRequest={onAcceptFriendRequest}
          onRejectFriendRequest={onRejectFriendRequest}
          onWithdrawFriendRequest={onWithdrawFriendRequest}
          onRemoveFriend={onRemoveFriend}
        />

        <BlockedUsersSection
          blockedUsersLoading={blockedUsersLoading}
          blockedUsersError={blockedUsersError}
          blockedUsers={blockedUsers}
          unblockingUserId={unblockingUserId}
          onUnblockUser={onUnblockUser}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
