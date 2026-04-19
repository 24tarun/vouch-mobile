import { Text, TouchableOpacity, View } from 'react-native';
import type { BlockedUserOption } from '@/lib/settings/relationships';
import { styles } from './styles';

interface BlockedUsersSectionProps {
  blockedUsersLoading: boolean;
  blockedUsersError: string | null;
  blockedUsers: BlockedUserOption[];
  unblockingUserId: string | null;
  onUnblockUser: (blockedUser: BlockedUserOption) => Promise<void>;
}

export function BlockedUsersSection({
  blockedUsersLoading,
  blockedUsersError,
  blockedUsers,
  unblockingUserId,
  onUnblockUser,
}: BlockedUsersSectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Blocked Users</Text>
      <View style={styles.card}>
        <View style={styles.defaultsContent}>
          <Text style={styles.toggleSub}>
            Unblock people you previously blocked so they can send friend requests again.
          </Text>

          {blockedUsersLoading ? <Text style={styles.savingText}>Loading blocked users...</Text> : null}
          {blockedUsersError ? <Text style={styles.errorText}>{blockedUsersError}</Text> : null}

          {!blockedUsersLoading && blockedUsers.length === 0 ? (
            <Text style={styles.toggleSub}>No blocked users.</Text>
          ) : null}

          {blockedUsers.map((blockedUser) => (
            <View key={blockedUser.id} style={styles.blockedUserRow}>
              <View style={styles.blockedUserMeta}>
                <Text style={styles.blockedUserName} numberOfLines={1} ellipsizeMode="clip">{blockedUser.username}</Text>
                <Text style={styles.blockedUserEmail} numberOfLines={1} ellipsizeMode="clip">{blockedUser.email}</Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.unblockButton,
                  unblockingUserId === blockedUser.id && styles.unblockButtonDisabled,
                ]}
                onPress={() => {
                  void onUnblockUser(blockedUser);
                }}
                activeOpacity={0.8}
                disabled={unblockingUserId === blockedUser.id}
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${blockedUser.username}`}
              >
                <Text style={styles.unblockButtonText}>
                  {unblockingUserId === blockedUser.id ? 'Unblocking...' : 'Unblock'}
                </Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
