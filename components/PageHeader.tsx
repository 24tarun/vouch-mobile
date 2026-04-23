import { StyleSheet, Text, View } from 'react-native';
import { spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';

interface PageHeaderProps {
  title: string;
}

export function PageHeader({ title }: PageHeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    letterSpacing: -0.5,
  },
});
