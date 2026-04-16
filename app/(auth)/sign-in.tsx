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

export default function SignInScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
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
      // Normalise Supabase error messages to something user-friendly
      if (authError.message.toLowerCase().includes('invalid login')) {
        setError('Incorrect email or password.');
      } else {
        setError(authError.message);
      }
    }
    // On success, the auth state change in useAuth triggers the redirect automatically
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
            <Text style={styles.tagline}>hold yourself accountable.</Text>
          </View>

          {/* Form */}
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

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.footerText}>Don't have an account?</Text>
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
    marginBottom: spacing.xxl,
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
  signInButton: {
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
  onboardingRow: {
    alignItems: 'center',
    paddingTop: spacing.xs,
  },
  footerText: {
    fontSize: typography.sm,
    color: colors.textMuted,
  },
});
