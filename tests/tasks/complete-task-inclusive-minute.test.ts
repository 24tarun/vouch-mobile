/* eslint-disable import/first */
let mockDeadlineIso = '2026-05-05T12:00:00.000Z';
let capturedRpcParams: Record<string, any> | null = null;
let mockVoucherId = 'user-1';
let mockRequiresProof = false;
/** Attested camera-capture time, or null when the task has no camera proof. */
let mockCameraProofTimestampIso: string | null = null;

type MockTaskReadBuilder = {
  eq: jest.Mock;
  single: jest.Mock;
};

type MockProofReadBuilder = {
  eq: jest.Mock;
  not: jest.Mock;
  limit: jest.Mock;
};

type MockSubtaskReadBuilder = {
  eq: jest.Mock;
  limit: jest.Mock;
};

let mockHasIncompleteSubtask = false;

const mockTaskReadBuilder: MockTaskReadBuilder = {
  eq: jest.fn((): MockTaskReadBuilder => mockTaskReadBuilder),
  single: jest.fn(async () => ({
    data: {
      id: 'task-1',
      voucher_id: mockVoucherId,
      status: 'ACTIVE',
      deadline: mockDeadlineIso,
      requires_proof: mockRequiresProof,
      has_proof: false,
    },
    error: null,
  })),
};

const mockTasksTable = {
  select: jest.fn(() => mockTaskReadBuilder),
};

const mockTaskEventsTable = {
  insert: jest.fn(async () => ({ error: null })),
};

const mockProofReadBuilder: MockProofReadBuilder = {
  eq: jest.fn((): MockProofReadBuilder => mockProofReadBuilder),
  not: jest.fn((): MockProofReadBuilder => mockProofReadBuilder),
  limit: jest.fn(async () => ({
    data: [{ id: 'proof-1' }],
    error: null,
  })),
};

const mockTaskProofsTable = {
  select: jest.fn(() => mockProofReadBuilder),
};

const mockSubtaskReadBuilder: MockSubtaskReadBuilder = {
  eq: jest.fn((): MockSubtaskReadBuilder => mockSubtaskReadBuilder),
  limit: jest.fn(async () => ({
    data: mockHasIncompleteSubtask ? [{ id: 'subtask-1' }] : [],
    error: null,
  })),
};

const mockTaskSubtasksTable = {
  select: jest.fn(() => mockSubtaskReadBuilder),
};

const DEADLINE_INCLUSIVE_MINUTE_MS = 60_000;
const MAX_CLIENT_LAG_MS = 2 * 60_000;

/**
 * Mirrors public.complete_task_at_client_time.
 *
 * The deadline decision now lives in the database, so this stands in for it:
 * server time is the authority, the client's action timestamp is honored only
 * when recent and in the past, and an attested camera capture can qualify the
 * completion on its own.
 */
