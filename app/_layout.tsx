import { useEffect, useRef } from 'react';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useAuth } from '@/hooks/useAuth';
import { colors } from '@/lib/theme';
import {
  clearLocalReminderNotificationsAsync,
  getTaskIdFromNotificationResponse,
  registerForPushNotificationsAsync,
  syncLocalReminderNotificationsAsync,
} from '@/lib/notifications';
import { PomodoroProvider } from '@/components/pomodoro/PomodoroProvider';

function AuthGuard() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);
  const lastHandledNotificationId = useRef<string | null>(null);

  function routeFromNotificationResponse(
    response: Notifications.NotificationResponse | null | undefined,
  ) {
    const notificationId = response?.notification.request.identifier ?? null;
    if (!notificationId || lastHandledNotificationId.current === notificationId) {
      return;
    }

    const taskId = getTaskIdFromNotificationResponse(response);
    if (!taskId) return;

    lastHandledNotificationId.current = notificationId;
    router.push(`/(app)/tasks/${taskId}`);
  }

  useEffect(() => {
    if (loading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!session && !inAuthGroup) {
      // Route unauthenticated users through onboarding on first launch,
      // or directly to sign-in on subsequent launches.
      AsyncStorage.getItem('vouch_onboarding_seen').then((seen) => {
        router.replace(seen ? '/(auth)/sign-in' : '/(auth)/onboarding');
      });
    } else if (session && inAuthGroup) {
      router.replace('/(app)/tasks');
    }
  }, [session, loading, segments]);

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
  }, [session?.user?.id]);

  return <Slot />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PomodoroProvider>
        <View style={styles.root}>
          <StatusBar style="light" />
          <AuthGuard />
        </View>
      </PomodoroProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
