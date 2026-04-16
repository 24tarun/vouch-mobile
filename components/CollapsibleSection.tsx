import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { ImagePickerAsset } from 'expo-image-picker';
import { colors, spacing, typography } from '@/lib/theme';
import { TaskRow } from '@/components/TaskRow';
import type { TaskRowData } from '@/components/TaskRow';

interface CollapsibleSectionProps {
  title: string;
  tasks: TaskRowData[];
  defaultOpen?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onComplete?: (id: string) => void;
  onProofPicked?: (taskId: string, asset: ImagePickerAsset) => void | Promise<void>;
  onPostpone?: (task: TaskRowData) => void | Promise<void>;
  onDelete?: (task: TaskRowData) => void | Promise<void>;
  defaultPomoDurationMinutes?: number;
}

export function CollapsibleSection({
  title,
  tasks,
  defaultOpen = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onComplete,
  onProofPicked,
  onPostpone,
  onDelete,
  defaultPomoDurationMinutes = 25,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (tasks.length === 0) return null;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setIsOpen((prev) => !prev)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        accessibilityLabel={`${title}, ${tasks.length} tasks`}
        accessibilityHint={isOpen ? 'Collapses this section' : 'Expands this section'}
      >
        <Feather
          name={isOpen ? 'chevron-down' : 'chevron-right'}
          size={16}
          color={colors.textMuted}
        />
        <Text style={styles.label}>{title}</Text>
      </TouchableOpacity>

      {isOpen && (
        <View style={styles.list}>
          {tasks.map((task) => (
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

          {hasMore && (
            <TouchableOpacity
              style={styles.loadMoreBtn}
              onPress={onLoadMore}
              disabled={loadingMore}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Load more past tasks"
            >
              {loadingMore ? (
                <ActivityIndicator size="small" color={colors.textMuted} />
              ) : (
                <Text style={styles.loadMoreText}>Load more</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  label: {
    fontSize: typography.sm,
    fontWeight: '600',
    color: colors.textMuted,
  },
  badge: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  badgeText: {
    fontSize: typography.xs,
    color: colors.textMuted,
  },
  list: {
    paddingBottom: spacing.sm,
  },
  loadMoreBtn: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  loadMoreText: {
    fontSize: typography.sm,
    color: colors.textMuted,
  },
});
