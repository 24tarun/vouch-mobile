import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View, Modal, Pressable, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import DateTimePicker from 'react-native-ui-datepicker';
// @ts-ignore — internal module, not in public exports
import WheelPicker from 'react-native-ui-datepicker/lib/commonjs/components/time-picker/wheel-picker/wheel-picker';
import type { TaskRowData } from '@/components/TaskRow';
import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from './styles';
import { radius, spacing, typography } from '@/lib/theme';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';

function buildOptions(count: number, start = 0) {
  return Array.from({ length: count }, (_, i) => ({
    value: i + start,
    text: String(i + start).padStart(2, '0'),
  }));
}

const HOURS = buildOptions(24);
const MINUTES = buildOptions(60);
const WHEEL_LIST_PROPS = { windowSize: 3, maxToRenderPerBatch: 5, updateCellsBatchingPeriod: 100, removeClippedSubviews: true };

interface PostponeDeadlineModalProps {
  task: TaskRowData | null;
  date: Date;
  setTask: (task: TaskRowData | null) => void;
  onDateChange: (_event: DateTimePickerEvent, selected?: Date) => void;
  onAndroidDateChange?: (_event: DateTimePickerEvent, selected?: Date) => void;
  onAndroidTimeChange?: (_event: DateTimePickerEvent, selected?: Date) => void;
  onConfirm: () => Promise<void>;
}

export function PostponeDeadlineModal({
  task,
  date,
  setTask,
  onDateChange,
  onConfirm,
}: PostponeDeadlineModalProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [androidDraftDate, setAndroidDraftDate] = useState<Date>(date);

  useEffect(() => {
    if (task) {
      setAndroidDraftDate(new Date(date));
    }
  }, [task, date]);

  const pickerStyles = {
    day: { borderRadius: 100 },
    day_label: { color: colors.text, fontSize: 13 },
    weekday_label: { color: colors.textMuted, fontSize: 12 },
    month_selector_label: { color: colors.text, fontWeight: '700' as const, fontSize: 16 },
    year_selector_label: { color: colors.text, fontWeight: '700' as const, fontSize: 16 },
    button_next: { backgroundColor: colors.surface, borderRadius: 8, padding: 6 },
    button_prev: { backgroundColor: colors.surface, borderRadius: 8, padding: 6 },
    selected: { backgroundColor: colors.warning },
    selected_label: { color: '#000' },
    today_label: { color: colors.warning },
    disabled_label: { color: colors.textMuted, opacity: 0.4 },
    // iOS time chip
    time_selector: { backgroundColor: colors.surface2, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
    time_selector_label: { color: colors.text, fontSize: 14, fontWeight: '600' as const },
    time_label: { color: colors.text, fontSize: 22, fontWeight: '700' as const },
    time_selected_indicator: { backgroundColor: colors.surface2, borderRadius: 10 },
  };

  function emitAndroidTime(nextHour: number, nextMinute: number) {
    const next = new Date(androidDraftDate);
    next.setHours(nextHour, nextMinute, 0, 0);
    setAndroidDraftDate(next);
    onDateChange({} as DateTimePickerEvent, next);
  }

  function setHour(h: number) {
    emitAndroidTime(h, androidDraftDate.getMinutes());
  }

  function setMinute(m: number) {
    emitAndroidTime(androidDraftDate.getHours(), m);
  }

  function handleDateChange(selected: Date) {
    const next = new Date(androidDraftDate);
    next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
    next.setSeconds(0, 0);
    setAndroidDraftDate(next);
    onDateChange({} as DateTimePickerEvent, next);
  }

  return (
    <Modal
      visible={task !== null}
      transparent
      animationType="fade"
      onRequestClose={() => setTask(null)}
    >
      <Pressable style={styles.postponeBackdrop} onPress={() => setTask(null)} />
      <View style={styles.postponeSheet}>
        {task && (
          Platform.OS === 'ios' ? (
            // iOS: calendar + native time chip toggle
            <DateTimePicker
              mode="single"
              date={date}
              minDate={new Date()}
              disableMonthPicker
              disableYearPicker
              timePicker
              onChange={({ date: selected }) => {
                if (selected) onDateChange({} as DateTimePickerEvent, new Date(selected as string | number | Date));
              }}
              styles={pickerStyles as any}
              style={{ backgroundColor: 'transparent' }}
            />
          ) : (
            // Android: calendar + always-visible wheel time pickers
            <>
              <DateTimePicker
                mode="single"
                date={androidDraftDate}
                minDate={new Date()}
                disableMonthPicker
                disableYearPicker
                onChange={({ date: selected }) => {
                  if (selected) handleDateChange(new Date(selected as string | number | Date));
                }}
                styles={pickerStyles as any}
                style={{ backgroundColor: 'transparent' }}
              />

              <View style={local.timeRow}>
                <Text style={[local.timeLabel, { color: colors.textMuted }]}>Time</Text>
                <View style={local.wheels}>
                  <TouchableOpacity
                    onPress={() => { emitAndroidTime(23, 0); }}
                    hitSlop={10}
                    accessibilityLabel="Reset time to 23:00"
                  >
                    <Feather name="rotate-ccw" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                  <WheelPicker
                    value={androidDraftDate.getHours()}
                    options={HOURS}
                    onChange={setHour}
                    itemHeight={44}
                    visibleRest={0}
                    decelerationRate="fast"
                    itemTextStyle={{ color: colors.text, fontSize: typography.lg, fontWeight: '600' }}
                    selectedIndicatorStyle={{ backgroundColor: colors.surface2, borderRadius: radius.md }}
                    containerStyle={{ width: 64 }}
                    flatListProps={WHEEL_LIST_PROPS}
                  />
                  <Text style={[local.colon, { color: colors.textMuted }]}>:</Text>
                  <WheelPicker
                    value={androidDraftDate.getMinutes()}
                    options={MINUTES}
                    onChange={setMinute}
                    itemHeight={44}
                    visibleRest={0}
                    decelerationRate="fast"
                    itemTextStyle={{ color: colors.text, fontSize: typography.lg, fontWeight: '600' }}
                    selectedIndicatorStyle={{ backgroundColor: colors.surface2, borderRadius: radius.md }}
                    containerStyle={{ width: 64 }}
                    flatListProps={WHEEL_LIST_PROPS}
                  />
                </View>
              </View>
            </>
          )
        )}

        <View style={styles.postponeActions}>
          <TouchableOpacity
            style={styles.postponeCancelBtn}
            onPress={() => setTask(null)}
            activeOpacity={0.7}
          >
            <Text style={styles.postponeCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.postponeConfirmBtn}
            onPress={() => { void onConfirm(); }}
            activeOpacity={0.7}
          >
            <Text style={styles.postponeConfirmText}>Confirm</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const local = StyleSheet.create({
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.xs,
  },
  timeLabel: {
    fontSize: typography.base,
    fontWeight: '600',
  },
  wheels: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  colon: {
    fontSize: typography.xl,
    fontWeight: '700',
  },
});
