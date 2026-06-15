import AsyncStorage from '@react-native-async-storage/async-storage';

let mockPlatformOS = 'ios';
let mockReminders: any[] = [];
let mockTasks: any[] = [];
let mockProfile: any = { notification_sound_key: 'default' };

const mockScheduleNotificationAsync = jest.fn();
const mockCancelScheduledNotificationAsync = jest.fn();
const mockGetPermissionsAsync = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockSetNotificationChannelAsync = jest.fn();
const mockGetExpoPushTokenAsync = jest.fn();
const mockPushTokenUpsert = jest.fn();
const mockPushTokenDelete = jest.fn();
const mockPushTokenDeleteEq = jest.fn();
const mockPushTokenDeleteIs = jest.fn();
const mockResolveUserClientInstanceId = jest.fn();

const mockIsAlarmKitAvailableAsync = jest.fn();
const mockGetAlarmAuthorizationStatusAsync = jest.fn();
const mockRequestAlarmAuthorizationAsync = jest.fn();
const mockScheduleTenMinuteAlarmAsync = jest.fn();
const mockCancelTenMinuteAlarmAsync = jest.fn();

jest.mock('react-native', () => {
  return {
    Platform: {
      get OS() {
        return mockPlatformOS;
      },
    },
  };
});

jest.mock('expo-notifications', () => ({
  AndroidImportance: { MAX: 'MAX' },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: mockSetNotificationChannelAsync,
  getPermissionsAsync: mockGetPermissionsAsync,
  requestPermissionsAsync: mockRequestPermissionsAsync,
  scheduleNotificationAsync: mockScheduleNotificationAsync,
  cancelScheduledNotificationAsync: mockCancelScheduledNotificationAsync,
  getExpoPushTokenAsync: mockGetExpoPushTokenAsync,
}));

jest.mock('expo-constants', () => ({
  expoConfig: { extra: { eas: { projectId: 'test-project' } } },
}));

jest.mock('alarm-kit', () => ({
  isAlarmKitAvailableAsync: mockIsAlarmKitAvailableAsync,
  getAlarmAuthorizationStatusAsync: mockGetAlarmAuthorizationStatusAsync,
  requestAlarmAuthorizationAsync: mockRequestAlarmAuthorizationAsync,
  scheduleTenMinuteAlarmAsync: mockScheduleTenMinuteAlarmAsync,
  cancelTenMinuteAlarmAsync: mockCancelTenMinuteAlarmAsync,
}));

jest.mock('@/lib/user-client-instance', () => ({
  resolveUserClientInstanceId: mockResolveUserClientInstanceId,
}));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => {
      if (table === 'expo_push_tokens') {
        return {
          upsert: mockPushTokenUpsert,
          delete: mockPushTokenDelete,
        };
      }

      if (table === 'profiles') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              maybeSingle: jest.fn(async () => ({ data: mockProfile, error: null })),
            })),
          })),
        };
      }

      if (table === 'task_reminders') {
        return {
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              gt: jest.fn(() => ({
                order: jest.fn(async () => ({ data: mockReminders, error: null })),
              })),
            })),
          })),
        };
      }

      if (table === 'tasks') {
        return {
          select: jest.fn(() => ({
            in: jest.fn(async () => ({ data: mockTasks, error: null })),
          })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  },
}));

const NOTIFICATION_MAP_KEY = 'vouch_local_reminder_notification_ids_v1';
const ALARMKIT_MAP_KEY = 'vouch_local_reminder_alarmkit_ids_v1';

/* eslint-disable-next-line @typescript-eslint/no-require-imports */
const notifications = require('@/lib/notifications') as typeof import('@/lib/notifications');
const { registerForPushNotificationsAsync, syncLocalReminderNotificationsAsync } = notifications;

function futureIso(minutesFromNow: number) {
  return new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString();
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockPlatformOS = 'ios';
  mockProfile = { notification_sound_key: 'default', alarm_style_notifications_enabled: true };
  mockTasks = [{ id: 'task-1', title: 'Pay rent', status: 'ACTIVE' }];
  mockReminders = [{
    id: 'reminder-1',
    parent_task_id: 'task-1',
    reminder_at: futureIso(20),
    source: 'DEFAULT_DEADLINE_10M',
    notified_at: null,
  }];
  mockGetPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockRequestPermissionsAsync.mockResolvedValue({ status: 'granted' });
  mockGetExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[current-token]' });
  mockResolveUserClientInstanceId.mockResolvedValue('client-instance-1');
  mockPushTokenUpsert.mockResolvedValue({ error: null });
  mockPushTokenDeleteIs.mockResolvedValue({ error: null });
  mockPushTokenDeleteEq.mockImplementation(() => ({
    eq: mockPushTokenDeleteEq,
    is: mockPushTokenDeleteIs,
  }));
  mockPushTokenDelete.mockImplementation(() => ({
    eq: mockPushTokenDeleteEq,
  }));
  mockScheduleNotificationAsync.mockResolvedValue('expo-notification-1');
  mockIsAlarmKitAvailableAsync.mockResolvedValue(false);
  mockGetAlarmAuthorizationStatusAsync.mockResolvedValue('unavailable');
  mockRequestAlarmAuthorizationAsync.mockResolvedValue('authorized');
  mockScheduleTenMinuteAlarmAsync.mockResolvedValue({ nativeAlarmId: 'native-alarm-1' });
});

