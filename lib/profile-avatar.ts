import type { ImagePickerAsset } from 'expo-image-picker';
import { File } from 'expo-file-system';
import { Image as ImageCompressor } from 'react-native-compressor';

import {
  AVATAR_BUCKET,
  MAX_AVATAR_BYTES,
  buildAvatarObjectPath,
  isOwnedAvatarPath,
} from '@/lib/avatar';
import { supabase } from '@/lib/supabase';

export type ProfileAvatarResult =
  | { success: true; avatarPath: string | null }
  | { success: false; error: string };

function deleteGeneratedFile(uri: string, originalUri: string): void {
  if (!uri || uri === originalUri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Compressor cache cleanup is best-effort.
  }
}

async function prepareAvatar(asset: ImagePickerAsset): Promise<{ uri: string; bytes: ArrayBuffer }> {
  if (!asset.uri || asset.type === 'video') throw new Error('Please choose a photo.');

  const uri = await ImageCompressor.compress(asset.uri, {
    compressionMethod: 'manual',
    maxWidth: 512,
    maxHeight: 512,
    quality: 0.84,
    output: 'jpg',
    input: 'uri',
    returnableOutputType: 'uri',
  });

  const response = await fetch(uri);
  if (!response.ok) {
    deleteGeneratedFile(uri, asset.uri);
    throw new Error('Could not read the selected photo.');
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength <= 0) {
    deleteGeneratedFile(uri, asset.uri);
    throw new Error('The selected photo is empty.');
  }
  if (bytes.byteLength > MAX_AVATAR_BYTES) {
    deleteGeneratedFile(uri, asset.uri);
    throw new Error('Could not reduce the profile picture below 2 MB.');
  }

  return { uri, bytes };
}

export async function uploadProfileAvatar(params: {
  userId: string;
  currentAvatarPath: string | null | undefined;
  asset: ImagePickerAsset;
}): Promise<ProfileAvatarResult> {
  const { userId, currentAvatarPath, asset } = params;
  let generatedUri: string | null = null;
  let newAvatarPath: string | null = null;

  try {
    const prepared = await prepareAvatar(asset);
    generatedUri = prepared.uri;
    newAvatarPath = buildAvatarObjectPath(userId);

    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(newAvatarPath, prepared.bytes, {
        cacheControl: '31536000',
        contentType: 'image/jpeg',
        upsert: false,
      });
    if (uploadError) return { success: false, error: uploadError.message };

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ avatar_path: newAvatarPath })
      .eq('id', userId);
    if (profileError) {
      await supabase.storage.from(AVATAR_BUCKET).remove([newAvatarPath]);
      return { success: false, error: profileError.message };
    }

    if (isOwnedAvatarPath(userId, currentAvatarPath) && currentAvatarPath !== newAvatarPath) {
      const { error: cleanupError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .remove([currentAvatarPath!]);
      if (cleanupError) console.warn('[profile-avatar] old avatar cleanup failed:', cleanupError.message);
    }

    return { success: true, avatarPath: newAvatarPath };
  } catch (error) {
    if (newAvatarPath) {
      await supabase.storage.from(AVATAR_BUCKET).remove([newAvatarPath]);
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Could not update the profile picture.',
    };
  } finally {
    if (generatedUri) deleteGeneratedFile(generatedUri, asset.uri);
  }
}

export async function removeProfileAvatar(params: {
  userId: string;
  currentAvatarPath: string | null | undefined;
}): Promise<ProfileAvatarResult> {
  const { userId, currentAvatarPath } = params;
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ avatar_path: null })
    .eq('id', userId);
  if (profileError) return { success: false, error: profileError.message };

  if (isOwnedAvatarPath(userId, currentAvatarPath)) {
    const { error: cleanupError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .remove([currentAvatarPath!]);
    if (cleanupError) console.warn('[profile-avatar] removed avatar cleanup failed:', cleanupError.message);
  }

  return { success: true, avatarPath: null };
}
