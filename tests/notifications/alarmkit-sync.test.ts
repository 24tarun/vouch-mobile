import AsyncStorage from '@react-native-async-storage/async-storage';

let mockPlatformOS = 'ios';
let mockReminders: any[] = [];
let mockTasks: any[] = [];
let mockProfile: any = { notification_sound_key: 'default' };

const mockScheduleNotificationAsync = jest.fn();
const mockCancelScheduledNotificationAsync = jest.fn();
const mockDismissNotificationAsync = jest.fn();
const mockGetPermissionsAsync = jest.fn();
const mockRequestPermissionsAsync = jest.fn();
const mockSetNotificationChannelAsync = jest.fn();
const mockGetExpoPushTokenAsync = jest.fn();
const mockRegisterTaskAsync = jest.fn();
const mockDefineTask = jest.fn();
const mockIsTaskDefined = jest.fn();
const mockIsTaskRegisteredAsync = jest.fn();
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
  dismissNotificationAsync: mockDismissNotificationAsync,
  getExpoPushTokenAsync: mockGetExpoPushTokenAsync,
  registerTaskAsync: mockRegisterTaskAsync,
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

jest.mock('expo-task-manager', () => ({
  defineTask: mockDefineTask,
  isTaskDefined: mockIsTaskDefined,
  isTaskRegisteredAsync: mockIsTaskRegisteredAsync,
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
const REMOTE_ACK_KEY = 'vouch_remote_reminder_delivery_acks_v1';

/* eslint-disable-next-line @typescript-eslint/no-require-imports */
const notifications = require('@/lib/notifications') as typeof import('@/lib/notifications');
const {
  getUrlFromNotificationResponse,
  recordRemoteReminderDeliveryAsync,
  registerRemoteReminderDeliveryTaskAsync,
  registerForPushNotificationsAsync,
  shouldSuppressLocalReminderBackupAsync,
  syncLocalReminderNotificationsAsync,
} = notifications;

function futureIso(minutesFromNow: number) {
  return new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString();
}

function reminderMinuteKey(reminderAt: string) {
  const date = new Date(reminderAt);
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

function plusBackupDelayIso(reminderAt: string) {
  return new Date(new Date(reminderAt).getTime() + 5 * 1000).toISOString();
}

function expectScheduledAtBackupDelay(reminderAt: string) {
  const scheduledCall = mockScheduleNotificationAsync.mock.calls[0]?.[0];
  const seconds = scheduledCall?.trigger?.seconds;
  expect(typeof seconds).toBe('number');

  const expectedDelaySeconds = Math.floor((new Date(reminderAt).getTime() + 5 * 1000 - Date.now()) / 1000);
  expect(seconds).toBeGreaterThanOrEqual(expectedDelaySeconds - 1);
  expect(seconds).toBeLessThanOrEqual(expectedDelaySeconds + 1);
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
  mockDismissNotificationAsync.mockResolvedValue(undefined);
  mockRegisterTaskAsync.mockResolvedValue(null);
  mockIsTaskDefined.mockReturnValue(false);
  mockIsTaskRegisteredAsync.mockResolvedValue(false);
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
    fireAtISO: plusBackupDelayIso(mockReminders[0].reminder_at),
    aggregate: false,
    taskCount: 1,
  });
  expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(ALARMKIT_MAP_KEY)).toBe(JSON.stringify({ 'reminder-1': 'native-alarm-1' }));
});

test('uses normal local notifications for DEFAULT_DEADLINE_10M when AlarmKit is unavailable', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(false);

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockScheduleTenMinuteAlarmAsync).not.toHaveBeenCalled();
  expectScheduledAtBackupDelay(mockReminders[0].reminder_at);
  expect(await AsyncStorage.getItem(NOTIFICATION_MAP_KEY)).toBe(JSON.stringify({ 'reminder-1': 'expo-notification-1' }));
});

test('aggregates same-minute Expo local reminders', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(false);
  const reminderAt = futureIso(20);
  mockTasks = [
    { id: 'task-1', title: 'Pay rent', status: 'ACTIVE' },
    { id: 'task-2', title: 'Clean kitchen', status: 'ACTIVE' },
  ];
  mockReminders = [
    {
      id: 'reminder-1',
      parent_task_id: 'task-1',
      reminder_at: reminderAt,
      source: 'DEFAULT_DEADLINE_1H',
      notified_at: null,
    },
    {
      id: 'reminder-2',
      parent_task_id: 'task-2',
      reminder_at: reminderAt,
      source: 'DEFAULT_DEADLINE_1H',
      notified_at: null,
    },
  ];

  await syncLocalReminderNotificationsAsync('user-1');

  const aggregateKey = `aggregate|DEFAULT_DEADLINE_1H|${reminderMinuteKey(reminderAt)}`;
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.objectContaining({
      title: 'Task reminders',
      body: '2 tasks need attention.',
      data: expect.objectContaining({
        aggregate: true,
        taskIds: ['task-1', 'task-2'],
        reminderIds: ['reminder-1', 'reminder-2'],
        count: 2,
        localBackupKey: aggregateKey,
        reminder_source: 'DEFAULT_DEADLINE_1H',
        url: '/tasks',
      }),
    }),
  }));
  expect(await AsyncStorage.getItem(NOTIFICATION_MAP_KEY)).toBe(JSON.stringify({ [aggregateKey]: 'expo-notification-1' }));
});

