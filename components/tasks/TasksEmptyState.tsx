import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/ThemeContext';
import { highlightedRowBackground, type Colors, radius, spacing, typography } from '@/lib/theme';

const GHOST_OPACITY = 0.45;

export function TasksEmptyState() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);

  return (
    <View style={styles.wrapper}>
      {/* Step 1: Arrow to FAB */}
      <View style={styles.stepRow}>
        <View style={styles.stepBadge}>
          <Text style={styles.stepBadgeText}>1</Text>
        </View>
        <View style={styles.stepTextRow}>
          <Text style={styles.stepText}>Tap the</Text>
          <View style={styles.inlineFab}>
            <Feather name="plus" size={10} color="#fff" />
          </View>
          <Text style={styles.stepText}>button to create a task</Text>
        </View>
      </View>

      {/* Step 2: Ghost collapsed row */}
      <View style={styles.stepRow}>
        <View style={styles.stepBadge}>
          <Text style={styles.stepBadgeText}>2</Text>
        </View>
        <Text style={styles.stepText}>Tap a task to expand it</Text>
      </View>

      <View style={styles.ghostCard}>
        {/* Collapsed row */}
        <View style={styles.ghostRow}>
          <View style={styles.ghostTitleRow}>
            <Text style={styles.ghostTitle}>Buy Groceries</Text>
            <Text style={styles.ghostSubtaskBadge}>0/2</Text>
          </View>
          <Text style={styles.ghostDeadline}>18:00</Text>
        </View>

        {/* Expanded panel */}
        <View style={styles.ghostExpandedPanel}>
          <View style={styles.ghostActions}>
            <View style={styles.ghostActionItem}>
              <View style={styles.ghostActionBtn}>
                <Feather name="circle" size={18} color={colors.success} />
              </View>
              <Text style={styles.ghostActionLabel}>Complete</Text>
            </View>

            <View style={styles.ghostActionItem}>
              <View style={styles.ghostActionBtn}>
                <Feather name="camera" size={18} color="#F472B6" />
              </View>
              <Text style={styles.ghostActionLabel}>Proof</Text>
            </View>

            <View style={styles.ghostActionItem}>
              <View style={styles.ghostActionBtn}>
                <Feather name="alert-triangle" size={18} color="#F59E0B" />
              </View>
              <Text style={styles.ghostActionLabel}>Postpone</Text>
            </View>

            <View style={styles.ghostActionItem}>
              <View style={styles.ghostActionBtn}>
                <Ionicons name="stopwatch-outline" size={18} color="#22D3EE" />
              </View>
              <Text style={styles.ghostActionLabel}>Timer</Text>
            </View>

            <View style={styles.ghostActionItem}>
              <View style={styles.ghostActionBtn}>
                <Feather name="trash-2" size={18} color={colors.destructive} />
              </View>
              <Text style={styles.ghostActionLabel}>Delete</Text>
            </View>

            <View style={styles.ghostActionItem}>
              <View style={styles.ghostActionBtn}>
                <Feather name="external-link" size={18} color={colors.textMuted} />
              </View>
              <Text style={styles.ghostActionLabel}>Detail</Text>
            </View>
          </View>

          {/* Ghost subtasks */}
          <View style={styles.ghostSubtaskItem}>
            <View style={styles.ghostSubtaskCircle} />
            <Text style={styles.ghostSubtaskTitle}>Milk</Text>
            <Feather name="trash-2" size={14} color={colors.destructive} />
          </View>
          <View style={styles.ghostSubtaskItem}>
            <View style={styles.ghostSubtaskCircle} />
            <Text style={styles.ghostSubtaskTitle}>Eggs</Text>
            <Feather name="trash-2" size={14} color={colors.destructive} />
          </View>
          <View style={styles.ghostSubtaskRow}>
            <Feather name="plus" size={14} color={colors.textMuted} />
            <Text style={styles.ghostSubtaskText}>Add subtask...</Text>
          </View>
        </View>
      </View>

      {/* Step 3: Swipe gestures */}
      <View style={styles.stepRow}>
        <View style={styles.stepBadge}>
          <Text style={styles.stepBadgeText}>3</Text>
        </View>
        <Text style={styles.stepText}>Swipe right to complete · left for details</Text>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors, isDark: boolean) =>
  StyleSheet.create({
    wrapper: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xl,
      gap: spacing.lg,
    },

    // Step indicators
    stepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.xs,
    },
    stepBadge: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.accentCyan,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    stepBadgeText: {
      fontSize: 12,
      fontWeight: '700' as const,
      color: '#000',
    },
    stepTextRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      flexWrap: 'wrap',
    },
    stepText: {
      fontSize: typography.sm,
      color: colors.textMuted,
      lineHeight: 20,
    },
    inlineFab: {
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: colors.success,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // Ghost task card
    ghostCard: {
      marginHorizontal: spacing.xs,
      borderRadius: radius.md,
      backgroundColor: highlightedRowBackground(colors, isDark),
      borderWidth: isDark ? 0 : 1,
      borderColor: isDark ? 'transparent' : colors.border,
      opacity: GHOST_OPACITY,
    },
    ghostRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: 15,
      gap: spacing.md,
    },
    ghostTitleRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    ghostTitle: {
      fontSize: 20,
      color: colors.text,
    },
    ghostDeadline: {
      fontSize: typography.sm,
      color: colors.accentCyan,
    },
    ghostExpandedPanel: {
      paddingBottom: spacing.md,
      borderTopWidth: isDark ? 0 : 1,
      borderTopColor: isDark ? 'transparent' : colors.border,
    },
    ghostActions: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
    },
    ghostActionItem: {
      alignItems: 'center',
      gap: 4,
    },
    ghostActionBtn: {
      padding: spacing.sm,
    },
    ghostActionLabel: {
      fontSize: 10,
      color: colors.textMuted,
      fontWeight: '500' as const,
    },
    ghostSubtaskBadge: {
      fontSize: typography.xs,
      color: colors.textMuted,
      flexShrink: 0,
    },
    ghostSubtaskItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: 6,
    },
    ghostSubtaskCircle: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.textMuted,
    },
    ghostSubtaskTitle: {
      flex: 1,
      fontSize: typography.base,
      color: colors.text,
    },
    ghostSubtaskRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xs,
    },
    ghostSubtaskText: {
      fontSize: typography.sm,
      color: colors.textMuted,
    },
  });
