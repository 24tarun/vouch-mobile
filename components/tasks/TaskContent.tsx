import type { ReactNode, RefObject } from 'react';
import { useMemo } from 'react';

import { Alert, Platform, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { ImagePickerAsset } from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from './styles';
import { isOptimisticTaskId } from '@/lib/tasks/task-id';
import { StatusPill } from '@/components/StatusPill';
import { TaskRow, type TaskRowData } from '@/components/TaskRow';
import { CollapsibleSection } from '@/components/CollapsibleSection';

interface TaskContentProps {
  header?: ReactNode;
  isSearchActive: boolean;
  searchLoading: boolean;
  searchError: string | null;
  searchResults: TaskRowData[];
  dueSoonTasks: TaskRowData[];
  futureTasks: TaskRowData[];
  pastTasks: TaskRowData[];
  hasMorePast: boolean;
  loadingMore: boolean;
  loadMorePastTasks: () => void;
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
}

export function TaskContent({
  header,
  isSearchActive,
  searchLoading,
  searchError,
  searchResults,
  dueSoonTasks,
  futureTasks,
  pastTasks,
  hasMorePast,
  loadingMore,
  loadMorePastTasks,
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
}: TaskContentProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
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
      {isSearchActive ? (
        <>
          {searchLoading ? (
            <Text style={styles.placeholder}>Searching tasks…</Text>
          ) : searchError ? (
            <Text style={[styles.placeholder, { color: colors.destructive }]}>{searchError}</Text>
          ) : searchResults.length === 0 ? (
            <Text style={styles.placeholder}>No matching tasks found.</Text>
          ) : (
            searchResults.map((task) => (
              <TouchableOpacity
                key={`search-${task.id}`}
                style={styles.searchResultRow}
                activeOpacity={0.7}
                onPress={() => {
                  if (isOptimisticTaskId(task.id)) {
                    Alert.alert('Please wait', 'Task is still being created.');
                    return;
                  }
                  router.push(`/tasks/${task.id}` as any);
                }}
                accessibilityRole="button"
                accessibilityLabel={task.title}
              >
                <Text style={styles.searchResultTitle} numberOfLines={1}>
                  {task.title}
                </Text>
                <View style={styles.searchResultMeta}>
                  {task.status && <StatusPill status={task.status} />}
                  <Feather name="external-link" size={14} color={colors.textMuted} />
                </View>
              </TouchableOpacity>
            ))
          )}
        </>
      ) : dueSoonTasks.length === 0 && futureTasks.length === 0 && pastTasks.length === 0 ? (
        <Text style={styles.placeholder}>Your tasks will appear here.</Text>
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
          <CollapsibleSection
            title="Past"
            tasks={pastTasks}
            hasMore={hasMorePast}
            loadingMore={loadingMore}
            onLoadMore={loadMorePastTasks}
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
