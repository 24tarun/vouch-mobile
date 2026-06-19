import { VOUCHER_ACTIONABLE_STATUSES } from '@/lib/constants/task-status';
import type { TaskStatus } from '@/lib/types';

export function countPendingVouchRequests(tasks: { status: TaskStatus }[]): number {
  return tasks.filter((task) => VOUCHER_ACTIONABLE_STATUSES.includes(task.status)).length;
}
