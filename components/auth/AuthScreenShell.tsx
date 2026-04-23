import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';

interface AuthScreenShellProps {
  tagline: string;
  children: ReactNode;
}

export function AuthScreenShell({ tagline, children }: AuthScreenShellProps) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={[styles.wordmark, { color: colors.text }]}>vouch</Text>
            <Text style={[styles.tagline, { color: colors.textMuted }]}>{tagline}</Text>
          </View>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  kav: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + 8,
    paddingBottom: spacing.xl,
  },
  header: {
    marginBottom: spacing.xl,
  },
  wordmark: {
    fontSize: typography.xxxl,
    fontWeight: typography.bold,
    letterSpacing: -1.5,
  },
  tagline: {
    fontSize: typography.sm,
    marginTop: 6,
    letterSpacing: 0.2,
  },
});
