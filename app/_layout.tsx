import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Animated, AppState, Easing, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import { Feather } from '@expo/vector-icons';
import Toast, { type ToastConfig, type ToastConfigParams } from 'react-native-toast-message';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { radius, spacing, typography } from '@/lib/theme';
import { ThemeProvider, useTheme } from '@/lib/ThemeContext';
import {
  clearLocalReminderNotificationsAsync,
  getTaskIdFromNotificationResponse,
  registerForPushNotificationsAsync,
  syncLocalReminderNotificationsAsync,
} from '@/lib/notifications';
import { PomodoroProvider } from '@/components/pomodoro/PomodoroProvider';
import { AppQueryProvider } from '@/lib/query/client';
import { createRealtimeRateLimiter } from '@/lib/query/realtimeRateLimiter';
import { supabase } from '@/lib/supabase';

void SplashScreen.preventAutoHideAsync().catch(() => {});

interface ThemedToastProps extends ToastConfigParams<any> {
  tone: 'success' | 'error';
  isDark: boolean;
}

function ThemedToast({
  isVisible,
  text1,
  onPress,
  tone,
  isDark,
}: ThemedToastProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const successFg = isDark ? '#86EFAC' : '#166534';
  const errorFg = isDark ? '#FCA5A5' : '#991B1B';
  const titleColor = tone === 'success' ? successFg : errorFg;
  const iconName = tone === 'success' ? 'check-circle' : 'alert-circle';
  const iconBg = tone === 'success'
    ? (isDark ? 'rgba(34,197,94,0.18)' : 'rgba(22,163,74,0.12)')
    : (isDark ? 'rgba(239,68,68,0.2)' : 'rgba(220,38,38,0.12)');
  const backgroundColor = isDark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.97)';
  const borderColor = tone === 'success'
    ? (isDark ? 'rgba(34,197,94,0.55)' : 'rgba(22,163,74,0.38)')
    : (isDark ? 'rgba(239,68,68,0.55)' : 'rgba(220,38,38,0.38)');
  const bodyColor = isDark ? '#E2E8F0' : '#0F172A';

  useEffect(() => {
    if (isVisible) {
      Animated.spring(progress, {
        toValue: 1,
        useNativeDriver: true,
        tension: 86,
        friction: 10,
      }).start();
      return;
    }

    Animated.timing(progress, {
      toValue: 0,
      duration: 230,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isVisible, progress]);

  return (
    <Animated.View
      style={[
        {
          width: 'auto',
          maxWidth: '90%',
          minHeight: 54,
          borderLeftWidth: 0,
          borderWidth: 1,
          borderRadius: radius.lg,
          backgroundColor,
          alignSelf: 'flex-start',
          marginLeft: spacing.lg,
          shadowColor: isDark ? '#020617' : '#0F172A',
          shadowOffset: { width: 0, height: 7 },
          shadowOpacity: isDark ? 0.55 : 0.18,
          shadowRadius: 14,
          elevation: 12,
        },
        {
          borderColor,
          opacity: progress,
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [22, 0],
              }),
            },
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [8, 0],
              }),
            },
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.92, 1],
              }),
            },
          ],
        },
      ]}
      pointerEvents="box-none"
      onTouchEnd={onPress}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm }}>
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: iconBg,
          }}
        >
          <Feather name={iconName} size={14} color={titleColor} />
        </View>
        <Text
          style={{
            color: bodyColor,
            fontSize: typography.sm,
            fontWeight: typography.semibold,
            lineHeight: 18,
            flexShrink: 1,
          }}
          numberOfLines={3}
        >
          {text1}
        </Text>
      </View>
    </Animated.View>
  );
}

function makeToastConfig(isDark: boolean): ToastConfig {
  return {
    proofError: (props) => <ThemedToast {...props} tone="error" isDark={isDark} />,
    proofSuccess: (props) => <ThemedToast {...props} tone="success" isDark={isDark} />,
  };
}

