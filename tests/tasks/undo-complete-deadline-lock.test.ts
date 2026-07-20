/* eslint-disable import/first */
let taskSnapshot = {
  id: 'task-1',
  voucher_id: 'voucher-1',
  ai_escalated_from: false,
  status: 'AWAITING_VOUCHER',
  deadline: '2026-07-19T12:00:00.000Z',
  postponed_at: null as string | null,
};
let updatedRows: { id: string }[] = [{ id: 'task-1' }];

type MockTaskReadBuilder = {
  eq: jest.Mock;
  single: jest.Mock;
};

type MockTaskUpdateBuilder = {
  eq: jest.Mock;
  gt: jest.Mock;
  select: jest.Mock;
};

const mockTaskReadBuilder: MockTaskReadBuilder = {
  eq: jest.fn((): MockTaskReadBuilder => mockTaskReadBuilder),
  single: jest.fn(async () => ({ data: taskSnapshot, error: null })),
};

const mockTaskUpdateBuilder: MockTaskUpdateBuilder = {
  eq: jest.fn((): MockTaskUpdateBuilder => mockTaskUpdateBuilder),
  gt: jest.fn((): MockTaskUpdateBuilder => mockTaskUpdateBuilder),
  select: jest.fn(async () => ({ data: updatedRows, error: null })),
};

const mockTasksTable = {
  select: jest.fn(() => mockTaskReadBuilder),
  update: jest.fn(() => mockTaskUpdateBuilder),
};

const mockTaskEventsTable = {
  insert: jest.fn(async () => ({ error: null })),
};

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: { user: { id: 'user-1' } } },
      })),
    },
    from: jest.fn((table: string) => {
      if (table === 'tasks') return mockTasksTable;
      if (table === 'task_events') return mockTaskEventsTable;
      throw new Error(`Unexpected table: ${table}`);
    }),
  },
}));

jest.mock('@/lib/user-client-instance', () => ({
  resolveUserClientInstanceId: jest.fn(async () => 'client-instance-1'),
}));

jest.mock('@/lib/task-postpone', () => ({ postponeTask: jest.fn() }));
jest.mock('@/lib/task-proof-upload', () => ({
  purgeTaskProofForFinalState: jest.fn(),
  queueAiEvalForTask: jest.fn(),
  removeCurrentTaskProofAsset: jest.fn(),
  uploadTaskProofAsset: jest.fn(),
}));
jest.mock('@/lib/google-calendar-mobile-sync', () => ({
  syncGoogleCalendarTaskAfterDelete: jest.fn(),
  syncGoogleCalendarTaskAfterSurrender: jest.fn(),
}));

import { undoCompleteTask } from '@/lib/tasks/task-actions';

describe('undoCompleteTask deadline lock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    taskSnapshot = {
      id: 'task-1',
      voucher_id: 'voucher-1',
      ai_escalated_from: false,
      status: 'AWAITING_VOUCHER',
      deadline: '2026-07-19T12:00:00.000Z',
      postponed_at: null,
    };
    updatedRows = [{ id: 'task-1' }];
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows undo during the inclusive minute and applies a database deadline predicate', async () => {
    jest.setSystemTime(new Date('2026-07-19T12:00:59.999Z'));

    const result = await undoCompleteTask('task-1', 'AWAITING_VOUCHER');

    expect(result.success).toBe(true);
    expect(mockTaskUpdateBuilder.gt).toHaveBeenCalledWith('deadline', '2026-07-19T11:59:59.999Z');
    expect(mockTaskEventsTable.insert).toHaveBeenCalledTimes(1);
  });

  it('rejects undo after the inclusive minute without updating or logging an event', async () => {
    jest.setSystemTime(new Date('2026-07-19T12:01:00.000Z'));

    const result = await undoCompleteTask('task-1', 'AWAITING_VOUCHER');

    expect(result.success).toBe(false);
    expect(result.error).toContain('deadline has passed');
    expect(mockTasksTable.update).not.toHaveBeenCalled();
    expect(mockTaskEventsTable.insert).not.toHaveBeenCalled();
  });

  it('does not log undo when the conditional update loses a deadline race', async () => {
    jest.setSystemTime(new Date('2026-07-19T12:00:59.999Z'));
    updatedRows = [];

    const result = await undoCompleteTask('task-1', 'AWAITING_VOUCHER');

    expect(result).toMatchObject({ success: false, error: 'Task can no longer be reverted. Please refresh.' });
    expect(mockTaskEventsTable.insert).not.toHaveBeenCalled();
  });
});
