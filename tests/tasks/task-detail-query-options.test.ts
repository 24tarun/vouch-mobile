import {
  TASK_DETAIL_STALE_TIME_MS,
  taskDetailQueryOptions,
} from '@/lib/hooks/useTaskDetail';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

describe('task detail query options', () => {
  it('shares the task-detail key and keeps prefetched data fresh for 60 seconds', () => {
    const options = taskDetailQueryOptions('123e4567-e89b-42d3-a456-426614174000');

    expect(options.queryKey).toEqual([
      'task-detail',
      '123e4567-e89b-42d3-a456-426614174000',
    ]);
    expect(options.staleTime).toBe(60_000);
    expect(TASK_DETAIL_STALE_TIME_MS).toBe(60_000);
  });
});
