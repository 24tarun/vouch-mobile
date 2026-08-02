export const DEFAULT_PAST_TASK_PAGE_SIZE = 5;

export function getPastTaskRefreshLimit(
  loadedTaskCount: number | undefined,
  pageSize = DEFAULT_PAST_TASK_PAGE_SIZE,
): number {
  return Math.max(pageSize, loadedTaskCount ?? 0);
}
