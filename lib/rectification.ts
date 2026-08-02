import { supabase } from '@/lib/supabase';
import { resolveUserClientInstanceId } from '@/lib/user-client-instance';
import type { RectificationRequest } from '@/lib/types';

export type RectificationTarget = 'ORIGINAL_VOUCHER' | 'AI';

async function authContext() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return { user, instanceId: await resolveUserClientInstanceId(user.id) };
}

function firstRow<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? data[0] ?? null : data;
}

export async function requestTaskRectification(
  taskId: string,
  target: RectificationTarget,
  reason?: string | null,
): Promise<RectificationRequest> {
  const { instanceId } = await authContext();
  const { data, error } = await supabase.rpc('request_task_rectification', {
    p_task_id: taskId,
    p_target_type: target,
    p_reason: reason?.trim() || null,
    p_actor_user_client_instance_id: instanceId,
  });
  if (error) throw error;
  const request = firstRow(data as RectificationRequest[] | null);
  if (!request) throw new Error('Could not create rectification request');
  return request;
}

export async function updateTaskRectification(requestId: string, reason?: string | null) {
  const { instanceId } = await authContext();
  const { data, error } = await supabase.rpc('update_task_rectification', {
    p_request_id: requestId,
    p_reason: reason?.trim() || null,
    p_actor_user_client_instance_id: instanceId,
  });
  if (error) throw error;
  return firstRow(data as RectificationRequest[] | null);
}

export async function cancelTaskRectification(requestId: string) {
  const { instanceId } = await authContext();
  const { data, error } = await supabase.rpc('cancel_task_rectification', {
    p_request_id: requestId,
    p_actor_user_client_instance_id: instanceId,
  });
  if (error) throw error;
  return firstRow(data as RectificationRequest[] | null);
}

export async function requestRectificationProof(requestId: string) {
  const { instanceId } = await authContext();
  const { data, error } = await supabase.rpc('request_rectification_proof', {
    p_request_id: requestId,
    p_actor_user_client_instance_id: instanceId,
  });
  if (error) throw error;
  return firstRow(data as RectificationRequest[] | null);
}

export async function decideTaskRectification(
  requestId: string,
  decision: 'APPROVE' | 'DECLINE',
  reason?: string | null,
) {
  const { instanceId } = await authContext();
  const { data, error } = await supabase.rpc('decide_task_rectification', {
    p_request_id: requestId,
    p_decision: decision,
    p_reason: reason?.trim() || null,
    p_actor_user_client_instance_id: instanceId,
  });
  if (error) throw error;
  return firstRow(data as { task_id: string; owner_id: string; resolution: string }[] | null);
}

export async function authorizeTaskRectification(taskId: string) {
  const { instanceId } = await authContext();
  const { data, error } = await supabase.rpc('authorize_task_rectification', {
    p_task_id: taskId,
    p_actor_user_client_instance_id: instanceId,
  });
  if (error) throw error;
  return firstRow(data as { task_id: string; owner_id: string }[] | null);
}

export async function appealAiRectification(requestId: string, reason?: string | null) {
  const { instanceId } = await authContext();
  const { data, error } = await supabase.rpc('submit_rectification_ai_appeal', {
    p_request_id: requestId,
    p_reason: reason?.trim() || null,
    p_actor_user_client_instance_id: instanceId,
  });
  if (error) throw error;
  return firstRow(data as RectificationRequest[] | null);
}

export async function escalateRectificationToOriginalVoucher(requestId: string) {
  const { instanceId } = await authContext();
  const { data, error } = await supabase.rpc('escalate_rectification_to_original_voucher', {
    p_request_id: requestId,
    p_actor_user_client_instance_id: instanceId,
  });
  if (error) throw error;
  return firstRow(data as RectificationRequest[] | null);
}
