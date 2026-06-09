import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AlarmKit from 'alarm-kit';
import { supabase } from './supabase';
import {
  type NotificationSoundKey,
  getNotificationSoundChannelId,
  getNotificationSoundConfig,
  getNotificationSoundConfigs,
  normalizeNotificationSoundKey,
} from './notification-sounds';

const NOTIFICATION_TTL_MS = 30 * 60 * 1000;
const LOCAL_REMINDER_NOTIFICATION_MAP_KEY = 'vouch_local_reminder_notification_ids_v1';
const LOCAL_REMINDER_ALARMKIT_MAP_KEY = 'vouch_local_reminder_alarmkit_ids_v1';
const LOCAL_REMINDER_SOUND_KEY = 'vouch_local_reminder_sound_key_v1';
const ACTIVE_TASK_STATUSES = new Set(['ACTIVE', 'POSTPONED']);
const DEFAULT_DEADLINE_10M_REMINDER_SOURCE = 'DEFAULT_DEADLINE_10M';

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('Aborted');
    err.name = 'AbortError';
    throw err;
  }
}

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

function resolveNotificationSoundName(key: NotificationSoundKey): string {
  return getNotificationSoundConfig(key).soundFileName;
}

function resolveAndroidChannelId(key: NotificationSoundKey): string {
  return getNotificationSoundChannelId(key);
}

async function ensureAndroidNotificationChannelsAsync(): Promise<void> {
  if (Platform.OS !== 'android') return;

  for (const config of getNotificationSoundConfigs()) {
    await Notifications.setNotificationChannelAsync(config.androidChannelId, {
      name: `Task reminders (${config.label})`,
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#F59E0B',
      sound: config.soundFileName === 'default' ? undefined : config.soundFileName,
    });
  }
}

async function getNotificationSoundKeyForUserAsync(userId: string): Promise<NotificationSoundKey> {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('notification_sound_key')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.warn('[notifications] failed to resolve notification sound key:', error.message);
      return 'default';
    }

    return normalizeNotificationSoundKey((data as { notification_sound_key?: unknown } | null)?.notification_sound_key);
  } catch (err) {
    console.warn('[notifications] failed to resolve notification sound key:', err);
    return 'default';
  }
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

async function hasGrantedNotificationPermissionAsync(signal?: AbortSignal): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  throwIfAborted(signal);
  const requested = await Notifications.requestPermissionsAsync();
  throwIfAborted(signal);
  return requested.status === 'granted';
}

async function readLocalReminderNotificationMapAsync(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_REMINDER_NOTIFICATION_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const entries: [string, string][] = Object.entries(parsed as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string' && value.length > 0)
      .map(([key, value]) => [key, value as string]);
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

async function readLocalReminderAlarmKitMapAsync(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_REMINDER_ALARMKIT_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const entries: [string, string][] = Object.entries(parsed as Record<string, unknown>)
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

async function writeLocalReminderAlarmKitMapAsync(
  next: Record<string, string>,
): Promise<void> {
  await AsyncStorage.setItem(LOCAL_REMINDER_ALARMKIT_MAP_KEY, JSON.stringify(next));
}

async function readLocalReminderSoundKeyAsync(): Promise<NotificationSoundKey | null> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_REMINDER_SOUND_KEY);
    if (!raw) return null;
    return normalizeNotificationSoundKey(raw);
  } catch {
    return null;
  }
}

async function writeLocalReminderSoundKeyAsync(key: NotificationSoundKey): Promise<void> {
  await AsyncStorage.setItem(LOCAL_REMINDER_SOUND_KEY, key);
}

function createReminderContent(input: {
  taskTitle: string;
  source: string | null;
  notificationSoundKey: NotificationSoundKey;
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
    sound: resolveNotificationSoundName(input.notificationSoundKey),
  };
}

