import { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { signInWithApple, signInWithGoogle } from '@/lib/auth-social';
import { Button, TextButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { colors, spacing, typography } from '@/lib/theme';
import { AuthScreenShell } from '@/components/auth/AuthScreenShell';
import { SocialAuthButtons } from '@/components/auth/SocialAuthButtons';

export default function SignInScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState('');

  async function handleSignIn() {
    if (!email.trim() || !password) {
      setError('Please fill in all fields.');
      return;
    }

    setLoading(true);
    setError('');

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    setLoading(false);

    if (authError) {
      if (authError.message.toLowerCase().includes('invalid login')) {
        setError('Incorrect email or password.');
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
      <SocialAuthButtons
        mode="sign-in"
        loadingProvider={socialLoading}
        onGooglePress={handleGoogleSignIn}
        onApplePress={handleAppleSignIn}
      />

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or</Text>
        <View style={styles.dividerLine} />
      </View>

      <View style={styles.form}>
        <Input
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          textContentType="emailAddress"
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

const styles = StyleSheet.create({
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
