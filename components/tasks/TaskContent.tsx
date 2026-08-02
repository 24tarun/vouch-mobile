import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ActivityIndicator, Platform, RefreshControl, ScrollView } from 'react-native';
import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from './styles';
import { TaskRow, type TaskCompletionIntentResult, type TaskRowData } from '@/components/TaskRow';
import { TasksEmptyState } from './TasksEmptyState';
import { isOptimisticTaskId } from '@/lib/tasks/task-id';

interface TaskContentProps {
  header?: ReactNode;
  dueSoonTasks: TaskRowData[];
  futureTasks: TaskRowData[];
  pastTasks: TaskRowData[];
  hasMorePast: boolean;
  loadingMorePast: boolean;
  onLoadMorePast: () => void;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
  onCompletionIntent: (task: TaskRowData) => TaskCompletionIntentResult;
  onPostponeIntent: (task: TaskRowData) => void;
  onPrefetchTask: (taskId: string) => void;
  bottomInsetOffset?: number;
  completionTaskIds?: readonly string[];
  initialLoading?: boolean;
  alwaysShowActiveTasks?: boolean;
}

export function TaskContent({
  header,
  dueSoonTasks,
  futureTasks,
  pastTasks,
  hasMorePast,
  loadingMorePast,
  onLoadMorePast,
  refreshing,
  onRefresh,
  onCompletionIntent,
  onPostponeIntent,
  onPrefetchTask,
  bottomInsetOffset = 0,
  completionTaskIds = [],
  initialLoading = false,
  alwaysShowActiveTasks = false,
}: TaskContentProps) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const computedBottomInset = bottomInsetOffset + 24;
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const lastAutoLoadLengthRef = useRef<number | null>(null);
  const hasAnyTasks = dueSoonTasks.length > 0 || futureTasks.length > 0 || pastTasks.length > 0;

  useEffect(() => {
    const visibleActiveTasks = [...dueSoonTasks, ...futureTasks];
    visibleActiveTasks
      .filter((task) => !isOptimisticTaskId(task.id))
      .slice(0, 5)
      .forEach((task) => onPrefetchTask(task.id));
  }, [dueSoonTasks, futureTasks, onPrefetchTask]);

  const requestNextPastPage = useCallback(() => {
    if (!hasMorePast || loadingMorePast) return;
    if (lastAutoLoadLengthRef.current === pastTasks.length) return;
    lastAutoLoadLengthRef.current = pastTasks.length;
    onLoadMorePast();
  }, [hasMorePast, loadingMorePast, onLoadMorePast, pastTasks.length]);

  useEffect(() => {
    if (!hasMorePast) {
      lastAutoLoadLengthRef.current = null;
      return;
    }
    if (viewportHeight > 0 && contentHeight > 0 && contentHeight <= viewportHeight + 320) {
      requestNextPastPage();
    }
  }, [contentHeight, hasMorePast, requestNextPastPage, viewportHeight]);

  return (
    <ScrollView
      style={styles.body}
      contentContainerStyle={[
        styles.taskList,
        { paddingBottom: computedBottomInset },
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      automaticallyAdjustKeyboardInsets
      onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
      onContentSizeChange={(_width, height) => setContentHeight(height)}
      onScroll={(event) => {
        const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
        const remainingDistance = contentSize.height - layoutMeasurement.height - contentOffset.y;
        if (remainingDistance <= 320) requestNextPastPage();
      }}
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
      {!hasAnyTasks ? (
        initialLoading ? null : <TasksEmptyState />
      ) : (
        <>
          {dueSoonTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onCompletionIntent={onCompletionIntent}
              onPostponeIntent={onPostponeIntent}
              onPrefetch={onPrefetchTask}
              completionInProgress={completionTaskIds.includes(task.id)}
            />
          ))}
          {futureTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              variant={alwaysShowActiveTasks ? 'default' : 'future-muted'}
              onCompletionIntent={alwaysShowActiveTasks ? onCompletionIntent : undefined}
              onPostponeIntent={alwaysShowActiveTasks ? onPostponeIntent : undefined}
              onPrefetch={onPrefetchTask}
              completionInProgress={alwaysShowActiveTasks && completionTaskIds.includes(task.id)}
            />
          ))}
          {pastTasks.map((task) => (
            <TaskRow key={task.id} task={task} onPrefetch={onPrefetchTask} />
          ))}
          {loadingMorePast ? (
            <ActivityIndicator color={colors.textMuted} style={{ marginVertical: 12 }} />
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
