import { useCallback, useEffect, useState } from 'react';
import { Tabs, usePathname } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import {
  getFriendsVouchRequestsSeenStorageKey,
  getSettingsFriendRequestsSeenStorageKey,
} from '@/lib/settings-badge';
import { type Colors } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import { taskCreatorState } from '@/lib/taskCreatorState';
import { createRealtimeRateLimiter } from '@/lib/query/realtimeRateLimiter';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

interface TabConfig {
  name: string;
  icon: FeatherName;
  title: string;
}

const TABS: TabConfig[] = [
  { name: 'tasks/index',       icon: 'check-circle', title: 'Tasks'       },
  { name: 'friends/index',     icon: 'users',        title: 'Friends'     },
  { name: 'commitments/index', icon: 'target',       title: 'Commitments' },
  { name: 'ledger/index',      icon: 'credit-card',  title: 'Ledger'      },
  { name: 'settings/index',    icon: 'settings',     title: 'Settings'    },
];

function TabIcon({
  icon,
  focused,
  badgeCount = 0,
}: {
  icon: FeatherName;
  focused: boolean;
  badgeCount?: number;
}) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const tint = focused ? colors.tabActive : colors.tabInactive;
  const badgeText = badgeCount > 99 ? '99+' : badgeCount > 0 ? String(badgeCount) : null;

  return (
    <View style={styles.tabItem}>
      <Feather name={icon} size={20} color={tint} />
      {badgeText ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeText}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function AppLayout() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [settingsBadgeSeenAt, setSettingsBadgeSeenAt] = useState<string | null>(null);
  const [settingsBadgeCount, setSettingsBadgeCount] = useState(0);
  const [settingsBadgeReady, setSettingsBadgeReady] = useState(false);
  const [friendsBadgeSeenAt, setFriendsBadgeSeenAt] = useState<string | null>(null);
  const [friendsBadgeCount, setFriendsBadgeCount] = useState(0);
  const [friendsBadgeReady, setFriendsBadgeReady] = useState(false);

  const markSettingsBadgeSeen = useCallback(
    async (visitedAt: string = new Date().toISOString()) => {
      if (!userId) return;
      setSettingsBadgeSeenAt(visitedAt);
      setSettingsBadgeCount(0);
      await AsyncStorage.setItem(
        getSettingsFriendRequestsSeenStorageKey(userId),
        visitedAt,
      );
    },
    [userId],
  );

  const markFriendsBadgeSeen = useCallback(
    async (visitedAt: string = new Date().toISOString()) => {
      if (!userId) return;
      setFriendsBadgeSeenAt(visitedAt);
      setFriendsBadgeCount(0);
      await AsyncStorage.setItem(
        getFriendsVouchRequestsSeenStorageKey(userId),
        visitedAt,
      );
    },
    [userId],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadSeenAt() {
      if (!userId) {
        setSettingsBadgeSeenAt(null);
        setSettingsBadgeCount(0);
        setSettingsBadgeReady(true);
        setFriendsBadgeSeenAt(null);
        setFriendsBadgeCount(0);
        setFriendsBadgeReady(true);
        return;
      }

      setSettingsBadgeReady(false);
      const storedSeenAt = await AsyncStorage.getItem(
        getSettingsFriendRequestsSeenStorageKey(userId),
      );
      if (!cancelled) {
        setSettingsBadgeSeenAt(storedSeenAt);
        setSettingsBadgeReady(true);
      }

      setFriendsBadgeReady(false);
      const storedFriendsSeenAt = await AsyncStorage.getItem(
        getFriendsVouchRequestsSeenStorageKey(userId),
      );
      if (!cancelled) {
        setFriendsBadgeSeenAt(storedFriendsSeenAt);
        setFriendsBadgeReady(true);
      }
    }

    void loadSeenAt();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !pathname.startsWith('/settings')) return;
    void markSettingsBadgeSeen();
  }, [markSettingsBadgeSeen, pathname, userId]);

  useEffect(() => {
    if (!userId || !pathname.startsWith('/friends')) return;
    void markFriendsBadgeSeen();
  }, [markFriendsBadgeSeen, pathname, userId]);

  useEffect(() => {
    if (!userId || !settingsBadgeReady) return;

    let cancelled = false;

    async function refreshSettingsBadgeCount() {
      let query = supabase
        .from('friend_requests')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', userId)
        .eq('status', 'PENDING');

      if (settingsBadgeSeenAt) {
        query = query.gt('created_at', settingsBadgeSeenAt);
      }

      const { count, error } = await query;
      if (cancelled || error) return;
      setSettingsBadgeCount(count ?? 0);
    }

    void refreshSettingsBadgeCount();
    const rateLimiter = createRealtimeRateLimiter({
      label: `settings-friend-request-badge:${userId}`,
      callback: () => {
        void refreshSettingsBadgeCount();
      },
    });

    const channel = supabase
      .channel(`settings-friend-request-badge:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'friend_requests',
          filter: `receiver_id=eq.${userId}`,
        },
        () => {
          rateLimiter.trigger();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      rateLimiter.dispose();
      void supabase.removeChannel(channel);
    };
  }, [settingsBadgeReady, settingsBadgeSeenAt, userId]);

  useEffect(() => {
    if (!userId || !friendsBadgeReady) return;

    let cancelled = false;

    async function refreshFriendsBadgeCount() {
      let query = supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('voucher_id', userId)
        .neq('user_id', userId)
        .in('status', ['AWAITING_VOUCHER', 'MARKED_COMPLETE']);

      if (friendsBadgeSeenAt) {
        query = query.gt('marked_completed_at', friendsBadgeSeenAt);
      }

      const { count, error } = await query;
      if (cancelled || error) return;
      setFriendsBadgeCount(count ?? 0);
    }

    void refreshFriendsBadgeCount();
    const rateLimiter = createRealtimeRateLimiter({
      label: `friends-vouch-request-badge:${userId}`,
      callback: () => {
        void refreshFriendsBadgeCount();
      },
    });

    const channel = supabase
      .channel(`friends-vouch-request-badge:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
          filter: `voucher_id=eq.${userId}`,
        },
        () => {
          rateLimiter.trigger();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      rateLimiter.dispose();
      void supabase.removeChannel(channel);
    };
  }, [friendsBadgeReady, friendsBadgeSeenAt, userId]);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: [
          styles.tabBar,
          // Respect device home indicator on iPhone
          { paddingBottom: insets.bottom, height: 56 + insets.bottom },
        ],
        tabBarBackground: () => <View style={styles.tabBarBg} />,
      }}
    >
      {TABS.map(({ name, icon, title }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ focused }) => (
              <TabIcon
                icon={icon}
                focused={focused}
                badgeCount={
                  name === 'settings/index'
                    ? settingsBadgeCount
                    : name === 'friends/index'
                      ? friendsBadgeCount
                      : 0
                }
              />
            ),
          }}
          listeners={() => ({
            tabPress: (e) => {
              if (taskCreatorState.isExpanded) {
                taskCreatorState.collapse();
                // Only block navigation if already on the tasks tab (creator's home).
                // For all other tabs, let the navigation proceed so the user lands there.
                if (name === 'tasks/index') {
                  e.preventDefault();
                }
              }
            },
          })}
        />
      ))}

      {/* Hide routes that exist on disk but shouldn't appear in the tab bar */}
      <Tabs.Screen name="index"      options={{ href: null }} />
      <Tabs.Screen name="tasks/[id]" options={{ href: null }} />
      <Tabs.Screen name="commitments/[id]" options={{ href: null }} />
    </Tabs>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  tabBar: {
    backgroundColor: colors.tabBar,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    elevation: 0,
    shadowOpacity: 0,
  },
  tabBarBg: {
    flex: 1,
    backgroundColor: colors.tabBar,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
    position: 'relative',
    minWidth: 28,
    minHeight: 24,
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.tabBar,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '700',
  },
});
