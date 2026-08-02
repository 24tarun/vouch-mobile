import {
  getPostProofUploadAction,
  getTaskCompletionDecision,
  getTaskPostponeBlockReason,
} from '@/lib/tasks/task-completion-intent';

describe('task completion decisions', () => {
  const task = {
    id: '123e4567-e89b-42d3-a456-426614174000',
    requires_proof: false,
    has_proof: false,
    subtaskTotal: 0,
    subtaskCompleted: 0,
  };

  it('accepts an eligible task and a proof-required task that already has proof', () => {
    expect(getTaskCompletionDecision(task, false)).toEqual({ result: 'accepted' });
    expect(getTaskCompletionDecision({ ...task, requires_proof: true, has_proof: true }, false))
      .toEqual({ result: 'accepted' });
  });

  it('routes missing proof to capture only after subtasks are complete', () => {
    expect(getTaskCompletionDecision({ ...task, requires_proof: true }, false))
      .toEqual({ result: 'proof-required' });
    expect(getTaskCompletionDecision({
      ...task,
      requires_proof: true,
      subtaskTotal: 2,
      subtaskCompleted: 1,
    }, false)).toEqual({ result: 'blocked', reason: 'incomplete-subtasks' });
  });

  it('blocks optimistic and busy tasks', () => {
    expect(getTaskCompletionDecision({ ...task, id: 'optimistic-123' }, false))
      .toEqual({ result: 'blocked', reason: 'optimistic' });
    expect(getTaskCompletionDecision(task, true))
      .toEqual({ result: 'blocked', reason: 'busy' });
  });

  it('honors both post-upload auto-submit preference values', () => {
    expect(getPostProofUploadAction(true)).toBe('complete');
    expect(getPostProofUploadAction(false)).toBe('stay-active');
  });

  it('allows one postpone while blocking optimistic and previously postponed tasks', () => {
    expect(getTaskPostponeBlockReason(task)).toBeNull();
    expect(getTaskPostponeBlockReason({ ...task, id: 'optimistic-123' })).toBe('optimistic');
    expect(getTaskPostponeBlockReason({ ...task, status: 'POSTPONED' }))
      .toBe('already-postponed');
    expect(getTaskPostponeBlockReason({ ...task, postponed_at: '2026-08-02T10:00:00.000Z' }))
      .toBe('already-postponed');
  });
});
