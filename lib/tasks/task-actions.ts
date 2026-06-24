import type { ImagePickerAsset } from 'expo-image-picker';
import { supabase } from '@/lib/supabase';
import { postponeTask } from '@/lib/task-postpone';
import { purgeTaskProofForFinalState, queueAiEvalForTask, removeCurrentTaskProofAsset, uploadTaskProofAsset } from '@/lib/task-proof-upload';
import { syncGoogleCalendarTaskAfterDelete } from '@/lib/google-calendar-mobile-sync';
import { resolveUserClientInstanceId } from '@/lib/user-client-instance';
import { AI_PROFILE_ID } from '@/lib/constants/ai-profile';
import { TASK_DELETE_WINDOW_MS } from '@/lib/constants/timings';
import { isValidTimeZone, getDatePartsInTimeZone } from '@/lib/utils/timezone';

interface TaskMutationResult {
  success: boolean;
  userId?: string;
  error?: string;
  warningMessage?: string;
  recurrenceRuleId?: string;
  pausedAt?: string | null;
  stateChanged?: boolean;
}

const DEADLINE_INCLUSIVE_MINUTE_MS = 60 * 1000;

function getOffsetIsoForTimeZone(date: Date, timeZone: string): string {
  const offsetPart = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  })
    .formatToParts(date)
    .find((part) => part.type === 'timeZoneName')?.value;

  if (!offsetPart || offsetPart === 'GMT') {
    return 'Z';
  }

  return offsetPart.replace('GMT', '');
}

function getVoucherResponseDeadlineUtc(baseDate: Date = new Date(), userTimeZone?: string): Date {
  const timeZone = userTimeZone && isValidTimeZone(userTimeZone) ? userTimeZone : 'UTC';

  const baseLocal = getDatePartsInTimeZone(baseDate, timeZone);
  const targetNoonUtc = new Date(Date.UTC(baseLocal.year, baseLocal.month - 1, baseLocal.day + 2, 12, 0, 0, 0));
  const targetLocal = getDatePartsInTimeZone(targetNoonUtc, timeZone);
  const offsetIso = getOffsetIsoForTimeZone(
    new Date(Date.UTC(targetLocal.year, targetLocal.month - 1, targetLocal.day, 12, 0, 0, 0)),
    timeZone,
  );

  const month = String(targetLocal.month).padStart(2, '0');
  const day = String(targetLocal.day).padStart(2, '0');
  const tzSuffix = offsetIso === 'Z' ? 'Z' : offsetIso;
  const targetIso = `${targetLocal.year}-${month}-${day}T23:00:00.000${tzSuffix}`;

  return new Date(targetIso);
}

export function isTaskWithinDeleteWindow(createdAt: string | null | undefined): boolean {
  const createdAtMs = createdAt ? new Date(createdAt).getTime() : NaN;
  return Number.isFinite(createdAtMs) && (Date.now() - createdAtMs) <= TASK_DELETE_WINDOW_MS;
}

