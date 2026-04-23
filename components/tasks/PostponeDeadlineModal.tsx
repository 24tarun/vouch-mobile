import { Modal, Platform, Pressable, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { TaskRowData } from '@/components/TaskRow';
import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from './styles';

interface PostponeDeadlineModalProps {
  task: TaskRowData | null;
  date: Date;
  setTask: (task: TaskRowData | null) => void;
  onDateChange: (_event: DateTimePickerEvent, selected?: Date) => void;
  onAndroidDateChange: (_event: DateTimePickerEvent, selected?: Date) => void;
  onAndroidTimeChange: (_event: DateTimePickerEvent, selected?: Date) => void;
  onConfirm: () => Promise<void>;
}

export function PostponeDeadlineModal({
  task,
  date,
  setTask,
  onDateChange,
  onAndroidDateChange,
  onAndroidTimeChange,
  onConfirm,
}: PostponeDeadlineModalProps) {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  return (
    <Modal
      visible={task !== null}
      transparent
      animationType="fade"
      onRequestClose={() => setTask(null)}
    >
      <Pressable style={styles.postponeBackdrop} onPress={() => setTask(null)} />
      <View style={styles.postponeSheet}>
        <Text style={styles.postponeTitle}>Move Deadline</Text>
        {task && (
          <Text style={styles.postponeSubtitle} numberOfLines={1}>
            {task.title}
          </Text>
        )}

        {task && (
          <>
            {Platform.OS === 'ios' ? (
              <DateTimePicker
                value={date}
                mode="datetime"
                display="inline"
                minimumDate={task.created_at ? new Date(task.created_at) : undefined}
                onChange={onDateChange}
                themeVariant="dark"
                accentColor={colors.warning}
                style={styles.postponeIosPicker}
              />
            ) : (
              <View style={styles.postponeAndroidRow}>
                <DateTimePicker
                  value={date}
                  mode="date"
                  display="calendar"
                  minimumDate={task.created_at ? new Date(task.created_at) : undefined}
                  onChange={onAndroidDateChange}
                />
                <DateTimePicker
                  value={date}
                  mode="time"
                  display="spinner"
                  onChange={onAndroidTimeChange}
                />
              </View>
            )}
          </>
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
            onPress={() => {
              void onConfirm();
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.postponeConfirmText}>Confirm</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
