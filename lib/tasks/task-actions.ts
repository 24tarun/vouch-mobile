import type { ImagePickerAsset } from 'expo-image-picker';
import { supabase } from '@/lib/supabase';
import { postponeTask } from '@/lib/task-postpone';
import { uploadTaskProofAsset } from '@/lib/task-proof-upload';

const TASK_DELETE_WINDOW_MS = 10 * 60 * 1000;

interface TaskMutationResult {
  success: boolean;
  userId?: string;
  error?: string;
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

  const { error } = await supabase
    .from('tasks')
    .update({ status: 'MARKED_COMPLETE', updated_at: new Date().toISOString() })
    .eq('id', taskId)
    .eq('user_id', userId);

  if (error) return { success: false, userId, error: error.message };
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
