export const BYTES_PER_MIB = 1024 * 1024;

export const MAX_TASK_PROOF_IMAGE_BYTES = 4 * BYTES_PER_MIB;
export const MAX_TASK_PROOF_VIDEO_BYTES = 30 * BYTES_PER_MIB;

// Leave a little headroom for encoder/container variance while staying close to the cap.
export const TARGET_TASK_PROOF_IMAGE_BYTES = Math.floor(3.9 * BYTES_PER_MIB);
export const TARGET_TASK_PROOF_VIDEO_BYTES = Math.floor(29.5 * BYTES_PER_MIB);

const VIDEO_AUDIO_ALLOWANCE_BITS_PER_SECOND = 160_000;
const MIN_VIDEO_BITRATE_BITS_PER_SECOND = 300_000;

export function maxTaskProofBytes(mediaKind: 'image' | 'video'): number {
  return mediaKind === 'video'
    ? MAX_TASK_PROOF_VIDEO_BYTES
    : MAX_TASK_PROOF_IMAGE_BYTES;
}

export function targetTaskProofBytes(mediaKind: 'image' | 'video'): number {
  return mediaKind === 'video'
    ? TARGET_TASK_PROOF_VIDEO_BYTES
    : TARGET_TASK_PROOF_IMAGE_BYTES;
}

export function taskProofSizeLabel(mediaKind: 'image' | 'video'): string {
  return mediaKind === 'video' ? '30 MB' : '4 MB';
}

export function calculateTargetVideoBitrate(
  durationMs: number,
  targetBytes = TARGET_TASK_PROOF_VIDEO_BYTES,
): number {
  const durationSeconds = Math.max(0.1, durationMs / 1000);
  const totalBitsPerSecond = Math.floor((targetBytes * 8 * 0.97) / durationSeconds);
  return Math.max(
    MIN_VIDEO_BITRATE_BITS_PER_SECOND,
    totalBitsPerSecond - VIDEO_AUDIO_ALLOWANCE_BITS_PER_SECOND,
  );
}

export function calculateRetryVideoBitrate(
  currentBitrate: number,
  outputBytes: number,
  targetBytes = TARGET_TASK_PROOF_VIDEO_BYTES,
): number {
  if (!Number.isFinite(outputBytes) || outputBytes <= 0) {
    return Math.max(MIN_VIDEO_BITRATE_BITS_PER_SECOND, Math.floor(currentBitrate * 0.75));
  }

  const proportional = currentBitrate * (targetBytes / outputBytes) * 0.94;
  return Math.max(
    MIN_VIDEO_BITRATE_BITS_PER_SECOND,
    Math.min(Math.floor(currentBitrate * 0.9), Math.floor(proportional)),
  );
}
