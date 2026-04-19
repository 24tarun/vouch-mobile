function getNavBadgeSeenStorageKey(prefix: string, userId: string) {
  return `${prefix}${userId}`;
}

export const SETTINGS_FRIEND_REQUESTS_SEEN_STORAGE_PREFIX =
  'vouch:settings-friend-requests:last-seen:';

export const FRIENDS_VOUCH_REQUESTS_SEEN_STORAGE_PREFIX =
  'vouch:friends-vouch-requests:last-seen:';

export function getSettingsFriendRequestsSeenStorageKey(userId: string) {
  return getNavBadgeSeenStorageKey(SETTINGS_FRIEND_REQUESTS_SEEN_STORAGE_PREFIX, userId);
}

export function getFriendsVouchRequestsSeenStorageKey(userId: string) {
  return getNavBadgeSeenStorageKey(FRIENDS_VOUCH_REQUESTS_SEEN_STORAGE_PREFIX, userId);
}
