import {
  getTaskDeadlineCutoffIso,
  isTaskCompletionLocked,
} from '@/lib/tasks/task-completion-lock';

describe('completed task deadline lock', () => {
  const deadlineIso = '2026-07-19T12:00:00.000Z';

  it.each(['AWAITING_VOUCHER', 'AWAITING_AI', 'MARKED_COMPLETE', 'ACCEPTED'])(
    'locks %s at the end of the inclusive deadline minute',
    (status) => {
      expect(isTaskCompletionLocked(status, deadlineIso, Date.parse('2026-07-19T12:00:59.999Z'))).toBe(false);
      expect(isTaskCompletionLocked(status, deadlineIso, Date.parse('2026-07-19T12:01:00.000Z'))).toBe(true);
    },
  );

  it('does not lock AI denial resubmission state', () => {
    expect(isTaskCompletionLocked('AWAITING_USER', deadlineIso, Date.parse('2026-07-19T12:01:00.000Z'))).toBe(false);
  });

  it('builds the database cutoff used by conditional mutations', () => {
    expect(getTaskDeadlineCutoffIso(new Date('2026-07-19T12:00:59.999Z'))).toBe('2026-07-19T11:59:59.999Z');
  });
});
