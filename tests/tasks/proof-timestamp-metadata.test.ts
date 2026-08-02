import {
  deriveProofTimestampMetadata,
  formatProofTimestampOverlay,
  type ProofCaptureAsset,
} from '@/lib/proof-timestamp-mobile';

function asset(overrides: Partial<ProofCaptureAsset> = {}): ProofCaptureAsset {
  return {
    uri: 'file:///proof.jpg',
    width: 100,
    height: 100,
    type: 'image',
    fileName: 'proof.jpg',
    fileSize: 100,
    mimeType: 'image/jpeg',
    duration: null,
    ...overrides,
  } as ProofCaptureAsset;
}

function pngWithTimeChunk(): ArrayBuffer {
  const bytes = new Uint8Array(31);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  new DataView(bytes.buffer).setUint32(8, 7);
  bytes.set([116, 73, 77, 69], 12); // tIME
  const view = new DataView(bytes.buffer);
  view.setUint16(16, 2026);
  bytes.set([8, 2, 9, 15, 0], 18);
  return bytes.buffer;
}

describe('proof timestamp metadata', () => {
  it('uses the in-app camera event ahead of editable image metadata', () => {
    const capturedAt = Date.UTC(2026, 7, 2, 9, 0);
    const result = deriveProofTimestampMetadata({
      asset: asset({
        proofOrigin: 'CAMERA',
        proofCapturedAtMs: capturedAt,
        exif: { DateTimeOriginal: '2020:01:01 01:00:00' },
      }),
      mimeType: 'image/jpeg',
    });

    expect(result.origin).toBe('CAMERA');
    expect(result.timestampSource).toBe('CAMERA_CAPTURE');
    expect(result.timestampAt).toBe(new Date(capturedAt).toISOString());
  });

  it('uses gallery EXIF before embedded and file timestamps', () => {
    const result = deriveProofTimestampMetadata({
      asset: asset({
        proofOrigin: 'LIBRARY',
        exif: { DateTimeOriginal: '2026:08:02 09:00:00' },
      }),
      mimeType: 'image/png',
      fileBuffer: pngWithTimeChunk(),
      fileCreationTimeMs: Date.UTC(2026, 7, 2, 10, 0),
    });

    expect(result.origin).toBe('LIBRARY');
    expect(result.timestampSource).toBe('EXIF');
    expect(result.overlayTimestampText).toBe('09:00 02/08/26');
  });

  it('uses embedded metadata before file timestamps', () => {
    const result = deriveProofTimestampMetadata({
      asset: asset({ proofOrigin: 'LIBRARY' }),
      mimeType: 'image/png',
      fileBuffer: pngWithTimeChunk(),
      fileCreationTimeMs: Date.UTC(2026, 7, 2, 10, 0),
    });

    expect(result.timestampSource).toBe('EMBEDDED_METADATA');
    expect(result.overlayTimestampText).toBe('09:15 02/08/26');
  });

  it('falls through creation and modification times in order', () => {
    const creation = deriveProofTimestampMetadata({
      asset: asset({ proofOrigin: 'LIBRARY' }),
      mimeType: 'image/jpeg',
      fileCreationTimeMs: Date.UTC(2026, 7, 2, 10, 0),
      fileModificationTimeMs: Date.UTC(2026, 7, 2, 11, 0),
    });
    const modification = deriveProofTimestampMetadata({
      asset: asset({ proofOrigin: 'LIBRARY' }),
      mimeType: 'image/jpeg',
      fileModificationTimeMs: Date.UTC(2026, 7, 2, 11, 0),
    });

    expect(creation.timestampSource).toBe('FILE_CREATION');
    expect(modification.timestampSource).toBe('FILE_MODIFICATION');
  });

  it('labels selection-time fallback as attached rather than captured', () => {
    const attachedAt = Date.UTC(2026, 7, 2, 16, 0);
    const result = deriveProofTimestampMetadata({
      asset: asset({ proofOrigin: 'LIBRARY', proofAttachedAtMs: attachedAt }),
      mimeType: 'image/jpeg',
    });

    expect(result.timestampSource).toBe('ATTACHED');
    expect(result.timestampAt).toBe(new Date(attachedAt).toISOString());
    expect(formatProofTimestampOverlay(result.overlayTimestampText, result.timestampSource))
      .toBe(`Attached ${result.overlayTimestampText}`);
  });
});
