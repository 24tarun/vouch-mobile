import { countPendingVouchRequests } from '@/lib/friends-badge';
import type { TaskStatus } from '@/lib/types';

function task(status: TaskStatus) {
  return { status };
}

describe('Friends nav badge count', () => {
  it('does not count active friend tasks', () => {
    expect(countPendingVouchRequests([
      task('ACTIVE'),
      task('ACTIVE'),
      task('POSTPONED'),
    ])).toBe(0);
  });

  it('counts pending vouch requests', () => {
    expect(countPendingVouchRequests([
      task('AWAITING_VOUCHER'),
      task('MARKED_COMPLETE'),
    ])).toBe(2);
  });

  it('counts only pending requests in mixed friend activity', () => {
    expect(countPendingVouchRequests([
      task('ACTIVE'),
      task('AWAITING_VOUCHER'),
      task('POSTPONED'),
      task('MARKED_COMPLETE'),
    ])).toBe(2);
  });
});
