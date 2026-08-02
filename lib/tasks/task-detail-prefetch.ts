import type { QueryClient } from '@tanstack/react-query';

import { taskDetailQueryOptions } from '@/lib/hooks/useTaskDetail';
import { isOptimisticTaskId } from '@/lib/tasks/task-id';

interface PrefetchJob {
  taskId: string;
  resolve: () => void;
}

export interface TaskDetailPrefetcher {
  prefetch: (taskId: string) => Promise<void>;
}

export function createTaskDetailPrefetcher(
  queryClient: Pick<QueryClient, 'prefetchQuery'>,
  concurrency = 2,
): TaskDetailPrefetcher {
  const pending: PrefetchJob[] = [];
  const scheduled = new Map<string, Promise<void>>();
  let activeCount = 0;

  function drain() {
    while (activeCount < concurrency && pending.length > 0) {
      const job = pending.shift()!;
      activeCount += 1;

      void queryClient.prefetchQuery(taskDetailQueryOptions(job.taskId))
        .catch(() => undefined)
        .finally(() => {
          activeCount -= 1;
          scheduled.delete(job.taskId);
          job.resolve();
          drain();
        });
    }
  }

  return {
    prefetch(taskId) {
      if (isOptimisticTaskId(taskId)) return Promise.resolve();
      const existing = scheduled.get(taskId);
      if (existing) return existing;

      let resolveJob!: () => void;
      const promise = new Promise<void>((resolve) => {
        resolveJob = resolve;
      });
      scheduled.set(taskId, promise);
      pending.push({ taskId, resolve: resolveJob });
      drain();
      return promise;
    },
  };
}
