import { useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, spacing, typography } from '@/lib/theme';

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
}

function QuickStatItem({ label, value, valueColor, glowColor }: QuickStatItemProps) {
  return (
    <View style={styles.item}>
      <Text style={styles.itemLabel}>{label}</Text>
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
  const stats = useMemo(
    () => [
      {
        label: 'Total Tasks',
        value: loading ? '—' : String(totalTasks ?? 0),
        valueColor: '#60A5FA',
        glowColor: 'rgba(96,165,250,0.45)',
      },
      {
        label: 'Accepted',
        value: loading ? '—' : String(accepted ?? 0),
        valueColor: '#BEF264',
        glowColor: 'rgba(190,242,100,0.45)',
      },
      {
        label: 'Denied',
        value: loading ? '—' : String(denied ?? 0),
        valueColor: '#F87171',
        glowColor: 'rgba(248,113,113,0.45)',
      },
      {
        label: 'Missed',
        value: loading ? '—' : String(missed ?? 0),
        valueColor: '#FB7185',
        glowColor: 'rgba(251,113,133,0.45)',
      },
      {
        label: 'Total Vouched',
        value: loading ? '—' : String(totalVouched ?? 0),
        valueColor: '#C084FC',
        glowColor: 'rgba(192,132,252,0.45)',
      },
      {
        label: 'Time Focused',
        value: loading ? '—' : formatFocusedTime(focusedSeconds),
        valueColor: '#22D3EE',
        glowColor: 'rgba(34,211,238,0.45)',
      },
    ],
    [loading, totalTasks, accepted, denied, missed, totalVouched, focusedSeconds],
  );

  return (
    <View style={styles.container}>
      {error && <Text style={styles.errorText}>{error}</Text>}
      <View style={styles.grid}>
        {stats.map((stat) => (
          <QuickStatItem
            key={stat.label}
            label={stat.label}
            value={stat.value}
            valueColor={stat.valueColor}
            glowColor={stat.glowColor}
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
    color: colors.textMuted,
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
    color: colors.destructive,
    marginBottom: spacing.xs,
  },
});
