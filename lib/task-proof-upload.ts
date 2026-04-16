import type { ImagePickerAsset } from 'expo-image-picker';
import { File } from 'expo-file-system';
import { supabase } from '@/lib/supabase';
import { deriveProofTimestampText } from '@/lib/proof-timestamp-mobile';
import { resolveUserClientInstanceId } from '@/lib/user-client-instance';

const TASK_PROOFS_BUCKET = 'task-proofs';
const MAX_TASK_PROOF_VIDEO_DURATION_MS = 15_000;

const ALLOWED_PROOF_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/quicktime',
  'video/webm',
]);

const ATTACHABLE_PROOF_STATUSES = new Set([
  'ACTIVE',
  'POSTPONED',
  'MARKED_COMPLETE',
  'AWAITING_VOUCHER',
  'AWAITING_ORCA',
  'AWAITING_USER',
  'ESCALATED',
]);

function inferExtensionFromMime(mimeType: string): string {
  const normalized = (mimeType || '').toLowerCase();
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('mp4')) return 'mp4';
  if (normalized.includes('quicktime')) return 'mov';
  if (normalized.includes('webm')) return 'webm';
  return 'bin';
}

function inferMimeTypeFromUri(uri: string, mediaKind: 'image' | 'video'): string {
  const normalized = uri.toLowerCase();
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.heic')) return 'image/heic';
  if (normalized.endsWith('.heif')) return 'image/heif';
  if (normalized.endsWith('.mp4')) return 'video/mp4';
  if (normalized.endsWith('.mov') || normalized.endsWith('.qt')) return 'video/quicktime';
  if (normalized.endsWith('.webm')) return 'video/webm';
  return mediaKind === 'video' ? 'video/mp4' : 'image/jpeg';
}

interface ProofUploadSuccess {
  success: true;
  mediaKind: 'image' | 'video';
}

interface ProofUploadFailure {
  success: false;
  error: string;
}

export type TaskProofUploadResult = ProofUploadSuccess | ProofUploadFailure;

