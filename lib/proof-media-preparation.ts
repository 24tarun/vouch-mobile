import type { ImagePickerAsset } from 'expo-image-picker';
import { File } from 'expo-file-system';
import {
  Image as ImageCompressor,
  Video as VideoCompressor,
  getImageMetaData,
  getVideoMetaData,
} from 'react-native-compressor';
import {
  calculateRetryVideoBitrate,
  calculateTargetVideoBitrate,
  maxTaskProofBytes,
  targetTaskProofBytes,
  taskProofSizeLabel,
} from '@/lib/proof-media-limits';

export interface PreparedTaskProofMedia {
  uri: string;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
  wasCompressed: boolean;
  cleanup: () => void;
}

function localFileSize(uri: string): number {
  try {
    const size = new File(uri).size;
    return Number.isFinite(size) ? Number(size) : 0;
  } catch {
    return 0;
  }
}

function deleteLocalFile(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Cache cleanup is best-effort.
  }
}

function cleanupGeneratedFiles(uris: Iterable<string>, keepUri?: string): void {
  for (const uri of uris) {
    if (uri !== keepUri) deleteLocalFile(uri);
  }
}

async function imageDimensions(asset: ImagePickerAsset): Promise<{ width: number; height: number }> {
  if (asset.width > 0 && asset.height > 0) {
    return { width: asset.width, height: asset.height };
  }

  const metadata = await getImageMetaData(asset.uri);
  return {
    width: Math.max(1, Number(metadata.ImageWidth) || 1),
    height: Math.max(1, Number(metadata.ImageHeight) || 1),
  };
}

async function compressImageUnderLimit(
  asset: ImagePickerAsset,
  originalSizeBytes: number,
): Promise<PreparedTaskProofMedia> {
  const maxBytes = maxTaskProofBytes('image');
  const targetBytes = targetTaskProofBytes('image');
  const dimensions = await imageDimensions(asset);
  const generatedUris = new Set<string>();
  let scale = 1;
  let selected: { uri: string; sizeBytes: number } | null = null;

  try {
    // Prefer retaining all pixels. Only step dimensions down if even a moderate JPEG
    // quality cannot meet the limit.
    for (let scaleAttempt = 0; scaleAttempt < 6 && !selected; scaleAttempt += 1) {
      let low = scale === 1 ? 0.52 : 0.62;
      let high = 0.98;
      let bestAtScale: { uri: string; sizeBytes: number } | null = null;

      for (let qualityAttempt = 0; qualityAttempt < 7; qualityAttempt += 1) {
        const quality = (low + high) / 2;
        const uri = await ImageCompressor.compress(asset.uri, {
          compressionMethod: 'manual',
          maxWidth: Math.max(1, Math.round(dimensions.width * scale)),
          maxHeight: Math.max(1, Math.round(dimensions.height * scale)),
          quality,
          output: 'jpg',
          input: 'uri',
          returnableOutputType: 'uri',
        });
        generatedUris.add(uri);
        const sizeBytes = localFileSize(uri);

        if (sizeBytes > 0 && sizeBytes <= targetBytes) {
          if (!bestAtScale || quality > low) {
            if (bestAtScale) deleteLocalFile(bestAtScale.uri);
            bestAtScale = { uri, sizeBytes };
          }
          low = quality;
        } else {
          high = quality;
        }
      }

      if (bestAtScale) {
        selected = bestAtScale;
        break;
      }

      scale *= 0.85;
    }

    if (!selected || selected.sizeBytes > maxBytes) {
      throw new Error(`Could not reduce this image below ${taskProofSizeLabel('image')}.`);
    }

    cleanupGeneratedFiles(generatedUris, selected.uri);
    return {
      uri: selected.uri,
      mimeType: 'image/jpeg',
      sizeBytes: selected.sizeBytes,
      fileName: `${(asset.fileName || 'proof').replace(/\.[^.]+$/, '')}.jpg`,
      wasCompressed: selected.sizeBytes < originalSizeBytes,
      cleanup: () => deleteLocalFile(selected!.uri),
    };
  } catch (error) {
    cleanupGeneratedFiles(generatedUris);
    throw error;
  }
}

async function compressVideoUnderLimit(
  asset: ImagePickerAsset,
  originalSizeBytes: number,
  durationMs: number,
): Promise<PreparedTaskProofMedia> {
  const maxBytes = maxTaskProofBytes('video');
  const targetBytes = targetTaskProofBytes('video');
  const metadata = await getVideoMetaData(asset.uri);
  const maxDimension = Math.max(
    640,
    Number(metadata.width) || asset.width || 0,
    Number(metadata.height) || asset.height || 0,
  );
  const generatedUris = new Set<string>();
  let bitrate = calculateTargetVideoBitrate(durationMs);

  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const uri = await VideoCompressor.compress(asset.uri, {
        compressionMethod: 'manual',
        bitrate,
        maxSize: maxDimension,
        minimumFileSizeForCompress: 0,
      });
      generatedUris.add(uri);
      const sizeBytes = localFileSize(uri);

      if (sizeBytes > 0 && sizeBytes <= targetBytes) {
        cleanupGeneratedFiles(generatedUris, uri);
        return {
          uri,
          mimeType: 'video/mp4',
          sizeBytes,
          fileName: `${(asset.fileName || 'proof').replace(/\.[^.]+$/, '')}.mp4`,
          wasCompressed: sizeBytes < originalSizeBytes,
          cleanup: () => deleteLocalFile(uri),
        };
      }

      bitrate = calculateRetryVideoBitrate(bitrate, sizeBytes);
    }

    throw new Error(`Could not reduce this video below ${taskProofSizeLabel('video')}.`);
  } catch (error) {
    cleanupGeneratedFiles(generatedUris);
    throw error;
  }
}

export async function prepareTaskProofMedia(params: {
  asset: ImagePickerAsset;
  mediaKind: 'image' | 'video';
  mimeType: string;
  durationMs: number | null;
}): Promise<PreparedTaskProofMedia> {
  const { asset, mediaKind, mimeType, durationMs } = params;
  const originalSizeBytes = localFileSize(asset.uri) || Number(asset.fileSize ?? 0);

  if (!Number.isFinite(originalSizeBytes) || originalSizeBytes <= 0) {
    throw new Error('Selected media size is invalid.');
  }

  if (originalSizeBytes <= maxTaskProofBytes(mediaKind)) {
    return {
      uri: asset.uri,
      mimeType,
      sizeBytes: originalSizeBytes,
      fileName: asset.fileName || `proof_${Date.now()}`,
      wasCompressed: false,
      cleanup: () => {},
    };
  }

  if (mediaKind === 'image') {
    return compressImageUnderLimit(asset, originalSizeBytes);
  }

  if (!durationMs || durationMs <= 0) {
    throw new Error('Could not read video duration. Try another clip.');
  }

  return compressVideoUnderLimit(asset, originalSizeBytes, durationMs);
}
