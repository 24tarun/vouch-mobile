import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { Button, TextButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { type Colors, spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';

export default function ForgotPasswordScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  async function handleReset() {
    if (!email.trim()) {
      setError('Enter your email address.');
      return;
    }

    setLoading(true);
    setError('');

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: 'vouch://reset-password' },
    );

    setLoading(false);

    if (resetError) {
      setError(resetError.message);
    } else {
      setSent(true);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={styles.container}>
          <Text style={styles.wordmark}>vouch</Text>

          {sent ? (
            <View style={styles.sentBlock}>
              <Text style={styles.heading}>Check your inbox</Text>
              <Text style={styles.body}>
                We sent a reset link to{' '}
                <Text style={styles.emailHighlight}>{email}</Text>.
              </Text>
              <TextButton
                label="Back to sign in"
                onPress={() => router.replace('/(auth)/sign-in')}
              />
            </View>
          ) : (
            <View style={styles.form}>
              <Text style={styles.heading}>Forgot password?</Text>
              <Text style={styles.body}>
                Enter your email and we&apos;ll send you a reset link.
              </Text>

              <Input
                placeholder="you@example.com"
                value={email}
                onChangeText={(v) => { setEmail(v); setError(''); }}
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="done"
                onSubmitEditing={handleReset}
                error={error}
              />

              <Button label="Send Reset Link" onPress={handleReset} loading={loading} />

              <TextButton
                label="Back to sign in"
                onPress={() => router.back()}
                muted
              />
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  kav: { flex: 1 },
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + 8,
    gap: spacing.xxl,
  },
  wordmark: {
    fontSize: typography.xxxl,
    fontWeight: typography.bold,
    color: colors.text,
    letterSpacing: -1.5,
  },
  sentBlock: { gap: spacing.md },
  form: { gap: spacing.md },
  heading: {
    fontSize: typography.xl,
    fontWeight: typography.semibold,
    color: colors.text,
  },
  body: {
    fontSize: typography.base,
    color: colors.textMuted,
    lineHeight: 22,
  },
  emailHighlight: {
    color: colors.text,
    fontWeight: typography.medium,
  },
});
