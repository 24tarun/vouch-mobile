import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { colors, radius, spacing, typography } from '@/lib/theme';
import { useCommitments } from '@/lib/hooks/useCommitments';
import {
  DayStrip,
  LinkedTaskRow,
  TaskPickerModal,
  formatCents,
  toDateOnly,
  useCommitmentLinks,
  StatusBadge,
} from '@/components/commitments/shared';

export default function CommitmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { commitments, currency, loading, error, refetch } = useCommitments();

  // Re-fetch every time this screen is navigated to. The Tabs layout pre-mounts
  // all screens, so without this the hook would show stale (or empty) data when
  // the user lands here after creating a new commitment.
  useFocusEffect(useCallback(() => { refetch(); }, []));
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);

  const item = commitments.find((commitment) => commitment.id === id) ?? null;
  const { linkedTasks, setLinkedTasks, loadingLinks } = useCommitmentLinks(item?.id ?? null);

  const today = toDateOnly(new Date());
  const isWithinCommitmentWindow = item ? today >= item.start_date && today <= item.end_date : false;
  const todayLinkedTask = isWithinCommitmentWindow
    ? linkedTasks.find((task) => task.type === 'task' && task.deadline?.slice(0, 10) === today) ?? null
    : null;

  async function handleRemoveLink(linkId: string) {
    setActionLoading(`unlink-${linkId}`);
    try {
      await supabase.from('commitment_task_links').delete().eq('id', linkId);
      setLinkedTasks((prev) => prev.filter((entry) => entry.linkId !== linkId));
      refetch();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCommit() {
    if (!item) return;
    if (linkedTasks.length === 0) {
      Alert.alert('Nothing linked', 'Link at least one task or recurring series before committing.');
      return;
    }
    if (item.start_date < today) {
      Alert.alert('Start date in the past', 'You cannot commit to a plan with a start date in the past.');
      return;
    }
    setActionLoading('commit');
    try {
      const { error: updateError } = await supabase
        .from('commitments')
        .update({ status: 'ACTIVE' })
        .eq('id', item.id)
        .eq('status', 'DRAFT');
      if (updateError) {
        Alert.alert('Error', updateError.message);
        return;
      }
      refetch();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDeleteOrAbandon() {
    if (!item) return;
    const isDraft = item.status === 'DRAFT';
    Alert.alert(
      isDraft ? 'Delete draft' : 'Abandon commitment',
      isDraft ? 'Delete this draft commitment?' : 'Abandon this commitment? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isDraft ? 'Delete' : 'Abandon',
          style: 'destructive',
          onPress: async () => {
            setActionLoading('delete');
            try {
              await supabase.from('commitments').delete().eq('id', item.id);
              refetch();
              router.back();
            } finally {
              setActionLoading(null);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !item) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error ?? 'Commitment not found.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const daysAccomplished = item.day_statuses.filter((entry) => entry.status === 'passed').length;
  const isDraft = item.status === 'DRAFT';
  const isActive = item.derived_status === 'ACTIVE';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerBtn} onPress={() => router.push('/(app)/commitments')}>
          <Feather name="chevron-left" size={18} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Commitment Details</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.detailCard}>
          <View style={styles.cardTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{item.name}</Text>
              {!!item.description && <Text style={styles.description}>{item.description}</Text>}
            </View>
            <View style={styles.cardTopRight}>
              <StatusBadge status={item.derived_status} />
              {isActive && (
                <TouchableOpacity style={styles.abandonBtn} onPress={handleDeleteOrAbandon} disabled={!!actionLoading}>
                  <Feather name="flag" size={11} color={colors.destructive} />
                  <Text style={styles.abandonBtnText}>Abandon</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.metricsRow}>
            <View style={styles.metricBlock}>
              <Text style={styles.metricLabel}>Days completed</Text>
              <View style={styles.metricValueRow}>
                <Text style={styles.metricPrimary}>{daysAccomplished}</Text>
                <Text style={styles.metricSlash}>/</Text>
                <Text style={styles.metricSecondary}>{item.days_total}</Text>
              </View>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricBlock}>
              <Text style={styles.metricLabel}>Amount pledged</Text>
              <View style={styles.metricValueRow}>
                <Text style={[styles.moneyPrimary, styles.moneyCurrent]}>{formatCents(item.earned_so_far_cents, currency)}</Text>
                <Text style={styles.metricSlash}>/</Text>
                <Text style={[styles.moneyPrimary, styles.moneyTarget]}>{formatCents(item.total_target_cents, currency)}</Text>
              </View>
            </View>
          </View>

          {!isDraft && <DayStrip item={item} />}

          {!isDraft && !loadingLinks && (
            <View style={styles.todayTaskSection}>
              <Text style={styles.todayTaskLabel}>Linked task for today</Text>
              {todayLinkedTask ? (
                <TouchableOpacity style={styles.todayTaskWrap} onPress={() => router.push(`/(app)/tasks/${todayLinkedTask.sourceId}`)}>
                  <Text style={styles.todayTaskTitle} numberOfLines={1}>{todayLinkedTask.title}</Text>
                  <Feather name="external-link" size={15} color={colors.accentCyan} />
                </TouchableOpacity>
              ) : (
                <Text style={styles.todayTaskEmpty}>You&apos;re free for the day</Text>
              )}
            </View>
          )}

          {loadingLinks ? (
            <ActivityIndicator color={colors.textMuted} style={{ marginVertical: spacing.md }} />
          ) : linkedTasks.length > 0 ? (
            <View style={styles.linkedList}>
              {linkedTasks.filter((entry) => !todayLinkedTask || entry.linkId !== todayLinkedTask.linkId).map((entry, index) => (
                <LinkedTaskRow
                  key={entry.linkId}
                  item={entry}
                  isDraft={isDraft}
                  index={index}
                  onRemove={handleRemoveLink}
                  onOpenTask={(taskId) => router.push(`/(app)/tasks/${taskId}`)}
                />
              ))}
            </View>
          ) : isDraft ? (
            <Text style={styles.noLinksText}>No tasks linked yet. Add at least one to commit.</Text>
          ) : null}

          {isDraft && (
            <View style={styles.actionGroup}>
              <TouchableOpacity style={styles.actionBtn} onPress={() => setTaskPickerOpen(true)} disabled={!!actionLoading}>
                <Feather name="plus" size={14} color={colors.accentCyan} />
                <Text style={[styles.actionBtnText, { color: colors.accentCyan }]}>Link task</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionBtnSuccess]} onPress={handleCommit} disabled={!!actionLoading}>
                {actionLoading === 'commit' ? (
                  <ActivityIndicator size="small" color={colors.success} />
                ) : (
                  <>
                    <Feather name="zap" size={14} color={colors.success} />
                    <Text style={[styles.actionBtnText, { color: colors.success }]}>Commit</Text>
                  </>
                )}
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDestructive]} onPress={handleDeleteOrAbandon} disabled={!!actionLoading}>
                <Feather name="trash-2" size={14} color={colors.destructive} />
                <Text style={[styles.actionBtnText, { color: colors.destructive }]}>Delete draft</Text>
              </TouchableOpacity>
            </View>
          )}

        </View>
      </ScrollView>

      {taskPickerOpen && (
        <TaskPickerModal
          commitmentId={item.id}
          startDate={item.start_date}
          endDate={item.end_date}
          excludedTaskIds={linkedTasks.filter((entry) => entry.type === 'task').map((entry) => entry.sourceId ?? '')}
          onClose={() => setTaskPickerOpen(false)}
          onLinked={(linked) => {
            setLinkedTasks((prev) => [...prev, linked]);
            setTaskPickerOpen(false);
            refetch();
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerTitle: { fontSize: typography.lg, fontWeight: typography.bold, color: colors.text },
  headerSpacer: { width: 36, height: 36 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  detailCard: {
    paddingVertical: spacing.sm,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  cardTopRight: { alignItems: 'flex-end', gap: spacing.xs },
  abandonBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.2)',
  },
  abandonBtnText: { fontSize: typography.xs, fontWeight: typography.medium, color: colors.destructive },
  title: { fontSize: 18, color: colors.text, flexShrink: 1 },
  description: { marginTop: spacing.xs, fontSize: typography.sm, color: colors.textMuted, lineHeight: 20 },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.lg,
  },
  metricBlock: { flex: 1, minWidth: 0 },
  metricDivider: { width: 1, backgroundColor: colors.border },
  metricLabel: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  metricValueRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, flexWrap: 'wrap' },
  metricPrimary: { fontSize: typography.xl, fontWeight: typography.normal, color: '#00ffd5' },
  metricSecondary: { fontSize: typography.lg, fontWeight: typography.normal, color: colors.destructive },
  metricSlash: {
    fontSize: typography.xxl,
    lineHeight: 34,
    fontWeight: typography.normal,
    color: 'rgba(239,68,68,0.75)',
    marginHorizontal: 1,
  },
  moneyPrimary: { fontSize: typography.lg, fontWeight: typography.normal },
  moneyCurrent: { color: colors.success },
  moneyTarget: { color: colors.destructive },
  todayTaskSection: {
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  todayTaskLabel: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  todayTaskWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 6,
  },
  todayTaskTitle: { flex: 1, fontSize: 18, color: colors.text },
  todayTaskEmpty: { fontSize: typography.sm, color: colors.textMuted, fontStyle: 'italic' },
  linkedList: {
    gap: spacing.xs,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  noLinksText: { fontSize: typography.sm, color: colors.textSubtle, marginTop: spacing.sm, marginBottom: spacing.md, fontStyle: 'italic' },
  actionGroup: {
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
  },
  actionBtnSuccess: { backgroundColor: 'rgba(34,197,94,0.08)' },
  actionBtnDestructive: { backgroundColor: 'rgba(239,68,68,0.08)' },
  actionBtnText: { fontSize: typography.sm, fontWeight: typography.medium },
  errorText: { color: colors.destructive, fontSize: typography.sm, textAlign: 'center' },
});
