import { createTaskDetailPrefetcher } from '@/lib/tasks/task-detail-prefetch';

jest.mock('@/lib/hooks/useTaskDetail', () => ({
  taskDetailQueryOptions: (taskId: string) => ({
    queryKey: ['task-detail', taskId],
    queryFn: jest.fn(),
    staleTime: 60_000,
  }),
}));

describe('task detail prefetcher', () => {
  it('caps concurrent work at two and advances the queue as jobs finish', async () => {
    const resolvers: (() => void)[] = [];
    const prefetchQuery = jest.fn(() => new Promise<void>((resolve) => {
      resolvers.push(resolve);
    }));
    const prefetcher = createTaskDetailPrefetcher({ prefetchQuery } as any, 2);

    const jobs = ['one', 'two', 'three', 'four', 'five'].map((id) => prefetcher.prefetch(id));
    expect(prefetchQuery).toHaveBeenCalledTimes(2);

    resolvers.shift()!();
    await Promise.resolve();
    await Promise.resolve();
    expect(prefetchQuery).toHaveBeenCalledTimes(3);

    while (resolvers.length > 0) {
      resolvers.shift()!();
      await Promise.resolve();
      await Promise.resolve();
    }
    await Promise.all(jobs);
    expect(prefetchQuery).toHaveBeenCalledTimes(5);
  });

  it('deduplicates scheduled task IDs and skips optimistic IDs', async () => {
    let resolve!: () => void;
    const prefetchQuery = jest.fn(() => new Promise<void>((done) => {
      resolve = done;
    }));
    const prefetcher = createTaskDetailPrefetcher({ prefetchQuery } as any, 2);

    const first = prefetcher.prefetch('same-task');
    const duplicate = prefetcher.prefetch('same-task');
    await prefetcher.prefetch('optimistic-123');

    expect(first).toBe(duplicate);
    expect(prefetchQuery).toHaveBeenCalledTimes(1);
    resolve();
    await first;
  });
});