export async function clearLocalReminderNotificationsAsync(): Promise<void> {
  try {
    const map = await readLocalReminderNotificationMapAsync();
    const alarmKitMap = await readLocalReminderAlarmKitMapAsync();
    for (const notificationId of Object.values(map)) {
      try {
        await Notifications.cancelScheduledNotificationAsync(notificationId);
      } catch {
        // Notification may already be delivered or canceled.
      }
    }
    for (const nativeAlarmId of Object.values(alarmKitMap)) {
      try {
        await AlarmKit.cancelTenMinuteAlarmAsync({ nativeAlarmId });
      } catch {
        // Alarm may already be delivered, canceled, or unavailable on this OS.
      }
    }
    await AsyncStorage.removeItem(LOCAL_REMINDER_NOTIFICATION_MAP_KEY);
    await AsyncStorage.removeItem(LOCAL_REMINDER_ALARMKIT_MAP_KEY);
    await AsyncStorage.removeItem(LOCAL_REMINDER_SOUND_KEY);
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

    await ensureAndroidNotificationChannelsAsync();

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

    const { data: profileRow } = await supabase
      .from('profiles')
      .select('alarm_style_notifications_enabled')
      .eq('id', userId)
      .maybeSingle();
    const alarmStyleEnabled = (profileRow as { alarm_style_notifications_enabled?: boolean } | null)
      ?.alarm_style_notifications_enabled ?? false;

    const reminderRows = (reminders as {
      id: string;
      parent_task_id: string;
      reminder_at: string;
      source: string | null;
      notified_at: string | null;
    }[] | null) ?? [];

    const pendingReminderRows = reminderRows.filter((row) => !row.notified_at);
    if (pendingReminderRows.length === 0) {
      await clearLocalReminderNotificationsAsync();
      console.log('[notifications] local reminder sync summary', {
        userId,
        fetchedFutureReminderRows: reminderRows.length,
        fetchedUnsentFutureReminderRows: 0,
        activeTasks: 0,
        scheduledExpo: 0,
        scheduledAlarmKit: 0,
        canceledExpo: 0,
        canceledAlarmKit: 0,
        skippedPast: 0,
        skippedAlarmKit: 0,
        reusedExpo: 0,
        reusedAlarmKit: 0,
      });
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
      ((tasks as { id: string; title: string; status: string }[] | null) ?? [])
        .filter((task) => ACTIVE_TASK_STATUSES.has(task.status))
        .map((task) => [task.id, task]),
    );

    const nowMs = Date.now();

    const validReminders = pendingReminderRows.filter((row) => {
      const reminderAt = new Date(row.reminder_at).getTime();
      return Number.isFinite(reminderAt) && reminderAt > nowMs && tasksById.has(row.parent_task_id);
    });

    const shouldUseIOSAlarmKit = (source: string | null) =>
      alarmStyleEnabled && Platform.OS === 'ios' && source === DEFAULT_DEADLINE_10M_REMINDER_SOURCE;

    const hasIOSAlarmKitCandidate = validReminders.some((row) => shouldUseIOSAlarmKit(row.source));
    const alarmKitAvailable = hasIOSAlarmKitCandidate
      ? await AlarmKit.isAlarmKitAvailableAsync().catch((err) => {
          console.warn('[notifications] failed to check AlarmKit availability:', err);
          return false;
        })
      : false;
    let alarmKitAuthorizationStatus: AlarmKit.AlarmKitAuthorizationStatus = 'unavailable';

    if (alarmKitAvailable) {
      alarmKitAuthorizationStatus = await AlarmKit.getAlarmAuthorizationStatusAsync().catch((err) => {
        console.warn('[notifications] failed to read AlarmKit authorization:', err);
        return 'unavailable' as const;
      });

      if (alarmKitAuthorizationStatus === 'not_determined') {
        alarmKitAuthorizationStatus = await AlarmKit.requestAlarmAuthorizationAsync().catch((err) => {
          console.warn('[notifications] failed to request AlarmKit authorization:', err);
          return 'denied' as const;
        });
      }

      if (alarmKitAuthorizationStatus !== 'authorized') {
        console.warn('[notifications] skipping iOS 26 serious reminders because AlarmKit is not authorized:', {
          userId,
          authorizationStatus: alarmKitAuthorizationStatus,
        });
      }
    }

    const canScheduleAlarmKit = alarmKitAvailable && alarmKitAuthorizationStatus === 'authorized';
    const candidateExpoReminderRows = validReminders.filter((row) => {
      if (!shouldUseIOSAlarmKit(row.source)) return true;
      return !alarmKitAvailable;
    });
    const alarmKitReminderRows = validReminders.filter((row) =>
      shouldUseIOSAlarmKit(row.source) && canScheduleAlarmKit
    );
    const skippedAlarmKitCount = validReminders.filter((row) =>
      shouldUseIOSAlarmKit(row.source) && alarmKitAvailable && !canScheduleAlarmKit
    ).length;

    const canScheduleExpoNotifications = candidateExpoReminderRows.length === 0
      || await hasGrantedNotificationPermissionAsync();
    const expoReminderRows = canScheduleExpoNotifications ? candidateExpoReminderRows : [];

    if (candidateExpoReminderRows.length > 0 && !canScheduleExpoNotifications) {
      console.warn('[notifications] skipping Expo local reminders because notification permission is not granted:', {
        userId,
        expoReminders: candidateExpoReminderRows.length,
      });
    }

    const notificationSoundKey = expoReminderRows.length > 0
      ? await getNotificationSoundKeyForUserAsync(userId)
      : 'default';
    const lastScheduledSoundKey = await readLocalReminderSoundKeyAsync();

    const desiredExpoReminderIds = new Set(expoReminderRows.map((row) => row.id));
    const desiredAlarmKitReminderIds = new Set(alarmKitReminderRows.map((row) => row.id));
    let canceledExpoCount = 0;
    let canceledAlarmKitCount = 0;
    let scheduledExpoCount = 0;
    let scheduledAlarmKitCount = 0;
    let reusedExpoCount = 0;
    let reusedAlarmKitCount = 0;
    let skippedPastCount = 0;
    let persistedExpoMap = await readLocalReminderNotificationMapAsync();
    const persistedAlarmKitMap = await readLocalReminderAlarmKitMapAsync();

    if (
      expoReminderRows.length > 0
      && lastScheduledSoundKey !== null
      && lastScheduledSoundKey !== notificationSoundKey
    ) {
      for (const notificationId of Object.values(persistedExpoMap)) {
        try {
          await Notifications.cancelScheduledNotificationAsync(notificationId);
          canceledExpoCount += 1;
        } catch {
          // Notification may already be delivered or canceled.
        }
      }
      persistedExpoMap = {};
    }
    const nextExpoMap: Record<string, string> = {};
    const nextAlarmKitMap: Record<string, string> = {};

    for (const [reminderId, notificationId] of Object.entries(persistedExpoMap)) {
      if (desiredExpoReminderIds.has(reminderId)) {
        nextExpoMap[reminderId] = notificationId;
        reusedExpoCount += 1;
      } else {
        try {
          await Notifications.cancelScheduledNotificationAsync(notificationId);
          canceledExpoCount += 1;
        } catch {
          // Notification may already be delivered or canceled.
        }
      }
    }

    for (const [reminderId, nativeAlarmId] of Object.entries(persistedAlarmKitMap)) {
      if (desiredAlarmKitReminderIds.has(reminderId)) {
        nextAlarmKitMap[reminderId] = nativeAlarmId;
        reusedAlarmKitCount += 1;
      } else {
        try {
          await AlarmKit.cancelTenMinuteAlarmAsync({ nativeAlarmId });
          canceledAlarmKitCount += 1;
        } catch {
          // Alarm may already be delivered, canceled, or unavailable on this OS.
        }
      }
    }

    for (const reminder of expoReminderRows) {
      if (nextExpoMap[reminder.id]) continue;

      const task = tasksById.get(reminder.parent_task_id);
      if (!task) continue;

      const delayMs = new Date(reminder.reminder_at).getTime() - nowMs;
      if (!Number.isFinite(delayMs) || delayMs <= 0) {
        skippedPastCount += 1;
        continue;
      }

      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          ...createReminderContent({
            taskTitle: task.title,
            source: reminder.source,
            notificationSoundKey,
          }),
          data: {
            kind: 'DEADLINE_REMINDER',
            category: 'DEADLINE_REMINDER',
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
          ...(Platform.OS === 'android'
            ? { channelId: resolveAndroidChannelId(notificationSoundKey) }
            : {}),
        },
      });

      nextExpoMap[reminder.id] = notificationId;
      scheduledExpoCount += 1;
    }

    for (const reminder of alarmKitReminderRows) {
      if (nextAlarmKitMap[reminder.id]) continue;

      const task = tasksById.get(reminder.parent_task_id);
      if (!task) continue;

      const reminderAtMs = new Date(reminder.reminder_at).getTime();
      if (!Number.isFinite(reminderAtMs) || reminderAtMs <= nowMs) {
        skippedPastCount += 1;
        continue;
      }

      try {
        const result = await AlarmKit.scheduleTenMinuteAlarmAsync({
          reminderId: reminder.id,
          taskId: reminder.parent_task_id,
          taskTitle: task.title,
          fireAtISO: reminder.reminder_at,
        });
        nextAlarmKitMap[reminder.id] = result.nativeAlarmId;
        scheduledAlarmKitCount += 1;
      } catch (err) {
        console.warn('[notifications] failed to schedule AlarmKit reminder; skipping serious alarm:', {
          reminderId: reminder.id,
          taskId: reminder.parent_task_id,
          error: err,
        });
      }
    }

    await writeLocalReminderNotificationMapAsync(nextExpoMap);
    await writeLocalReminderAlarmKitMapAsync(nextAlarmKitMap);
    if (expoReminderRows.length > 0) {
      await writeLocalReminderSoundKeyAsync(notificationSoundKey);
    }
    console.log('[notifications] local reminder sync summary', {
      userId,
      fetchedFutureReminderRows: reminderRows.length,
      fetchedUnsentFutureReminderRows: pendingReminderRows.length,
      activeTasks: tasksById.size,
      validFutureReminders: validReminders.length,
      reusedExpo: reusedExpoCount,
      reusedAlarmKit: reusedAlarmKitCount,
      scheduledExpo: scheduledExpoCount,
      scheduledAlarmKit: scheduledAlarmKitCount,
      canceledExpo: canceledExpoCount,
      canceledAlarmKit: canceledAlarmKitCount,
      skippedPast: skippedPastCount,
      skippedAlarmKit: skippedAlarmKitCount,
      alarmKitAvailable,
      alarmKitAuthorizationStatus,
    });
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
export async function registerForPushNotificationsAsync(
  userId: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await ensureAndroidNotificationChannelsAsync();
    throwIfAborted(signal);

    const finalStatus = (await hasGrantedNotificationPermissionAsync(signal)) ? 'granted' : 'denied';
    throwIfAborted(signal);

    if (finalStatus !== 'granted') {
      return;
    }

    const token = await getExpoPushTokenAsync();
    if (!token) return;

    throwIfAborted(signal);

    await supabase
      .from('expo_push_tokens')
      .upsert(
        { user_id: userId, token, updated_at: new Date().toISOString() },
        { onConflict: 'token' },
      );
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return;
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

interface ProofRequestPushInput {
  taskId: string;
  recipientUserId: string;
}

interface ProofRequestPushResult {
  success: boolean;
  error?: string;
  skipped?: boolean;
}

function isMissingRpcFunctionError(message: string): boolean {
  return /could not find the function|function .* does not exist/i.test(message);
}

async function dispatchProofRequestPushViaRpc(input: ProofRequestPushInput): Promise<ProofRequestPushResult> {
  try {
    const { error } = await (supabase.rpc('send_task_proof_requested_push', {
      p_task_id: input.taskId,
      p_recipient_user_id: input.recipientUserId,
    }) as any);

    if (!error) return { success: true };
    if (isMissingRpcFunctionError(error.message ?? '')) {
      return { success: false, error: '__rpc_missing__' };
    }
    return { success: false, error: error.message ?? 'Push dispatch RPC failed.' };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Push dispatch RPC failed.',
    };
  }
}

