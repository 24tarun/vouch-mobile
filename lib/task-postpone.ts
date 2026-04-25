import { supabase } from '@/lib/supabase';
import { resolveUserClientInstanceId } from '@/lib/user-client-instance';

const INVALID_DEADLINE_ERROR = 'Deadline is invalid.';
const PAST_DEADLINE_ERROR = 'Deadline must be in the future.';
const DAILY_RECURRING_POSTPONE_SAME_DAY_ERROR = 'Daily repeating tasks can only be postponed within the same day.';

const MANUAL_REMINDER_SOURCE = 'MANUAL';
const DEFAULT_DEADLINE_1H_REMINDER_SOURCE = 'DEFAULT_DEADLINE_1H';
const DEFAULT_DEADLINE_10M_REMINDER_SOURCE = 'DEFAULT_DEADLINE_10M';

type PostponeResult =
  | { success: true }
  | { success: false; error: string };

function parseAndValidateFutureDeadline(rawDeadline: string): { deadline?: Date; error?: string } {
  const parsedDeadline = new Date(rawDeadline);
  if (Number.isNaN(parsedDeadline.getTime())) {
    return { error: INVALID_DEADLINE_ERROR };
  }

  if (parsedDeadline.getTime() <= Date.now()) {
    return { error: PAST_DEADLINE_ERROR };
  }

  return { deadline: parsedDeadline };
}

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function getDatePartsInTimeZone(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

function shouldRestrictDailyPostponeToSameRuleDay(ruleConfig: unknown): boolean {
  if (!ruleConfig || typeof ruleConfig !== 'object') return false;
  const frequency = String((ruleConfig as { frequency?: unknown }).frequency ?? '').toUpperCase();
  return frequency === 'DAILY';
}

function canPostponeDailyRecurringTaskToDeadline(
  currentDeadline: Date,
  newDeadline: Date,
  recurrenceTimeZone?: string | null,
): boolean {
  const safeTimeZone =
    typeof recurrenceTimeZone === 'string' && isValidTimeZone(recurrenceTimeZone)
      ? recurrenceTimeZone
      : 'UTC';

  const currentDay = getDatePartsInTimeZone(currentDeadline, safeTimeZone);
  const nextDay = getDatePartsInTimeZone(newDeadline, safeTimeZone);

  return (
    currentDay.year === nextDay.year
    && currentDay.month === nextDay.month
    && currentDay.day === nextDay.day
  );
}

function buildDefaultDeadlineReminderRows(input: {
  parentTaskId: string;
  userId: string;
  deadline: Date;
  deadlineOneHourWarningEnabled: boolean;
  deadlineFinalWarningEnabled: boolean;
  now?: Date;
}) {
  const {
    parentTaskId,
    userId,
    deadline,
    deadlineOneHourWarningEnabled,
    deadlineFinalWarningEnabled,
    now = new Date(),
  } = input;

  const deadlineMs = deadline.getTime();
  if (Number.isNaN(deadlineMs)) return [] as any[];

  const seededNowMs = now.getTime();
  const seededNowIso = now.toISOString();
  const rowsByReminderMs = new Map<number, any>();

  const pushReminder = (enabled: boolean, offsetMs: number, source: string) => {
    if (!enabled) return;

    const reminderMs = deadlineMs - offsetMs;
    const reminderIso = new Date(reminderMs).toISOString();
    const isPast = reminderMs <= seededNowMs;

    rowsByReminderMs.set(reminderMs, {
      parent_task_id: parentTaskId,
      user_id: userId,
      reminder_at: reminderIso,
      source,
      notified_at: isPast ? seededNowIso : null,
      created_at: seededNowIso,
      updated_at: seededNowIso,
    });
  };

  pushReminder(
    deadlineOneHourWarningEnabled,
    60 * 60 * 1000,
    DEFAULT_DEADLINE_1H_REMINDER_SOURCE,
  );
  pushReminder(
    deadlineFinalWarningEnabled,
    10 * 60 * 1000,
    DEFAULT_DEADLINE_10M_REMINDER_SOURCE,
  );

  return Array.from(rowsByReminderMs.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, row]) => row);
}

