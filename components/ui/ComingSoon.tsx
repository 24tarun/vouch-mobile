import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography } from '@/lib/theme';
import { PageHeader } from '@/components/PageHeader';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

interface ComingSoonProps {
  title: string;
  icon: FeatherName;
}

export function ComingSoon({ title, icon }: ComingSoonProps) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <PageHeader title={title} />
      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <Feather name={icon} size={32} color={colors.textSubtle} />
        </View>
        <Text style={styles.label}>Coming Soon</Text>
        <Text style={styles.sub}>This section is under construction.</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.xxl,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  label: {
    fontSize: typography.md,
    fontWeight: typography.semibold,
    color: colors.textMuted,
  },
  sub: {
    fontSize: typography.sm,
    color: colors.textSubtle,
  },
});
