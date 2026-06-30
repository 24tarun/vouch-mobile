import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AlarmKit from 'alarm-kit';
import * as TaskManager from 'expo-task-manager';
import { supabase } from './supabase';
import { resolveUserClientInstanceId } from './user-client-instance';
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
const LOCAL_REMINDER_FINGERPRINT_MAP_KEY = 'vouch_local_reminder_fingerprints_v1';
const LOCAL_REMINDER_SOUND_KEY = 'vouch_local_reminder_sound_key_v1';
const REMOTE_REMINDER_DELIVERY_ACK_KEY = 'vouch_remote_reminder_delivery_acks_v1';
const REMOTE_PUSH_REGISTERED_USER_KEY = 'vouch_remote_push_registered_user_v1';
const ACTIVE_TASK_STATUSES = new Set(['ACTIVE', 'POSTPONED']);
const DEFAULT_DEADLINE_10M_REMINDER_SOURCE = 'DEFAULT_DEADLINE_10M';
const DEFAULT_DEADLINE_DUE_REMINDER_SOURCE = 'DEFAULT_DEADLINE_DUE';
const LOCAL_REMINDER_BACKUP_DELAY_MS = 30 * 1000;
const REMOTE_REMINDER_ACK_TTL_MS = 24 * 60 * 60 * 1000;
const REMOTE_REMINDER_DELIVERY_TASK = 'vouch-remote-reminder-delivery';

type ReminderRow = {
  id: string;
  parent_task_id: string;
  reminder_at: string;
  source: string | null;
  notified_at: string | null;
};

type ActiveTaskRow = { id: string; title: string; status: string };

type ReminderGroup = {
  key: string;
  source: string | null;
  reminderAtMinute: string;
  reminders: ReminderRow[];
};

type ReminderDeliveryAckMap = Record<string, number>;

type ReminderFingerprintMap = Record<string, string>;

function findStringValueDeep(input: unknown, key: string, depth = 0): string | null {
  if (!input || typeof input !== 'object' || depth > 5) return null;
  const record = input as Record<string, unknown>;
  const direct = record[key];
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct;
  }

  for (const value of Object.values(record)) {
    const found = findStringValueDeep(value, key, depth + 1);
    if (found) return found;
  }

  return null;
}

function findStringArrayValueDeep(input: unknown, key: string, depth = 0): string[] {
  if (!input || typeof input !== 'object' || depth > 5) return [];
  const record = input as Record<string, unknown>;
  const direct = record[key];
  if (Array.isArray(direct)) {
    return direct.filter((value): value is string => (
      typeof value === 'string' && value.trim().length > 0
    ));
  }

  for (const value of Object.values(record)) {
    const found = findStringArrayValueDeep(value, key, depth + 1);
    if (found.length > 0) return found;
  }

  return [];
}

function hasBooleanValueDeep(input: unknown, key: string, expected: boolean, depth = 0): boolean {
  if (!input || typeof input !== 'object' || depth > 5) return false;
  const record = input as Record<string, unknown>;
  if (record[key] === expected) return true;

  return Object.values(record).some((value) => hasBooleanValueDeep(value, key, expected, depth + 1));
}

function getLocalBackupKeyFromData(data: unknown): string | null {
  return findStringValueDeep(data, 'localBackupKey');
}

function getReminderIdsFromData(data: unknown): string[] {
  return findStringArrayValueDeep(data, 'reminderIds');
}

function isLocalReminderBackupData(data: unknown): boolean {
  return hasBooleanValueDeep(data, 'local_schedule', true);
}

function isReminderRemoteDeliveryData(data: unknown): boolean {
  const localBackupKey = getLocalBackupKeyFromData(data);
  if (!localBackupKey || isLocalReminderBackupData(data)) return false;

  const kind = findStringValueDeep(data, 'kind');
  const category = findStringValueDeep(data, 'category');
  return kind === 'TASK_REMINDER_REMOTE_DELIVERED' || category === 'DEADLINE_REMINDER';
}

