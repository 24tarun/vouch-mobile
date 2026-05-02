export const AI_PROFILE_ID = '11111111-1111-1111-1111-111111111111';
export const AI_PROFILE_USERNAME = 'AI';
export const AI_PROFILE_EMAIL = 'ai@vouch.internal';

export function isAiProfileId(profileId: string | null | undefined): boolean {
  return profileId === AI_PROFILE_ID;
}

export function normalizeAiUsername(
  profileId: string,
  username: string | null | undefined,
  fallback = 'Friend',
): string {
  if (isAiProfileId(profileId)) return AI_PROFILE_USERNAME;
  const trimmed = (username ?? '').trim();
  return trimmed || fallback;
}

export function normalizeAiEmail(
  profileId: string,
  email: string | null | undefined,
  fallback = '',
): string {
  if (isAiProfileId(profileId)) return AI_PROFILE_EMAIL;
  const trimmed = (email ?? '').trim().toLowerCase();
  return trimmed || fallback;
}