async function realignTaskRemindersAfterPostpone(
  taskId: string,
  userId: string,
  oldDeadline: Date,
  newDeadline: Date,
): Promise<{ error?: string }> {
  const { data: existingReminders, error: existingRemindersError } = await supabase
    .from('task_reminders')
    .select('id, reminder_at, source, created_at, notified_at')
    .eq('parent_task_id', taskId)
    .eq('user_id', userId);

  if (existingRemindersError) {
    return { error: existingRemindersError.message };
  }

  const { data: reminderDefaultsProfile, error: reminderDefaultsError } = await supabase
    .from('profiles')
    .select('deadline_one_hour_warning_enabled, deadline_final_warning_enabled')
    .eq('id', userId)
    .maybeSingle();

  if (reminderDefaultsError) {
    return { error: reminderDefaultsError.message };
  }

  const now = new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  const deadlineDeltaMs = newDeadline.getTime() - oldDeadline.getTime();
  const rowsByReminderIso = new Map<string, any>();

  for (const row of ((existingReminders as {
    reminder_at: string;
    source?: string | null;
    created_at: string;
  }[] | null) || [])) {
    const reminderMs = new Date(row.reminder_at).getTime();
    if (Number.isNaN(reminderMs) || reminderMs <= nowMs) {
      continue;
    }

    const source = row.source || MANUAL_REMINDER_SOURCE;
    if (source !== MANUAL_REMINDER_SOURCE) {
      continue;
    }

    const shiftedReminderMs = reminderMs + deadlineDeltaMs;
    if (shiftedReminderMs <= nowMs) {
      continue;
    }

    const shiftedReminderIso = new Date(shiftedReminderMs).toISOString();
    if (rowsByReminderIso.has(shiftedReminderIso)) {
      continue;
    }

    rowsByReminderIso.set(shiftedReminderIso, {
      parent_task_id: taskId,
      user_id: userId,
      reminder_at: shiftedReminderIso,
      source: MANUAL_REMINDER_SOURCE,
      notified_at: null,
      created_at: row.created_at || nowIso,
      updated_at: nowIso,
    });
  }

  const defaultReminderRows = buildDefaultDeadlineReminderRows({
    parentTaskId: taskId,
    userId,
    deadline: newDeadline,
    deadlineOneHourWarningEnabled:
      ((reminderDefaultsProfile as any)?.deadline_one_hour_warning_enabled as boolean | undefined) ?? true,
    deadlineFinalWarningEnabled:
      ((reminderDefaultsProfile as any)?.deadline_final_warning_enabled as boolean | undefined) ?? true,
    now,
  });

  for (const row of defaultReminderRows) {
    const reminderMs = new Date(row.reminder_at).getTime();
    if (Number.isNaN(reminderMs) || reminderMs <= nowMs) {
      continue;
    }

    const reminderIso = new Date(reminderMs).toISOString();
    if (rowsByReminderIso.has(reminderIso)) {
      continue;
    }

    rowsByReminderIso.set(reminderIso, {
      ...row,
      notified_at: null,
      created_at: row.created_at ?? nowIso,
      updated_at: nowIso,
    });
  }

  const nextFutureRows = Array.from(rowsByReminderIso.values());
  if (nextFutureRows.length > 0) {
    const { error: upsertError } = await supabase
      .from('task_reminders')
      .upsert(nextFutureRows, { onConflict: 'parent_task_id,reminder_at' });

    if (upsertError) {
      return { error: upsertError.message };
    }
  }

  const nextFutureReminderIsoSet = new Set(
    nextFutureRows.map((row) => new Date(row.reminder_at as string).toISOString()),
  );
  const reminderIdsToDelete = ((existingReminders as { id: string; reminder_at: string }[] | null) || [])
    .filter((row) => {
      const reminderMs = new Date(row.reminder_at).getTime();
      if (Number.isNaN(reminderMs) || reminderMs <= nowMs) {
        return false;
      }
      return !nextFutureReminderIsoSet.has(new Date(reminderMs).toISOString());
    })
    .map((row) => row.id);

  if (reminderIdsToDelete.length > 0) {
    const { error: deleteError } = await supabase
      .from('task_reminders')
      .delete()
      .in('id', reminderIdsToDelete as any)
      .eq('user_id', userId as any);

    if (deleteError) {
      return { error: deleteError.message };
    }
  }

  return {};
}

