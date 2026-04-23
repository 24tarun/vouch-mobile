import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { type Colors, radius, spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import { type CommitmentListItem, type DayStatus } from '@/lib/hooks/useCommitments';
import type { CommitmentStatus, Currency } from '@/lib/types';
import {
  toDateOnlyString as toDateOnly,
  parseDateOnly,
} from '@/lib/utils/date-only';
import { queryKeys } from '@/lib/query/keys';
import { useRealtimeInvalidation } from '@/lib/query/useRealtimeInvalidation';

export function formatCents(cents: number, currency: Currency): string {
  const major = Math.round(cents / 100);
  if (currency === 'EUR') return `€${major}`;
  if (currency === 'USD') return `$${major}`;
  if (currency === 'INR') return `₹${major}`;
  return `${major}`;
}

export { toDateOnly };

export function StatusBadge({ status }: { status: CommitmentStatus }) {
  const { colors } = useTheme();
  const styles = makeSharedCommitmentStyles(colors);
  const STATUS_CFG: Record<CommitmentStatus, { label: string; color: string; bg: string }> = {
    ACTIVE: { label: 'Active', color: colors.accentCyan, bg: 'rgba(0,217,255,0.12)' },
    DRAFT: { label: 'Draft', color: colors.textMuted, bg: colors.surface2 },
    COMPLETED: { label: 'Completed', color: colors.success, bg: 'rgba(34,197,94,0.12)' },
    FAILED: { label: 'Failed', color: colors.destructive, bg: 'rgba(239,68,68,0.12)' },
  };
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.DRAFT;
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

export function DayStrip({ item }: { item: CommitmentListItem }) {
  const { colors } = useTheme();
  const styles = makeSharedCommitmentStyles(colors);
  const DAY_COLORS: Record<DayStatus, string> = {
    passed: colors.success,
    failed: colors.destructive,
    pending: colors.accentCyan,
    future: colors.textSubtle,
  };
  const { start_date, end_date, day_statuses } = item;
  const { width: screenWidth } = useWindowDimensions();
  const scrollRef = useRef<ScrollView | null>(null);
  const today = toDateOnly(new Date());
  const statusByDate = new Map(day_statuses.map((d) => [d.date, d.status]));

  const days = useMemo(() => {
    const nextDays: string[] = [];
    const cursor = new Date(`${start_date}T00:00:00.000Z`);
    const endMs = new Date(`${end_date}T00:00:00.000Z`).getTime();
    while (cursor.getTime() <= endMs) {
      nextDays.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return nextDays;
  }, [start_date, end_date]);

  const visibleCount = Math.min(5, days.length || 1);
  const tileGap = spacing.xs;
  const availableWidth = Math.max(screenWidth - (spacing.lg * 2), 0);
  const tileWidth = Math.max(44, Math.floor((availableWidth - tileGap * (visibleCount - 1)) / visibleCount));

  const initialIndex = useMemo(() => {
    if (days.length <= visibleCount) return 0;
    const todayIndex = days.indexOf(today);
    if (todayIndex >= 0) {
      return Math.min(Math.max(todayIndex - 2, 0), Math.max(days.length - visibleCount, 0));
    }
    if (today < start_date) return 0;
    return Math.max(days.length - visibleCount, 0);
  }, [days, start_date, today, visibleCount]);

  useEffect(() => {
    if (!scrollRef.current || initialIndex === 0) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ x: initialIndex * (tileWidth + tileGap), animated: false });
    });
  }, [initialIndex, tileGap, tileWidth]);

  return (
    <View style={styles.dayStripWrap}>
      <ScrollView
        ref={scrollRef}
        horizontal
        nestedScrollEnabled
        directionalLockEnabled
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.dayStripScroll}
      >
        {days.map((date, index) => {
          const status = (statusByDate.get(date) ?? (date > today ? 'future' : 'future')) as DayStatus;
          const parsed = parseDateOnly(date);
          const monthLabel = parsed.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }).toUpperCase();
          const dayLabel = String(parsed.getDate());
          const weekLabel = parsed.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }).toUpperCase();
          const isToday = date === today;

          return (
            <View
              key={date}
              style={[
                styles.dayTile,
                {
                  width: tileWidth,
                  marginRight: index === days.length - 1 ? 0 : tileGap,
                  borderColor: isToday ? colors.accentCyan : colors.border,
                  backgroundColor: isToday
                    ? 'rgba(0,217,255,0.08)'
                    : status === 'future'
                      ? 'rgba(255,255,255,0.02)'
                      : colors.surface2,
                },
              ]}
            >
              <Text style={[styles.dayTileMonth, isToday && styles.dayTileMonthToday]}>{monthLabel}</Text>
              <Text
                style={[
                  styles.dayTileDay,
                  { color: status === 'future' ? colors.textMuted : DAY_COLORS[status] },
                  isToday && styles.dayTileDayToday,
                ]}
              >
                {dayLabel}
              </Text>
              <Text style={[styles.dayTileWeek, isToday && styles.dayTileMonthToday]}>{weekLabel}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

export interface LinkedTask {
  linkId: string;
  sourceId?: string;
  title: string;
  type: 'task' | 'rule';
  failureCostCents: number;
  deadline?: string;
}

export function LinkedTaskRow({
  item,
  isDraft,
  onRemove,
  onOpenTask,
  index,
}: {
  item: LinkedTask;
  isDraft: boolean;
  onRemove?: (linkId: string) => void;
  onOpenTask?: (taskId: string) => void;
  index: number;
}) {
  const { colors } = useTheme();
  const styles = makeSharedCommitmentStyles(colors);
  return (
    <View style={[styles.linkedRow, index % 2 === 0 ? styles.linkedRowEven : styles.linkedRowOdd]}>
      <View style={styles.linkedTextWrap}>
        <Text style={styles.linkedTitle} numberOfLines={1}>{item.title}</Text>
      </View>
      {item.type === 'task' && item.sourceId && onOpenTask ? (
        <TouchableOpacity onPress={() => onOpenTask(item.sourceId!)} hitSlop={8}>
          <Feather name="external-link" size={15} color={colors.accentCyan} />
        </TouchableOpacity>
      ) : null}
      {isDraft && onRemove ? (
        <TouchableOpacity onPress={() => onRemove(item.linkId)} hitSlop={8}>
          <Feather name="x" size={14} color={colors.destructive} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function useCommitmentLinks(commitmentId: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.commitmentLinks(commitmentId),
    queryFn: async () => {
      const { data: links, error: linksError } = await supabase
        .from('commitment_task_links')
        .select('id, task_id, recurrence_rule_id')
        .eq('commitment_id', commitmentId!)
        .order('created_at', { ascending: true });

      if (linksError) {
        throw new Error(linksError.message);
      }

      const taskIds = ((links ?? []) as any[]).filter((link) => link.task_id).map((link) => link.task_id as string);
      const ruleIds = ((links ?? []) as any[]).filter((link) => link.recurrence_rule_id).map((link) => link.recurrence_rule_id as string);

      const [tasksRes, rulesRes] = await Promise.all([
        taskIds.length > 0
          ? supabase.from('tasks').select('id, title, failure_cost_cents, deadline').in('id', taskIds)
          : Promise.resolve({ data: [], error: null }),
        ruleIds.length > 0
          ? supabase.from('recurrence_rules').select('id, title, failure_cost_cents').in('id', ruleIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (tasksRes.error) {
        throw new Error(tasksRes.error.message);
      }
      if (rulesRes.error) {
        throw new Error(rulesRes.error.message);
      }

      const taskMap = new Map((tasksRes.data ?? []).map((task: any) => [task.id, task]));
      const ruleMap = new Map((rulesRes.data ?? []).map((rule: any) => [rule.id, rule]));

      return ((links ?? []) as any[]).map((link) => {
        const task = link.task_id ? taskMap.get(link.task_id) : null;
        const rule = link.recurrence_rule_id ? ruleMap.get(link.recurrence_rule_id) : null;
        return {
          linkId: link.id,
          sourceId: link.task_id ?? link.recurrence_rule_id ?? undefined,
          title: task?.title ?? rule?.title ?? 'Unknown',
          type: link.task_id ? 'task' : 'rule',
          failureCostCents: Number(task?.failure_cost_cents ?? rule?.failure_cost_cents ?? 0),
          deadline: task?.deadline,
        } satisfies LinkedTask;
      });
    },
    enabled: Boolean(commitmentId),
  });

  useRealtimeInvalidation({
    channelName: `commitment-links:${commitmentId ?? 'none'}`,
    enabled: Boolean(commitmentId),
    subscriptions: commitmentId
      ? [
          { table: 'commitment_task_links', filter: `commitment_id=eq.${commitmentId}` },
          { table: 'tasks' },
          { table: 'recurrence_rules' },
        ]
      : [],
    invalidateKeys: [queryKeys.commitmentLinks(commitmentId)],
  });

  return {
    linkedTasks: query.data ?? [],
    setLinkedTasks: useCallback((value: SetStateAction<LinkedTask[]>) => {
      if (!commitmentId) return;

      queryClient.setQueryData<LinkedTask[]>(
        queryKeys.commitmentLinks(commitmentId),
        (current) => {
          const previous = current ?? [];
          return typeof value === 'function'
            ? (value as (prevState: LinkedTask[]) => LinkedTask[])(previous)
            : value;
        },
      );
    }, [commitmentId, queryClient]),
    loadingLinks: query.isLoading,
    refetchLinks: useCallback(() => {
      void query.refetch();
    }, [query]),
  };
}

export function TaskPickerModal({
  commitmentId,
  startDate,
  endDate,
  excludedTaskIds = [],
  onClose,
  onLinked,
}: {
  commitmentId?: string;
  startDate: string;
  endDate: string;
  excludedTaskIds?: string[];
  onClose: () => void;
  onLinked: (linked: LinkedTask) => void;
}) {
  const { colors } = useTheme();
  const styles = makeSharedCommitmentStyles(colors);
  const [items, setItems] = useState<
    ({ id: string; title: string; deadline?: string; type: 'task'; failureCostCents: number } | { id: string; title: string; type: 'rule'; failureCostCents: number })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [linking, setLinking] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchItems() {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) return;

      const [tasksRes, rulesRes] = await Promise.all([
        supabase
          .from('tasks')
          .select('id, title, deadline, failure_cost_cents')
          .eq('user_id', userId)
          .neq('status', 'DELETED')
          .gte('deadline', `${startDate}T00:00:00.000Z`)
          .lte('deadline', `${endDate}T23:59:59.999Z`)
          .order('deadline', { ascending: true }),
        supabase
          .from('recurrence_rules')
          .select('id, title, failure_cost_cents')
          .eq('user_id', userId)
          .order('created_at', { ascending: false }),
      ]);

      if (!cancelled) {
        setItems([
          ...((tasksRes.data as any[] ?? []).map((t) => ({
            id: t.id,
            title: t.title,
            deadline: t.deadline,
            type: 'task' as const,
            failureCostCents: Number(t.failure_cost_cents ?? 0),
          }))),
          ...((rulesRes.data as any[] ?? []).map((r) => ({
            id: r.id,
            title: r.title,
            type: 'rule' as const,
            failureCostCents: Number(r.failure_cost_cents ?? 0),
          }))),
        ]);
        setLoading(false);
      }
    }
    fetchItems();
    return () => { cancelled = true; };
  }, [endDate, startDate]);

  const filtered = items.filter((item) => {
    if (item.type === 'task' && excludedTaskIds.includes(item.id)) return false;
    return item.title.toLowerCase().includes(search.toLowerCase());
  });

  async function linkItem(item: { id: string; title: string; type: 'task' | 'rule'; failureCostCents: number }) {
    setLinking(item.id);
    try {
      if (!commitmentId) {
        onLinked({
          linkId: item.id,
          sourceId: item.id,
          title: item.title,
          type: item.type,
          failureCostCents: item.failureCostCents,
        });
        return;
      }

      const payload = item.type === 'task'
        ? { commitment_id: commitmentId, task_id: item.id, recurrence_rule_id: null }
        : { commitment_id: commitmentId, task_id: null, recurrence_rule_id: item.id };

      const { data, error } = await supabase
        .from('commitment_task_links')
        .insert(payload)
        .select('id')
        .single();

      if (error) {
        Alert.alert('Error', error.message);
        return;
      }

      onLinked({
        linkId: data.id,
        sourceId: item.id,
        title: item.title,
        type: item.type,
        failureCostCents: item.failureCostCents,
      });
    } finally {
      setLinking(null);
    }
  }

  return (
    <View style={styles.modalOverlay}>
      <View style={styles.pickerModal}>
        <View style={styles.pickerHeader}>
          <Text style={styles.pickerTitle}>Link a task</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Feather name="x" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <Text style={styles.pickerSubtitle}>Choose a task or recurring series</Text>
        <View style={styles.searchWrap}>
          <Feather name="search" size={15} color={colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search tasks or series…"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>
        {loading ? (
          <ActivityIndicator color={colors.textMuted} style={{ marginTop: spacing.xl }} />
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: spacing.lg }}
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.pickerRow} onPress={() => linkItem(item)} disabled={!!linking}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickerRowTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.pickerRowSub}>
                    {item.type === 'task'
                      ? `Task due ${item.deadline ? parseDateOnly(item.deadline.slice(0, 10)).toLocaleDateString('en-GB') : ''}`
                      : 'Recurring series'}
                  </Text>
                </View>
                {linking === item.id ? (
                  <ActivityIndicator size="small" color={colors.accentCyan} />
                ) : (
                  <Feather name="plus" size={18} color={colors.accentCyan} />
                )}
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </View>
  );
}

const makeSharedCommitmentStyles = (colors: Colors) => StyleSheet.create({
  badge: { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontSize: typography.xs, fontWeight: typography.semibold },
  dayStripWrap: { marginBottom: spacing.md },
  dayStripScroll: { paddingVertical: 2 },
  dayTile: {
    height: 94,
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
  dayTileMonthToday: { color: colors.accentCyan },
  dayTileDay: { fontSize: typography.xxl, fontWeight: typography.medium },
  dayTileWeek: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
    color: colors.textSubtle,
    letterSpacing: 1.2,
    marginTop: 3,
  },
  dayTileDayToday: {
    textShadowColor: 'rgba(0,217,255,0.25)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
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
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2,6,23,0.72)',
    justifyContent: 'flex-end',
  },
  pickerModal: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    maxHeight: '82%',
  },
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
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.md,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: typography.base },
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
});

