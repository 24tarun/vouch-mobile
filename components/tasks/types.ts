export interface TodayParts {
  dayName: string;
  day: number;
  ordinal: string;
  monthName: string;
}

export type DraftReminderPresetSource = 'DEFAULT_DEADLINE_1H' | 'DEFAULT_DEADLINE_10M';
export type DraftReminderSource = DraftReminderPresetSource | 'MANUAL';
export type RecurrenceType = '' | 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface DraftReminder {
  id: string;
  reminderAt: Date;
  source: DraftReminderSource;
}

export interface DraftSubtask {
  id: string;
  title: string;
  isCompleted: boolean;
}

export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
export const WEEKDAY_SHORT: Record<number, string> = {
  0: 'Su',
  1: 'Mo',
  2: 'Tu',
  3: 'We',
  4: 'Th',
  5: 'Fr',
  6: 'Sa',
};
