import { useState } from 'react';
import {
  Linking,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { signInWithApple, signInWithGoogle } from '@/lib/auth-social';
import { Button, TextButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { type Colors, spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import { AuthScreenShell } from '@/components/auth/AuthScreenShell';
import { SocialAuthButtons } from '@/components/auth/SocialAuthButtons';

const PRIVACY_POLICY_URL = 'https://tas.tarunh.com/privacy-policy';

async function resolveEmail(input: string): Promise<{ email: string; error: string | null }> {
  const trimmed = input.trim().toLowerCase();
  if (trimmed.includes('@')) {
    return { email: trimmed, error: null };
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('email')
    .eq('username', trimmed)
    .maybeSingle();
  if (error) return { email: '', error: 'Could not look up username.' };
  if (!data?.email) return { email: '', error: 'No account found with that username.' };
  return { email: data.email, error: null };
}

export default function SignInScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'apple' | null>(null);
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

  async function handleGoogleSignIn() {
    setSocialLoading('google');
    setError('');
    const { error: authError } = await signInWithGoogle();
    setSocialLoading(null);
    if (authError && authError.message !== 'Sign in was cancelled') {
      setError(authError.message);
    }
  }

  async function handleAppleSignIn() {
    setSocialLoading('apple');
    setError('');
    const { error: authError } = await signInWithApple();
    setSocialLoading(null);
    if (authError && authError.message !== 'Sign in was cancelled') {
      setError(authError.message);
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

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or continue with</Text>
        <View style={styles.dividerLine} />
      </View>

      <SocialAuthButtons
        mode="sign-in"
        loadingProvider={socialLoading}
        onGooglePress={handleGoogleSignIn}
        onApplePress={handleAppleSignIn}
      />

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
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerText: {
    fontSize: typography.xs,
    color: colors.textSubtle,
    letterSpacing: 0.5,
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
