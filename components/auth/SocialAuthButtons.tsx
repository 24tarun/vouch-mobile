import type { ReactNode } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { colors, radius, spacing, typography } from '@/lib/theme';

interface SocialAuthButtonsProps {
  mode: 'sign-in' | 'sign-up';
  loadingProvider: 'google' | 'apple' | null;
  onGooglePress: () => void;
  onApplePress: () => void;
  disclaimer?: ReactNode;
}

export function SocialAuthButtons({
  mode,
  loadingProvider,
  onGooglePress,
  onApplePress,
  disclaimer,
}: SocialAuthButtonsProps) {
  const appleButtonType = mode === 'sign-up'
    ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
    : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN;

  return (
    <View style={styles.socialSection}>
      <TouchableOpacity
        style={styles.socialButton}
        onPress={onGooglePress}
        disabled={loadingProvider !== null}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Continue with Google"
      >
        {loadingProvider === 'google' ? (
          <ActivityIndicator size="small" color={colors.text} />
        ) : (
          <>
            <Ionicons name="logo-google" size={18} color={colors.text} />
            <Text style={styles.socialButtonText}>Continue with Google</Text>
          </>
        )}
      </TouchableOpacity>

      {Platform.OS === 'ios' && (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={appleButtonType}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
          cornerRadius={radius.md}
          style={styles.appleButton}
          onPress={onApplePress}
        />
      )}

      {disclaimer ? <Text style={styles.socialDisclaimer}>{disclaimer}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  socialSection: {
    gap: spacing.sm,
  },
  socialButton: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  socialButtonText: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: colors.text,
    letterSpacing: 0.1,
  },
  appleButton: {
    height: 50,
    width: '100%',
  },
  socialDisclaimer: {
    fontSize: typography.xs,
    color: colors.textSubtle,
    lineHeight: 18,
  },
});
