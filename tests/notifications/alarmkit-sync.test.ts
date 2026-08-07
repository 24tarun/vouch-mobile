import AsyncStorage from '@react-native-async-storage/async-storage';

let mockPlatformOS = 'ios';
let mockAppStateCurrent: 'active' | 'background' = 'active';
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
const mockClaimUpsert = jest.fn();
const mockClaimDeleteNot = jest.fn();
const mockClaimDeleteIn = jest.fn();

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
    AppState: {
      get currentState() {
        return mockAppStateCurrent;
      },
    },
  };
});

jest.mock('expo-notifications', () => ({
  AndroidImportance: { MAX: 'MAX' },
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval', DATE: 'date' },
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

      if (table === 'reminder_device_claims') {
        // delete().eq().eq().not()  — release everything not still armed
        // delete().eq().in()        — release one task's reminders
        const deleteBuilder: any = {
          eq: jest.fn(() => deleteBuilder),
          not: mockClaimDeleteNot,
          in: mockClaimDeleteIn,
        };
        return {
          upsert: mockClaimUpsert,
          delete: jest.fn(() => deleteBuilder),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    auth: {
      getSession: jest.fn(async () => ({ data: { session: { user: { id: 'user-1' } } } })),
    },
  },
}));

const NOTIFICATION_MAP_KEY = 'vouch_local_reminder_notification_ids_v1';
const ALARMKIT_MAP_KEY = 'vouch_local_reminder_alarmkit_ids_v1';
const FINGERPRINT_MAP_KEY = 'vouch_local_reminder_fingerprints_v1';
const REMOTE_ACK_KEY = 'vouch_remote_reminder_delivery_acks_v1';

/* eslint-disable-next-line @typescript-eslint/no-require-imports */
const notifications = require('@/lib/notifications') as typeof import('@/lib/notifications');
const {
  getUrlFromNotificationResponse,
  cancelLocalReminderNotificationsForTaskAsync,
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

function claimedReminderIds() {
  const rows = mockClaimUpsert.mock.calls.at(-1)?.[0] ?? [];
  return rows.map((row: any) => row.reminder_id).sort();
}

function reminderFingerprint(reminders: any[]) {
  return JSON.stringify({
    source: reminders[0]?.source ?? 'MANUAL',
    reminders: reminders
      .map((reminder) => ({
        id: reminder.id,
        taskId: reminder.parent_task_id,
        reminderAt: reminder.reminder_at,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  });
}

/**
 * Local reminders must fire at the reminder instant itself, via an absolute
 * DATE trigger. A relative TIME_INTERVAL is counted from when the OS accepts
 * the schedule, so it silently absorbs every await between computing the delay
 * and registering it — which is what used to push the final call ~40s late.
 */
function expectScheduledAtExactReminderTime(reminderAt: string, callIndex = 0) {
  const trigger = mockScheduleNotificationAsync.mock.calls[callIndex]?.[0]?.trigger;
  expect(trigger?.type).toBe('date');
  expect(trigger?.seconds).toBeUndefined();
  expect(trigger?.date).toBe(new Date(reminderAt).getTime());
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockPlatformOS = 'ios';
  mockAppStateCurrent = 'active';
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
  mockClaimUpsert.mockResolvedValue({ error: null });
  mockClaimDeleteNot.mockResolvedValue({ error: null });
  mockClaimDeleteIn.mockResolvedValue({ error: null });
});

test('schedules iOS 26 DEFAULT_DEADLINE_10M reminders with AlarmKit', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(true);
  mockGetAlarmAuthorizationStatusAsync.mockResolvedValue('authorized');

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockScheduleTenMinuteAlarmAsync).toHaveBeenCalledWith({
    reminderId: 'reminder-1',
    taskId: 'task-1',
    taskTitle: 'Pay rent',
    fireAtISO: new Date(mockReminders[0].reminder_at).toISOString(),
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
  expectScheduledAtExactReminderTime(mockReminders[0].reminder_at);
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

test('falls back to a standard notification when AlarmKit is denied', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(true);
  mockGetAlarmAuthorizationStatusAsync.mockResolvedValue('denied');

  await syncLocalReminderNotificationsAsync('user-1');

  // Keying the Expo exclusion on availability rather than authorization used to
  // drop this reminder from both channels: no alarm and no notification, on any
  // iOS 26 device where the user had not granted alarm permission.
  expect(mockScheduleTenMinuteAlarmAsync).not.toHaveBeenCalled();
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expectScheduledAtExactReminderTime(mockReminders[0].reminder_at);
  expect(await AsyncStorage.getItem(ALARMKIT_MAP_KEY)).toBe(JSON.stringify({}));
});

test('falls back to a standard notification when alarm permission is undecided', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(true);
  mockGetAlarmAuthorizationStatusAsync.mockResolvedValue('not_determined');
  // Backgrounded: iOS cannot present the prompt here.
  mockAppStateCurrent = 'background';

  await syncLocalReminderNotificationsAsync('user-1');

  // AlarmKit authorization is one-shot — a request made when no prompt can be
  // shown resolves to denied permanently. Never spend that chance off-screen.
  expect(mockRequestAlarmAuthorizationAsync).not.toHaveBeenCalled();
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
});

test('requests alarm permission only while the app is foregrounded', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(true);
  mockGetAlarmAuthorizationStatusAsync.mockResolvedValue('not_determined');
  mockRequestAlarmAuthorizationAsync.mockResolvedValue('authorized');
  mockAppStateCurrent = 'active';

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockRequestAlarmAuthorizationAsync).toHaveBeenCalled();
  expect(mockScheduleTenMinuteAlarmAsync).toHaveBeenCalled();
  expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
});

test('reuses an existing valid AlarmKit mapping', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(true);
  mockGetAlarmAuthorizationStatusAsync.mockResolvedValue('authorized');
  await AsyncStorage.setItem(ALARMKIT_MAP_KEY, JSON.stringify({ 'reminder-1': 'native-alarm-existing' }));
  await AsyncStorage.setItem(FINGERPRINT_MAP_KEY, JSON.stringify({
    'reminder-1': reminderFingerprint(mockReminders),
  }));

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockScheduleTenMinuteAlarmAsync).not.toHaveBeenCalled();
  expect(mockCancelTenMinuteAlarmAsync).not.toHaveBeenCalled();
  expect(await AsyncStorage.getItem(ALARMKIT_MAP_KEY)).toBe(JSON.stringify({ 'reminder-1': 'native-alarm-existing' }));
});

