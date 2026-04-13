import { Redirect } from 'expo-router';

// Default entry — AuthGuard in _layout.tsx will redirect to /(app)/tasks if
// the user already has a session. Otherwise this lands on sign-in.
export default function Index() {
  return <Redirect href="/(auth)/sign-in" />;
}
