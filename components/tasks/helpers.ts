import type { DraftReminder, TodayParts } from './types';

function getOrdinalSuffix(day: number): string {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

export function getTodayParts(): TodayParts {
  const now = new Date();
  return {
    dayName: now.toLocaleDateString('en-GB', { weekday: 'long' }),
    day: now.getDate(),
    ordinal: getOrdinalSuffix(now.getDate()),
    monthName: now.toLocaleDateString('en-GB', { month: 'long' }),
  };
}

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
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 720) return numeric;
  return 60;
}
