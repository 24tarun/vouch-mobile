import type { ReactNode, RefObject } from 'react';
import { useMemo } from 'react';

import { Platform, RefreshControl, ScrollView, Text } from 'react-native';
import type { ImagePickerAsset } from 'expo-image-picker';
import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from './styles';
import { TaskRow, type TaskRowData } from '@/components/TaskRow';
import { CollapsibleSection } from '@/components/CollapsibleSection';
import { TasksEmptyState } from './TasksEmptyState';

interface TaskContentProps {
  header?: ReactNode;
  dueSoonTasks: TaskRowData[];
  futureTasks: TaskRowData[];
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onComplete: (taskId: string) => Promise<void>;
  onProofPicked: (taskId: string, asset: ImagePickerAsset) => Promise<void>;
  onProofRemoved: (taskId: string) => Promise<void>;
  onPostpone: (task: TaskRowData) => void;
  onDelete: (task: TaskRowData) => Promise<void>;
  defaultPomoDurationMinutes: number;
  scrollRef?: RefObject<ScrollView | null>;
  onScrollOffsetChange?: (offsetY: number) => void;
  keyboardBottomInset?: number;
  bottomInsetOffset?: number;
  onSubtaskComposerFocus?: (inputBottomY: number) => void;
  proofUploadTaskId?: string | null;
  hasPastTasks?: boolean;
}

export function TaskContent({
  header,
  dueSoonTasks,
  futureTasks,
  refreshing,
  onRefresh,
  onComplete,
  onProofPicked,
  onProofRemoved,
  onPostpone,
  onDelete,
  defaultPomoDurationMinutes,
  scrollRef,
  onScrollOffsetChange,
  keyboardBottomInset = 0,
  bottomInsetOffset = 0,
  onSubtaskComposerFocus,
  proofUploadTaskId = null,
  hasPastTasks = false,
}: TaskContentProps) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const baseInset = bottomInsetOffset + 24;
  const computedBottomInset = keyboardBottomInset > 0
    ? Math.max(keyboardBottomInset + 24, baseInset)
    : baseInset;

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.body}
      contentContainerStyle={[
        styles.taskList,
        { paddingBottom: computedBottomInset },
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      automaticallyAdjustKeyboardInsets
      onScroll={(event) => onScrollOffsetChange?.(event.nativeEvent.contentOffset.y)}
      scrollEventThrottle={16}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.textMuted}
          colors={[colors.textMuted]}
        />
      }
    >
      {header}
      {dueSoonTasks.length === 0 && futureTasks.length === 0 ? (
        hasPastTasks ? (
          <Text style={styles.placeholder}>No active tasks.</Text>
        ) : (
          <TasksEmptyState />
        )
      ) : (
        <>
          {dueSoonTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onComplete={onComplete}
              onProofPicked={onProofPicked}
              onProofRemoved={onProofRemoved}
              onPostpone={onPostpone}
              onDelete={onDelete}
              defaultPomoDurationMinutes={defaultPomoDurationMinutes}
              onSubtaskComposerFocus={onSubtaskComposerFocus}
              proofActionInProgress={proofUploadTaskId === task.id}
            />
          ))}
          <CollapsibleSection
            title="Future"
            tasks={futureTasks}
            onComplete={onComplete}
            onProofPicked={onProofPicked}
            onProofRemoved={onProofRemoved}
            onPostpone={onPostpone}
            onDelete={onDelete}
            defaultPomoDurationMinutes={defaultPomoDurationMinutes}
            onSubtaskComposerFocus={onSubtaskComposerFocus}
            proofUploadTaskId={proofUploadTaskId}
          />
        </>
      )}
    </ScrollView>
  );
}