test('replaces an Expo notification when postponing changes the reminder time', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(false);
  const oldReminder = { ...mockReminders[0], reminder_at: futureIso(5) };
  await AsyncStorage.setItem(NOTIFICATION_MAP_KEY, JSON.stringify({
    'reminder-1': 'notification-at-old-deadline',
  }));
  await AsyncStorage.setItem(FINGERPRINT_MAP_KEY, JSON.stringify({
    'reminder-1': reminderFingerprint([oldReminder]),
  }));

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('notification-at-old-deadline');
  expect(mockDismissNotificationAsync).toHaveBeenCalledWith('notification-at-old-deadline');
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expectScheduledAtExactReminderTime(mockReminders[0].reminder_at);
});

test('replaces an AlarmKit alarm when postponing changes the reminder time', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(true);
  mockGetAlarmAuthorizationStatusAsync.mockResolvedValue('authorized');
  const oldReminder = { ...mockReminders[0], reminder_at: futureIso(5) };
  await AsyncStorage.setItem(ALARMKIT_MAP_KEY, JSON.stringify({
    'reminder-1': 'alarm-at-old-deadline',
  }));
  await AsyncStorage.setItem(FINGERPRINT_MAP_KEY, JSON.stringify({
    'reminder-1': reminderFingerprint([oldReminder]),
  }));

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockCancelTenMinuteAlarmAsync).toHaveBeenCalledWith({ nativeAlarmId: 'alarm-at-old-deadline' });
  expect(mockScheduleTenMinuteAlarmAsync).toHaveBeenCalledWith(expect.objectContaining({
    fireAtISO: new Date(mockReminders[0].reminder_at).toISOString(),
  }));
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
    fireAtISO: new Date(reminderAt).toISOString(),
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
  await AsyncStorage.setItem(NOTIFICATION_MAP_KEY, JSON.stringify({
    'reminder-1': 'local-backup-1',
  }));

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
  // Registering for push no longer tears down local schedules: local delivery
  // is the punctual channel, and push is the fallback for reminders this
  // device could not arm.
  expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalled();
});

test('keeps scheduling locally after this device registers for push', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(false);

  await registerForPushNotificationsAsync('user-1');
  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expectScheduledAtExactReminderTime(mockReminders[0].reminder_at);
});

