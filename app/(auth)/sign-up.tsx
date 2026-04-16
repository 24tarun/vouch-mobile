import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { Button, TextButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { colors, spacing, typography } from '@/lib/theme';

const PRIVACY_POLICY_URL = 'https://tas.tarunh.com/privacy-policy';

export default function SignUpScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  const [privacyOpened, setPrivacyOpened] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);

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

    if (!privacyOpened) errors.privacy = 'Please open the Privacy Policy before signing up.';
    else if (!privacyAccepted) errors.privacy = 'You must accept the Privacy Policy to create an account.';

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

  function handleOpenPrivacyPolicy() {
    setPrivacyOpened(true);
    setFieldErrors((e) => ({ ...e, privacy: '' }));
    void Linking.openURL(PRIVACY_POLICY_URL);
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
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.kav}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Wordmark */}
          <View style={styles.header}>
            <Text style={styles.wordmark}>vouch</Text>
            <Text style={styles.tagline}>Create your account.</Text>
          </View>

          {/* Form */}
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

            {/* Privacy Policy consent */}
            <View style={styles.consentBox}>
              <TouchableOpacity onPress={handleOpenPrivacyPolicy} activeOpacity={0.7}>
                <Text style={styles.consentLink}>Open Privacy Policy</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.consentRow, !privacyOpened && styles.consentRowDisabled]}
                onPress={() => {
                  if (!privacyOpened) return;
                  setPrivacyAccepted((v) => !v);
                  setFieldErrors((e) => ({ ...e, privacy: '' }));
                }}
                activeOpacity={privacyOpened ? 0.7 : 1}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: privacyAccepted, disabled: !privacyOpened }}
              >
                <View style={[styles.checkbox, privacyAccepted && styles.checkboxChecked]}>
                  {privacyAccepted && <Feather name="check" size={12} color={colors.bg} />}
                </View>
                <Text style={[styles.consentLabel, !privacyOpened && styles.consentLabelDisabled]}>
                  I have read and agree to the Privacy Policy
                </Text>
              </TouchableOpacity>

              {fieldErrors.privacy ? (
                <Text style={styles.consentError}>{fieldErrors.privacy}</Text>
              ) : null}
            </View>

            {globalError ? (
              <Text style={styles.errorBanner}>{globalError}</Text>
            ) : null}

            <Button
              label="Create Account"
              onPress={handleSignUp}
              loading={loading}
              style={styles.signUpButton}
              disabled={!privacyAccepted}
            />
          </View>

          {/* Footer */}
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
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
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

  // Header
  header: {
    marginBottom: spacing.xl,
  },
  wordmark: {
    fontSize: typography.xxxl,
    fontWeight: typography.bold,
    color: colors.text,
    letterSpacing: -1.5,
  },
  tagline: {
    fontSize: typography.sm,
    color: colors.textMuted,
    marginTop: 6,
    letterSpacing: 0.2,
  },

  // Form
  form: {
    gap: spacing.md,
  },
  signUpButton: {
    marginTop: spacing.xs,
  },
  errorBanner: {
    fontSize: typography.sm,
    color: colors.destructive,
    paddingVertical: spacing.xs,
  },

  // Privacy consent
  consentBox: {
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm + 2,
    gap: spacing.sm,
  },
  consentLink: {
    fontSize: typography.xs,
    color: colors.accentCyan,
    textDecorationLine: 'underline',
  },
  consentRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  consentRowDisabled: {
    opacity: 0.4,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    flexShrink: 0,
  },
  checkboxChecked: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  consentLabel: {
    flex: 1,
    fontSize: typography.xs,
    color: colors.textMuted,
    lineHeight: 18,
  },
  consentLabelDisabled: {
    color: colors.textSubtle,
  },
  consentError: {
    fontSize: typography.xs,
    color: colors.destructive,
  },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 'auto',
    paddingTop: spacing.xl,
  },
  onboardingRow: {
    alignItems: 'center',
    paddingTop: spacing.xs,
  },
  footerText: {
    fontSize: typography.sm,
    color: colors.textMuted,
  },

  // Email confirmation screen
  confirmContainer: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl + 8,
    gap: spacing.md,
  },
  confirmTitle: {
    fontSize: typography.xl,
    fontWeight: typography.semibold,
    color: colors.text,
    marginTop: spacing.lg,
  },
  confirmBody: {
    fontSize: typography.base,
    color: colors.textMuted,
    lineHeight: 22,
  },
  confirmEmail: {
    color: colors.text,
    fontWeight: typography.medium,
  },
});