if (!TaskManager.isTaskDefined(REMOTE_REMINDER_DELIVERY_TASK)) {
  TaskManager.defineTask(REMOTE_REMINDER_DELIVERY_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[notifications] remote reminder delivery task failed:', error);
      return;
    }

    await recordRemoteReminderDeliveryAsync(data);
  });
}

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
    if (await shouldSuppressLocalReminderBackupAsync(data)) {
      return {
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    }

    await recordRemoteReminderDeliveryAsync(data);

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

function isPushTokenClientInstanceSchemaError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? '';
  return error.code === '42703'
    || error.code === '42P10'
    || /user_client_instance_id|expo_push_tokens_user_client_instance_unique|schema cache/i.test(message);
}

function isPushTokenUniqueConflict(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return error.code === '23505' || /duplicate key value violates unique constraint/i.test(error.message ?? '');
}

async function upsertLegacyPushTokenAsync(
  userId: string,
  token: string,
  updatedAt: string,
): Promise<boolean> {
  const { error } = await supabase
    .from('expo_push_tokens')
    .upsert(
      { user_id: userId, token, updated_at: updatedAt },
      { onConflict: 'token' },
    );

  if (error) {
    console.warn('[notifications] registration failed:', error.message);
    return false;
  }
  return true;
}

async function hasRemotePushRegistrationAsync(userId: string): Promise<boolean> {
  try {
    return await AsyncStorage.getItem(REMOTE_PUSH_REGISTERED_USER_KEY) === userId;
  } catch {
    return false;
  }
}

async function markRemotePushRegisteredAsync(userId: string): Promise<void> {
  await AsyncStorage.setItem(REMOTE_PUSH_REGISTERED_USER_KEY, userId);
  // Remote delivery is the primary channel. Remove any local backups that may
  // have been scheduled while registration was still in flight.
  await clearLocalReminderNotificationsAsync();
}

async function upsertClientInstancePushTokenAsync(input: {
  userId: string;
  token: string;
  userClientInstanceId: string;
  updatedAt: string;
}): Promise<boolean> {
  const row = {
    user_id: input.userId,
    user_client_instance_id: input.userClientInstanceId,
    token: input.token,
    updated_at: input.updatedAt,
  };

  const { error } = await supabase
    .from('expo_push_tokens')
    .upsert(row, { onConflict: 'user_id,user_client_instance_id' });

  if (!error) {
    await supabase
      .from('expo_push_tokens')
      .delete()
      .eq('user_id', input.userId)
      .is('user_client_instance_id', null);
    return true;
  }

  if (isPushTokenUniqueConflict(error)) {
    await supabase
      .from('expo_push_tokens')
      .delete()
      .eq('user_id', input.userId)
      .eq('token', input.token);

    const { error: retryError } = await supabase
      .from('expo_push_tokens')
      .upsert(row, { onConflict: 'user_id,user_client_instance_id' });

    if (!retryError) {
      await supabase
        .from('expo_push_tokens')
        .delete()
        .eq('user_id', input.userId)
        .is('user_client_instance_id', null);
      return true;
    }

    if (isPushTokenClientInstanceSchemaError(retryError)) return false;
    console.warn('[notifications] registration failed:', retryError.message);
    return false;
  }

  if (isPushTokenClientInstanceSchemaError(error)) return false;

  console.warn('[notifications] registration failed:', error.message);
  return false;
}

export function getTaskIdFromNotificationResponse(
  response: Notifications.NotificationResponse | null | undefined,
): string | null {
  const taskId = response?.notification.request.content.data?.task_id;
  return typeof taskId === 'string' && taskId.trim().length > 0 ? taskId : null;
}

export function getUrlFromNotificationResponse(
  response: Notifications.NotificationResponse | null | undefined,
): string | null {
  const url = response?.notification.request.content.data?.url;
  return typeof url === 'string' && url.trim().length > 0 ? url : null;
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

async function readLocalReminderFingerprintMapAsync(): Promise<ReminderFingerprintMap> {
  try {
    const raw = await AsyncStorage.getItem(LOCAL_REMINDER_FINGERPRINT_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'string' && value.length > 0),
    ) as ReminderFingerprintMap;
  } catch {
    return {};
  }
}

async function writeLocalReminderFingerprintMapAsync(next: ReminderFingerprintMap): Promise<void> {
  await AsyncStorage.setItem(LOCAL_REMINDER_FINGERPRINT_MAP_KEY, JSON.stringify(next));
}

