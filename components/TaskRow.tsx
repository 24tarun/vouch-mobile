import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { StatusPill } from '@/components/StatusPill';

export interface TaskRowData {
  id: string;
  title: string;
  deadline: string; // ISO string
  status?: string;
  created_at?: string;
  subtaskTotal?: number;
  subtaskCompleted?: number;
  completed?: boolean; // legacy fallback when status not provided
}

interface TaskRowProps {
  task: TaskRowData;
  onComplete?: (id: string) => void;
}

// Statuses where the task is fully done (drives circle fill + strikethrough)
const COMPLETED_STATUSES = new Set([
  'MARKED_COMPLETE',
  'AWAITING_VOUCHER',
  'AWAITING_ORCA',
  'AWAITING_USER',
  'ESCALATED',
  'ACCEPTED',
  'AUTO_ACCEPTED',
  'ORCA_ACCEPTED',
  'DENIED',
  'MISSED',
  'RECTIFIED',
  'SETTLED',
  'DELETED',
]);


// `HH:MM DD mon` — mirrors web's deadlineLabel format
function formatDeadline(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '';
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = date.getDate().toString().padStart(2, '0');
  const month = date.toLocaleDateString('en-GB', { month: 'short' }).toLowerCase();
  return `${time} ${day} ${month}`;
}

export function TaskRow({ task, onComplete }: TaskRowProps) {
  const router = useRouter();
  const isCompleted = task.status
    ? COMPLETED_STATUSES.has(task.status)
    : (task.completed ?? false);

  // Active rows are tappable to expand the action tray
  const [expanded, setExpanded] = useState(false);
  const [subtaskText, setSubtaskText] = useState('');

  const hasSubtasks = (task.subtaskTotal ?? 0) > 0;
  const deadlineLabel = formatDeadline(task.deadline);

  if (isCompleted) {
    // ── Completed / past row ─────────────────────────────────────────────────
    return (
      <TouchableOpacity
        style={styles.completedRow}
        activeOpacity={0.7}
        onPress={() => router.push(`/tasks/${task.id}` as any)}
        accessibilityRole="button"
        accessibilityLabel={task.title}
      >
        <View style={styles.completedMain}>
          <Text style={styles.completedTitle} numberOfLines={2}>{task.title}</Text>
        </View>
        <View style={styles.completedMeta}>
          {task.status && <StatusPill status={task.status} />}
          <Feather name="external-link" size={14} color={colors.textMuted} style={styles.externalLink} />
        </View>
      </TouchableOpacity>
    );
  }

  // ── Active row ─────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, expanded && styles.containerExpanded]}>
      <Pressable
        onPress={() => setExpanded((prev) => !prev)}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${task.title}, ${expanded ? 'collapse' : 'expand'}`}
      >
        {/* Circle — tapping only toggles completion */}
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onComplete?.(task.id);
          }}
          style={({ pressed }) => [styles.circle, pressed && styles.circlePressed]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: false }}
          accessibilityLabel={`Mark "${task.title}" complete`}
          hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
        />

        {/* Title + subtask count */}
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={2}>
            {task.title}
          </Text>
          {hasSubtasks && (
            <Text style={styles.subtaskBadge}>
              {task.subtaskCompleted ?? 0}/{task.subtaskTotal}
            </Text>
          )}
        </View>

        <Text style={styles.deadline}>{deadlineLabel}</Text>
      </Pressable>

      {/* Expanded action tray */}
      {expanded && (
        <View style={styles.expandedPanel}>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.actionBtn} activeOpacity={0.65} accessibilityLabel="Attach proof">
              <Feather name="camera" size={20} color="#F472B6" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} activeOpacity={0.65} accessibilityLabel="Alert">
              <Feather name="alert-triangle" size={20} color="#F59E0B" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} activeOpacity={0.65} accessibilityLabel="Timer">
              <Ionicons name="stopwatch-outline" size={20} color="#22D3EE" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} activeOpacity={0.65} accessibilityLabel="Delete">
              <Feather name="trash-2" size={20} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.actionBtn} activeOpacity={0.65} accessibilityLabel="Postpone">
              <Feather name="chevron-down" size={20} color={colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.actionBtn}
              activeOpacity={0.65}
              accessibilityLabel="Open detail"
              onPress={() => router.push(`/tasks/${task.id}` as any)}
            >
              <Feather name="external-link" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <View style={styles.subtaskRow}>
            <Feather name="plus" size={16} color={colors.textMuted} style={styles.subtaskIcon} />
            <TextInput
              style={styles.subtaskInput}
              placeholder="Add subtask..."
              placeholderTextColor={colors.textMuted}
              value={subtaskText}
              onChangeText={setSubtaskText}
              returnKeyType="done"
              onSubmitEditing={() => setSubtaskText('')}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  containerExpanded: {
    backgroundColor: colors.surface,
  },
  completedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  completedMain: {
    flex: 1,
    minWidth: 0,
  },
  completedTitle: {
    fontSize: typography.base,
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  completedMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: 15,
    gap: spacing.md,
  },
  rowPressed: {
    opacity: 0.7,
  },
  circle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.textMuted,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  circlePressed: {
    opacity: 0.6,
  },
  titleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minWidth: 0,
    overflow: 'hidden',
  },
  title: {
    flexShrink: 1,
    fontSize: typography.base,
    color: colors.text,
  },
  subtaskBadge: {
    fontSize: typography.xs,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
    flexShrink: 0,
  },
  deadline: {
    fontSize: typography.sm,
    color: colors.textMuted,
    flexShrink: 0,
    whiteSpace: 'nowrap',
  } as any,
  externalLink: {
    flexShrink: 0,
  },
  expandedPanel: {
    paddingBottom: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  actionBtn: {
    padding: spacing.sm,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  subtaskIcon: {
    flexShrink: 0,
  },
  subtaskInput: {
    flex: 1,
    fontSize: typography.base,
    color: colors.text,
    paddingVertical: 0,
  },
});
