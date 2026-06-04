import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { type Colors, radius, spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import { PageHeader } from '@/components/PageHeader';
import {
  useCommitments,
  type CommitmentListItem,
} from '@/lib/hooks/useCommitments';
import type { Currency } from '@/lib/types';
import {
  LinkedTaskRow,
  TaskPickerModal,
  formatCents,
  StatusBadge,
  type LinkedTask,
} from '@/components/commitments/shared';
import {
  toDateOnlyString as toDateOnly,
  formatDateOnlyDisplay as formatDateDisplay,
} from '@/lib/utils/date-only';
import { queryKeys } from '@/lib/query/keys';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function defaultStartDate(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function defaultEndDate(): Date {
  const d = defaultStartDate();
  d.setDate(d.getDate() + 6); // 7-day window
  return d;
}

function dayDiffFromToday(dateOnly: string): number {
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const target = new Date(`${dateOnly}T00:00:00.000Z`);
  if (Number.isNaN(target.getTime())) return 0;
  return Math.floor((target.getTime() - todayUtc) / 86_400_000);
}

// ─── Commitment card ──────────────────────────────────────────────────────────

function CommitmentCard({
  item,
  currency,
}: {
  item: CommitmentListItem;
  currency: Currency;
}) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const router = useRouter();
  const daysAccomplished = item.day_statuses.filter((entry) => entry.status === 'passed').length;
  const earnedLabel = formatCents(item.earned_so_far_cents, currency);
  const totalTargetLabel = formatCents(item.total_target_cents, currency);

  return (
    <Pressable
      onPress={() => router.push(`/(app)/commitments/${item.id}`)}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
        {/* Header */}
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>{item.name}</Text>
            <StatusBadge status={item.derived_status} />
          </View>
          <Feather name="chevron-right" size={16} color={colors.textMuted} />
        </View>

        {/* Description */}
        {!!item.description && (
          <Text style={styles.cardDesc} numberOfLines={2}>
            {item.description}
          </Text>
        )}

        <View style={styles.commitmentMetricsRow}>
          <View style={styles.commitmentMetricBlock}>
            <Text style={styles.commitmentMetricLabel}>Days completed</Text>
            <View style={styles.commitmentMetricValueRow}>
              <Text style={styles.commitmentMetricValuePrimary}>{daysAccomplished}</Text>
              <Text style={styles.commitmentMetricSlash}>/</Text>
              <Text style={styles.commitmentMetricValueSecondary}>{item.days_total}</Text>
            </View>
          </View>
          <View style={styles.commitmentMetricDivider} />
          <View style={styles.commitmentMetricBlock}>
            <Text style={styles.commitmentMetricLabel}>Amount pledged</Text>
            <View style={styles.commitmentMetricValueRow}>
              <Text style={[styles.commitmentMetricMoneyPrimary, styles.commitmentMetricMoneyCurrent]}>
                {earnedLabel}
              </Text>
              <Text style={styles.commitmentMetricSlash}>/</Text>
              <Text style={[styles.commitmentMetricMoneyPrimary, styles.commitmentMetricMoneyTarget]}>
                {totalTargetLabel}
              </Text>
            </View>
          </View>
        </View>
    </Pressable>
  );
}

// ─── Create modal ─────────────────────────────────────────────────────────────

function CreateModal({
  currency,
  onClose,
}: {
  currency: Currency;
  onClose: () => void;
}) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const queryClient = useQueryClient();
  const trafficIconColor = isDark ? '#0b1329' : '#0f172a';
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(defaultStartDate());
  const [endDate, setEndDate] = useState(defaultEndDate());
  const [activePicker, setActivePicker] = useState<'start' | 'end' | null>(null);
  const [linkedTasks, setLinkedTasks] = useState<LinkedTask[]>([]);
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [savingAction, setSavingAction] = useState<'draft' | 'commit' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startOnly = toDateOnly(startDate);
  const endOnly = toDateOnly(endDate);
  const totalDays = Math.floor(
    (new Date(`${endOnly}T00:00:00.000Z`).getTime() -
      new Date(`${startOnly}T00:00:00.000Z`).getTime()) /
      86_400_000,
  ) + 1;
  const linkedTaskCount = linkedTasks.length;
  const pledgeCents = linkedTasks.reduce((sum, item) => sum + Number(item.failureCostCents ?? 0), 0);

  function onDateChange(_event: DateTimePickerEvent, date?: Date) {
    if (Platform.OS === 'android') setActivePicker(null);
    if (!date) return;
    if (activePicker === 'start') {
      setStartDate(date);
      // Push end date forward if it's before start
      if (date >= endDate) {
        const next = new Date(date);
        next.setDate(next.getDate() + 29);
        setEndDate(next);
      }
    } else if (activePicker === 'end') {
      setEndDate(date);
    }
  }

  async function handleRemoveLinkedTask(linkId: string) {
    setLinkedTasks((prev) => prev.filter((item) => item.linkId !== linkId));
  }

  async function handleCreate(status: 'DRAFT' | 'ACTIVE') {
    setError(null);
    const trimmedName = name.trim();
    const trimmedDesc = description.trim();

    if (!trimmedName) { setError('Name is required.'); return; }
    if (trimmedDesc.length < 10) { setError('Description must be at least 10 characters.'); return; }
    if (trimmedDesc.length > 500) { setError('Description must be 500 characters or fewer.'); return; }

    const startMs = new Date(`${startOnly}T00:00:00.000Z`).getTime();
    const endMs = new Date(`${endOnly}T00:00:00.000Z`).getTime();
    const diffDays = Math.floor((endMs - startMs) / 86_400_000);
    if (diffDays < 2) { setError('Commitment must span at least 3 days.'); return; }
    if (status === 'ACTIVE' && linkedTasks.length === 0) {
      setError('Link at least one task or recurring series before committing.');
      return;
    }

    setSavingAction(status === 'ACTIVE' ? 'commit' : 'draft');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) { setError('Not authenticated.'); return; }

      const { data: createdCommitment, error: insertError } = await supabase
        .from('commitments')
        .insert({
        user_id: userId,
        name: trimmedName,
        description: trimmedDesc,
        status,
        start_date: startOnly,
        end_date: endOnly,
        })
        .select('id')
        .single();

      if (insertError) { setError(insertError.message); return; }

      if (linkedTasks.length > 0) {
        const { error: linkError } = await supabase
          .from('commitment_task_links')
          .insert(
            linkedTasks.map((item) => ({
              commitment_id: createdCommitment.id,
              task_id: item.type === 'task' ? item.sourceId ?? null : null,
              recurrence_rule_id: item.type === 'rule' ? item.sourceId ?? null : null,
            })),
          );

        if (linkError) {
          await supabase.from('commitments').delete().eq('id', createdCommitment.id);
          setError(linkError.message);
          return;
        }
      }

      const nowIso = new Date().toISOString();
      const optimisticItem: CommitmentListItem = {
        id: createdCommitment.id,
        user_id: userId,
        name: trimmedName,
        description: trimmedDesc,
        status,
        start_date: startOnly,
        end_date: endOnly,
        created_at: nowIso,
        updated_at: nowIso,
        derived_status: status === 'DRAFT' ? 'DRAFT' : 'ACTIVE',
        earned_so_far_cents: 0,
        total_target_cents: pledgeCents,
        days_total: Math.max(totalDays, 0),
        days_remaining: Math.max(0, dayDiffFromToday(endOnly)),
        starts_in_days: dayDiffFromToday(startOnly),
        day_statuses: [],
      };

      queryClient.setQueryData<CommitmentListItem[]>(
        queryKeys.commitments(userId),
        (current) => [optimisticItem, ...(current ?? []).filter((entry) => entry.id !== createdCommitment.id)],
      );
      queryClient.setQueryData(queryKeys.commitmentLinks(createdCommitment.id), linkedTasks);
      void queryClient.invalidateQueries({ queryKey: queryKeys.commitments(userId) });
      onClose();
    } finally {
      setSavingAction(null);
    }
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.createModal} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={styles.createHeader}>
          <Text style={styles.createTitle}>New Commitment</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Feather name="x" size={20} color={colors.destructive} />
          </TouchableOpacity>
        </View>

        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.createScroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.createStatsTop}>
            <View style={styles.createStatInline}>
              <Text style={styles.createStatLabel}>Cost pledge</Text>
              <Text style={styles.createStatValuePledge}>{formatCents(pledgeCents, currency)}</Text>
            </View>
            <View style={styles.createStatInline}>
              <Text style={styles.createStatLabel}>Total days</Text>
              <Text style={styles.createStatValueCyan}>{Math.max(totalDays, 0)}</Text>
            </View>
            <View style={styles.createStatInline}>
              <Text style={styles.createStatLabel}>Linked</Text>
              <Text style={styles.createStatValueBlue}>{linkedTaskCount}</Text>
            </View>
          </View>

          {/* Name */}
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            style={styles.textInput}
            placeholder="e.g. 30 Day Gym Challenge"
            placeholderTextColor={colors.inputPlaceholder}
            value={name}
            onChangeText={setName}
            maxLength={100}
          />

          {/* Description */}
          <Text style={styles.fieldLabel}>Description</Text>
          <TextInput
            style={[styles.textInput, styles.textArea]}
            placeholder="Describe what you're committing to…"
            placeholderTextColor={colors.inputPlaceholder}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            maxLength={500}
            textAlignVertical="top"
          />

          <View style={styles.dateRow}>
            <View style={styles.dateField}>
              <Text style={styles.fieldLabel}>Start date</Text>
              <TouchableOpacity
                style={styles.dateBtn}
                onPress={() => setActivePicker(activePicker === 'start' ? null : 'start')}
              >
                <Feather name="calendar" size={15} color={colors.textMuted} />
                <Text style={styles.dateBtnText} numberOfLines={1}>{formatDateDisplay(startOnly)}</Text>
                <Feather name="chevron-down" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.dateField}>
              <Text style={styles.fieldLabel}>End date</Text>
              <TouchableOpacity
                style={styles.dateBtn}
                onPress={() => setActivePicker(activePicker === 'end' ? null : 'end')}
              >
                <Feather name="calendar" size={15} color={colors.textMuted} />
                <Text style={styles.dateBtnText} numberOfLines={1}>{formatDateDisplay(endOnly)}</Text>
                <Feather name="chevron-down" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {activePicker === 'start' && (
            <DateTimePicker
              value={startDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              themeVariant="dark"
              minimumDate={new Date()}
              onChange={onDateChange}
              style={Platform.OS === 'ios' ? styles.iosPicker : undefined}
            />
          )}

          {activePicker === 'end' && (
            <DateTimePicker
              value={endDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              themeVariant="dark"
              minimumDate={startDate}
              onChange={onDateChange}
              style={Platform.OS === 'ios' ? styles.iosPicker : undefined}
            />
          )}

          <View style={styles.createLinkSection}>
            <View style={styles.createLinkHeader}>
              <TouchableOpacity
                style={styles.createLinkTrigger}
                onPress={() => setTaskPickerOpen(true)}
                disabled={!!savingAction}
              >
              <Text style={styles.createLinkTriggerText}>Link tasks</Text>
                <View style={styles.createLinkPlus}>
                  <Feather name="plus" size={14} color={colors.accentCyan} />
                </View>
              </TouchableOpacity>
            </View>
            {linkedTasks.length > 0 ? (
              <View style={styles.linkedList}>
                {linkedTasks.map((item, index) => (
                  <LinkedTaskRow
                    key={item.linkId}
                    item={item}
                    isDraft
                    index={index}
                    onRemove={handleRemoveLinkedTask}
                  />
                ))}
              </View>
            ) : null}
          </View>

          {/* Error */}
          {error && <Text style={styles.errorText}>{error}</Text>}
        </ScrollView>

        <View style={styles.createFooter}>
          <TouchableOpacity
            style={[styles.trafficFooterBtn, styles.trafficFooterBtnRed, !!savingAction && styles.createBtnDisabled]}
            onPress={onClose}
            disabled={!!savingAction}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Cancel creating commitment"
          >
            <Feather name="x" size={18} color={trafficIconColor} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.trafficFooterBtn, styles.trafficFooterBtnAmber, !!savingAction && styles.createBtnDisabled]}
            onPress={() => { void handleCreate('DRAFT'); }}
            disabled={!!savingAction}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Save commitment as draft"
          >
            {savingAction === 'draft' ? (
              <ActivityIndicator size="small" color={trafficIconColor} />
            ) : (
              <Feather name="edit-3" size={18} color={trafficIconColor} />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.trafficFooterBtn, styles.trafficFooterBtnGreen, !!savingAction && styles.createBtnDisabled]}
            onPress={() => { void handleCreate('ACTIVE'); }}
            disabled={!!savingAction}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Commit now"
          >
            {savingAction === 'commit' ? (
              <ActivityIndicator size="small" color={trafficIconColor} />
            ) : (
              <Feather name="check" size={18} color={trafficIconColor} />
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {taskPickerOpen && (
        <TaskPickerModal
          startDate={startOnly}
          endDate={endOnly}
          excludedTaskIds={linkedTasks.filter((item) => item.type === 'task').map((item) => item.sourceId ?? '')}
          excludedRuleIds={linkedTasks.filter((item) => item.type === 'rule').map((item) => item.sourceId ?? '')}
          onClose={() => setTaskPickerOpen(false)}
          onLinked={(linked) => {
            setLinkedTasks((prev) => {
              const duplicate = prev.some(
                (entry) => entry.type === linked.type && entry.sourceId && linked.sourceId && entry.sourceId === linked.sourceId,
              );
              return duplicate ? prev : [...prev, linked];
            });
            setTaskPickerOpen(false);
          }}
        />
      )}
    </Modal>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const trafficIconColor = isDark ? '#0b1329' : '#0f172a';
  return (
    <View style={styles.emptyWrap}>
      <TouchableOpacity
        style={styles.emptyCreateBtn}
        onPress={onNew}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel="Create a commitment"
      >
        <Feather name="plus" size={32} color={trafficIconColor} />
      </TouchableOpacity>
      <Text style={styles.emptyMessage}>{"Create a Commitment and stick to it,\nif you can 😉😉"}</Text>
    </View>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CommitmentsPage() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const trafficIconColor = isDark ? '#0b1329' : '#0f172a';
  const { commitments, currency, loading, error, refetch } = useCommitments();
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  async function onRefresh() {
    setRefreshing(true);
    await Promise.resolve(refetch());
    setRefreshing(false);
  }

  const activeItems = commitments.filter(
    (c) => c.derived_status === 'ACTIVE' || c.derived_status === 'DRAFT',
  );
  const pastItems = commitments.filter(
    (c) => c.derived_status === 'COMPLETED' || c.derived_status === 'FAILED',
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <PageHeader
        title="Commitments"
        rightAccessory={(
          <View style={styles.headerRight}>
            {loading && !refreshing ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
            <TouchableOpacity style={styles.newBtn} onPress={() => setCreateOpen(true)}>
              <Feather name="plus" size={13} color={trafficIconColor} />
            </TouchableOpacity>
          </View>
        )}
      />

      {error ? (
        <View style={styles.errorWrap}>
          <Text style={styles.errorBanner}>{error}</Text>
          <TouchableOpacity onPress={refetch} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textMuted} />
          }
          showsVerticalScrollIndicator={false}
        >
          {!loading && commitments.length === 0 && (
            <EmptyState onNew={() => setCreateOpen(true)} />
          )}

          {activeItems.length > 0 && (
            <View style={styles.section}>
              {activeItems.map((item) => (
                <CommitmentCard key={item.id} item={item} currency={currency} />
              ))}
            </View>
          )}

          {pastItems.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Past</Text>
              {pastItems.map((item) => (
                <CommitmentCard key={item.id} item={item} currency={currency} />
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {createOpen && (
        <CreateModal
          currency={currency}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (colors: Colors, isDark = true) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  // Page header accessory
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  newBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#00000024',
    shadowColor: colors.success,
    shadowOpacity: 0.2,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 0 },
    elevation: 1,
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: spacing.xxl },

  // Error
  errorWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  errorBanner: { color: colors.destructive, fontSize: typography.sm, textAlign: 'center' },
  retryBtn: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md },
  retryText: { color: colors.text, fontSize: typography.sm, fontWeight: typography.medium },

  // Section
  section: { marginTop: spacing.lg },
  sectionLabel: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },

  // Card
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardPressed: { opacity: 0.85 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  cardTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  cardTitle: { fontSize: 18, color: colors.text, flexShrink: 1 },
  cardDesc: { marginTop: spacing.xs, fontSize: typography.sm, color: colors.textMuted, lineHeight: 20 },
  todayTaskSection: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    gap: 4,
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
  todayTaskTitle: {
    flex: 1,
    fontSize: typography.base,
    fontWeight: typography.medium,
    color: colors.text,
  },
  todayTaskEmpty: {
    fontSize: typography.sm,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  commitmentMetricsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  commitmentMetricBlock: {
    flex: 1,
    minWidth: 0,
  },
  commitmentMetricDivider: {
    width: 1,
    backgroundColor: colors.border,
  },
  commitmentMetricLabel: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  commitmentMetricValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    flexWrap: 'wrap',
  },
  commitmentMetricValuePrimary: {
    fontSize: typography.xl,
    fontWeight: typography.normal,
    color: isDark ? '#00ffd5' : '#0d9488',
  },
  commitmentMetricValueSecondary: {
    fontSize: typography.lg,
    fontWeight: typography.normal,
    color: colors.destructive,
  },
  commitmentMetricSlash: {
    fontSize: typography.xxl,
    lineHeight: 34,
    fontWeight: typography.normal,
    color: 'rgba(239,68,68,0.75)',
    marginHorizontal: 1,
  },
  commitmentMetricMoneyPrimary: {
    fontSize: typography.lg,
    fontWeight: typography.normal,
  },
  commitmentMetricMoneyCurrent: {
    color: colors.success,
  },
  commitmentMetricMoneyTarget: {
    color: colors.destructive,
  },

  // Badge
  badge: { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: typography.xs, fontWeight: typography.semibold },

  // Expanded
  expandedBody: { marginTop: spacing.md },
  divider: { height: 1, backgroundColor: colors.border, marginBottom: spacing.md },

  // Day strip
  dayStripWrap: { marginBottom: spacing.md },
  dayStripScroll: { paddingVertical: 2 },
  dayTile: {
    height: 78,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayTileMonth: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
    color: colors.textSubtle,
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  dayTileMonthToday: {
    color: colors.accentCyan,
  },
  dayTileDay: {
    fontSize: typography.xxl,
    fontWeight: typography.medium,
  },
  dayTileDayToday: {
    textShadowColor: 'rgba(0,217,255,0.25)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },

  // Linked tasks list
  linkedList: { gap: spacing.xs, marginBottom: spacing.sm },
  linkedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  linkedRowEven: { backgroundColor: 'rgba(255,255,255,0.02)' },
  linkedRowOdd: { backgroundColor: 'rgba(0,217,255,0.05)' },
  linkedTextWrap: { flex: 1, minWidth: 0 },
  linkedTitle: { fontSize: 18, color: colors.text },
  noLinksText: { fontSize: typography.sm, color: colors.textSubtle, marginBottom: spacing.sm, fontStyle: 'italic' },

  // Action group
  actionGroup: { gap: spacing.xs, marginTop: spacing.sm },
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

  // Empty state
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: spacing.xl },
  emptyCreateBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#00000024',
    shadowColor: colors.success,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
    marginBottom: spacing.lg,
  },
  emptyMessage: { fontSize: typography.md, color: colors.textMuted, textAlign: 'center', lineHeight: 24 },

  // Picker modal
  pickerModal: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  pickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  pickerTitle: { fontSize: typography.md, fontWeight: typography.bold, color: colors.text },
  pickerSubtitle: { fontSize: typography.xs, color: colors.textMuted, marginBottom: spacing.md },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.md,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: typography.base },
  pickerEmpty: { color: colors.textSubtle, fontSize: typography.sm, textAlign: 'center', marginTop: spacing.xl },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  pickerRowTitle: { fontSize: 18, color: colors.text },
  pickerRowSub: { fontSize: typography.xs, color: colors.textMuted, marginTop: 2 },

  // Create modal
  createModal: { flex: 1, backgroundColor: colors.bg },
  createHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  createTitle: { fontSize: typography.lg, fontWeight: typography.bold, color: colors.text },
  createScroll: { padding: spacing.lg, paddingBottom: spacing.lg },
  fieldLabel: { fontSize: typography.sm, fontWeight: typography.semibold, color: colors.textMuted, marginBottom: 6, marginTop: spacing.md },
  dateRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  dateField: { flex: 1 },
  textInput: {
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    color: colors.text,
    fontSize: typography.base,
  },
  textArea: { height: 80, paddingTop: 11 },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.inputBg,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
  },
  dateBtnText: { flex: 1, color: colors.text, fontSize: typography.base },
  iosPicker: { height: 160, marginHorizontal: -spacing.md },
  createStatsTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  createStatInline: {
    flex: 1,
    minWidth: 0,
  },
  createLinkSection: { marginTop: spacing.lg, gap: spacing.sm },
  createLinkHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start' },
  createLinkTrigger: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'flex-start' },
  createLinkTriggerText: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    color: colors.accentCyan,
  },
  createLinkPlus: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,217,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(0,217,255,0.24)',
  },
  createStatLabel: {
    fontSize: typography.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  createStatValue: {
    fontSize: typography.md,
    fontWeight: typography.bold,
    color: colors.text,
  },
  createStatValuePledge: {
    fontSize: typography.xxl,
    fontWeight: typography.normal,
    color: colors.success,
  },
  createStatValueCyan: {
    fontSize: typography.xxl,
    fontWeight: typography.normal,
    color: colors.accentCyan,
  },
  createStatValueBlue: {
    fontSize: typography.xxl,
    fontWeight: typography.normal,
    color: '#3B82F6',
  },
  errorText: {
    color: colors.destructive,
    fontSize: typography.sm,
    marginTop: spacing.md,
  },
  createBtnDisabled: { opacity: 0.5 },
  createFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  trafficFooterBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderWidth: 1,
    borderColor: '#00000024',
  },
  trafficFooterBtnRed: {
    backgroundColor: colors.destructive,
    shadowColor: colors.destructive,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  trafficFooterBtnAmber: {
    backgroundColor: colors.warning,
    shadowColor: colors.warning,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  trafficFooterBtnGreen: {
    backgroundColor: colors.success,
    shadowColor: colors.success,
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
});
