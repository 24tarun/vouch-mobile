import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableOpacityProps,
} from 'react-native';
import { colors, radius, typography } from '@/lib/theme';

type Variant = 'primary' | 'ghost' | 'destructive';

interface ButtonProps extends TouchableOpacityProps {
  label: string;
  variant?: Variant;
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  label,
  variant = 'primary',
  loading = false,
  fullWidth = true,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      style={[
        styles.base,
        styles[variant],
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? colors.primaryFg : colors.text}
          size="small"
        />
      ) : (
        <Text style={[styles.label, styles[`${variant}Label`]]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

// Minimal ghost text link — no border/background
interface TextButtonProps {
  label: string;
  onPress: () => void;
  muted?: boolean;
}

export function TextButton({ label, onPress, muted = false }: TextButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.textButton}
    >
      <Text style={[styles.textLink, muted && styles.textLinkMuted]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  fullWidth: {
    width: '100%',
  },

  // Variants
  primary: {
    backgroundColor: colors.primary,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  destructive: {
    backgroundColor: colors.destructive,
  },

  // Disabled
  disabled: {
    opacity: 0.4,
  },

  // Labels
  label: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    letterSpacing: 0.1,
  },
  primaryLabel: {
    color: colors.primaryFg,
  },
  ghostLabel: {
    color: colors.text,
  },
  destructiveLabel: {
    color: '#FFFFFF',
  },

  // Text link — 44pt touch target per HIG
  textButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  textLink: {
    fontSize: typography.sm,
    fontWeight: typography.medium,
    color: colors.text,
  },
  textLinkMuted: {
    color: colors.textMuted,
  },
});
