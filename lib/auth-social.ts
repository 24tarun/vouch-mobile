import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

export async function signInWithGoogle(): Promise<{ error: Error | null }> {
  const redirectTo = makeRedirectUri({ scheme: 'vouch', path: 'auth/callback' });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error || !data.url) {
    return { error: error ?? new Error('Failed to get Google auth URL') };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type === 'cancel' || result.type === 'dismiss') {
    return { error: new Error('Sign in was cancelled') };
  }

  if (result.type !== 'success') {
    return { error: new Error('Google sign in failed') };
  }

  const { error: sessionError } = await supabase.auth.exchangeCodeForSession(result.url);
  if (sessionError) return { error: sessionError };

  await ensureProfile();
  return { error: null };
}

export async function signInWithApple(): Promise<{ error: Error | null }> {
  if (Platform.OS !== 'ios') {
    return { error: new Error('Apple Sign In is only available on iOS') };
  }

  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e: unknown) {
    // ERR_CANCELED is thrown when user dismisses the dialog
    if ((e as { code?: string }).code === 'ERR_CANCELED') {
      return { error: new Error('Sign in was cancelled') };
    }
    return { error: e instanceof Error ? e : new Error('Apple sign in failed') };
  }

  if (!credential.identityToken) {
    return { error: new Error('No identity token received from Apple') };
  }

  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });

  if (error) return { error };

  await ensureProfile();
  return { error: null };
}

// Creates a profile row if one doesn't exist yet (first OAuth sign-in).
async function ensureProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (existing) return;

  const email = user.email ?? '';
  const username = email
    ? email.split('@')[0]!.replace(/[^a-z0-9_]/gi, '_').slice(0, 30).toLowerCase() || 'user'
    : 'user';

  await supabase.from('profiles').insert({ id: user.id, email, username });
}
