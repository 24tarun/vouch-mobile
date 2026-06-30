/* eslint-disable import/first */
let mockDeadlineIso = '2026-05-05T12:00:00.000Z';
let capturedDeadlineCutoffIso: string | null = null;
let mockVoucherId = 'user-1';

type MockTaskReadBuilder = {
  eq: jest.Mock;
  single: jest.Mock;
};

type MockTaskUpdateBuilder = {
  eq: jest.Mock;
  in: jest.Mock;
  gt: jest.Mock;
  select: jest.Mock;
};

const mockTaskReadBuilder: MockTaskReadBuilder = {
  eq: jest.fn((): MockTaskReadBuilder => mockTaskReadBuilder),
  single: jest.fn(async () => ({
    data: {
      id: 'task-1',
      voucher_id: mockVoucherId,
      status: 'ACTIVE',
      requires_proof: false,
      has_proof: false,
    },
    error: null,
  })),
};

const mockTaskUpdateBuilder: MockTaskUpdateBuilder = {
  eq: jest.fn((): MockTaskUpdateBuilder => mockTaskUpdateBuilder),
  in: jest.fn((): MockTaskUpdateBuilder => mockTaskUpdateBuilder),
  gt: jest.fn((_column: string, value: string) => {
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

jest.mock('@/lib/task-postpone', () => ({
  postponeTask: jest.fn(),
}));

jest.mock('@/lib/task-proof-upload', () => ({
  purgeTaskProofForFinalState: jest.fn(async () => undefined),
  queueAiEvalForTask: jest.fn(async () => ({ success: true })),
  removeCurrentTaskProofAsset: jest.fn(async () => ({ success: true })),
  uploadTaskProofAsset: jest.fn(async () => ({ success: true })),
}));

jest.mock('@/lib/google-calendar-mobile-sync', () => ({
  syncGoogleCalendarTaskAfterDelete: jest.fn(async () => undefined),
}));

import { completeTask } from '@/lib/tasks/task-actions';
import { queueAiEvalForTask } from '@/lib/task-proof-upload';

const mockQueueAiEvalForTask = queueAiEvalForTask as jest.Mock;

describe('completeTask inclusive deadline minute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedDeadlineCutoffIso = null;
    mockDeadlineIso = '2026-05-05T12:00:00.000Z';
    mockVoucherId = 'user-1';
    mockQueueAiEvalForTask.mockResolvedValue({ success: true });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('allows completion during the displayed deadline minute', async () => {
    jest.setSystemTime(new Date('2026-05-05T12:00:59.000Z'));

    const result = await completeTask('task-1');

    expect(result.success).toBe(true);
    expect(capturedDeadlineCutoffIso).toBe('2026-05-05T11:59:59.000Z');
  });

  it('blocks completion after the inclusive deadline minute window', async () => {
    jest.setSystemTime(new Date('2026-05-05T12:01:00.000Z'));

    const result = await completeTask('task-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Task can no longer be marked complete. Please refresh.');
    expect(capturedDeadlineCutoffIso).toBe('2026-05-05T12:00:00.000Z');
  });

  it('returns the backend quota message when AI review cannot be queued', async () => {
    jest.setSystemTime(new Date('2026-05-05T12:00:30.000Z'));
    mockVoucherId = '11111111-1111-1111-1111-111111111111';
    mockQueueAiEvalForTask.mockResolvedValue({
      success: false,
      code: 'AI_QUOTA_EXHAUSTED',
      error: 'Free accounts include 5 AI-reviewed tasks per calendar month.',
    });

    const result = await completeTask('task-1');

    expect(result).toEqual({
      success: false,
      userId: 'user-1',
      error: 'Free accounts include 5 AI-reviewed tasks per calendar month.',
    });
  });
});
