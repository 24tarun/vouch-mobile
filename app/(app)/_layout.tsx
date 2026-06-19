import { useEffect, useMemo, useState } from 'react';
import { Tabs } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { type Colors } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import { TaskCreatorProvider, useTaskCreatorHandle } from '@/lib/taskCreatorState';
import { createRealtimeRateLimiter } from '@/lib/query/realtimeRateLimiter';
import { queryKeys } from '@/lib/query/keys';
import { fetchCommitments } from '@/lib/hooks/useCommitments';
import { fetchLedger } from '@/lib/hooks/useLedger';
import { fetchFriendQueue } from '@/lib/hooks/useFriendQueue';
import { fetchRelationships } from '@/lib/hooks/useRelationships';
import { fetchBlockedUsers } from '@/lib/hooks/useBlockedUsers';
import { fetchSettingsStats } from '@/lib/stats/calculate-stats';
import { countPendingVouchRequests } from '@/lib/friends-badge';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

interface TabConfig {
  name: string;
  icon: FeatherName;
  title: string;
}

const TABS: TabConfig[] = [
  { name: 'tasks/index',       icon: 'check-circle', title: 'Tasks'       },
  { name: 'history/index',     icon: 'clock',        title: 'History'     },
  { name: 'friends/index',     icon: 'users',        title: 'Friends'     },
  { name: 'commitments/index', icon: 'target',       title: 'Commits'     },
  { name: 'ledger/index',      icon: 'credit-card',  title: 'Ledger'      },
  { name: 'settings',          icon: 'settings',     title: 'Settings'    },
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
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const tint = focused ? colors.tabActive : colors.tabInactive;
  const badgeText = badgeCount > 99 ? '99+' : badgeCount > 0 ? String(badgeCount) : null;

  return (
    <View style={styles.tabItem}>
      <Feather name={icon} size={22} color={tint} />
      {badgeText ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeText}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function AppLayout() {
  return (
    <TaskCreatorProvider>
      <AppLayoutContent />
    </TaskCreatorProvider>
  );
}

function AppLayoutContent() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const taskCreatorHandle = useTaskCreatorHandle();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const [settingsBadgeCount, setSettingsBadgeCount] = useState(0);
  const friendQueueQuery = useQuery({
    queryKey: queryKeys.friendQueue(userId),
    queryFn: ({ signal }) => fetchFriendQueue(userId!, signal),
    enabled: Boolean(userId),
  });
  const friendsBadgeCount = useMemo(
    () => countPendingVouchRequests(friendQueueQuery.data ?? []),
    [friendQueueQuery.data],
  );

  // Prefetch all tab data on app load so navigation is instant
  useEffect(() => {
    if (!userId) return;

    queryClient.prefetchQuery({
      queryKey: queryKeys.commitments(userId),
      queryFn: () => fetchCommitments(userId),
    });
    queryClient.prefetchQuery({
      queryKey: queryKeys.ledger(userId),
      queryFn: () => fetchLedger(userId),
    });
    queryClient.prefetchQuery({
      queryKey: queryKeys.friendQueue(userId),
      queryFn: () => fetchFriendQueue(userId),
    });
    queryClient.prefetchQuery({
      queryKey: queryKeys.relationships(userId),
      queryFn: () => fetchRelationships(userId),
    });
    queryClient.prefetchQuery({
      queryKey: queryKeys.blockedUsers(userId),
      queryFn: () => fetchBlockedUsers(userId),
    });
    queryClient.prefetchQuery({
      queryKey: queryKeys.settingsStats(userId),
      queryFn: async () => {
        const result = await fetchSettingsStats(userId);
        if (result.error) throw new Error(result.error);
        return result.data;
      },
    });
  }, [queryClient, userId]);

  useEffect(() => {
    if (!userId) {
      setSettingsBadgeCount(0);
      return;
    }

    let cancelled = false;

    async function refreshSettingsBadgeCount() {
      const { count, error } = await supabase
        .from('friend_requests')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', userId)
        .eq('status', 'PENDING');

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
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    const queueKey = queryKeys.friendQueue(userId);
    const rateLimiter = createRealtimeRateLimiter({
      label: `friends-vouch-request-badge:${userId}`,
      callback: () => {
        void queryClient.invalidateQueries({ queryKey: queueKey });
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
      rateLimiter.dispose();
      void supabase.removeChannel(channel);
    };
  }, [queryClient, userId]);

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
                  name === 'settings'
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
              if (taskCreatorHandle.current.isExpanded) {
                taskCreatorHandle.current.collapse();
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

const makeStyles = (colors: Colors, isDark: boolean) => StyleSheet.create({
  tabBar: {
    backgroundColor: colors.tabBar,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    elevation: 0,
    shadowColor: '#0F172A',
    shadowOpacity: isDark ? 0 : 0.06,
    shadowRadius: isDark ? 0 : 10,
    shadowOffset: { width: 0, height: isDark ? 0 : -2 },
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