async function dispatchProofRequestPushViaEdgeFunction(input: ProofRequestPushInput): Promise<ProofRequestPushResult> {
  const functionName = process.env.EXPO_PUBLIC_PROOF_REQUEST_PUSH_FUNCTION?.trim();
  if (!functionName) {
    return { success: false, error: 'Push dispatch is not configured.', skipped: true };
  }

  try {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body: {
        event: 'proof_requested',
        taskId: input.taskId,
        recipientUserId: input.recipientUserId,
      },
    });

    if (error) {
      return { success: false, error: error.message ?? 'Push dispatch function failed.' };
    }

    if (data && typeof data === 'object' && 'success' in (data as Record<string, unknown>)) {
      const payload = data as { success?: unknown; error?: unknown };
      if (payload.success === false) {
        return {
          success: false,
          error: typeof payload.error === 'string' && payload.error.trim().length > 0
            ? payload.error
            : 'Push dispatch function returned an error.',
        };
      }
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Push dispatch function failed.',
    };
  }
}

export async function sendProofRequestedPushNotificationAsync(
  input: ProofRequestPushInput,
): Promise<ProofRequestPushResult> {
  if (!input.taskId || !input.recipientUserId) {
    return { success: false, error: 'Missing taskId or recipient user id.' };
  }

  const rpcResult = await dispatchProofRequestPushViaRpc(input);
  if (rpcResult.success) return rpcResult;
  if (rpcResult.error !== '__rpc_missing__') return rpcResult;

  return dispatchProofRequestPushViaEdgeFunction(input);
}
