import { calculateTaskStatusCounts } from '@/lib/stats/task-status-counts';
import type { TaskStatus } from '@/lib/types';

function task(status: TaskStatus) {
  return { status };
}

describe('calculateTaskStatusCounts', () => {
  it('keeps total tasks equal to accepted + denied + missed', () => {
    const counts = calculateTaskStatusCounts([
      task('ACTIVE'),
      task('POSTPONED'),
      task('MARKED_COMPLETE'),
      task('AWAITING_VOUCHER'),
      task('AWAITING_AI'),
      task('AWAITING_USER'),
      task('ESCALATED'),
      task('ACCEPTED'),
      task('AUTO_ACCEPTED'),
      task('AI_ACCEPTED'),
      task('DENIED'),
      task('MISSED'),
      task('RECTIFIED'),
      task('SETTLED'),
      task('DELETED'),
    ]);

    expect(counts).toEqual({
      total: 5,
      accepted: 3,
      denied: 1,
      missed: 1,
    });
  });

  it('does not count AI_DENIED as a final denied task', () => {
    const counts = calculateTaskStatusCounts([
      task('AI_DENIED'),
      task('AWAITING_USER'),
    ]);

    expect(counts).toEqual({
      total: 0,
      accepted: 0,
      denied: 0,
      missed: 0,
    });
  });
});
