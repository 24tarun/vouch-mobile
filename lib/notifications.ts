import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const NOTIFICATION_TTL_MS = 30 * 60 * 1000;
const LOCAL_REMINDER_NOTIFICATION_MAP_KEY = 'vouch_local_reminder_notification_ids_v1';
const ACTIVE_TASK_STATUSES = new Set(['ACTIVE', 'POSTPONED']);

function extractNotificationTimestampMs(
  data: Record<string, unknown> | undefined | null,
): number | null {
  if (!data) return null;

  const value =
    data.reminder_at
    ?? data.reminderAt
    ?? data.sent_at
    ?? data.sentAt
    ?? data.created_at
    ?? data.createdAt;

  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// Controls how notifications are presented when the app is in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = (notification.request.content.data as Record<string, unknown> | undefined) ?? undefined;
    const sourceTimestampMs = extractNotificationTimestampMs(data);
    const isExpired = sourceTimestampMs !== null && (Date.now() - sourceTimestampMs) > NOTIFICATION_TTL_MS;

    if (isExpired) {
      return {
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    }

    return {
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    };
  },
});

function getProjectId() {
  return Constants.expoConfig?.extra?.eas?.projectId as string;
}

async function getExpoPushTokenAsync(): Promise<string | null> {
  const { data: token } = await Notifications.getExpoPushTokenAsync({
    projectId: getProjectId(),
  });
  return token;
}

export function getTaskIdFromNotificationResponse(
  response: Notifications.NotificationResponse | null | undefined,
): string | null {
  const taskId = response?.notification.request.content.data?.task_id;
  return typeof taskId === 'string' && taskId.trim().length > 0 ? taskId : null;
}

async function hasGrantedNotificationPermissionAsync(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}

