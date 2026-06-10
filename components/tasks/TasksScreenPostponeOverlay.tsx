import { memo, useEffect, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { PostponeDeadlineModal } from '@/components/tasks/PostponeDeadlineModal';
import { LegacyPostponeCalendarPicker } from '@/components/tasks/LegacyPostponeCalendarPicker';
import { postponeTaskDeadline } from '@/lib/tasks/task-actions';
import { syncLocalReminderNotificationsAsync } from '@/lib/notifications';
import type { TaskRowData } from '@/components/TaskRow';
import { getDefaultDeadline } from '@/lib/task-title-parser';

interface Props {
  task: TaskRowData | null;
  refetchTasks: () => void;
  onClose: () => void;
}

export const TasksScreenPostponeOverlay = memo(function TasksScreenPostponeOverlay({
  task,
  refetchTasks,
  onClose,
}: Props) {
  const taskId = task?.id ?? null;
  const [postponePickerDate, setPostponePickerDate] = useState(() => getDefaultDeadline());
  const [postponingTaskId, setPostponingTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (taskId) {
      setPostponePickerDate(getDefaultDeadline());
    }
  }, [taskId]);

  function handlePostponePickerChange(_event: DateTimePickerEvent, selected?: Date) {
    if (selected) setPostponePickerDate(selected);
  }

  function handlePostponeAndroidDateChange(_event: DateTimePickerEvent, selected?: Date) {
    if (!selected) return;
    const next = new Date(selected);
    next.setHours(postponePickerDate.getHours(), postponePickerDate.getMinutes(), 0, 0);
    setPostponePickerDate(next);
  }

  function handlePostponeAndroidTimeChange(_event: DateTimePickerEvent, selected?: Date) {
    if (!selected) return;
    const next = new Date(postponePickerDate);
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    setPostponePickerDate(next);
  }

  async function confirmPostponeWithPicker() {
    if (!task) return;

    if (postponingTaskId) {
      Alert.alert('Postpone in progress', 'Please wait for the current postpone action to finish.');
      return;
    }

    const minDate = task.created_at ? new Date(task.created_at) : new Date(0);

    if (postponePickerDate.getTime() <= minDate.getTime()) {
      Alert.alert('Invalid deadline', 'New deadline must be after the task was created.');
      return;
    }

    onClose();
    setPostponingTaskId(task.id);
    try {
      const result = await postponeTaskDeadline(task.id, postponePickerDate.toISOString());
      if (!result.success) {
        Alert.alert('Could not move deadline', result.error ?? 'Unknown error');
        return;
      }
      refetchTasks();
      if (result.userId) {
        void syncLocalReminderNotificationsAsync(result.userId);
      }
    } finally {
      setPostponingTaskId((prev) => (prev === task.id ? null : prev));
    }
  }

  if (!task) return null;

  if (Platform.OS === 'ios') {
    return (
      <LegacyPostponeCalendarPicker
        task={task}
        date={postponePickerDate}
        setTask={() => onClose()}
        onDateChange={handlePostponePickerChange}
        onAndroidDateChange={handlePostponeAndroidDateChange}
        onAndroidTimeChange={handlePostponeAndroidTimeChange}
        onConfirm={confirmPostponeWithPicker}
      />
    );
  }

  return (
    <PostponeDeadlineModal
      task={task}
      date={postponePickerDate}
      setTask={() => onClose()}
      onDateChange={handlePostponePickerChange}
      onConfirm={confirmPostponeWithPicker}
    />
  );
});
