import 'react-native-gesture-handler';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import Toast, { BaseToast, type ToastConfig, type ToastConfigParams } from 'react-native-toast-message';
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

void SplashScreen.preventAutoHideAsync().catch(() => {});

const toastBaseStyle = {
  width: 'auto' as const,
  maxWidth: '88%' as const,
  minHeight: 44,
  borderLeftWidth: 0,
  borderWidth: 1,
  borderRadius: radius.md,
  backgroundColor: '#0B1220EE',
  alignSelf: 'flex-start' as const,
  marginLeft: spacing.lg,
};

function ProofSuccessToast({ isVisible, text1, onPress }: ToastConfigParams<any>) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isVisible) {
      Animated.spring(progress, {
        toValue: 1,
        useNativeDriver: true,
        tension: 90,
        friction: 11,
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
        toastBaseStyle,
        {
          borderColor: '#22C55E55',
          opacity: progress,
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [28, 0],
              }),
            },
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [6, 0],
              }),
            },
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.84, 1],
              }),
            },
          ],
        },
      ]}
      pointerEvents="box-none"
      onTouchEnd={onPress}
    >
      <View style={{ paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
        <Text style={{ color: '#E5E7EB', fontSize: typography.xs, fontWeight: typography.medium }}>
          {text1}
        </Text>
      </View>
    </Animated.View>
  );
}

const toastConfig: ToastConfig = {
  proofError: (props) => (
    <BaseToast
      {...props}
      style={[toastBaseStyle, { borderColor: '#EF444455' }]}
      contentContainerStyle={{ paddingHorizontal: spacing.md }}
      text1Style={{ color: '#E5E7EB', fontSize: typography.xs, fontWeight: typography.medium }}
      text1NumberOfLines={3}
    />
  ),
  proofSuccess: (props) => <ProofSuccessToast {...props} />,
};

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

    void registerForPushNotificationsAsync(userId);
    void syncLocalReminderNotificationsAsync(userId);
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