test('claims every armed reminder so the server skips this device', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(false);

  await syncLocalReminderNotificationsAsync('user-1');

  expect(claimedReminderIds()).toEqual(['reminder-1']);
  const claim = mockClaimUpsert.mock.calls.at(-1)?.[0]?.[0];
  expect(claim).toMatchObject({
    reminder_id: 'reminder-1',
    user_id: 'user-1',
    user_client_instance_id: 'client-instance-1',
  });
  // The lease has to outlive the reminder, or the cron would push a duplicate
  // right as the local notification fires.
  expect(new Date(claim.armed_until).getTime())
    .toBeGreaterThan(new Date(mockReminders[0].reminder_at).getTime());
});

test('releases claims for reminders it no longer has armed', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(false);

  await syncLocalReminderNotificationsAsync('user-1');

  expect(mockClaimDeleteNot).toHaveBeenCalledWith('reminder_id', 'in', '(reminder-1)');
});

test('leaves reminders beyond the local schedule budget to the server', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(false);
  mockTasks = [{ id: 'task-1', title: 'Pay rent', status: 'ACTIVE' }];
  // Distinct minutes so each reminder forms its own group.
  mockReminders = Array.from({ length: 70 }, (_, index) => ({
    id: `reminder-${index + 1}`,
    parent_task_id: 'task-1',
    reminder_at: futureIso(60 + index),
    source: 'MANUAL',
    notified_at: null,
  }));

  await syncLocalReminderNotificationsAsync('user-1');

  // iOS silently drops anything past its 64-notification cap, so the overflow
  // must stay unclaimed rather than be armed-and-forgotten.
  expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(60);
  expect(claimedReminderIds()).toHaveLength(60);
  expect(claimedReminderIds()).not.toContain('reminder-70');
});

