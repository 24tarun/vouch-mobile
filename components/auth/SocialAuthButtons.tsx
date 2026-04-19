import { ActivityIndicator, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '@/lib/theme';

interface SocialAuthButtonsProps {
  mode: 'sign-in' | 'sign-up';
  loadingProvider: 'google' | 'apple' | null;
  onGooglePress: () => void;
  onApplePress: () => void;
}

export function SocialAuthButtons({
  loadingProvider,
  onGooglePress,
  onApplePress,
}: SocialAuthButtonsProps) {
  const showApple = Platform.OS === 'ios';

  return (
    <View style={[styles.row, !showApple && styles.rowCentered]}>
      <TouchableOpacity
        style={styles.iconButton}
        onPress={onGooglePress}
        disabled={loadingProvider !== null}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
      >
        {loadingProvider === 'google' ? (
          <ActivityIndicator size="small" color={colors.text} />
        ) : (
          <Ionicons name="logo-google" size={22} color={colors.text} />
        )}
      </TouchableOpacity>

      {showApple && (
        <TouchableOpacity
          style={styles.iconButton}
          onPress={onApplePress}
          disabled={loadingProvider !== null}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Continue with Apple"
        >
          {loadingProvider === 'apple' ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <Ionicons name="logo-apple" size={24} color={colors.text} />
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  rowCentered: {
    justifyContent: 'center',
  },
  iconButton: {
    flex: 1,
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
