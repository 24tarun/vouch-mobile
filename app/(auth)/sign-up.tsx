import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { Button, TextButton } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { colors, spacing, typography } from '@/lib/theme';

export default function SignUpScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);

  function validate(): boolean {
    const errors: Record<string, string> = {};

    if (!email.trim()) errors.email = 'Email is required.';
    else if (!/\S+@\S+\.\S+/.test(email)) errors.email = 'Enter a valid email.';

    if (!username.trim()) {
      errors.username = 'Username is required.';
    } else if (username.trim().length < 3) {
      errors.username = 'Username must be at least 3 characters.';
    } else if (!/^[a-zA-Z0-9_]+$/.test(username.trim())) {
      errors.username = 'Letters, numbers, and underscores only.';
    }

    if (!password) errors.password = 'Password is required.';
    else if (password.length < 6) errors.password = 'At least 6 characters.';

    if (password !== confirmPassword) {
      errors.confirmPassword = 'Passwords do not match.';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSignUp() {
    if (!validate()) return;

    setLoading(true);
    setGlobalError('');

    // Step 1: create auth user
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

    // Step 2: create profile row (only possible when session exists, i.e., email
    // confirmation is disabled. If the project requires email confirmation, this
    // step will be skipped and the profile must be created after the user verifies.)
    if (data.session) {
      const { error: profileError } = await supabase.from('profiles').insert({
        id: user.id,
        email: user.email ?? email.trim().toLowerCase(),
        username: username.trim().toLowerCase(),
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
      // Email confirmation required — auth state change will handle redirect
      setSuccess(true);
      setLoading(false);
      return;
    }

    setLoading(false);
    // Auth state change triggers redirect to /(app)/tasks automatically
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
              label="Username"
              placeholder="yourname"
              value={username}
              onChangeText={(v) => {
                setUsername(v);
                setFieldErrors((e) => ({ ...e, username: '' }));
              }}
              autoCapitalize="none"
              returnKeyType="next"
              error={fieldErrors.username}
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
              returnKeyType="next"
              error={fieldErrors.password}
            />

            <Input
              label="Confirm Password"
              placeholder="••••••••"
              value={confirmPassword}
              onChangeText={(v) => {
                setConfirmPassword(v);
                setFieldErrors((e) => ({ ...e, confirmPassword: '' }));
              }}
              secureTextEntry
              secureToggle
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={handleSignUp}
              error={fieldErrors.confirmPassword}
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

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <TextButton
              label="Sign in"
              onPress={() => router.replace('/(auth)/sign-in')}
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

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 'auto',
    paddingTop: spacing.xl,
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