export async function uploadTaskProofAsset(taskId: string, asset: ImagePickerAsset): Promise<TaskProofUploadResult> {
  try {
    if (!asset.uri) {
      return { success: false, error: 'Selected media is missing a file path.' };
    }

    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return { success: false, error: 'Please sign in again and retry.' };
    }

    const mediaKind: 'image' | 'video' = asset.type === 'video' ? 'video' : 'image';
    const mimeType = (asset.mimeType || inferMimeTypeFromUri(asset.uri, mediaKind)).toLowerCase();
    if (!ALLOWED_PROOF_MIME_TYPES.has(mimeType)) {
      return { success: false, error: 'Please use JPG, PNG, WEBP, HEIC, MP4, MOV, or WEBM.' };
    }

    const durationMs = mediaKind === 'video'
      ? Math.round(Number(asset.duration ?? 0))
      : null;

    if (mediaKind === 'video' && (!Number.isFinite(durationMs) || !durationMs || durationMs <= 0)) {
      return { success: false, error: 'Could not read video duration. Try another clip.' };
    }

    if (mediaKind === 'video' && Number(durationMs ?? 0) > MAX_TASK_PROOF_VIDEO_DURATION_MS) {
      return { success: false, error: 'Video proof must be 15 seconds or less.' };
    }

    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('id, user_id, voucher_id, status')
      .eq('id', taskId)
      .single();

    if (taskError || !task) {
      return { success: false, error: taskError?.message ?? 'Task not found.' };
    }

    if ((task as any).user_id !== userId) {
      return { success: false, error: 'You can only upload proof for your own tasks.' };
    }

    if (!ATTACHABLE_PROOF_STATUSES.has((task as any).status)) {
      return { success: false, error: 'Proof can only be attached to active or awaiting tasks.' };
    }

    const fileResponse = await fetch(asset.uri);
    if (!fileResponse.ok) {
      return { success: false, error: 'Could not read selected media.' };
    }

    const fileBytes = await fileResponse.arrayBuffer();
    const sizeBytes = Number(asset.fileSize ?? fileBytes.byteLength);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      return { success: false, error: 'Selected media size is invalid.' };
    }

    let fileModificationTimeMs: number | null = null;
    let fileCreationTimeMs: number | null = null;
    try {
      const file = new File(asset.uri);
      fileModificationTimeMs = file.modificationTime ?? null;
      fileCreationTimeMs = file.creationTime ?? null;
    } catch {
      // keep null timestamps; helper will fall back safely
    }

    const overlayTimestampText = deriveProofTimestampText({
      asset,
      mimeType,
      fileBuffer: fileBytes,
      fileModificationTimeMs,
      fileCreationTimeMs,
    });

    const { data: existingProof, error: existingProofError } = await supabase
      .from('task_completion_proofs')
      .select('bucket, object_path')
      .eq('task_id', taskId)
      .maybeSingle();

    if (existingProofError) {
      return { success: false, error: existingProofError.message };
    }

    const bucketName = ((existingProof as any)?.bucket as string) || TASK_PROOFS_BUCKET;
    const objectPath = ((existingProof as any)?.object_path as string)
      || `${userId}/${taskId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${inferExtensionFromMime(mimeType)}`;

    const { error: initError } = await supabase
      .from('task_completion_proofs')
      .upsert(
        {
          task_id: taskId,
          owner_id: userId,
          voucher_id: (task as any).voucher_id,
          bucket: bucketName,
          object_path: objectPath,
          media_kind: mediaKind,
          mime_type: mimeType,
          size_bytes: sizeBytes,
          duration_ms: durationMs,
          overlay_timestamp_text: overlayTimestampText,
          upload_state: 'PENDING',
        },
        { onConflict: 'task_id' },
      );

    if (initError) {
      return { success: false, error: initError.message };
    }

    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(objectPath, fileBytes, {
        upsert: true,
        contentType: mimeType,
        cacheControl: '120',
      });

    if (uploadError) {
      await supabase
        .from('task_completion_proofs')
        .update({
          upload_state: 'FAILED',
          updated_at: new Date().toISOString(),
        } as any)
        .eq('task_id', taskId)
        .eq('owner_id', userId);

      return { success: false, error: uploadError.message || 'Upload failed.' };
    }

    const nowIso = new Date().toISOString();
    const actorUserClientInstanceId = await resolveUserClientInstanceId(userId);

    const { error: finalizeError } = await supabase
      .from('task_completion_proofs')
      .update({
        media_kind: mediaKind,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        duration_ms: durationMs,
        overlay_timestamp_text: overlayTimestampText,
        upload_state: 'UPLOADED',
        updated_at: nowIso,
      } as any)
      .eq('task_id', taskId)
      .eq('owner_id', userId);

    if (finalizeError) {
      return { success: false, error: finalizeError.message };
    }

    await supabase
      .from('tasks')
      .update({
        proof_request_open: false,
        proof_requested_at: null,
        proof_requested_by: null,
        updated_at: nowIso,
      } as any)
      .eq('id', taskId)
      .eq('user_id', userId)
      .in('status', ['AWAITING_VOUCHER', 'AWAITING_ORCA', 'MARKED_COMPLETE'] as any);

    await supabase
      .from('task_events')
      .insert({
        task_id: taskId,
        event_type: 'PROOF_UPLOADED',
        actor_id: userId,
        actor_user_client_instance_id: actorUserClientInstanceId,
        from_status: (task as any).status,
        to_status: (task as any).status,
        metadata: {
          media_kind: mediaKind,
          mime_type: mimeType,
          size_bytes: sizeBytes,
          duration_ms: durationMs,
        },
      } as any);

    return { success: true, mediaKind };
  } catch (error: any) {
    return { success: false, error: error?.message ?? 'Please try again.' };
  }
}
