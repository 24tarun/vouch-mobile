import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/lib/ThemeContext';
import { radius, spacing, typography } from '@/lib/theme';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n: number) { return String(n).padStart(2, '0'); }

interface Props {
  value: Date;
  minimumDate?: Date;
  onChange: (date: Date) => void;
}

export function AndroidDateTimePicker({ value, minimumDate, onChange }: Props) {
  const { colors } = useTheme();

  function shiftDate(days: number) {
    const next = new Date(value);
    next.setDate(next.getDate() + days);
    if (minimumDate && next < minimumDate) return;
    onChange(next);
  }

  function shiftHour(delta: number) {
    const next = new Date(value);
    next.setHours((next.getHours() + delta + 24) % 24);
    onChange(next);
  }

  function shiftMinute(delta: number) {
    const next = new Date(value);
    next.setMinutes((next.getMinutes() + delta + 60) % 60);
    onChange(next);
  }

  const canGoBack = !minimumDate || (() => {
    const prev = new Date(value);
    prev.setDate(prev.getDate() - 1);
    prev.setHours(23, 59, 59, 999);
    return prev >= minimumDate;
  })();

  const dateLabel = `${DAYS[value.getDay()]}, ${value.getDate()} ${MONTHS[value.getMonth()]} ${value.getFullYear()}`;

  return (
    <View style={styles.root}>
      {/* Date row */}
      <View style={[styles.dateRow, { borderColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => shiftDate(-1)}
          disabled={!canGoBack}
          hitSlop={12}
          style={[styles.arrowBtn, !canGoBack && styles.disabled]}
        >
          <Feather name="chevron-left" size={20} color={canGoBack ? colors.text : colors.textMuted} />
        </TouchableOpacity>

        <Text style={[styles.dateLabel, { color: colors.text }]}>{dateLabel}</Text>

        <TouchableOpacity onPress={() => shiftDate(1)} hitSlop={12} style={styles.arrowBtn}>
          <Feather name="chevron-right" size={20} color={colors.text} />
        </TouchableOpacity>
      </View>

      {/* Time row */}
      <View style={styles.timeRow}>
        {/* Hour */}
        <View style={[styles.spinnerCol, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <TouchableOpacity onPress={() => shiftHour(1)} hitSlop={8} style={styles.spinnerArrow}>
            <Feather name="chevron-up" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <Text style={[styles.spinnerValue, { color: colors.text }]}>{pad(value.getHours())}</Text>
          <TouchableOpacity onPress={() => shiftHour(-1)} hitSlop={8} style={styles.spinnerArrow}>
            <Feather name="chevron-down" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.colon, { color: colors.textMuted }]}>:</Text>

        {/* Minute */}
        <View style={[styles.spinnerCol, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <TouchableOpacity onPress={() => shiftMinute(1)} hitSlop={8} style={styles.spinnerArrow}>
            <Feather name="chevron-up" size={18} color={colors.textMuted} />
          </TouchableOpacity>
          <Text style={[styles.spinnerValue, { color: colors.text }]}>{pad(value.getMinutes())}</Text>
          <TouchableOpacity onPress={() => shiftMinute(-1)} hitSlop={8} style={styles.spinnerArrow}>
            <Feather name="chevron-down" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm + 2,
  },
  arrowBtn: {
    padding: spacing.xs,
  },
  disabled: {
    opacity: 0.3,
  },
  dateLabel: {
    fontSize: typography.sm,
    fontWeight: '600',
    flex: 1,
    textAlign: 'center',
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  spinnerCol: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xl,
  },
  spinnerArrow: {
    paddingVertical: spacing.xs,
  },
  spinnerValue: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 1,
    paddingVertical: spacing.xs,
  },
  colon: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 2,
  },
});
