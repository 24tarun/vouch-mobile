import type { ImagePickerAsset } from 'expo-image-picker';
import { File } from 'expo-file-system';
import { supabase } from '@/lib/supabase';
import { deriveProofTimestampText } from '@/lib/proof-timestamp-mobile';

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

interface ProofUploadSuccess {
  success: true;
  mediaKind: 'image' | 'video';
}

interface ProofUploadFailure {
  success: false;
  error: string;
}

interface TaskProofIntent {
  mediaKind: 'image' | 'video';
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  overlayTimestampText: string;
}

interface TaskProofMeta extends TaskProofIntent {
  bucket: string;
  objectPath: string;
}

interface TaskProofUploadTarget {
  bucket: string;
  objectPath: string;
  uploadToken: string;
}

interface TaskProofInitResponse {
  success: boolean;
  error?: string;
  proofUploadTarget?: TaskProofUploadTarget;
}

interface TaskProofSimpleResponse {
  success: boolean;
  error?: string;
}

export type TaskProofUploadResult = ProofUploadSuccess | ProofUploadFailure;
export type TaskProofRemoveResult = { success: true } | { success: false; error: string };
export type TaskProofPurgeResult = { success: true } | { success: false; error: string };

async function invokeTaskProofFunction<TResponse>(body: Record<string, unknown>) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!accessToken) {
    return {
      data: null as TResponse | null,
      error: { message: 'Please sign in again and retry.' } as unknown,
    };
  }

  if (!anonKey) {
    return {
      data: null as TResponse | null,
      error: { message: 'Missing EXPO_PUBLIC_SUPABASE_ANON_KEY.' } as unknown,
    };
  }

  if (!supabaseUrl) {
    return {
      data: null as TResponse | null,
      error: { message: 'Missing EXPO_PUBLIC_SUPABASE_URL.' } as unknown,
    };
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/task-proof-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    let parsed: unknown = null;
    try {
      parsed = await response.clone().json();
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      return {
        data: null as TResponse | null,
        error: {
          name: 'FunctionsHttpError',
          message: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`,
          context: response,
          payload: parsed,
        } as unknown,
      };
    }

    return {
      data: (parsed as TResponse) ?? null,
      error: null,
    };
  } catch (error) {
    return {
      data: null as TResponse | null,
      error,
    };
  }
}

function storageContentType(mimeType: string): string {
  return mimeType;
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

async function invokeErrorMessage(error: unknown): Promise<string> {
  if (error && typeof error === 'object') {
    const candidate = error as Record<string, unknown>;
    const errorName = typeof candidate.name === 'string' ? candidate.name : '';
    const context = candidate.context;
    if (
      context
      && typeof context === 'object'
      && typeof (context as { text?: unknown }).text === 'function'
    ) {
      const response = context as Response;
      const statusPrefix = Number.isFinite(response.status)
        ? `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}: `
        : '';
      try {
        const payload = await response.clone().json() as { error?: unknown };
        if (typeof payload?.error === 'string' && payload.error.trim()) {
          return `${statusPrefix}${payload.error}`;
        }
      } catch {
        try {
          const rawText = await response.clone().text();
          if (rawText.trim()) return `${statusPrefix}${rawText}`;
        } catch {
          // ignore and fall back
        }
      }

      if (statusPrefix) {
        return `${statusPrefix}Edge function request failed.`;
      }
    }

    if (typeof candidate.message === 'string' && candidate.message.trim()) {
      return errorName ? `${errorName}: ${candidate.message}` : candidate.message;
    }
  }
  return 'Please try again.';
}

async function initProofUpload(taskId: string, proofIntent: TaskProofIntent): Promise<{ success: true; target: TaskProofUploadTarget } | { success: false; error: string }> {
  const { data, error } = await invokeTaskProofFunction<TaskProofInitResponse>({
    action: 'init',
    taskId,
    proofIntent,
  });

  if (error) {
    return { success: false, error: await invokeErrorMessage(error) };
  }

  if (!data?.success || !data.proofUploadTarget?.uploadToken) {
    return { success: false, error: data?.error || 'Could not create proof upload session.' };
  }

  return {
    success: true,
    target: data.proofUploadTarget,
  };
}

async function finalizeProofUpload(taskId: string, proofMeta: TaskProofMeta): Promise<{ success: true } | { success: false; error: string }> {
  const { data, error } = await invokeTaskProofFunction<TaskProofSimpleResponse>({
    action: 'finalize',
    taskId,
    proofMeta,
  });

  if (error) {
    return { success: false, error: await invokeErrorMessage(error) };
  }

  if (!data?.success) {
    return { success: false, error: data?.error || 'Could not finalize proof upload.' };
  }

  return { success: true };
}

async function markProofUploadFailed(taskId: string, proofMeta: { bucket: string; objectPath: string }): Promise<void> {
  await invokeTaskProofFunction<TaskProofSimpleResponse>({
    action: 'fail',
    taskId,
    proofMeta,
  });
}

export async function removeTaskProofAsset(
  taskId: string,
  proofMeta: { bucket: string; objectPath: string },
): Promise<TaskProofRemoveResult> {
  const { data, error } = await invokeTaskProofFunction<TaskProofSimpleResponse>({
    action: 'fail',
    taskId,
    proofMeta,
  });

  if (error) {
    return { success: false, error: await invokeErrorMessage(error) };
  }

  if (!data?.success) {
    return { success: false, error: data?.error || 'Could not remove proof.' };
  }

  return { success: true };
}

export async function purgeTaskProofForFinalState(taskId: string): Promise<TaskProofPurgeResult> {
  const { data, error } = await invokeTaskProofFunction<TaskProofSimpleResponse>({
    action: 'purge-final',
    taskId,
  });

  if (error) {
    return { success: false, error: await invokeErrorMessage(error) };
  }

  if (!data?.success) {
    return { success: false, error: data?.error || 'Could not purge proof for final state.' };
  }

  return { success: true };
}

export async function queueAiEvalForTask(taskId: string): Promise<{ success: true } | { success: false; error: string }> {
  const { data, error } = await invokeTaskProofFunction<TaskProofSimpleResponse>({
    action: 'queue-ai-eval',
    taskId,
  });

  if (error) {
    return { success: false, error: await invokeErrorMessage(error) };
  }

  if (!data?.success) {
    return { success: false, error: data?.error || 'Could not queue AI evaluation.' };
  }

  return { success: true };
}

export async function removeCurrentTaskProofAsset(taskId: string): Promise<TaskProofRemoveResult> {
  const { data, error } = await invokeTaskProofFunction<TaskProofSimpleResponse>({
    action: 'remove-current',
    taskId,
  });

  if (error) {
    return { success: false, error: await invokeErrorMessage(error) };
  }

  if (!data?.success) {
    return { success: false, error: data?.error || 'Could not remove proof.' };
  }

  return { success: true };
}

export async function uploadTaskProofAsset(taskId: string, asset: ImagePickerAsset): Promise<TaskProofUploadResult> {
  try {
    if (!asset.uri) {
      return { success: false, error: 'Selected media is missing a file path.' };
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

    const proofIntent: TaskProofIntent = {
      mediaKind,
      mimeType,
      sizeBytes,
      durationMs,
      overlayTimestampText,
    };

    const initResult = await initProofUpload(taskId, proofIntent);
    if (!initResult.success) {
      return { success: false, error: initResult.error };
    }

    const { bucket, objectPath, uploadToken } = initResult.target;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .uploadToSignedUrl(objectPath, uploadToken, fileBytes, {
        contentType: storageContentType(mimeType),
      });

    if (uploadError) {
      await markProofUploadFailed(taskId, { bucket, objectPath });
      return { success: false, error: uploadError.message || 'Upload failed.' };
    }

    const finalizeResult = await finalizeProofUpload(taskId, {
      ...proofIntent,
      bucket,
      objectPath,
    });

    if (!finalizeResult.success) {
      await markProofUploadFailed(taskId, { bucket, objectPath });
      return { success: false, error: finalizeResult.error };
    }

    return { success: true, mediaKind };
  } catch (error: unknown) {
    return { success: false, error: await invokeErrorMessage(error) };
  }
}
