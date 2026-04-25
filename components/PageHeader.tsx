import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';

interface PageHeaderProps {
  title: string;
  rightAccessory?: ReactNode;
}

export function PageHeader({ title, rightAccessory }: PageHeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {rightAccessory ? (
          <View style={styles.rightAccessory}>
            {rightAccessory}
          </View>
        ) : null}
      </View>
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
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  title: {
    flex: 1,
    fontSize: typography.xl,
    fontWeight: typography.bold,
    letterSpacing: -0.5,
  },
  rightAccessory: {
    flexShrink: 0,
  },
});
