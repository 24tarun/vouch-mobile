import {
  BYTES_PER_MIB,
  MAX_TASK_PROOF_IMAGE_BYTES,
  MAX_TASK_PROOF_VIDEO_BYTES,
  calculateRetryVideoBitrate,
  calculateTargetVideoBitrate,
  maxTaskProofBytes,
} from '@/lib/proof-media-limits';

describe('task proof media limits', () => {
  it('caps images at 4 MiB and videos at 30 MiB', () => {
    expect(MAX_TASK_PROOF_IMAGE_BYTES).toBe(4 * BYTES_PER_MIB);
    expect(MAX_TASK_PROOF_VIDEO_BYTES).toBe(30 * BYTES_PER_MIB);
    expect(maxTaskProofBytes('image')).toBe(4 * BYTES_PER_MIB);
    expect(maxTaskProofBytes('video')).toBe(30 * BYTES_PER_MIB);
  });

  it('uses nearly all of the available video budget for a 15 second clip', () => {
    const bitrate = calculateTargetVideoBitrate(15_000);
    const estimatedTotalBytes = ((bitrate + 160_000) * 15) / 8;

    expect(estimatedTotalBytes).toBeGreaterThan(28 * BYTES_PER_MIB);
    expect(estimatedTotalBytes).toBeLessThan(30 * BYTES_PER_MIB);
  });

  it('backs bitrate off proportionally when an encoded video is oversized', () => {
    const firstBitrate = 16_000_000;
    const retryBitrate = calculateRetryVideoBitrate(
      firstBitrate,
      35 * BYTES_PER_MIB,
    );

    expect(retryBitrate).toBeLessThan(firstBitrate);
    expect(retryBitrate).toBeGreaterThan(10_000_000);
  });
});
