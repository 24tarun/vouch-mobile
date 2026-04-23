import { View } from 'react-native';
import { useTheme } from '@/lib/ThemeContext';

// AuthGuard in _layout.tsx owns all boot-time auth routing.
export default function Index() {
  const { colors } = useTheme();
  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}