test('prefers the soonest reminders when over budget', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(false);
  mockReminders = Array.from({ length: 70 }, (_, index) => ({
    id: `reminder-${index + 1}`,
    parent_task_id: 'task-1',
    reminder_at: futureIso(60 + index),
    source: 'MANUAL',
    notified_at: null,
  }));

  await syncLocalReminderNotificationsAsync('user-1');

  expect(claimedReminderIds()).toContain('reminder-1');
  expect(claimedReminderIds()).toContain('reminder-60');
  expect(claimedReminderIds()).not.toContain('reminder-61');
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
  'SURRENDERED',
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

test('completion immediately cancels every local schedule containing the task', async () => {
  const aggregateKey = 'aggregate|DEFAULT_DEADLINE_DUE|2026-07-20T15:00:00.000Z';
  await AsyncStorage.setItem(NOTIFICATION_MAP_KEY, JSON.stringify({
    'reminder-individual': 'expo-individual',
    [aggregateKey]: 'expo-aggregate',
    'reminder-other': 'expo-other',
  }));
  await AsyncStorage.setItem(ALARMKIT_MAP_KEY, JSON.stringify({
    'reminder-individual': 'alarm-individual',
  }));
  await AsyncStorage.setItem(FINGERPRINT_MAP_KEY, JSON.stringify({
    'reminder-individual': JSON.stringify({
      source: 'DEFAULT_DEADLINE_DUE',
      reminders: [{ id: 'reminder-individual', taskId: 'task-1', reminderAt: futureIso(5) }],
    }),
    [aggregateKey]: JSON.stringify({
      source: 'DEFAULT_DEADLINE_DUE',
      reminders: [
        { id: 'reminder-aggregate-1', taskId: 'task-1', reminderAt: futureIso(5) },
        { id: 'reminder-aggregate-2', taskId: 'task-2', reminderAt: futureIso(5) },
      ],
    }),
    'reminder-other': JSON.stringify({
      source: 'MANUAL',
      reminders: [{ id: 'reminder-other', taskId: 'task-2', reminderAt: futureIso(10) }],
    }),
  }));

  await expect(cancelLocalReminderNotificationsForTaskAsync('task-1')).resolves.toBe(true);

  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('expo-individual');
  expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('expo-aggregate');
  expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalledWith('expo-other');
  expect(mockCancelTenMinuteAlarmAsync).toHaveBeenCalledWith({ nativeAlarmId: 'alarm-individual' });
  expect(JSON.parse((await AsyncStorage.getItem(NOTIFICATION_MAP_KEY)) ?? '{}')).toEqual({
    'reminder-other': 'expo-other',
  });
  expect(JSON.parse((await AsyncStorage.getItem(FINGERPRINT_MAP_KEY)) ?? '{}')).toEqual({
    'reminder-other': expect.any(String),
  });
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

test('skips redundant claim writes when the armed set is unchanged', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(false);

  await syncLocalReminderNotificationsAsync('user-1');
  expect(mockClaimUpsert).toHaveBeenCalledTimes(1);

  // Reminder sync runs on every realtime change and every foreground; a no-op
  // sync must not cost two round trips each time.
  await syncLocalReminderNotificationsAsync('user-1');
  expect(mockClaimUpsert).toHaveBeenCalledTimes(1);
});

test('writes claims again once the armed set changes', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(false);

  await syncLocalReminderNotificationsAsync('user-1');
  expect(mockClaimUpsert).toHaveBeenCalledTimes(1);

  mockReminders = [{
    id: 'reminder-2',
    parent_task_id: 'task-1',
    reminder_at: futureIso(40),
    source: 'DEFAULT_DEADLINE_DUE',
    notified_at: null,
  }];

  await syncLocalReminderNotificationsAsync('user-1');
  expect(mockClaimUpsert).toHaveBeenCalledTimes(2);
  expect(claimedReminderIds()).toEqual(['reminder-2']);
});

test('bunches same-minute ten-minute reminders into one AlarmKit alarm', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(true);
  mockGetAlarmAuthorizationStatusAsync.mockResolvedValue('authorized');
  const reminderAt = futureIso(20);
  mockTasks = [
    { id: 'task-1', title: 'Pay rent', status: 'ACTIVE' },
    { id: 'task-2', title: 'Call mum', status: 'ACTIVE' },
    { id: 'task-3', title: 'Ship PR', status: 'ACTIVE' },
  ];
  mockReminders = [
    { id: 'r1', parent_task_id: 'task-1', reminder_at: reminderAt, source: 'DEFAULT_DEADLINE_10M', notified_at: null },
    { id: 'r2', parent_task_id: 'task-2', reminder_at: reminderAt, source: 'DEFAULT_DEADLINE_10M', notified_at: null },
    { id: 'r3', parent_task_id: 'task-3', reminder_at: reminderAt, source: 'DEFAULT_DEADLINE_10M', notified_at: null },
  ];

  await syncLocalReminderNotificationsAsync('user-1');

  // Three tasks due in the same minute must not produce three alarms.
  expect(mockScheduleTenMinuteAlarmAsync).toHaveBeenCalledTimes(1);
  expect(mockScheduleTenMinuteAlarmAsync).toHaveBeenCalledWith(expect.objectContaining({
    aggregate: true,
    taskCount: 3,
    taskId: '',
  }));
  // All three are still individually claimed, so the server skips all of them.
  expect(claimedReminderIds()).toEqual(['r1', 'r2', 'r3']);
});

test('releases claims for every task sharing a cancelled aggregate alarm', async () => {
  mockIsAlarmKitAvailableAsync.mockResolvedValue(true);
  mockGetAlarmAuthorizationStatusAsync.mockResolvedValue('authorized');
  const reminderAt = futureIso(20);
  mockTasks = [
    { id: 'task-1', title: 'Pay rent', status: 'ACTIVE' },
    { id: 'task-2', title: 'Call mum', status: 'ACTIVE' },
  ];
  mockReminders = [
    { id: 'r1', parent_task_id: 'task-1', reminder_at: reminderAt, source: 'DEFAULT_DEADLINE_10M', notified_at: null },
    { id: 'r2', parent_task_id: 'task-2', reminder_at: reminderAt, source: 'DEFAULT_DEADLINE_10M', notified_at: null },
  ];

  await syncLocalReminderNotificationsAsync('user-1');
  expect(mockScheduleTenMinuteAlarmAsync).toHaveBeenCalledTimes(1);

  await cancelLocalReminderNotificationsForTaskAsync('task-1');

  // One OS alarm covers both tasks, so completing task-1 tears down task-2's
  // alarm too. If task-2 kept its claim the cron would skip it and it would get
  // no notification at all should the follow-up sync never run.
  const released = mockClaimDeleteIn.mock.calls.at(-1);
  expect(released?.[0]).toBe('reminder_id');
  expect([...released?.[1]].sort()).toEqual(['r1', 'r2']);
});
