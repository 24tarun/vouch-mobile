import {
  COMPLETION_EDIT_LOCKED_ERROR,
  isCompletionEditingLocked,
  wasProofStagedBeforeCompletionLock,
} from '../../supabase/functions/task-proof-upload/task-proof-deadline';

describe('task proof deadline lock', () => {
  const deadline = '2026-08-03T06:00:00.000Z';
  const cutoffMs = Date.parse(deadline) + 60_000;

  it.each(['ACTIVE', 'POSTPONED', 'AWAITING_VOUCHER', 'AWAITING_AI', 'MARKED_COMPLETE'])(
    'locks %s after the inclusive deadline minute',
    (status) => {
      expect(isCompletionEditingLocked(status, deadline, cutoffMs - 1)).toBe(false);
      expect(isCompletionEditingLocked(status, deadline, cutoffMs)).toBe(true);
    },
  );

  it('keeps rectification proof independent from the original task deadline', () => {
    expect(isCompletionEditingLocked('AWAITING_RECTIFICATION', deadline, cutoffMs)).toBe(false);
  });

  it('allows a finalization that was staged before the lock and rejects one at the cutoff', () => {
    expect(wasProofStagedBeforeCompletionLock(deadline, '2026-08-03T06:00:59.999Z')).toBe(true);
    expect(wasProofStagedBeforeCompletionLock(deadline, '2026-08-03T06:01:00.000Z')).toBe(false);
  });

  it('uses the same user-facing deadline error as completion', () => {
    expect(COMPLETION_EDIT_LOCKED_ERROR).toBe(
      'The task deadline has passed. Proof and completion can no longer be changed.',
    );
  });
});
