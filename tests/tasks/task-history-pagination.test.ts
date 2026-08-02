import {
  DEFAULT_PAST_TASK_PAGE_SIZE,
  getPastTaskRefreshLimit,
} from '@/lib/tasks/task-history-pagination';

describe('historical task refresh pagination', () => {
  it('uses the first-page size before history has loaded', () => {
    expect(getPastTaskRefreshLimit(undefined)).toBe(DEFAULT_PAST_TASK_PAGE_SIZE);
  });

  it('preserves the number of historical tasks already loaded during refresh', () => {
    expect(getPastTaskRefreshLimit(7)).toBe(7);
    expect(getPastTaskRefreshLimit(15)).toBe(15);
  });

  it('does not request fewer records than one page', () => {
    expect(getPastTaskRefreshLimit(0)).toBe(DEFAULT_PAST_TASK_PAGE_SIZE);
    expect(getPastTaskRefreshLimit(3)).toBe(DEFAULT_PAST_TASK_PAGE_SIZE);
  });
});