async function readRemoteReminderDeliveryAcksAsync(nowMs = Date.now()): Promise<ReminderDeliveryAckMap> {
  try {
    const raw = await AsyncStorage.getItem(REMOTE_REMINDER_DELIVERY_ACK_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};

    const entries = Object.entries(parsed as Record<string, unknown>)
      .filter(([key, value]) => (
        key.length > 0
        && typeof value === 'number'
        && Number.isFinite(value)
        && nowMs - value <= REMOTE_REMINDER_ACK_TTL_MS
      )) as [string, number][];

    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

async function writeRemoteReminderDeliveryAcksAsync(next: ReminderDeliveryAckMap): Promise<void> {
  await AsyncStorage.setItem(REMOTE_REMINDER_DELIVERY_ACK_KEY, JSON.stringify(next));
}

async function cancelAndDismissExpoNotificationAsync(notificationId: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // Notification may already be delivered or canceled.
  }
  try {
    await Notifications.dismissNotificationAsync(notificationId);
  } catch {
    // Notification may not be currently presented.
  }
}

async function cancelLocalReminderBackupsAsync(localBackupKeys: string[]): Promise<boolean> {
  const keys = Array.from(new Set(localBackupKeys.map((key) => key.trim()).filter(Boolean)));
  if (keys.length === 0) return false;

  const [expoMap, alarmKitMap, fingerprintMap] = await Promise.all([
    readLocalReminderNotificationMapAsync(),
    readLocalReminderAlarmKitMapAsync(),
    readLocalReminderFingerprintMapAsync(),
  ]);
  let canceled = false;

  for (const key of keys) {
    const notificationId = expoMap[key];
    if (notificationId) {
      await cancelAndDismissExpoNotificationAsync(notificationId);
      delete expoMap[key];
      canceled = true;
    }

    const nativeAlarmId = alarmKitMap[key];
    if (nativeAlarmId) {
      try {
        await AlarmKit.cancelTenMinuteAlarmAsync({ nativeAlarmId });
      } catch {
        // Alarm may already be delivered, canceled, or unavailable on this OS.
      }
      delete alarmKitMap[key];
      canceled = true;
    }

    delete fingerprintMap[key];
  }

  await Promise.all([
    writeLocalReminderNotificationMapAsync(expoMap),
    writeLocalReminderAlarmKitMapAsync(alarmKitMap),
    writeLocalReminderFingerprintMapAsync(fingerprintMap),
  ]);
  return canceled;
}

export async function cancelLocalReminderBackupAsync(localBackupKey: string): Promise<boolean> {
  return cancelLocalReminderBackupsAsync([localBackupKey]);
}

export async function recordRemoteReminderDeliveryAsync(data: unknown): Promise<boolean> {
  if (!isReminderRemoteDeliveryData(data)) return false;

  const localBackupKey = getLocalBackupKeyFromData(data);
  if (!localBackupKey) return false;

  const backupKeys = Array.from(new Set([
    localBackupKey,
    ...getReminderIdsFromData(data),
  ]));
  const nowMs = Date.now();
  const ackMap = await readRemoteReminderDeliveryAcksAsync(nowMs);
  for (const backupKey of backupKeys) {
    ackMap[backupKey] = nowMs;
  }
  await writeRemoteReminderDeliveryAcksAsync(ackMap);
  await cancelLocalReminderBackupsAsync(backupKeys);
  return true;
}

export async function shouldSuppressLocalReminderBackupAsync(data: unknown): Promise<boolean> {
  if (!isLocalReminderBackupData(data)) return false;

  const localBackupKey = getLocalBackupKeyFromData(data);
  if (!localBackupKey) return false;

  const ackMap = await readRemoteReminderDeliveryAcksAsync();
  return Boolean(ackMap[localBackupKey]);
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
  if (source === DEFAULT_DEADLINE_DUE_REMINDER_SOURCE) {
    return {
      title: 'Final call',
      body: `Mark "${input.taskTitle}" complete now or it will be missed.`,
      sound: resolveNotificationSoundName(input.notificationSoundKey),
    };
  }

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

function createAggregateReminderContent(input: {
  count: number;
  source: string | null;
  notificationSoundKey: NotificationSoundKey;
}): Notifications.NotificationContentInput {
  const isDue = input.source === DEFAULT_DEADLINE_DUE_REMINDER_SOURCE;

  return {
    title: isDue ? 'Final call' : 'Task reminders',
    body: isDue
      ? `Last call for ${input.count} tasks.`
      : `${input.count} tasks need attention.`,
    sound: resolveNotificationSoundName(input.notificationSoundKey),
  };
}

function getReminderAtMinuteKey(reminderAt: string): string {
  const reminderDate = new Date(reminderAt);
  const reminderMs = reminderDate.getTime();
  if (!Number.isFinite(reminderMs)) return reminderAt;

  reminderDate.setUTCSeconds(0, 0);
  return reminderDate.toISOString();
}

function getReminderGroupKey(source: string | null, reminderAtMinute: string): string {
  return `aggregate|${source ?? 'MANUAL'}|${reminderAtMinute}`;
}

function getReminderScheduleKey(group: ReminderGroup): string {
  return group.reminders.length === 1
    ? group.reminders[0].id
    : group.key;
}

function getReminderGroupFingerprint(group: ReminderGroup): string {
  return JSON.stringify({
    source: group.source ?? 'MANUAL',
    reminders: group.reminders
      .map((reminder) => ({
        id: reminder.id,
        taskId: reminder.parent_task_id,
        reminderAt: reminder.reminder_at,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

function groupReminderRows(reminders: ReminderRow[]): ReminderGroup[] {
  const groupsByKey = new Map<string, ReminderGroup>();

  for (const reminder of reminders) {
    const reminderAtMinute = getReminderAtMinuteKey(reminder.reminder_at);
    const key = getReminderGroupKey(reminder.source, reminderAtMinute);
    const existingGroup = groupsByKey.get(key);
    if (existingGroup) {
      existingGroup.reminders.push(reminder);
      continue;
    }

    groupsByKey.set(key, {
      key,
      source: reminder.source,
      reminderAtMinute,
      reminders: [reminder],
    });
  }

  return Array.from(groupsByKey.values());
}

function getReminderGroupFireAtMs(group: ReminderGroup): number {
  return group.reminders.reduce((earliest, reminder) => {
    const reminderAtMs = new Date(reminder.reminder_at).getTime();
    if (!Number.isFinite(reminderAtMs)) return earliest;
    return Math.min(earliest, reminderAtMs);
  }, Number.POSITIVE_INFINITY);
}

function getAggregateReminderData(group: ReminderGroup, tasksById: Map<string, ActiveTaskRow>) {
  const taskIds = group.reminders
    .map((reminder) => tasksById.get(reminder.parent_task_id)?.id)
    .filter((taskId): taskId is string => Boolean(taskId));

  return {
    aggregate: true,
    localBackupKey: getReminderScheduleKey(group),
    kind: group.source === DEFAULT_DEADLINE_DUE_REMINDER_SOURCE
      ? 'DEADLINE_FINAL_CALL'
      : 'DEADLINE_REMINDER',
    category: 'DEADLINE_REMINDER',
    taskIds,
    reminderIds: group.reminders.map((reminder) => reminder.id),
    count: group.reminders.length,
    reminder_source: group.source ?? 'MANUAL',
    source: group.source ?? 'MANUAL',
    reminder_at: group.reminderAtMinute,
    reminderAt: group.reminderAtMinute,
    url: '/tasks',
    local_schedule: true,
  };
}

export async function clearLocalReminderNotificationsAsync(): Promise<void> {
  try {
    const map = await readLocalReminderNotificationMapAsync();
    const alarmKitMap = await readLocalReminderAlarmKitMapAsync();
    for (const notificationId of Object.values(map)) {
      await cancelAndDismissExpoNotificationAsync(notificationId);
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
    await AsyncStorage.removeItem(LOCAL_REMINDER_FINGERPRINT_MAP_KEY);
    await AsyncStorage.removeItem(LOCAL_REMINDER_SOUND_KEY);
    await AsyncStorage.removeItem(REMOTE_REMINDER_DELIVERY_ACK_KEY);
  } catch (err) {
    console.warn('[notifications] failed to clear local reminders:', err);
  }
}

export async function registerRemoteReminderDeliveryTaskAsync(): Promise<void> {
  try {
    const alreadyRegistered = await TaskManager.isTaskRegisteredAsync(REMOTE_REMINDER_DELIVERY_TASK);
    if (alreadyRegistered) return;
    await Notifications.registerTaskAsync(REMOTE_REMINDER_DELIVERY_TASK);
  } catch (err) {
    console.warn('[notifications] failed to register remote reminder delivery task:', err);
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

    // Scheduling both channels cannot be made duplicate-proof on iOS because
    // background delivery markers are best-effort while the app is suspended.
    // A registered device therefore uses remote push only; local copy remains
    // a fallback for devices where remote registration is unavailable.
    if (await hasRemotePushRegistrationAsync(userId)) {
      await clearLocalReminderNotificationsAsync();
      return;
    }

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
      .select('alarm_style_notifications_enabled, deadline_due_warning_enabled')
      .eq('id', userId)
      .maybeSingle();
    const alarmStyleEnabled = (profileRow as {
      alarm_style_notifications_enabled?: boolean;
      deadline_due_warning_enabled?: boolean;
    } | null)
      ?.alarm_style_notifications_enabled ?? false;
    const deadlineDueWarningEnabled = (profileRow as {
      alarm_style_notifications_enabled?: boolean;
      deadline_due_warning_enabled?: boolean;
    } | null)
      ?.deadline_due_warning_enabled ?? true;

    const reminderRows = (reminders as ReminderRow[] | null) ?? [];

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

    const tasksById = new Map<string, ActiveTaskRow>(
      ((tasks as ActiveTaskRow[] | null) ?? [])
        .filter((task) => ACTIVE_TASK_STATUSES.has(task.status))
        .map((task) => [task.id, task]),
    );

    const nowMs = Date.now();

    const validReminders = pendingReminderRows.filter((row) => {
      if (row.source === DEFAULT_DEADLINE_DUE_REMINDER_SOURCE && !deadlineDueWarningEnabled) return false;
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

    const remoteDeliveryAcks = await readRemoteReminderDeliveryAcksAsync(nowMs);
    const isUnacknowledgedGroup = (group: ReminderGroup) => !remoteDeliveryAcks[getReminderScheduleKey(group)];
    const expoReminderGroups = groupReminderRows(expoReminderRows).filter(isUnacknowledgedGroup);
    const alarmKitReminderGroups = groupReminderRows(alarmKitReminderRows).filter(isUnacknowledgedGroup);
    const desiredExpoScheduleKeys = new Set(expoReminderGroups.map(getReminderScheduleKey));
    const desiredAlarmKitScheduleKeys = new Set(alarmKitReminderGroups.map(getReminderScheduleKey));
    const desiredFingerprints = new Map(
      [...expoReminderGroups, ...alarmKitReminderGroups]
        .map((group) => [getReminderScheduleKey(group), getReminderGroupFingerprint(group)]),
    );
    let canceledExpoCount = 0;
    let canceledAlarmKitCount = 0;
    let scheduledExpoCount = 0;
    let scheduledAlarmKitCount = 0;
    let reusedExpoCount = 0;
    let reusedAlarmKitCount = 0;
    let skippedPastCount = 0;
    let persistedExpoMap = await readLocalReminderNotificationMapAsync();
    const persistedAlarmKitMap = await readLocalReminderAlarmKitMapAsync();
    const persistedFingerprintMap = await readLocalReminderFingerprintMapAsync();

    if (
      expoReminderRows.length > 0
      && lastScheduledSoundKey !== null
      && lastScheduledSoundKey !== notificationSoundKey
    ) {
      for (const notificationId of Object.values(persistedExpoMap)) {
        await cancelAndDismissExpoNotificationAsync(notificationId);
        canceledExpoCount += 1;
      }
      persistedExpoMap = {};
    }
    const nextExpoMap: Record<string, string> = {};
    const nextAlarmKitMap: Record<string, string> = {};
    const nextFingerprintMap: ReminderFingerprintMap = {};

    for (const [scheduleKey, notificationId] of Object.entries(persistedExpoMap)) {
      const desiredFingerprint = desiredFingerprints.get(scheduleKey);
      if (
        desiredExpoScheduleKeys.has(scheduleKey)
        && desiredFingerprint !== undefined
        && persistedFingerprintMap[scheduleKey] === desiredFingerprint
      ) {
        nextExpoMap[scheduleKey] = notificationId;
        nextFingerprintMap[scheduleKey] = desiredFingerprint;
        reusedExpoCount += 1;
      } else {
        await cancelAndDismissExpoNotificationAsync(notificationId);
        canceledExpoCount += 1;
      }
    }

    for (const [scheduleKey, nativeAlarmId] of Object.entries(persistedAlarmKitMap)) {
      const desiredFingerprint = desiredFingerprints.get(scheduleKey);
      if (
        desiredAlarmKitScheduleKeys.has(scheduleKey)
        && desiredFingerprint !== undefined
        && persistedFingerprintMap[scheduleKey] === desiredFingerprint
      ) {
        nextAlarmKitMap[scheduleKey] = nativeAlarmId;
        nextFingerprintMap[scheduleKey] = desiredFingerprint;
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

    for (const group of expoReminderGroups) {
      const scheduleKey = getReminderScheduleKey(group);
      if (nextExpoMap[scheduleKey]) continue;

      const delayMs = getReminderGroupFireAtMs(group) + LOCAL_REMINDER_BACKUP_DELAY_MS - nowMs;
      if (!Number.isFinite(delayMs) || delayMs <= 0) {
        skippedPastCount += 1;
        continue;
      }

      const isAggregate = group.reminders.length > 1;
      const reminder = group.reminders[0];
      const task = tasksById.get(reminder.parent_task_id);
      if (!isAggregate && !task) continue;

      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          ...(isAggregate
            ? createAggregateReminderContent({
                count: group.reminders.length,
                source: group.source,
                notificationSoundKey,
              })
            : createReminderContent({
                taskTitle: task?.title ?? '',
                source: reminder.source,
                notificationSoundKey,
              })),
          data: isAggregate
            ? getAggregateReminderData(group, tasksById)
            : {
                kind: reminder.source === DEFAULT_DEADLINE_DUE_REMINDER_SOURCE
                  ? 'DEADLINE_FINAL_CALL'
                  : 'DEADLINE_REMINDER',
                category: 'DEADLINE_REMINDER',
                localBackupKey: scheduleKey,
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

      nextExpoMap[scheduleKey] = notificationId;
      nextFingerprintMap[scheduleKey] = getReminderGroupFingerprint(group);
      scheduledExpoCount += 1;
    }

    for (const group of alarmKitReminderGroups) {
      const scheduleKey = getReminderScheduleKey(group);
      if (nextAlarmKitMap[scheduleKey]) continue;

      const reminderAtMs = getReminderGroupFireAtMs(group) + LOCAL_REMINDER_BACKUP_DELAY_MS;
      if (!Number.isFinite(reminderAtMs) || reminderAtMs <= nowMs) {
        skippedPastCount += 1;
        continue;
      }

      const isAggregate = group.reminders.length > 1;
      const reminder = group.reminders[0];
      const task = tasksById.get(reminder.parent_task_id);
      if (!isAggregate && !task) continue;

      try {
        const result = await AlarmKit.scheduleTenMinuteAlarmAsync({
          reminderId: isAggregate ? scheduleKey : reminder.id,
          taskId: isAggregate ? '' : reminder.parent_task_id,
          taskTitle: isAggregate ? `${group.reminders.length} tasks need attention` : task?.title ?? '',
          fireAtISO: new Date(reminderAtMs).toISOString(),
          aggregate: isAggregate,
          taskCount: group.reminders.length,
        });
        nextAlarmKitMap[scheduleKey] = result.nativeAlarmId;
        nextFingerprintMap[scheduleKey] = getReminderGroupFingerprint(group);
        scheduledAlarmKitCount += 1;
      } catch (err) {
        console.warn('[notifications] failed to schedule AlarmKit reminder; skipping serious alarm:', {
          scheduleKey,
          reminderIds: group.reminders.map((row) => row.id),
          error: err,
        });
      }
    }

    await writeLocalReminderNotificationMapAsync(nextExpoMap);
    await writeLocalReminderAlarmKitMapAsync(nextAlarmKitMap);
    await writeLocalReminderFingerprintMapAsync(nextFingerprintMap);
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

    const updatedAt = new Date().toISOString();
    const userClientInstanceId = await resolveUserClientInstanceId(userId);

    if (userClientInstanceId) {
      const handled = await upsertClientInstancePushTokenAsync({
        userId,
        token,
        userClientInstanceId,
        updatedAt,
      });
      if (handled) {
        await markRemotePushRegisteredAsync(userId);
        return;
      }
    }

    if (await upsertLegacyPushTokenAsync(userId, token, updatedAt)) {
      await markRemotePushRegisteredAsync(userId);
    }
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
      return;
    }
    await AsyncStorage.removeItem(REMOTE_PUSH_REGISTERED_USER_KEY);
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