test('schedules iOS 26 DEFAULT_DEADLINE_10M reminders with AlarmKit', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(true);
  mockGetAlarmAuthorizationStatusAsync.mockResolvedValue('authorized');

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockScheduleTenMinuteAlarmAsync).toHaveBeenCalledWith({
    reminderId: 'reminder-1',
    taskId: 'task-1',
    taskTitle: 'Pay rent',
    fireAtISO: mockReminders[0].reminder_at,
  });
  expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(ALARMKIT_MAP_KEY)).toBe(JSON.stringify({ 'reminder-1': 'native-alarm-1' }));
});

test('uses normal local notifications for DEFAULT_DEADLINE_10M when AlarmKit is unavailable', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(false);

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockScheduleTenMinuteAlarmAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(NOTIFICATION_MAP_KEY)).toBe(JSON.stringify({ 'reminder-1': 'expo-notification-1' }));
});

test('skips iOS 26 DEFAULT_DEADLINE_10M reminders when AlarmKit is denied', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(true);
  mockGetAlarmAuthorizationStatusAsync.mockResolvedValue('denied');

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockScheduleTenMinuteAlarmAsync).not.toHaveBeenCalled();
  expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(ALARMKIT_MAP_KEY)).toBe(JSON.stringify({}));
});

test('reuses an existing valid AlarmKit mapping', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(true);
  mockGetAlarmAuthorizationStatusAsync.mockResolvedValue('authorized');
  await AsyncStorage.setItem(ALARMKIT_MAP_KEY, JSON.stringify({ 'reminder-1': 'native-alarm-existing' }));

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockScheduleTenMinuteAlarmAsync).not.toHaveBeenCalled();
  expect(mockCancelTenMinuteAlarmAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(ALARMKIT_MAP_KEY)).toBe(JSON.stringify({ 'reminder-1': 'native-alarm-existing' }));
});

test('cancels stale AlarmKit mappings when reminders are no longer valid', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(true);
  mockGetAlarmAuthorizationStatusAsync.mockResolvedValue('authorized');
  mockTasks = [{ id: 'task-1', title: 'Pay rent', status: 'COMPLETED' }];
  await AsyncStorage.setItem(ALARMKIT_MAP_KEY, JSON.stringify({ 'reminder-1': 'native-alarm-existing' }));

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockCancelTenMinuteAlarmAsync).toHaveBeenCalledWith({ nativeAlarmId: 'native-alarm-existing' });
  expect(mockScheduleTenMinuteAlarmAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(ALARMKIT_MAP_KEY)).toBe(JSON.stringify({}));
});

test('keeps non-10-minute reminders on the Expo notifications path', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(true);
  mockGetAlarmAuthorizationStatusAsync.mockResolvedValue('authorized');
  mockReminders = [{
    id: 'reminder-1',
    parent_task_id: 'task-1',
    reminder_at: futureIso(50),
    source: 'DEFAULT_DEADLINE_1H',
    notified_at: null,
  }];

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockScheduleTenMinuteAlarmAsync).not.toHaveBeenCalled();
});

test('schedules DEFAULT_DEADLINE_DUE reminders as final-call Expo notifications', async () => {
  mockReminders = [{
    id: 'reminder-due',
    parent_task_id: 'task-1',
    reminder_at: futureIso(5),
    source: 'DEFAULT_DEADLINE_DUE',
    notified_at: null,
  }];

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.objectContaining({
      title: 'Final call',
      body: 'Mark "Pay rent" complete now or it will be missed.',
      data: expect.objectContaining({
        kind: 'DEADLINE_FINAL_CALL',
        category: 'DEADLINE_REMINDER',
        reminder_source: 'DEFAULT_DEADLINE_DUE',
      }),
    }),
  }));
  expect(mockScheduleTenMinuteAlarmAsync).not.toHaveBeenCalled();
});

test('skips DEFAULT_DEADLINE_DUE reminders when final call is disabled', async () => {
  mockProfile = {
    notification_sound_key: 'default',
    alarm_style_notifications_enabled: true,
    deadline_due_warning_enabled: false,
  };
  mockReminders = [{
    id: 'reminder-due',
    parent_task_id: 'task-1',
    reminder_at: futureIso(5),
    source: 'DEFAULT_DEADLINE_DUE',
    notified_at: null,
  }];

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  expect(mockScheduleTenMinuteAlarmAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(NOTIFICATION_MAP_KEY)).toBe(JSON.stringify({}));
});

test('registers push tokens against the current user client instance', async () => {
  await registerForPushNotificationsAsync('user-1');

  expect(mockResolveUserClientInstanceId).toHaveBeenCalledWith('user-1');
  expect(mockPushTokenUpsert).toHaveBeenCalledWith(
    {
      user_id: 'user-1',
      user_client_instance_id: 'client-instance-1',
      token: 'ExponentPushToken[current-token]',
      updated_at: expect.any(String),
    },
    { onConflict: 'user_id,user_client_instance_id' },
  );
  expect(mockPushTokenDelete).toHaveBeenCalledTimes(1);
  expect(mockPushTokenDeleteEq).toHaveBeenCalledWith('user_id', 'user-1');
  expect(mockPushTokenDeleteIs).toHaveBeenCalledWith('user_client_instance_id', null);
});
