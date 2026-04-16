import { useEffect } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors } from '@/lib/theme';

// Entry point — decides between onboarding (first launch) and sign-in (returning user).
// AuthGuard in _layout.tsx handles the authenticated → /(app)/tasks redirect.
export default function Index() {
  const router = useRouter();

  useEffect(() => {
    AsyncStorage.getItem('vouch_onboarding_seen').then((seen) => {
      if (seen) {
        router.replace('/(auth)/sign-in');
      } else {
        router.replace('/(auth)/onboarding');
      }
    });
  }, []);

  // Blank slate while AsyncStorage resolves (instant on device).
  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}
