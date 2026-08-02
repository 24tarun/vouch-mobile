export const DEADLINE_INCLUSIVE_MINUTE_MS = 60 * 1000;

export const COMPLETION_EDITABLE_STATUSES = [
  'AWAITING_VOUCHER',
  'AWAITING_AI',
  'MARKED_COMPLETE',
  'ACCEPTED',
] as const;

const completionEditableStatusSet = new Set<string>(COMPLETION_EDITABLE_STATUSES);

export function getTaskDeadlineCutoffIso(now: Date = new Date()): string {
  return new Date(now.getTime() - DEADLINE_INCLUSIVE_MINUTE_MS).toISOString();
}

export function isTaskCompletionLocked(
  status: string | null | undefined,
  deadlineIso: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!status || !completionEditableStatusSet.has(status)) return false;

  const deadlineMs = deadlineIso ? new Date(deadlineIso).getTime() : NaN;
  if (!Number.isFinite(deadlineMs)) return true;

  return nowMs >= deadlineMs + DEADLINE_INCLUSIVE_MINUTE_MS;
}