test('aggregates DEFAULT_DEADLINE_DUE local reminders with final-call copy', async () => {
  const reminderAt = futureIso(5);
  mockTasks = [
    { id: 'task-1', title: 'Pay rent', status: 'ACTIVE' },
    { id: 'task-2', title: 'Clean kitchen', status: 'ACTIVE' },
  ];
  mockReminders = [
    {
      id: 'reminder-due-1',
      parent_task_id: 'task-1',
      reminder_at: reminderAt,
      source: 'DEFAULT_DEADLINE_DUE',
      notified_at: null,
    },
    {
      id: 'reminder-due-2',
      parent_task_id: 'task-2',
      reminder_at: reminderAt,
      source: 'DEFAULT_DEADLINE_DUE',
      notified_at: null,
    },
  ];

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.objectContaining({
      title: 'Final call',
      body: 'Last call for 2 tasks.',
      data: expect.objectContaining({
        aggregate: true,
        kind: 'DEADLINE_FINAL_CALL',
        localBackupKey: `aggregate|DEFAULT_DEADLINE_DUE|${reminderMinuteKey(reminderAt)}`,
        url: '/tasks',
      }),
    }),
  }));
});

test('schedules one individual final call when the other same-minute task is inactive', async () => {
  const reminderAt = futureIso(5);
  mockTasks = [
    { id: 'task-1', title: 'Pay rent', status: 'ACTIVE' },
    { id: 'task-2', title: 'Clean kitchen', status: 'AWAITING_VOUCHER' },
  ];
  mockReminders = [
    {
      id: 'reminder-due-1',
      parent_task_id: 'task-1',
      reminder_at: reminderAt,
      source: 'DEFAULT_DEADLINE_DUE',
      notified_at: null,
    },
    {
      id: 'reminder-due-2',
      parent_task_id: 'task-2',
      reminder_at: reminderAt,
      source: 'DEFAULT_DEADLINE_DUE',
      notified_at: null,
    },
  ];

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.objectContaining({
      title: 'Final call',
      body: 'Mark "Pay rent" complete now or it will be missed.',
      data: expect.objectContaining({
        localBackupKey: 'reminder-due-1',
        task_id: 'task-1',
        reminder_id: 'reminder-due-1',
      }),
    }),
  }));
  expect(await AsyncStorage.getItem(NOTIFICATION_MAP_KEY)).toBe(JSON.stringify({
    'reminder-due-1': 'expo-notification-1',
  }));
});

test('aggregates manual local reminders when simultaneous', async () => {
  const reminderAt = futureIso(15);
  mockTasks = [
    { id: 'task-1', title: 'Pay rent', status: 'ACTIVE' },
    { id: 'task-2', title: 'Clean kitchen', status: 'ACTIVE' },
  ];
  mockReminders = [
    {
      id: 'manual-1',
      parent_task_id: 'task-1',
      reminder_at: reminderAt,
      source: 'MANUAL',
      notified_at: null,
    },
    {
      id: 'manual-2',
      parent_task_id: 'task-2',
      reminder_at: reminderAt,
      source: 'MANUAL',
      notified_at: null,
    },
  ];

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockScheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
    content: expect.objectContaining({
      title: 'Task reminders',
      body: '2 tasks need attention.',
      data: expect.objectContaining({
        aggregate: true,
        localBackupKey: `aggregate|MANUAL|${reminderMinuteKey(reminderAt)}`,
        reminder_source: 'MANUAL',
        url: '/tasks',
      }),
    }),
  }));
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

