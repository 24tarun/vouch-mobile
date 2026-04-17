import { RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { ImagePickerAsset } from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { colors } from '@/lib/theme';
import { styles } from '../styles';
import { StatusPill } from '@/components/StatusPill';
import { TaskRow, type TaskRowData } from '@/components/TaskRow';
import { CollapsibleSection } from '@/components/CollapsibleSection';

interface TaskContentProps {
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
  onPostpone: (task: TaskRowData) => void;
  onDelete: (task: TaskRowData) => Promise<void>;
  defaultPomoDurationMinutes: number;
}

export function TaskContent({
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
  onPostpone,
  onDelete,
  defaultPomoDurationMinutes,
}: TaskContentProps) {
  const router = useRouter();

  return (
    <ScrollView
      style={styles.body}
      contentContainerStyle={styles.taskList}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.textMuted}
          colors={[colors.textMuted]}
        />
      }
    >
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
                onPress={() => router.push(`/tasks/${task.id}` as any)}
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
              onPostpone={onPostpone}
              onDelete={onDelete}
              defaultPomoDurationMinutes={defaultPomoDurationMinutes}
            />
          ))}
          <CollapsibleSection
            title="Future"
            tasks={futureTasks}
            onComplete={onComplete}
            onProofPicked={onProofPicked}
            onPostpone={onPostpone}
            onDelete={onDelete}
            defaultPomoDurationMinutes={defaultPomoDurationMinutes}
          />
          <CollapsibleSection
            title="Past"
            tasks={pastTasks}
            hasMore={hasMorePast}
            loadingMore={loadingMore}
            onLoadMore={loadMorePastTasks}
            onComplete={onComplete}
            onProofPicked={onProofPicked}
            onPostpone={onPostpone}
            onDelete={onDelete}
            defaultPomoDurationMinutes={defaultPomoDurationMinutes}
          />
        </>
      )}
    </ScrollView>
  );
}
