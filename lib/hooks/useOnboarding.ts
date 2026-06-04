import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_COMPLETE_KEY = 'vouch:onboarding_complete';

export function useOnboarding() {
  const [loading, setLoading] = useState(true);
  const [onboardingComplete, setOnboardingComplete] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_COMPLETE_KEY)
      .then((value) => {
        setOnboardingComplete(value === '1');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const completeOnboarding = useCallback(async () => {
    setOnboardingComplete(true);
    try {
      await AsyncStorage.setItem(ONBOARDING_COMPLETE_KEY, '1');
    } catch {}
  }, []);

  return { onboardingComplete, loading: loading, completeOnboarding };
}
