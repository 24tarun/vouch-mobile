import { useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';

function formatFocusedTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

interface QuickStatItemProps {
  label: string;
  value: string;
  valueColor: string;
  glowColor: string;
  labelColor: string;
}

function QuickStatItem({ label, value, valueColor, glowColor, labelColor }: QuickStatItemProps) {
  return (
    <View style={styles.item}>
      <Text style={[styles.itemLabel, { color: labelColor }]}>{label}</Text>
      <Text
        style={[
          styles.itemValue,
          { color: valueColor, textShadowColor: glowColor },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

export interface StatsOverviewProps {
  totalTasks?: number;
  accepted?: number;
  denied?: number;
  missed?: number;
  totalVouched?: number;
  focusedSeconds?: number;
  loading?: boolean;
  error?: string | null;
}

export function StatsOverview({
  totalTasks,
  accepted,
  denied,
  missed,
  totalVouched,
  focusedSeconds = 0,
  loading = false,
  error = null,
}: StatsOverviewProps) {
  const { colors, isDark } = useTheme();

  const stats = useMemo(
    () => [
      {
        label: 'Total Tasks',
        value: loading ? '—' : String(totalTasks ?? 0),
        valueColor: isDark ? '#60A5FA' : '#2563EB',
        glowColor: 'rgba(96,165,250,0.45)',
      },
      {
        label: 'Accepted',
        value: loading ? '—' : String(accepted ?? 0),
        valueColor: isDark ? '#BEF264' : '#65A30D',
        glowColor: 'rgba(190,242,100,0.45)',
      },
      {
        label: 'Denied',
        value: loading ? '—' : String(denied ?? 0),
        valueColor: isDark ? '#F87171' : '#DC2626',
        glowColor: 'rgba(248,113,113,0.45)',
      },
      {
        label: 'Missed',
        value: loading ? '—' : String(missed ?? 0),
        valueColor: isDark ? '#FB7185' : '#E11D48',
        glowColor: 'rgba(251,113,133,0.45)',
      },
      {
        label: 'Total Vouched',
        value: loading ? '—' : String(totalVouched ?? 0),
        valueColor: isDark ? '#C084FC' : '#7C3AED',
        glowColor: 'rgba(192,132,252,0.45)',
      },
      {
        label: 'Time Focused',
        value: loading ? '—' : formatFocusedTime(focusedSeconds),
        valueColor: isDark ? '#22D3EE' : '#0891B2',
        glowColor: 'rgba(34,211,238,0.45)',
      },
    ],
    [loading, totalTasks, accepted, denied, missed, totalVouched, focusedSeconds, isDark],
  );

  return (
    <View style={styles.container}>
      {error && <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>}
      <View style={styles.grid}>
        {stats.map((stat) => (
          <QuickStatItem
            key={stat.label}
            label={stat.label}
            value={stat.value}
            valueColor={stat.valueColor}
            glowColor={stat.glowColor}
            labelColor={colors.textMuted}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xl,
    columnGap: spacing.md,
    paddingHorizontal: 2,
  },
  item: {
    width: '30%',
    gap: spacing.xs,
  },
  itemLabel: {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.9,
    fontWeight: typography.bold,
    lineHeight: 14,
  },
  itemValue: {
    fontSize: typography.xl,
    fontWeight: typography.normal,
    lineHeight: 28,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 7,
  },
  errorText: {
    fontSize: 12,
    marginBottom: spacing.xs,
  },
});
