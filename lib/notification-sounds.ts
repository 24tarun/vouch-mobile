export type NotificationSoundKey = 'default' | 'tone_01' | 'tone_02' | 'tone_03';

export interface NotificationSoundConfig {
  key: NotificationSoundKey;
  label: string;
  soundFileName: 'default' | `${string}.wav`;
  androidChannelId: string;
  previewAsset: number | null;
}

const NOTIFICATION_SOUND_CONFIGS: Record<NotificationSoundKey, NotificationSoundConfig> = {
  default: {
    key: 'default',
    label: 'Default',
    soundFileName: 'default',
    androidChannelId: 'reminder-default-v1',
    previewAsset: null,
  },
  tone_01: {
    key: 'tone_01',
    label: 'Tone 1',
    soundFileName: 'notification_tone_01.wav',
    androidChannelId: 'reminder-tone-01-v1',
    previewAsset: require('../assets/notification-sounds/notification_tone_01.wav'),
  },
  tone_02: {
    key: 'tone_02',
    label: 'Tone 2',
    soundFileName: 'notification_tone_02.wav',
    androidChannelId: 'reminder-tone-02-v1',
    previewAsset: require('../assets/notification-sounds/notification_tone_02.wav'),
  },
  tone_03: {
    key: 'tone_03',
    label: 'Tone 3',
    soundFileName: 'notification_tone_03.wav',
    androidChannelId: 'reminder-tone-03-v1',
    previewAsset: require('../assets/notification-sounds/notification_tone_03.wav'),
  },
};

const NOTIFICATION_SOUND_KEYS: NotificationSoundKey[] = [
  'default',
  'tone_01',
  'tone_02',
  'tone_03',
];

function validateNotificationSoundCatalog() {
  const channelIds = new Set<string>();

  for (const key of NOTIFICATION_SOUND_KEYS) {
    const config = NOTIFICATION_SOUND_CONFIGS[key];
    if (!config) {
      throw new Error(`Missing notification sound config for key: ${key}`);
    }
    if (channelIds.has(config.androidChannelId)) {
      throw new Error(`Duplicate Android notification channel id: ${config.androidChannelId}`);
    }
    channelIds.add(config.androidChannelId);
  }
}

validateNotificationSoundCatalog();

export function getNotificationSoundConfigs(): NotificationSoundConfig[] {
  return NOTIFICATION_SOUND_KEYS.map((key) => NOTIFICATION_SOUND_CONFIGS[key]);
}

export function getNotificationSoundConfig(
  key: NotificationSoundKey,
): NotificationSoundConfig {
  return NOTIFICATION_SOUND_CONFIGS[key];
}

export function getNotificationSoundChannelId(key: NotificationSoundKey): string {
  return getNotificationSoundConfig(key).androidChannelId;
}

export function getNotificationSoundPreviewAsset(key: NotificationSoundKey): number | null {
  return getNotificationSoundConfig(key).previewAsset;
}

function isNotificationSoundKey(value: unknown): value is NotificationSoundKey {
  return typeof value === 'string' && NOTIFICATION_SOUND_KEYS.includes(value as NotificationSoundKey);
}

export function normalizeNotificationSoundKey(value: unknown): NotificationSoundKey {
  return isNotificationSoundKey(value) ? value : 'default';
}