export async function postponeTask(
  taskId: string,
  newDeadlineIso: string,
  actorUserClientInstanceId?: string | null,
): Promise<PostponeResult> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return { success: false, error: 'Not authenticated' };
    }

    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('*')
      .eq('id', taskId)
      .eq('user_id', userId)
      .single();

    if (taskError || !task) {
      return { success: false, error: taskError?.message ?? 'Task not found' };
    }

    if (typeof newDeadlineIso !== 'string' || !newDeadlineIso.trim()) {
      return { success: false, error: INVALID_DEADLINE_ERROR };
    }

    const deadlineValidation = parseAndValidateFutureDeadline(newDeadlineIso);
    if (!deadlineValidation.deadline) {
      return { success: false, error: deadlineValidation.error || INVALID_DEADLINE_ERROR };
    }
    const newDeadlineDate = deadlineValidation.deadline;

    const currentDeadline = new Date((task as any).deadline);
    if (Number.isNaN(currentDeadline.getTime())) {
      return { success: false, error: INVALID_DEADLINE_ERROR };
    }

    if (Date.now() >= currentDeadline.getTime()) {
      return { success: false, error: 'Deadline has passed' };
    }

    if (!['ACTIVE', 'POSTPONED'].includes((task as any).status)) {
      return { success: false, error: `Cannot postpone task in ${(task as any).status} status` };
    }

    if ((task as any).postponed_at) {
      return { success: false, error: 'Task has already been postponed once' };
    }

    if ((task as any).recurrence_rule_id) {
      const { data: recurrenceRule, error: recurrenceRuleError } = await supabase
        .from('recurrence_rules')
        .select('rule_config, timezone')
        .eq('id', (task as any).recurrence_rule_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (recurrenceRuleError) {
        return { success: false, error: recurrenceRuleError.message };
      }

      if (shouldRestrictDailyPostponeToSameRuleDay((recurrenceRule as any)?.rule_config)) {
        const recurrenceTimeZone =
          typeof (recurrenceRule as any)?.timezone === 'string'
            ? ((recurrenceRule as any).timezone as string)
            : null;

        const canPostponeWithinSameRuleDay = canPostponeDailyRecurringTaskToDeadline(
          currentDeadline,
          newDeadlineDate,
          recurrenceTimeZone,
        );

        if (!canPostponeWithinSameRuleDay) {
          return { success: false, error: DAILY_RECURRING_POSTPONE_SAME_DAY_ERROR };
        }
      }
    }

    const nowIso = new Date().toISOString();
    const resolvedActorUserClientInstanceId =
      actorUserClientInstanceId ?? await resolveUserClientInstanceId(userId);
    const { error: updateError } = await supabase
      .from('tasks')
      .update({
        status: 'POSTPONED',
        deadline: newDeadlineDate.toISOString(),
        postponed_at: nowIso,
        updated_at: nowIso,
      } as any)
      .eq('id', taskId)
      .eq('user_id', userId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    const [reminderRealignment, { error: eventError }] = await Promise.all([
      realignTaskRemindersAfterPostpone(taskId, userId, currentDeadline, newDeadlineDate),
      supabase
        .from('task_events')
        .insert({
          task_id: taskId,
          event_type: 'POSTPONE',
          actor_id: userId,
          actor_user_client_instance_id: resolvedActorUserClientInstanceId,
          from_status: (task as any).status,
          to_status: 'POSTPONED',
          metadata: { new_deadline: newDeadlineDate.toISOString() },
        } as any),
    ]);

    if (reminderRealignment.error) {
      return { success: false, error: reminderRealignment.error };
    }

    if (eventError) {
      return { success: false, error: eventError.message };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error?.message ?? 'Could not postpone task' };
  }
}
