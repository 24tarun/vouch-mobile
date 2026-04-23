import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableOpacityProps,
} from 'react-native';
import { radius, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';

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
  const { colors } = useTheme();
  const isDisabled = disabled || loading;

  const variantStyle = {
    primary: { backgroundColor: colors.primary },
    ghost: { backgroundColor: 'transparent' as const, borderWidth: 1, borderColor: colors.border },
    destructive: { backgroundColor: colors.destructive },
  }[variant];

  const labelColor = {
    primary: colors.primaryFg,
    ghost: colors.text,
    destructive: '#FFFFFF',
  }[variant];

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      style={[
        styles.base,
        variantStyle,
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
        <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
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
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.textButton}
    >
      <Text style={[styles.textLink, { color: muted ? colors.textMuted : colors.text }]}>{label}</Text>
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
  disabled: {
    opacity: 0.4,
  },
  label: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    letterSpacing: 0.1,
  },
  textButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  textLink: {
    fontSize: typography.sm,
    fontWeight: typography.medium,
  },
});
