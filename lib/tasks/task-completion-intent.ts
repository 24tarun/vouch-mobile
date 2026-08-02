import { isOptimisticTaskId } from '@/lib/tasks/task-id';

interface CompletionTaskSnapshot {
  id: string;
  status?: string;
  postponed_at?: string | null;
  requires_proof?: boolean;
  has_proof?: boolean;
  subtaskTotal?: number;
  subtaskCompleted?: number;
}

export type TaskCompletionDecision =
  | { result: 'accepted' }
  | { result: 'proof-required' }
  | { result: 'blocked'; reason: 'optimistic' | 'busy' | 'incomplete-subtasks' };

export function getTaskCompletionDecision(
  task: CompletionTaskSnapshot,
  actionInProgress: boolean,
): TaskCompletionDecision {
  if (isOptimisticTaskId(task.id)) {
    return { result: 'blocked', reason: 'optimistic' };
  }
  if (actionInProgress) {
    return { result: 'blocked', reason: 'busy' };
  }
  if ((task.subtaskTotal ?? 0) > (task.subtaskCompleted ?? 0)) {
    return { result: 'blocked', reason: 'incomplete-subtasks' };
  }
  if (task.requires_proof && !task.has_proof) {
    return { result: 'proof-required' };
  }
  return { result: 'accepted' };
}

export function getPostProofUploadAction(
  autoSubmitAfterProofUpload: boolean,
): 'complete' | 'stay-active' {
  return autoSubmitAfterProofUpload ? 'complete' : 'stay-active';
}

export function getTaskPostponeBlockReason(
  task: CompletionTaskSnapshot,
): 'optimistic' | 'already-postponed' | null {
  if (isOptimisticTaskId(task.id)) return 'optimistic';
  if (task.status === 'POSTPONED' || task.postponed_at) return 'already-postponed';
  return null;
}
