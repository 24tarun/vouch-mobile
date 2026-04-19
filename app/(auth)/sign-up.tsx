import { useState } from 'react';
import {
  Linking,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { signInWithApple, signInWithGoogle } from '@/lib/auth-social';
import { EMAIL_CONFIRMATION_URL } from '@/lib/auth-urls';
import { Button, TextButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { colors, spacing, typography } from '@/lib/theme';
import { AuthScreenShell } from '@/components/auth/AuthScreenShell';
import { SocialAuthButtons } from '@/components/auth/SocialAuthButtons';

const PRIVACY_POLICY_URL = 'https://tas.tarunh.com/privacy-policy';

export default function SignUpScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<'google' | 'apple' | null>(null);
  const [globalError, setGlobalError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);

  function deriveUsername(rawEmail: string): string {
    const prefix = rawEmail.trim().toLowerCase().split('@')[0] ?? '';
    return prefix.replace(/[^a-z0-9_]/g, '_').slice(0, 30) || 'user';
  }

  function validate(): boolean {
    const errors: Record<string, string> = {};

    if (!email.trim()) errors.email = 'Email is required.';
    else if (!/\S+@\S+\.\S+/.test(email)) errors.email = 'Enter a valid email.';

    if (!password) errors.password = 'Password is required.';
    else if (password.length < 6) errors.password = 'At least 6 characters.';

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSignUp() {
    if (!validate()) return;

    setLoading(true);
    setGlobalError('');

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: EMAIL_CONFIRMATION_URL,
      },
    });

    if (signUpError) {
      setLoading(false);
      setGlobalError(signUpError.message);
      return;
    }

    const user = data.user;
    if (!user) {
      setLoading(false);
      setGlobalError('Sign up failed. Please try again.');
      return;
    }

    if (data.session) {
      const { error: profileError } = await supabase.from('profiles').insert({
        id: user.id,
        email: user.email ?? email.trim().toLowerCase(),
        username: deriveUsername(email),
      });

      if (profileError) {
        setLoading(false);
        if (profileError.message.includes('duplicate') || profileError.code === '23505') {
          setFieldErrors({ username: 'Username is already taken.' });
        } else {
          setGlobalError('Account created but profile setup failed. Please contact support.');
        }
        return;
      }
    } else {
      setSuccess(true);
      setLoading(false);
      return;
    }

    setLoading(false);
  }

  async function handleGoogleSignUp() {
    setSocialLoading('google');
    setGlobalError('');
    const { error: authError } = await signInWithGoogle();
    setSocialLoading(null);
    if (authError && authError.message !== 'Sign in was cancelled') {
      setGlobalError(authError.message);
    }
  }

  async function handleAppleSignUp() {
    setSocialLoading('apple');
    setGlobalError('');
    const { error: authError } = await signInWithApple();
    setSocialLoading(null);
    if (authError && authError.message !== 'Sign in was cancelled') {
      setGlobalError(authError.message);
    }
  }

  if (success) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.confirmContainer}>
          <Text style={styles.wordmark}>vouch</Text>
          <Text style={styles.confirmTitle}>Check your email</Text>
          <Text style={styles.confirmBody}>
            We sent a confirmation link to{' '}
            <Text style={styles.confirmEmail}>{email}</Text>. Open it to
            activate your account.
          </Text>
          <TextButton
            label="Back to sign in"
            onPress={() => router.replace('/(auth)/sign-in')}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <AuthScreenShell tagline="Create your account.">
      <View style={styles.form}>
        <Input
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            setFieldErrors((e) => ({ ...e, email: '' }));
          }}
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          error={fieldErrors.email}
        />

        <Input
          label="Password"
          placeholder="••••••••"
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            setFieldErrors((e) => ({ ...e, password: '' }));
          }}
          secureTextEntry
          secureToggle
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={handleSignUp}
          error={fieldErrors.password}
        />

        {globalError ? (
          <Text style={styles.errorBanner}>{globalError}</Text>
        ) : null}

        <Button
          label="Create Account"
          onPress={handleSignUp}
          loading={loading}
          style={styles.signUpButton}
        />
      </View>

      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text style={styles.dividerText}>or continue with</Text>
        <View style={styles.dividerLine} />
      </View>

      <SocialAuthButtons
        mode="sign-up"
        loadingProvider={socialLoading}
        onGooglePress={handleGoogleSignUp}
        onApplePress={handleAppleSignUp}
      />

      <Text style={styles.legal}>
        By signing up, you agree to our{' '}
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
        <Text style={styles.footerText}>Already have an account?</Text>
        <TextButton
          label="Sign in"
          onPress={() => router.replace('/(auth)/sign-in')}
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
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  form: {
    gap: spacing.md,
  },
  signUpButton: {
    marginTop: spacing.xs,
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
  confirmContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  wordmark: {
    fontSize: typography.xxxl,
    fontWeight: typography.bold,
    color: colors.text,
    letterSpacing: -1.5,
  },
  confirmTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: colors.text,
  },
  confirmBody: {
    fontSize: typography.base,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
  },
  confirmEmail: {
    color: colors.text,
    fontWeight: typography.semibold,
  },
});