async function readLocalReminderNotificationMapAsync(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_REMINDER_NOTIFICATION_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const entries: Array<[string, string]> = Object.entries(parsed as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string' && value.length > 0)
      .map(([key, value]) => [key, value as string]);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

async function writeLocalReminderNotificationMapAsync(
  next: Record<string, string>,
): Promise<void> {
  await AsyncStorage.setItem(LOCAL_REMINDER_NOTIFICATION_MAP_KEY, JSON.stringify(next));
}

function createReminderContent(input: {
  taskTitle: string;
  source: string | null;
}): Notifications.NotificationContentInput {
  const source = input.source ?? 'MANUAL';
  const bodyPrefix = source === 'DEFAULT_DEADLINE_10M'
    ? 'Due in about 10 minutes'
    : source === 'DEFAULT_DEADLINE_1H'
      ? 'Due in about 1 hour'
      : 'Task reminder';

  return {
    title: input.taskTitle,
    body: `${bodyPrefix}: ${input.taskTitle}`,
    sound: true,
  };
}

export async function clearLocalReminderNotificationsAsync(): Promise<void> {
  try {
    const map = await readLocalReminderNotificationMapAsync();
    for (const notificationId of Object.values(map)) {
      try {
        await Notifications.cancelScheduledNotificationAsync(notificationId);
      } catch {
        // Notification may already be delivered or canceled.
      }
    }
    await AsyncStorage.removeItem(LOCAL_REMINDER_NOTIFICATION_MAP_KEY);
  } catch (err) {
    console.warn('[notifications] failed to clear local reminders:', err);
  }
}

/**
 * Hybrid delivery: mirrors DB-backed task reminders as local on-device
 * notifications for offline resilience while backend push remains the
 * cross-device source of truth.
 */
export async function syncLocalReminderNotificationsAsync(userId: string): Promise<void> {
  try {
    if (!userId) return;

    if (!(await hasGrantedNotificationPermissionAsync())) {
      return;
    }

    const nowIso = new Date().toISOString();

    const { data: reminders, error: remindersError } = await supabase
      .from('task_reminders')
      .select('id, parent_task_id, reminder_at, source, notified_at')
      .eq('user_id', userId)
      .gt('reminder_at', nowIso)
      .order('reminder_at', { ascending: true });

    if (remindersError) {
      console.warn('[notifications] local reminder sync failed to fetch reminders:', remindersError.message);
      return;
    }

    const reminderRows = (reminders as Array<{
      id: string;
      parent_task_id: string;
      reminder_at: string;
      source: string | null;
      notified_at: string | null;
    }> | null) ?? [];

    const pendingReminderRows = reminderRows.filter((row) => !row.notified_at);
    if (pendingReminderRows.length === 0) {
      await clearLocalReminderNotificationsAsync();
      return;
    }

    const taskIds = Array.from(new Set(pendingReminderRows.map((row) => row.parent_task_id)));
    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select('id, title, status')
      .in('id', taskIds);

    if (tasksError) {
      console.warn('[notifications] local reminder sync failed to fetch tasks:', tasksError.message);
      return;
    }

    const tasksById = new Map(
      ((tasks as Array<{ id: string; title: string; status: string }> | null) ?? [])
        .filter((task) => ACTIVE_TASK_STATUSES.has(task.status))
        .map((task) => [task.id, task]),
    );

    const validReminders = pendingReminderRows.filter((row) => {
      const reminderAt = new Date(row.reminder_at).getTime();
      return Number.isFinite(reminderAt) && reminderAt > Date.now() && tasksById.has(row.parent_task_id);
    });

    const desiredReminderIds = new Set(validReminders.map((row) => row.id));
    const persistedMap = await readLocalReminderNotificationMapAsync();
    const nextMap: Record<string, string> = {};

    for (const [reminderId, notificationId] of Object.entries(persistedMap)) {
      if (desiredReminderIds.has(reminderId)) {
        nextMap[reminderId] = notificationId;
      } else {
        try {
          await Notifications.cancelScheduledNotificationAsync(notificationId);
        } catch {
          // Notification may already be delivered or canceled.
        }
      }
    }

    for (const reminder of validReminders) {
      if (nextMap[reminder.id]) continue;

      const task = tasksById.get(reminder.parent_task_id);
      if (!task) continue;

      const delayMs = new Date(reminder.reminder_at).getTime() - Date.now();
      if (!Number.isFinite(delayMs) || delayMs <= 0) continue;

      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          ...createReminderContent({ taskTitle: task.title, source: reminder.source }),
          data: {
            task_id: reminder.parent_task_id,
            reminder_id: reminder.id,
            reminder_source: reminder.source ?? 'MANUAL',
            reminder_at: reminder.reminder_at,
            local_schedule: true,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: Math.max(1, Math.floor(delayMs / 1000)),
          repeats: false,
        },
      });

      nextMap[reminder.id] = notificationId;
    }

    await writeLocalReminderNotificationMapAsync(nextMap);
  } catch (err) {
    console.warn('[notifications] local reminder sync failed:', err);
  }
}

/**
 * Requests push-notification permission, retrieves the Expo push token, and
 * upserts it into `expo_push_tokens` for the given user.
 *
 * Safe to call on every app launch — the upsert is idempotent.
 * Silently no-ops on simulators or when the user denies permission.
 */
export async function registerForPushNotificationsAsync(userId: string): Promise<void> {
  try {
    // Android requires an explicit notification channel for API 26+.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#F59E0B',
      });
    }

    const finalStatus = (await hasGrantedNotificationPermissionAsync()) ? 'granted' : 'denied';

    if (finalStatus !== 'granted') {
      return;
    }

    const token = await getExpoPushTokenAsync();
    if (!token) return;

    await supabase
      .from('expo_push_tokens')
      .upsert(
        { user_id: userId, token, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,token' },
      );
  } catch (err) {
    // Silently swallow — common on simulators where tokens are unavailable.
    console.warn('[notifications] registration failed:', err);
  }
}

export async function unregisterForPushNotificationsAsync(userId: string): Promise<void> {
  try {
    const token = await getExpoPushTokenAsync();
    if (!token) return;

    const { error } = await supabase
      .from('expo_push_tokens')
      .delete()
      .eq('user_id', userId)
      .eq('token', token);

    if (error) {
      console.warn('[notifications] deregistration failed:', error.message);
    }
  } catch (err) {
    console.warn('[notifications] deregistration failed:', err);
  }
}
