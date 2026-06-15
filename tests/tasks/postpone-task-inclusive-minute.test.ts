/* eslint-disable import/first */
let mockDeadlineIso = '2026-05-05T12:00:00.000Z';
let capturedDeadlineCutoffIso: string | null = null;

type Chain = {
  eq: jest.Mock;
};

type TaskReadBuilder = Chain & {
  single: jest.Mock;
};

type TaskUpdateBuilder = Chain & {
  in: jest.Mock;
  is: jest.Mock;
  gt: jest.Mock;
  select: jest.Mock;
};

const mockTaskReadBuilder: TaskReadBuilder = {
  eq: jest.fn((): TaskReadBuilder => mockTaskReadBuilder),
  single: jest.fn(async () => ({
    data: {
      id: 'task-1',
      user_id: 'user-1',
      voucher_id: 'user-1',
      title: 'Pay rent',
      status: 'ACTIVE',
      deadline: mockDeadlineIso,
      postponed_at: null,
      recurrence_rule_id: null,
    },
    error: null,
  })),
};

const mockTaskUpdateBuilder: TaskUpdateBuilder = {
  eq: jest.fn((): TaskUpdateBuilder => mockTaskUpdateBuilder),
  in: jest.fn((): TaskUpdateBuilder => mockTaskUpdateBuilder),
  is: jest.fn((): TaskUpdateBuilder => mockTaskUpdateBuilder),
  gt: jest.fn((_column: string, value: string): TaskUpdateBuilder => {
    capturedDeadlineCutoffIso = value;
    return mockTaskUpdateBuilder;
  }),
  select: jest.fn(async () => ({
    data: Date.parse(mockDeadlineIso) > Date.parse(capturedDeadlineCutoffIso ?? '')
      ? [{ id: 'task-1' }]
      : [],
    error: null,
  })),
};

const mockReminderSelectSecondEq = jest.fn(async () => ({ data: [], error: null }));
const mockReminderSelectBuilder = {
  eq: jest.fn(() => ({
    eq: mockReminderSelectSecondEq,
  })),
};

const mockProfileSelectBuilder = {
  eq: jest.fn(() => ({
    maybeSingle: jest.fn(async () => ({
      data: {
        deadline_one_hour_warning_enabled: true,
        deadline_final_warning_enabled: true,
        deadline_due_warning_enabled: true,
      },
      error: null,
    })),
  })),
};

const mockTaskEventsTable = {
  insert: jest.fn(async () => ({ error: null })),
};

const mockTaskRemindersTable = {
  select: jest.fn(() => mockReminderSelectBuilder),
  upsert: jest.fn(async () => ({ error: null })),
  delete: jest.fn(() => ({
    in: jest.fn(() => ({
      eq: jest.fn(async () => ({ error: null })),
    })),
  })),
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: { user: { id: 'user-1' } } },
      })),
    },
    from: jest.fn((table: string) => {
      if (table === 'tasks') {
        return {
          select: jest.fn(() => mockTaskReadBuilder),
          update: jest.fn(() => mockTaskUpdateBuilder),
        };
      }
      if (table === 'task_reminders') return mockTaskRemindersTable;
      if (table === 'profiles') {
        return {
          select: jest.fn(() => mockProfileSelectBuilder),
        };
      }
      if (table === 'task_events') return mockTaskEventsTable;
      throw new Error(`Unexpected table: ${table}`);
    }),
  },
}));

jest.mock('@/lib/user-client-instance', () => ({
  resolveUserClientInstanceId: jest.fn(async () => 'client-instance-1'),
}));

import { postponeTask } from '@/lib/task-postpone';

describe('postponeTask inclusive deadline minute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedDeadlineCutoffIso = null;
    mockDeadlineIso = '2026-05-05T12:00:00.000Z';
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows postponing during the displayed deadline minute', async () => {
    jest.setSystemTime(new Date('2026-05-05T12:00:59.000Z'));

    const result = await postponeTask('task-1', '2026-05-05T13:00:00.000Z', 'client-instance-1');

    expect(result.success).toBe(true);
    expect(capturedDeadlineCutoffIso).toBe('2026-05-05T11:59:59.000Z');
  });

  it('blocks postponing after the displayed deadline minute ends', async () => {
    jest.setSystemTime(new Date('2026-05-05T12:01:00.000Z'));

    const result = await postponeTask('task-1', '2026-05-05T13:00:00.000Z', 'client-instance-1');

    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected postpone to fail after the displayed deadline minute.');
    expect(result.error).toBe('Deadline has passed');
    expect(capturedDeadlineCutoffIso).toBe(null);
  });
});
