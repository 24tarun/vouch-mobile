import { View } from 'react-native';
import { colors } from '@/lib/theme';

// AuthGuard in _layout.tsx owns all boot-time auth routing.
export default function Index() {
  // Keep a static background so there's never an auth/app flash at root.
  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}
