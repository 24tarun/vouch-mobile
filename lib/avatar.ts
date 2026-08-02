import { supabase } from '@/lib/supabase';

export const AVATAR_BUCKET = 'avatars';
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const AVATAR_PALETTE = ['#7C3AED', '#2563EB', '#0891B2', '#059669', '#D97706', '#DC2626', '#DB2777'];

export function getAvatarColor(username: string): string {
  let hash = 0;
  for (let index = 0; index < username.length; index += 1) {
    hash = (hash * 31 + username.charCodeAt(index)) & 0x7fffffff;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
}

export function getAvatarInitials(username: string): string {
  const trimmed = username.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/[\s_.-]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

export function getAvatarPublicUrl(avatarPath: string | null | undefined): string | null {
  const path = avatarPath?.trim();
  if (!path) return null;
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
}

export function isOwnedAvatarPath(userId: string, avatarPath: string | null | undefined): boolean {
  return Boolean(userId && avatarPath?.startsWith(`${userId}/`));
}

export function buildAvatarObjectPath(
  userId: string,
  timestamp = Date.now(),
  randomValue = Math.random(),
): string {
  const randomPart = randomValue.toString(36).slice(2, 12).padEnd(10, '0');
  return `${userId}/${timestamp}-${randomPart}.jpg`;
}
