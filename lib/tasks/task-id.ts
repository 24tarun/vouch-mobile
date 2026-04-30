export function isOptimisticTaskId(taskId: string | null | undefined): boolean {
  if (!taskId) return false;
  return taskId.startsWith('optimistic-');
}
