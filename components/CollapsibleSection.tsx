import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import type { ImagePickerAsset } from 'expo-image-picker';
import { spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
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
  onProofRemoved?: (taskId: string) => void | Promise<void>;
  onPostpone?: (task: TaskRowData) => void | Promise<void>;
  onDelete?: (task: TaskRowData) => void | Promise<void>;
  defaultPomoDurationMinutes?: number;
  onSubtaskComposerFocus?: (inputBottomY: number) => void;
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
  onProofRemoved,
  onPostpone,
  onDelete,
  defaultPomoDurationMinutes = 25,
  onSubtaskComposerFocus,
}: CollapsibleSectionProps) {
  const { colors } = useTheme();
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
        <Text style={[styles.label, { color: colors.textMuted }]}>{title}</Text>
      </TouchableOpacity>

      {isOpen && (
        <View style={styles.list}>
          {tasks.map((task) => (
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
            />
          ))}

          {hasMore && (
            <TouchableOpacity
              style={[styles.loadMoreBtn, { borderTopColor: colors.border }]}
              onPress={onLoadMore}
              disabled={loadingMore}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Load more past tasks"
            >
              {loadingMore ? (
                <ActivityIndicator size="small" color={colors.textMuted} />
              ) : (
                <Text style={[styles.loadMoreText, { color: colors.textMuted }]}>Load more</Text>
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
  },
  loadMoreText: {
    fontSize: typography.sm,
  },
});