test('aggregates same-minute iOS 26 AlarmKit reminders', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(true);
  mockGetAlarmAuthorizationStatusAsync.mockResolvedValue('authorized');
  const reminderAt = futureIso(20);
  mockTasks = [
    { id: 'task-1', title: 'Pay rent', status: 'ACTIVE' },
    { id: 'task-2', title: 'Clean kitchen', status: 'ACTIVE' },
  ];
  mockReminders = [
    {
      id: 'reminder-1',
      parent_task_id: 'task-1',
      reminder_at: reminderAt,
      source: 'DEFAULT_DEADLINE_10M',
      notified_at: null,
    },
    {
      id: 'reminder-2',
      parent_task_id: 'task-2',
      reminder_at: reminderAt,
      source: 'DEFAULT_DEADLINE_10M',
      notified_at: null,
    },
  ];

  await syncLocalReminderNotificationsAsync('user-1');

  const aggregateKey = `aggregate|DEFAULT_DEADLINE_10M|${reminderMinuteKey(reminderAt)}`;
  expect(mockScheduleTenMinuteAlarmAsync).toHaveBeenCalledTimes(1);
  expect(mockScheduleTenMinuteAlarmAsync).toHaveBeenCalledWith({
    reminderId: aggregateKey,
    taskId: '',
    taskTitle: '2 tasks need attention',
    fireAtISO: plusBackupDelayIso(reminderAt),
    aggregate: true,
    taskCount: 2,
  });
  expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(ALARMKIT_MAP_KEY)).toBe(JSON.stringify({ [aggregateKey]: 'native-alarm-1' }));
});