function AuthGuard() {
  const { session, authInitialized, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);
  const lastHandledNotificationId = useRef<string | null>(null);
  const [routeReady, setRouteReady] = useState(false);
  const [splashHidden, setSplashHidden] = useState(false);

  const routeFromNotificationResponse = useCallback((
    response: Notifications.NotificationResponse | null | undefined,
  ) => {
    const notificationId = response?.notification.request.identifier ?? null;
    if (!notificationId || lastHandledNotificationId.current === notificationId) {
      return;
    }

    const taskId = getTaskIdFromNotificationResponse(response);
    if (!taskId) return;

    lastHandledNotificationId.current = notificationId;
    router.push(`/(app)/tasks/${taskId}`);
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    async function resolveInitialRoute() {
      if (!authInitialized) return;

      const topSegment = (segments[0] ?? '') as string;
      const inAppGroup = topSegment === '(app)';
      const inAuthGroup = topSegment === '(auth)';
      const isPublicUtilityRoute = topSegment === 'email-confirmed';

      if (session) {
        if (!inAppGroup) {
          router.replace('/(app)/tasks');
          return;
        }
        if (!cancelled) setRouteReady(true);
        return;
      }

      if (inAuthGroup || isPublicUtilityRoute) {
        if (!cancelled) setRouteReady(true);
        return;
      }

      const seen = await AsyncStorage.getItem('vouch_onboarding_seen');
      if (cancelled) return;
      router.replace(seen ? '/(auth)/sign-in' : '/(auth)/onboarding');
    }

    void resolveInitialRoute();

    return () => {
      cancelled = true;
    };
  }, [authInitialized, session, segments, router]);

  useEffect(() => {
    if (!routeReady || splashHidden) return;
    if (session && loading) return;

    SplashScreen.hideAsync()
      .catch(() => {})
      .finally(() => {
        setSplashHidden(true);
      });
  }, [routeReady, splashHidden, session, loading]);

  // Register for push notifications once the user is authenticated.
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      void clearLocalReminderNotificationsAsync();
      return;
    }

    let disposed = false;
    let syncInFlight = false;
    let syncQueued = false;

    const runReminderSync = async () => {
      if (disposed) return;
      if (syncInFlight) {
        syncQueued = true;
        return;
      }

      syncInFlight = true;
      try {
        do {
          syncQueued = false;
          await syncLocalReminderNotificationsAsync(userId);
        } while (!disposed && syncQueued);
      } finally {
        syncInFlight = false;
      }
    };

    const reminderSyncLimiter = createRealtimeRateLimiter({
      label: `local-reminders:${userId}`,
      callback: () => {
        void runReminderSync();
      },
      maxRunsPerWindow: 60,
      minIntervalMs: 1000,
    });

    const tasksChannel = supabase
      .channel(`local-reminder-sync:tasks:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` },
        () => {
          reminderSyncLimiter.trigger();
        },
      )
      .subscribe();

    const remindersChannel = supabase
      .channel(`local-reminder-sync:task-reminders:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_reminders', filter: `user_id=eq.${userId}` },
        () => {
          reminderSyncLimiter.trigger();
        },
      )
      .subscribe();

    const profileChannel = supabase
      .channel(`local-reminder-sync:profile:${userId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` },
        () => {
          reminderSyncLimiter.trigger();
        },
      )
      .subscribe();

    const appStateSubscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        void runReminderSync();
      }
    });

    void registerForPushNotificationsAsync(userId);
    void runReminderSync();
    void Notifications.getLastNotificationResponseAsync().then(routeFromNotificationResponse);

    // Notification received while app is open — no special action needed since
    // the app already reflects live state.
    notificationListener.current = Notifications.addNotificationReceivedListener(
      (_notification) => {},
    );

    // User taps a notification — route to the relevant task if a task_id is
    // embedded in the notification data payload.
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      routeFromNotificationResponse,
    );

    return () => {
      disposed = true;
      reminderSyncLimiter.dispose();
      appStateSubscription.remove();
      void supabase.removeChannel(tasksChannel);
      void supabase.removeChannel(remindersChannel);
      void supabase.removeChannel(profileChannel);
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [routeFromNotificationResponse, session?.user?.id]);

  // Always keep <Slot /> mounted so child navigators ((app), (auth)) are never
  // torn down mid-navigation. The native splash screen covers the initial load.
  return <Slot />;
}

function ThemedRoot() {
  const { colors, isDark } = useTheme();
  const toastConfig = useMemo(() => makeToastConfig(isDark), [isDark]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <AuthGuard />
      <Toast config={toastConfig} />
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <SafeAreaProvider>
        <AppQueryProvider>
          <ThemeProvider>
            <AuthProvider>
              <PomodoroProvider>
                <ThemedRoot />
              </PomodoroProvider>
            </AuthProvider>
          </ThemeProvider>
        </AppQueryProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flex: 1,
  },
});
