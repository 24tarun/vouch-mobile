import { useMemo, useState } from 'react';
import {
  Linking,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { Button, TextButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { type Colors, spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import { AuthScreenShell } from '@/components/auth/AuthScreenShell';

const PRIVACY_POLICY_URL = 'https://tas.tarunh.com/privacy-policy';

async function resolveEmail(input: string): Promise<{ email: string; error: string | null }> {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.includes('@')) {
    return { email: trimmed, error: null };
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('email')
    .ilike('username', trimmed)
    .maybeSingle();
  if (error) return { email: '', error: 'Incorrect email/username or password.' };
  if (!data?.email) return { email: '', error: 'Incorrect email/username or password.' };
  return { email: data.email, error: null };
}

export default function SignInScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSignIn() {
    if (!identifier.trim() || !password) {
      setError('Please fill in all fields.');
      return;
    }

    setLoading(true);
    setError('');

    const { email, error: lookupError } = await resolveEmail(identifier);
    if (lookupError) {
      setError(lookupError);
      setLoading(false);
      return;
    }

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (authError) {
      if (authError.message.toLowerCase().includes('invalid login')) {
        setError('Incorrect email/username or password.');
      } else {
        setError(authError.message);
      }
    }
  }

  return (
    <AuthScreenShell tagline="hold yourself accountable.">
      <View style={styles.form}>
        <Input
          label="Email or Username"
          placeholder="you@example.com or username"
          value={identifier}
          onChangeText={setIdentifier}
          keyboardType="default"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
          returnKeyType="next"
        />

        <Input
          label="Password"
          placeholder="••••••••"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          secureToggle
          textContentType="password"
          returnKeyType="done"
          onSubmitEditing={handleSignIn}
        />

        {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

        <Button
          label="Sign In"
          onPress={handleSignIn}
          loading={loading}
          style={styles.signInButton}
        />

        <TextButton
          label="Forgot password?"
          onPress={() => router.push('/(auth)/forgot-password')}
          muted
        />
      </View>

      <Text style={styles.legal}>
        By signing in, you agree to our{' '}
        <Text style={styles.legalLink} onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}>
          Terms &amp; Conditions
        </Text>
        {' '}and{' '}
        <Text style={styles.legalLink} onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}>
          Privacy Policy
        </Text>
        .
      </Text>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Don&apos;t have an account?</Text>
        <TextButton
          label="Sign up"
          onPress={() => router.replace('/(auth)/sign-up')}
        />
      </View>

      <View style={styles.onboardingRow}>
        <TextButton
          label="View onboarding"
          onPress={() => router.push('/(auth)/onboarding')}
          muted
        />
      </View>
    </AuthScreenShell>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  form: {
    gap: spacing.md,
  },
  signInButton: {
    marginTop: spacing.xs,
  },
  errorBanner: {
    fontSize: typography.sm,
    color: colors.destructive,
    paddingVertical: spacing.xs,
  },
  legal: {
    marginTop: spacing.md,
    fontSize: typography.xs,
    color: colors.textSubtle,
    textAlign: 'center',
    lineHeight: 18,
  },
  legalLink: {
    color: colors.accentCyan,
  },
  footer: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xl,
  },
  footerText: {
    color: colors.textMuted,
    fontSize: typography.sm,
  },
  onboardingRow: {
    alignItems: 'center',
    marginTop: spacing.sm,
  },
});
