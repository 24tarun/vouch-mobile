import type { TaskStatus } from '@/lib/types';

export interface TaskStatsCounts {
  total: number;
  accepted: number;
  denied: number;
  missed: number;
}

const ACCEPTED_STATUSES = new Set<TaskStatus>(['ACCEPTED', 'AUTO_ACCEPTED', 'AI_ACCEPTED']);

export function calculateTaskStatusCounts(tasks: readonly { status: TaskStatus }[]): TaskStatsCounts {
  const counts: TaskStatsCounts = {
    total: 0,
    accepted: 0,
    denied: 0,
    missed: 0,
  };

  for (const task of tasks) {
    if (ACCEPTED_STATUSES.has(task.status)) {
      counts.accepted += 1;
    }
    if (task.status === 'DENIED') {
      counts.denied += 1;
    }
    if (task.status === 'MISSED') {
      counts.missed += 1;
    }
  }

  counts.total = counts.accepted + counts.denied + counts.missed;

  return counts;
}