test('cancels old per-reminder schedules when replacing them with an aggregate notification', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(false);
  const reminderAt = futureIso(20);
  mockTasks = [
    { id: 'task-1', title: 'Pay rent', status: 'ACTIVE' },
    { id: 'task-2', title: 'Clean kitchen', status: 'ACTIVE' },
  ];
  mockReminders = [
    {
      id: 'reminder-1',
      parent_task_id: 'task-1',
      reminder_at: reminderAt,
      source: 'DEFAULT_DEADLINE_1H',
      notified_at: null,
    },
    {
      id: 'reminder-2',
      parent_task_id: 'task-2',
      reminder_at: reminderAt,
      source: 'DEFAULT_DEADLINE_1H',
      notified_at: null,
    },
  ];
  await AsyncStorage.setItem(NOTIFICATION_MAP_KEY, JSON.stringify({
    'reminder-1': 'old-notification-1',
    'reminder-2': 'old-notification-2',
  }));

  await syncLocalReminderNotificationsAsync('user-1');

  const aggregateKey = `aggregate|DEFAULT_DEADLINE_1H|${reminderMinuteKey(reminderAt)}`;
  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('old-notification-1');
  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('old-notification-2');
  expect(await AsyncStorage.getItem(NOTIFICATION_MAP_KEY)).toBe(JSON.stringify({ [aggregateKey]: 'expo-notification-1' }));
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
        localBackupKey: 'reminder-due',
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

test('reads aggregate notification URL for task-list routing', () => {
  const response = {
    notification: {
      request: {
        content: {
          data: {
            aggregate: true,
            url: '/tasks',
          },
        },
      },
    },
  } as any;

  expect(getUrlFromNotificationResponse(response)).toBe('/tasks');
});

test('registers the remote reminder delivery background task once', async () => {
  await registerRemoteReminderDeliveryTaskAsync();

  expect(mockIsTaskRegisteredAsync).toHaveBeenCalledWith('vouch-remote-reminder-delivery');
  expect(mockRegisterTaskAsync).toHaveBeenCalledWith('vouch-remote-reminder-delivery');
});

test('remote reminder delivery cancels matching Expo and AlarmKit backups', async () => {
  await AsyncStorage.setItem(NOTIFICATION_MAP_KEY, JSON.stringify({ 'reminder-1': 'expo-notification-1' }));
  await AsyncStorage.setItem(ALARMKIT_MAP_KEY, JSON.stringify({ 'reminder-1': 'native-alarm-1' }));

  const recorded = await recordRemoteReminderDeliveryAsync({
    kind: 'TASK_REMINDER_REMOTE_DELIVERED',
    category: 'DEADLINE_REMINDER',
    localBackupKey: 'reminder-1',
  });

  expect(recorded).toBe(true);
  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('expo-notification-1');
  expect(mockDismissNotificationAsync).toHaveBeenCalledWith('expo-notification-1');
  expect(mockCancelTenMinuteAlarmAsync).toHaveBeenCalledWith({ nativeAlarmId: 'native-alarm-1' });
  expect(await AsyncStorage.getItem(NOTIFICATION_MAP_KEY)).toBe(JSON.stringify({}));
  expect(await AsyncStorage.getItem(ALARMKIT_MAP_KEY)).toBe(JSON.stringify({}));
  expect(JSON.parse((await AsyncStorage.getItem(REMOTE_ACK_KEY)) ?? '{}')).toEqual({
    'reminder-1': expect.any(Number),
  });
});

test('remote aggregate reminder delivery cancels matching aggregate backup', async () => {
  const aggregateKey = 'aggregate|DEFAULT_DEADLINE_1H|2026-03-23T22:00:00.000Z';
  await AsyncStorage.setItem(NOTIFICATION_MAP_KEY, JSON.stringify({ [aggregateKey]: 'expo-aggregate-1' }));

  const recorded = await recordRemoteReminderDeliveryAsync({
    category: 'DEADLINE_REMINDER',
    aggregate: true,
    localBackupKey: aggregateKey,
  });

  expect(recorded).toBe(true);
  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('expo-aggregate-1');
  expect(await AsyncStorage.getItem(NOTIFICATION_MAP_KEY)).toBe(JSON.stringify({}));
  expect(JSON.parse((await AsyncStorage.getItem(REMOTE_ACK_KEY)) ?? '{}')).toEqual({
    [aggregateKey]: expect.any(Number),
  });
});

test('remote aggregate reminder delivery cancels aggregate and individual backups', async () => {
  const aggregateKey = 'aggregate|DEFAULT_DEADLINE_DUE|2026-03-23T22:00:00.000Z';
  await AsyncStorage.setItem(NOTIFICATION_MAP_KEY, JSON.stringify({
    [aggregateKey]: 'expo-aggregate-1',
    'reminder-1': 'expo-individual-1',
    'reminder-2': 'expo-individual-2',
  }));
  await AsyncStorage.setItem(ALARMKIT_MAP_KEY, JSON.stringify({
    'reminder-1': 'native-individual-1',
    'reminder-2': 'native-individual-2',
  }));

  const recorded = await recordRemoteReminderDeliveryAsync({
    kind: 'TASK_REMINDER_REMOTE_DELIVERED',
    category: 'DEADLINE_REMINDER',
    aggregate: true,
    localBackupKey: aggregateKey,
    reminderIds: ['reminder-1', 'reminder-2'],
  });

  expect(recorded).toBe(true);
  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('expo-aggregate-1');
  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('expo-individual-1');
  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('expo-individual-2');
  expect(mockDismissNotificationAsync).toHaveBeenCalledWith('expo-aggregate-1');
  expect(mockDismissNotificationAsync).toHaveBeenCalledWith('expo-individual-1');
  expect(mockDismissNotificationAsync).toHaveBeenCalledWith('expo-individual-2');
  expect(mockCancelTenMinuteAlarmAsync).toHaveBeenCalledWith({ nativeAlarmId: 'native-individual-1' });
  expect(mockCancelTenMinuteAlarmAsync).toHaveBeenCalledWith({ nativeAlarmId: 'native-individual-2' });
  expect(await AsyncStorage.getItem(NOTIFICATION_MAP_KEY)).toBe(JSON.stringify({}));
  expect(await AsyncStorage.getItem(ALARMKIT_MAP_KEY)).toBe(JSON.stringify({}));
  expect(JSON.parse((await AsyncStorage.getItem(REMOTE_ACK_KEY)) ?? '{}')).toEqual({
    [aggregateKey]: expect.any(Number),
    'reminder-1': expect.any(Number),
    'reminder-2': expect.any(Number),
  });
});

test.each([
  'AWAITING_VOUCHER',
  'AWAITING_AI',
  'ACCEPTED',
  'MISSED',
  'DELETED',
])('reconciliation cancels and dismisses stale Expo schedules for %s tasks', async (status) => {
  mockTasks = [{ id: 'task-1', title: 'Pay rent', status }];
  await AsyncStorage.setItem(NOTIFICATION_MAP_KEY, JSON.stringify({
    'reminder-1': 'stale-notification-1',
  }));

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('stale-notification-1');
  expect(mockDismissNotificationAsync).toHaveBeenCalledWith('stale-notification-1');
  expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(NOTIFICATION_MAP_KEY)).toBe(JSON.stringify({}));
});

test('suppresses local backup notifications when remote delivery was already recorded', async () => {
  await recordRemoteReminderDeliveryAsync({
    kind: 'TASK_REMINDER_REMOTE_DELIVERED',
    category: 'DEADLINE_REMINDER',
    localBackupKey: 'reminder-1',
  });

  await expect(shouldSuppressLocalReminderBackupAsync({
    local_schedule: true,
    localBackupKey: 'reminder-1',
  })).resolves.toBe(true);
});

test('does not suppress local backup notifications without a remote delivery ack', async () => {
  await expect(shouldSuppressLocalReminderBackupAsync({
    local_schedule: true,
    localBackupKey: 'reminder-1',
  })).resolves.toBe(false);
});

test('skips scheduling local backup when remote delivery was already recorded', async () => {
  await recordRemoteReminderDeliveryAsync({
    kind: 'TASK_REMINDER_REMOTE_DELIVERED',
    category: 'DEADLINE_REMINDER',
    localBackupKey: 'reminder-1',
  });

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  expect(mockScheduleTenMinuteAlarmAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(NOTIFICATION_MAP_KEY)).toBe(JSON.stringify({}));
});
