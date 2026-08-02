import type { DraftReminder } from './types';

export function sortDraftReminders(reminders: DraftReminder[]): DraftReminder[] {
  return [...reminders].sort((a, b) => a.reminderAt.getTime() - b.reminderAt.getTime());
}

export function formatReminderDateTimeLabel(date: Date): string {
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
  return `${time} ${day}`;
}

export function formatReminderDateChip(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function formatReminderTimeChip(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function normalizeEventDurationMinutes(value: number | null | undefined): number {
  const numeric = typeof value === 'number' ? value : NaN;
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 1000) return numeric;
  return 60;
}
