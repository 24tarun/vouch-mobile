import type { ImagePickerAsset } from 'expo-image-picker';
import { supabase } from '@/lib/supabase';
import { postponeTask } from '@/lib/task-postpone';
import { uploadTaskProofAsset } from '@/lib/task-proof-upload';
import { resolveUserClientInstanceId } from '@/lib/user-client-instance';
import { AI_PROFILE_ID } from '@/lib/constants/ai-profile';

const TASK_DELETE_WINDOW_MS = 10 * 60 * 1000;

interface TaskMutationResult {
  success: boolean;
  userId?: string;
  error?: string;
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
  const targetIso = `${targetLocal.year}-${month}-${day}T23:59:59.999${tzSuffix}`;

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

  const nowIso = new Date().toISOString();
  const actorUserClientInstanceId = await resolveUserClientInstanceId(userId);
  const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('id, voucher_id, status')
    .eq('id', taskId)
    .eq('user_id', userId)
    .single();

  if (taskError || !task) {
    return { success: false, userId, error: taskError?.message ?? 'Task not found.' };
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
    .gt('deadline', nowIso)
    .select('id');

  if (error) return { success: false, userId, error: error.message };

  if (!updatedRows || updatedRows.length === 0) {
    return { success: false, userId, error: 'Task can no longer be marked complete. Please refresh.' };
  }

  await supabase.from('task_events').insert({
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

  return { success: true, userId };
}

export async function undoCompleteTask(taskId: string, fromStatus: string): Promise<TaskMutationResult> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, error: 'Please sign in again and retry.' };

  const now = new Date().toISOString();
  const actorUserClientInstanceId = await resolveUserClientInstanceId(userId);

  const { error } = await supabase
    .from('tasks')
    .update({
      status: 'ACTIVE',
      marked_completed_at: null,
      voucher_response_deadline: null,
      updated_at: now,
    })
    .eq('id', taskId)
    .eq('user_id', userId)
    .in('status', ['MARKED_COMPLETE', 'AWAITING_VOUCHER', 'AWAITING_AI']);

  if (error) return { success: false, userId, error: error.message };

  await supabase.from('task_events').insert({
    task_id: taskId,
    event_type: 'UNDO_COMPLETE',
    actor_id: userId,
    actor_user_client_instance_id: actorUserClientInstanceId,
    from_status: fromStatus,
    to_status: 'ACTIVE',
  });

  return { success: true, userId };
}

export async function deleteTask(taskId: string): Promise<TaskMutationResult> {
  const userId = await getAuthenticatedUserId();
  if (!userId) return { success: false, error: 'Please sign in again and retry.' };

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('tasks')
    .update({ status: 'DELETED', updated_at: nowIso })
    .eq('id', taskId)
    .eq('user_id', userId);

  if (error) return { success: false, userId, error: error.message };
  return { success: true, userId };
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