const mockRpc = jest.fn(async (fnName: string, params: Record<string, any>) => {
  if (fnName !== 'complete_task_at_client_time') {
    throw new Error(`Unexpected rpc: ${fnName}`);
  }
  capturedRpcParams = params;

  const nowMs = Date.now();
  const clientMs = Date.parse(params.p_client_action_at);
  const effectiveMs = Number.isFinite(clientMs) && clientMs <= nowMs && nowMs - clientMs <= MAX_CLIENT_LAG_MS
    ? clientMs
    : nowMs;

  const proofMs = mockCameraProofTimestampIso ? Date.parse(mockCameraProofTimestampIso) : NaN;
  const qualifyingMs = Number.isFinite(proofMs) ? Math.min(effectiveMs, proofMs) : effectiveMs;

  if (qualifyingMs >= Date.parse(mockDeadlineIso) + DEADLINE_INCLUSIVE_MINUTE_MS) {
    return {
      data: {
        success: false,
        error: 'The task deadline has passed. Proof and completion can no longer be changed.',
      },
      error: null,
    };
  }

  return {
    data: {
      success: true,
      task_id: 'task-1',
      marked_completed_at: new Date(effectiveMs).toISOString(),
    },
    error: null,
  };
});

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: { user: { id: 'user-1' } } },
      })),
    },
    rpc: (...args: [string, Record<string, any>]) => mockRpc(...args),
    from: jest.fn((table: string) => {
      if (table === 'tasks') return mockTasksTable;
      if (table === 'task_events') return mockTaskEventsTable;
      if (table === 'task_completion_proofs') return mockTaskProofsTable;
      if (table === 'task_subtasks') return mockTaskSubtasksTable;
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

jest.mock('@/lib/notifications', () => ({
  cancelLocalReminderNotificationsForTaskAsync: jest.fn(async () => true),
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
import { cancelLocalReminderNotificationsForTaskAsync } from '@/lib/notifications';

const mockQueueAiEvalForTask = queueAiEvalForTask as jest.Mock;
const mockCancelLocalReminderNotificationsForTaskAsync = cancelLocalReminderNotificationsForTaskAsync as jest.Mock;

const DEADLINE_PASSED_ERROR = 'The task deadline has passed. Proof and completion can no longer be changed.';

describe('completeTask inclusive deadline minute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capturedRpcParams = null;
    mockDeadlineIso = '2026-05-05T12:00:00.000Z';
    mockVoucherId = 'user-1';
    mockRequiresProof = false;
    mockHasIncompleteSubtask = false;
    mockCameraProofTimestampIso = null;
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
    expect(capturedRpcParams?.p_client_action_at).toBe('2026-05-05T12:00:59.000Z');
    expect(mockCancelLocalReminderNotificationsForTaskAsync).toHaveBeenCalledWith('task-1');
  });

  it('blocks completion while any subtask remains incomplete', async () => {
    mockHasIncompleteSubtask = true;

    const result = await completeTask('task-1');

    expect(result).toEqual({
      success: false,
      userId: 'user-1',
      error: 'All subtasks must be completed before marking this task complete.',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('blocks completion after the inclusive deadline minute window', async () => {
    jest.setSystemTime(new Date('2026-05-05T12:01:00.000Z'));

    const result = await completeTask('task-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe(DEADLINE_PASSED_ERROR);
    expect(mockCancelLocalReminderNotificationsForTaskAsync).not.toHaveBeenCalled();
  });

  it('accepts a tap made inside the deadline minute that lands after it', async () => {
    // The user pressed Complete at 12:00:55 with 4 seconds to spare; a slow
    // request meant the write only reached the server at 12:01:03. Judging by
    // arrival would fail a task that was finished on time.
    jest.setSystemTime(new Date('2026-05-05T12:01:03.000Z'));

    const result = await completeTask('task-1', new Date('2026-05-05T12:00:55.000Z'));

    expect(result.success).toBe(true);
    expect(capturedRpcParams?.p_client_action_at).toBe('2026-05-05T12:00:55.000Z');
  });

  it('ignores a client action timestamp that is implausibly stale', async () => {
    // Beyond the trusted lag window this is either a badly wrong device clock
    // or an attempt to complete late, so the server clock decides instead.
    jest.setSystemTime(new Date('2026-05-05T12:05:00.000Z'));

    const result = await completeTask('task-1', new Date('2026-05-05T12:00:55.000Z'));

    expect(result.success).toBe(false);
    expect(result.error).toBe(DEADLINE_PASSED_ERROR);
  });

  it('ignores a client action timestamp from the future', async () => {
    // A device clock set forward cannot be used to claim the tap happened
    // earlier than it did; anything after server time falls back to server time.
    jest.setSystemTime(new Date('2026-05-05T12:01:30.000Z'));

    const result = await completeTask('task-1', new Date('2026-05-05T12:02:00.000Z'));

    expect(result.success).toBe(false);
    expect(result.error).toBe(DEADLINE_PASSED_ERROR);
  });

  it('allows upload latency after an attested in-app capture within the deadline minute', async () => {
    jest.setSystemTime(new Date('2026-05-05T12:01:03.000Z'));
    mockRequiresProof = true;
    mockCameraProofTimestampIso = '2026-05-05T12:00:58.000Z';

    const result = await completeTask('task-1');

    expect(result.success).toBe(true);
    expect(mockCancelLocalReminderNotificationsForTaskAsync).toHaveBeenCalledWith('task-1');
  });

  it('still requires an uploaded proof before completing a proof-backed task', async () => {
    jest.setSystemTime(new Date('2026-05-05T12:00:30.000Z'));
    mockRequiresProof = true;
    mockProofReadBuilder.limit.mockResolvedValueOnce({ data: [], error: null });

    const result = await completeTask('task-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Please upload proof before marking this task complete.');
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('gives a human voucher until the end of the second calendar day', async () => {
    jest.setSystemTime(new Date('2026-05-05T12:00:00.000Z'));
    mockVoucherId = 'voucher-2';

    const result = await completeTask('task-1');

    expect(result.success).toBe(true);
    const storedDeadline = new Date(String(capturedRpcParams?.p_voucher_response_deadline));
    expect([
      storedDeadline.getFullYear(),
      storedDeadline.getMonth(),
      storedDeadline.getDate(),
      storedDeadline.getHours(),
      storedDeadline.getMinutes(),
      storedDeadline.getSeconds(),
      storedDeadline.getMilliseconds(),
    ]).toEqual([2026, 4, 7, 23, 59, 59, 999]);
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