async function getAuthenticatedUserId(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

export async function completeTask(taskId: string): Promise<TaskMutationResult> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, error: 'Please sign in again and retry.' };

  const now = new Date();
  const nowIso = now.toISOString();
  const completionDeadlineCutoffIso = new Date(now.getTime() - DEADLINE_INCLUSIVE_MINUTE_MS).toISOString();
  const actorUserClientInstanceId = await resolveUserClientInstanceId(userId);
  const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('id, voucher_id, status, requires_proof, has_proof')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (taskError || !task) {
    return { success: false, userId, error: taskError?.message ?? 'Task not found.' };
  }

  if ((task as any).requires_proof) {
    const { data: proofRows, error: proofCheckError } = await supabase
      .from('task_completion_proofs')
      .select('id')
      .eq('task_id', taskId)
      .eq('upload_state', 'UPLOADED')
      .not('object_path', 'is', null)
      .limit(1);

    if (proofCheckError) {
      return { success: false, userId, error: proofCheckError.message };
    }

    const hasUploadedProof = Boolean(proofRows && proofRows.length > 0);
    if (!hasUploadedProof) {
      return { success: false, userId, error: 'Please upload proof before marking this task complete.' };
    }
  }

  const isSelfVouched = task.voucher_id === userId;
  const nextStatus = isSelfVouched
    ? 'ACCEPTED'
    : task.voucher_id === AI_PROFILE_ID
      ? 'AWAITING_AI'
      : 'AWAITING_VOUCHER';
  const voucherResponseDeadline = isSelfVouched || task.voucher_id === AI_PROFILE_ID
    ? null
    : getVoucherResponseDeadlineUtc(new Date(nowIso), userTimeZone).toISOString();

  const { data: updatedRows, error } = await supabase
    .from('tasks')
    .update({
      status: nextStatus,
      marked_completed_at: nowIso,
      voucher_response_deadline: voucherResponseDeadline,
      proof_request_open: false,
      proof_requested_at: null,
      proof_requested_by: null,
      updated_at: nowIso,
    })
    .eq('id', taskId)
    .eq('user_id', userId)
    .in('status', ['ACTIVE', 'POSTPONED'])
    .gt('deadline', completionDeadlineCutoffIso)
    .select('id');

  if (error) return { success: false, userId, error: error.message };

  if (!updatedRows || updatedRows.length === 0) {
    return { success: false, userId, error: 'Task can no longer be marked complete. Please refresh.' };
  }

  const { error: eventError } = await supabase.from('task_events').insert({
    task_id: taskId,
    event_type: 'MARK_COMPLETE',
    actor_id: userId,
    actor_user_client_instance_id: actorUserClientInstanceId,
    from_status: task.status,
    to_status: nextStatus,
    metadata: isSelfVouched
      ? {
          self_vouched: true,
          auto_accepted: true,
        }
      : null,
  });
  if (eventError) console.warn('[task-actions] MARK_COMPLETE event insert failed:', eventError.message);

  if (nextStatus === 'AWAITING_AI') {
    const queueResult = await queueAiEvalForTask(taskId);
    if (!queueResult.success) {
      console.warn('[task-actions] AI eval queue failed:', queueResult.error);
    }
  }

  if (nextStatus === 'ACCEPTED' && (task as any).has_proof) {
    const purgeResult = await purgeTaskProofForFinalState(taskId);
    if (!purgeResult.success) {
      return { success: false, userId, error: `Task accepted, but proof cleanup failed: ${purgeResult.error}` };
    }
  }

  return { success: true, userId };
}

export async function undoCompleteTask(taskId: string, fromStatus: string): Promise<TaskMutationResult> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, error: 'Please sign in again and retry.' };

  const now = new Date().toISOString();
  const actorUserClientInstanceId = await resolveUserClientInstanceId(userId);
  const { data: taskSnapshot, error: taskSnapshotError } = await supabase
    .from('tasks')
    .select('id, voucher_id, ai_escalated_from')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (taskSnapshotError || !taskSnapshot) {
    return { success: false, userId, error: taskSnapshotError?.message ?? 'Task not found.' };
  }

  const shouldRestoreAiVoucher = taskSnapshot.ai_escalated_from && taskSnapshot.voucher_id !== AI_PROFILE_ID;

  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'ACTIVE',
      marked_completed_at: null,
      voucher_response_deadline: null,
      voucher_id: shouldRestoreAiVoucher ? AI_PROFILE_ID : taskSnapshot.voucher_id,
      ai_escalated_from: shouldRestoreAiVoucher ? false : taskSnapshot.ai_escalated_from,
      updated_at: now,
    })
    .eq('id', taskId)
    .eq('user_id', userId)
    .in('status', ['MARKED_COMPLETE', 'AWAITING_VOUCHER', 'AWAITING_AI']);

  if (error) return { success: false, userId, error: error.message };

  const { error: undoEventError } = await supabase.from('task_events').insert({
    task_id: taskId,
    event_type: 'UNDO_COMPLETE',
    actor_id: userId,
    actor_user_client_instance_id: actorUserClientInstanceId,
    from_status: fromStatus,
    to_status: 'ACTIVE',
    metadata: shouldRestoreAiVoucher
      ? {
          restored_ai_voucher: true,
          previous_human_voucher_id: taskSnapshot.voucher_id,
        }
      : null,
  });
  if (undoEventError) console.warn('[task-actions] UNDO_COMPLETE event insert failed:', undoEventError.message);

  return { success: true, userId };
}

