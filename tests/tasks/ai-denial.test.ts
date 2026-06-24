import { getLatestAiDenialReason } from '@/lib/tasks/ai-denial';
import type { AiVouch, TaskEvent } from '@/lib/types';

function aiVouch(overrides: Partial<AiVouch>): AiVouch {
  return {
    id: 'vouch-1',
    task_id: 'task-1',
    attempt_number: 1,
    decision: 'denied',
    reason: null,
    approved_at: null,
    vouched_at: '2026-06-23T10:00:00.000Z',
    ...overrides,
  };
}

function event(overrides: Partial<TaskEvent>): TaskEvent {
  return {
    id: 'event-1',
    task_id: 'task-1',
    event_type: 'AI_DENY',
    actor_id: null,
    from_status: 'AWAITING_AI',
    to_status: 'AI_DENIED',
    metadata: null,
    created_at: '2026-06-23T10:00:00.000Z',
    ...overrides,
  };
}

describe('getLatestAiDenialReason', () => {
  it('prefers the latest denied AI vouch reason', () => {
    const reason = getLatestAiDenialReason([
      aiVouch({ id: 'vouch-1', attempt_number: 1, reason: 'First denial' }),
      aiVouch({ id: 'vouch-2', attempt_number: 2, reason: 'Most recent denial' }),
    ], [
      event({ metadata: { reason: 'Event fallback' } }),
    ]);

    expect(reason).toBe('Most recent denial');
  });

  it('falls back to compatible AI denial event metadata', () => {
    const reason = getLatestAiDenialReason([], [
      event({ id: 'event-1', event_type: 'AI_DENY', metadata: { reason: 'Legacy event reason' } }),
      event({ id: 'event-2', event_type: 'AI_DENIED', metadata: { reason: 'Canonical event reason' } }),
    ]);

    expect(reason).toBe('Canonical event reason');
  });
});
