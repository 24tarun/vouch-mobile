import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { radius, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';

interface InputProps extends TextInputProps {
  label?: string;
  error?: string;
  secureToggle?: boolean;
}

export function Input({
  label,
  error,
  secureToggle = false,
  secureTextEntry,
  style,
  ...rest
}: InputProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(secureTextEntry ?? false);
  const eyeLabel = hidden ? 'Show password' : 'Hide password';

  return (
    <View style={styles.wrapper}>
      {label ? <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text> : null}

      <View
        style={[
          styles.inputRow,
          { backgroundColor: colors.inputBg, borderColor: colors.inputBorder },
          focused && { borderColor: colors.inputBorderFocus },
          !!error && { borderColor: colors.destructive },
        ]}
      >
        <TextInput
          style={[styles.input, { color: colors.text }, style]}
          placeholderTextColor={colors.inputPlaceholder}
          selectionColor={colors.text}
          secureTextEntry={secureToggle ? hidden : secureTextEntry}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoCapitalize="none"
          autoCorrect={false}
          {...rest}
        />

        {secureToggle ? (
          <TouchableOpacity
            onPress={() => setHidden((h) => !h)}
            style={styles.eyeButton}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={eyeLabel}
            hitSlop={6}
          >
            <Feather
              name={hidden ? 'eye-off' : 'eye'}
              size={18}
              color={colors.textMuted}
            />
          </TouchableOpacity>
        ) : null}
      </View>

      {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 6,
  },
  label: {
    fontSize: typography.sm,
    fontWeight: typography.medium,
    letterSpacing: 0.3,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    height: 50,
    fontSize: typography.base,
  },
  eyeButton: {
    width: 44,
    height: 44,
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    fontSize: typography.xs,
    marginTop: 2,
  },
});
