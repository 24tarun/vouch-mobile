export const OPTIMISTIC_COMPLETION_TIMEOUT_MS = 6000;
export const DEFAULT_REMINDER_OFFSET_MS = 30 * 60 * 1000;
export const TASK_DELETE_WINDOW_MS = 60 * 60 * 1000;
export const SIGNED_URL_EXPIRY_SECONDS = 3600;
export const MIN_POMO_DURATION_MINUTES = 1;
export const MAX_POMO_DURATION_MINUTES = 120;
export const DEFAULT_POMO_DURATION_MINUTES = 25;

export function isValidPomoDurationMinutes(value: number | null | undefined): boolean {
  if (value == null) return false;
  return Number.isInteger(value) && value >= MIN_POMO_DURATION_MINUTES && value <= MAX_POMO_DURATION_MINUTES;
}

export function normalizePomoDurationMinutes(value: number | null | undefined): number {
  return isValidPomoDurationMinutes(value) ? value! : DEFAULT_POMO_DURATION_MINUTES;
}
