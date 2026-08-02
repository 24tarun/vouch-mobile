import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import {
  getAvatarColor,
  getAvatarInitials,
  getAvatarPublicUrl,
} from '@/lib/avatar';

interface UserAvatarProps {
  username: string;
  avatarPath?: string | null;
  localUri?: string | null;
  size?: number;
  accessibilityLabel?: string;
  accessible?: boolean;
}

export function UserAvatar({
  username,
  avatarPath = null,
  localUri = null,
  size = 44,
  accessibilityLabel,
  accessible = true,
}: UserAvatarProps) {
  const remoteUri = useMemo(() => getAvatarPublicUrl(avatarPath), [avatarPath]);
  const uri = localUri || remoteUri;
  const borderRadius = size / 2;

  return (
    <View
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius,
          backgroundColor: getAvatarColor(username),
        },
      ]}
      accessible={accessible}
      accessibilityRole={accessible ? 'image' : undefined}
      accessibilityLabel={accessible ? accessibilityLabel ?? `${username || 'User'} profile picture` : undefined}
    >
      <Text style={[styles.initials, { fontSize: Math.round(size * 0.38) }]}>
        {getAvatarInitials(username)}
      </Text>
      {uri ? (
        <Image
          source={{
            uri,
            cacheKey: localUri ? undefined : avatarPath ?? uri,
          }}
          style={[StyleSheet.absoluteFillObject, { borderRadius }]}
          contentFit="cover"
          cachePolicy={localUri ? 'none' : 'memory-disk'}
          transition={120}
          accessible={false}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  initials: {
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
});