export async function deleteTask(taskId: string): Promise<TaskMutationResult> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, error: 'Please sign in again and retry.' };

  const { data: task, error: taskFetchError } = await supabase
    .from('tasks')
    .select('id, recurrence_rule_id, status, created_at')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (taskFetchError || !task) {
    return { success: false, userId, error: taskFetchError?.message ?? 'Task not found.' };
  }

  if (!['ACTIVE', 'POSTPONED'].includes(task.status)) {
    return { success: false, userId, error: `Cannot delete task in ${task.status} status.` };
  }

  if (!isTaskWithinDeleteWindow(task.created_at)) {
    return { success: false, userId, error: 'Delete window expired. Tasks can only be deleted within 1 hour.' };
  }

  const { data: googleLink, error: googleLinkError } = await supabase
    .from('google_calendar_task_links')
    .select('google_event_id, calendar_id')
    .eq('task_id', taskId)
    .eq('user_id', userId)
    .maybeSingle();

  if (googleLinkError) {
    console.warn('[task-actions] failed to read Google link before delete', {
      taskId,
      message: googleLinkError.message,
    });
  }

  if (task.recurrence_rule_id) {
    const { error: ruleDeleteError } = await supabase
      .from('recurrence_rules')
      .delete()
      .eq('id', task.recurrence_rule_id)
      .eq('user_id', userId);

    if (ruleDeleteError) {
      return { success: false, userId, error: ruleDeleteError.message };
    }
  }

  const { data: deletedRows, error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', taskId)
    .eq('user_id', userId)
    .in('status', ['ACTIVE', 'POSTPONED'])
    .select('id');

  if (error) return { success: false, userId, error: error.message };

  if (!deletedRows || deletedRows.length === 0) {
    return { success: false, userId, error: 'Task can no longer be deleted. Please refresh.' };
  }

  const googleDeleteResult = await syncGoogleCalendarTaskAfterDelete(
    taskId,
    (googleLink as { google_event_id?: string | null } | null)?.google_event_id ?? null,
    (googleLink as { calendar_id?: string | null } | null)?.calendar_id ?? null,
  );

  const warningMessage = googleLinkError
    ? 'Task deleted, but Google Calendar cleanup could not be prepared.'
    : (googleDeleteResult.message ?? undefined);

  return {
    success: true,
    userId,
    warningMessage,
  };
}

export async function stopTaskRepetitions(taskId: string): Promise<TaskMutationResult> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, error: 'Please sign in again and retry.' };

  const actorUserClientInstanceId = await resolveUserClientInstanceId(userId);
  const { data: task, error: taskFetchError } = await supabase
    .from('tasks')
    .select('id, status, recurrence_rule_id')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (taskFetchError || !task) {
    return { success: false, userId, error: taskFetchError?.message ?? 'Task not found.' };
  }

  if (!task.recurrence_rule_id) {
    return { success: true, userId };
  }

  const { error: ruleDeleteError } = await supabase
    .from('recurrence_rules')
    .delete()
    .eq('id', task.recurrence_rule_id)
    .eq('user_id', userId);

  if (ruleDeleteError) {
    return { success: false, userId, error: ruleDeleteError.message };
  }

  const { error: stopEventError } = await supabase.from('task_events').insert({
    task_id: task.id,
    event_type: 'REPETITION_STOPPED',
    actor_id: userId,
    actor_user_client_instance_id: actorUserClientInstanceId,
    from_status: task.status,
    to_status: task.status,
  });
  if (stopEventError) console.warn('[task-actions] REPETITION_STOPPED event insert failed:', stopEventError.message);

  return { success: true, userId };
}

export async function setTaskRepetitionsPaused(taskId: string, paused: boolean): Promise<TaskMutationResult> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, error: 'Please sign in again and retry.' };

  const actorUserClientInstanceId = await resolveUserClientInstanceId(userId);
  const { data, error } = await supabase.rpc('set_recurrence_paused' as any, {
    p_task_id: taskId,
    p_paused: paused,
    p_actor_user_client_instance_id: actorUserClientInstanceId,
  } as any);

  if (error) return { success: false, userId, error: error.message };

  const result = Array.isArray(data) ? data[0] : data;
  return {
    success: true,
    userId,
    recurrenceRuleId: (result as any)?.recurrence_rule_id,
    pausedAt: (result as any)?.paused_at ?? null,
    stateChanged: Boolean((result as any)?.state_changed),
  };
}

export async function postponeTaskDeadline(taskId: string, nextDeadlineIso: string): Promise<TaskMutationResult> {
  const result = await postponeTask(taskId, nextDeadlineIso);
  if (!result.success) return { success: false, error: result.error };

  const userId = await getAuthenticatedUserId();
  return { success: true, userId: userId ?? undefined };
}

export async function uploadTaskProof(taskId: string, asset: ImagePickerAsset) {
  return uploadTaskProofAsset(taskId, asset);
}

export async function removeTaskProof(taskId: string) {
  return removeCurrentTaskProofAsset(taskId);
}
