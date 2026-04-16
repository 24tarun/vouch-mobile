import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader } from '@/components/PageHeader';

type CurrencyCode = 'USD' | 'EUR' | 'INR';
type LedgerEntryKind = 'failure' | 'rectified' | 'override' | 'voucher_timeout_penalty' | 'other';

interface LedgerEntry {
  id: string;
  periodId: string;
  title: string;
  amountCents: number;
  createdAt: string;
  kind: LedgerEntryKind;
}

interface LedgerMonth {
  id: string;
  label: string;
  projectedDonationCents: number;
  rectifyPassesUsed: number;
  keptCents: number;
  failures: number;
  totalCents: number;
  entries: LedgerEntry[];
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function formatMonthId(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function parsePeriodToLabel(periodId: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(periodId);
  if (!match) return periodId;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 0 || month > 11) {
    return periodId;
  }
  return formatMonthLabel(new Date(year, month, 1));
}

function formatDateOnly(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function resolveCurrency(raw: string | null | undefined): CurrencyCode {
  if (raw === 'EUR' || raw === 'INR') return raw;
  return 'USD';
}

function currencySymbol(currency: CurrencyCode): string {
  if (currency === 'EUR') return '€';
  if (currency === 'INR') return '₹';
  return '$';
}

function formatCurrency(cents: number, currency: CurrencyCode): string {
  return `${currencySymbol(currency)}${(Math.abs(cents) / 100).toFixed(2)}`;
}

function parsePeriodFromCreatedAt(createdAt: string | null | undefined, fallbackPeriod: string): string {
  if (!createdAt) return fallbackPeriod;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return fallbackPeriod;
  return formatMonthId(monthStart(date));
}

function normalizeEntryKind(raw: string): LedgerEntryKind {
  if (raw === 'failure') return 'failure';
  if (raw === 'rectified') return 'rectified';
  if (raw === 'override') return 'override';
  if (raw === 'voucher_timeout_penalty') return 'voucher_timeout_penalty';
  return 'other';
}

function fallbackTitle(kind: LedgerEntryKind): string {
  if (kind === 'rectified') return 'Rectified Task';
  if (kind === 'override') return 'Override';
  if (kind === 'voucher_timeout_penalty') return 'Voucher Timeout Penalty';
  return 'Task Penalty';
}

function badgeForKind(kind: LedgerEntryKind): { label: string; fg: string; bg: string } {
  switch (kind) {
    case 'failure':
      return { label: 'MISSED', fg: '#EF4444', bg: 'rgba(239,68,68,0.18)' };
    case 'rectified':
      return { label: 'RECTIFIED', fg: '#22C55E', bg: 'rgba(34,197,94,0.18)' };
    case 'override':
      return { label: 'SETTLED', fg: '#22D3EE', bg: 'rgba(34,211,238,0.18)' };
    case 'voucher_timeout_penalty':
      return { label: 'TIMEOUT', fg: '#F59E0B', bg: 'rgba(245,158,11,0.18)' };
    default:
      return { label: 'ENTRY', fg: colors.textMuted, bg: colors.surface2 };
  }
}

function isReversal(kind: LedgerEntryKind, amountCents: number): boolean {
  if (kind === 'rectified' || kind === 'override') return true;
  if (kind === 'other') return amountCents < 0;
  return false;
}

function monthTotals(entries: LedgerEntry[]): { totalCents: number; failures: number } {
  return entries.reduce(
    (acc, entry) => {
      acc.totalCents += entry.amountCents;
      if (entry.kind === 'failure') acc.failures += 1;
      return acc;
    },
    { totalCents: 0, failures: 0 },
  );
}

function formatMonthNet(totalCents: number, currency: CurrencyCode): string {
  if (totalCents > 0) return `-${formatCurrency(totalCents, currency)}`;
  if (totalCents < 0) return `+${formatCurrency(totalCents, currency)}`;
  return formatCurrency(0, currency);
}

function emptyCurrentMonth(periodId: string): LedgerMonth {
  return {
    id: periodId,
    label: parsePeriodToLabel(periodId),
    projectedDonationCents: 0,
    rectifyPassesUsed: 0,
    keptCents: 0,
    failures: 0,
    totalCents: 0,
    entries: [],
  };
}

function Metric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
    </View>
  );
}

function LedgerEntryRow({
  entry,
  currency,
}: {
  entry: LedgerEntry;
  currency: CurrencyCode;
}) {
  const badge = badgeForKind(entry.kind);
  const reversal = isReversal(entry.kind, entry.amountCents);

  return (
    <View style={styles.entryRow}>
      <View style={styles.entryMain}>
        <View style={styles.entryTop}>
          <Text style={styles.entryTitle} numberOfLines={1} ellipsizeMode="tail">
            {entry.title}
          </Text>
          <View style={[styles.entryBadge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.entryBadgeText, { color: badge.fg }]}>{badge.label}</Text>
          </View>
          <Feather name="external-link" size={14} color={colors.textMuted} />
        </View>
      </View>

      <View style={styles.entryAmountWrap}>
        <Text style={[styles.entryAmount, reversal ? styles.credit : styles.debit]}>
          {reversal ? '+' : '-'}{formatCurrency(entry.amountCents, currency)}
        </Text>
      </View>
    </View>
  );
}

export default function LedgerScreen() {
  const { user, profile, loading: authLoading } = useAuth();
  const currency = useMemo(() => resolveCurrency(profile?.currency), [profile?.currency]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentMonth, setCurrentMonth] = useState<LedgerMonth | null>(null);
  const [previousMonths, setPreviousMonths] = useState<LedgerMonth[]>([]);
  const [openMonthById, setOpenMonthById] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;

    async function loadLedger() {
      const currentPeriodId = formatMonthId(monthStart(new Date()));
      if (!user?.id) {
        if (!cancelled) {
          setCurrentMonth(emptyCurrentMonth(currentPeriodId));
          setPreviousMonths([]);
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setError(null);

      const now = new Date();
      const currentStart = monthStart(now);
      const nextStart = addMonths(currentStart, 1);
      const periodStartDate = `${formatMonthId(currentStart)}-01`;
      const periodEndDate = formatDateOnly(nextStart);

      const [ledgerRes, rectifyRes, keptRes] = await Promise.all([
        supabase
          .from('ledger_entries')
          .select(`
            id,
            period,
            amount_cents,
            entry_type,
            created_at,
            task:tasks(id, title, status)
          `)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('rectify_passes')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('period', currentPeriodId),
        supabase
          .from('tasks')
          .select('failure_cost_cents')
          .eq('user_id', user.id)
          .in('status', ['ACCEPTED', 'AUTO_ACCEPTED', 'ORCA_ACCEPTED'])
          .gte('deadline', periodStartDate)
          .lt('deadline', periodEndDate),
      ]);

      if (cancelled) return;

      if (ledgerRes.error) {
        setError(ledgerRes.error.message);
        setLoading(false);
        return;
      }
      if (rectifyRes.error) {
        setError(rectifyRes.error.message);
        setLoading(false);
        return;
      }
      if (keptRes.error) {
        setError(keptRes.error.message);
        setLoading(false);
        return;
      }

      const rawRows = (ledgerRes.data ?? []) as any[];
      const mappedEntries: LedgerEntry[] = rawRows.map((row) => {
        const kind = normalizeEntryKind(String(row.entry_type ?? ''));
        const task = Array.isArray(row.task) ? row.task[0] : row.task;
        const periodId = typeof row.period === 'string' && /^\d{4}-\d{2}$/.test(row.period)
          ? row.period
          : parsePeriodFromCreatedAt(row.created_at, currentPeriodId);
        return {
          id: String(row.id),
          periodId,
          title: (task?.title as string | undefined)?.trim() || fallbackTitle(kind),
          amountCents: Number(row.amount_cents ?? 0),
          createdAt: typeof row.created_at === 'string' ? row.created_at : new Date().toISOString(),
          kind,
        };
      });

      const entriesByPeriod = new Map<string, LedgerEntry[]>();
      for (const entry of mappedEntries) {
        const existing = entriesByPeriod.get(entry.periodId) ?? [];
        existing.push(entry);
        entriesByPeriod.set(entry.periodId, existing);
      }
      for (const [periodId, entries] of entriesByPeriod.entries()) {
        entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        entriesByPeriod.set(periodId, entries);
      }

      const currentEntries = entriesByPeriod.get(currentPeriodId) ?? [];
      const currentComputed = monthTotals(currentEntries);
      const keptCents = ((keptRes.data ?? []) as { failure_cost_cents: number | null }[]).reduce(
        (sum, row) => sum + Number(row.failure_cost_cents ?? 0),
        0,
      );
      const rectifyCount = rectifyRes.count ?? 0;

      const currentMonthData: LedgerMonth = {
        id: currentPeriodId,
        label: parsePeriodToLabel(currentPeriodId),
        projectedDonationCents: currentComputed.totalCents,
        rectifyPassesUsed: rectifyCount,
        keptCents,
        failures: currentComputed.failures,
        totalCents: currentComputed.totalCents,
        entries: currentEntries,
      };

      const previousPeriodIds = Array.from(entriesByPeriod.keys())
        .filter((periodId) => periodId !== currentPeriodId)
        .sort((a, b) => b.localeCompare(a));

      const previousMonthsData = previousPeriodIds.map((periodId) => {
        const entries = entriesByPeriod.get(periodId) ?? [];
        const computed = monthTotals(entries);
        return {
          id: periodId,
          label: parsePeriodToLabel(periodId),
          projectedDonationCents: computed.totalCents,
          rectifyPassesUsed: 0,
          keptCents: 0,
          failures: computed.failures,
          totalCents: computed.totalCents,
          entries,
        } satisfies LedgerMonth;
      });

      setCurrentMonth(currentMonthData);
      setPreviousMonths(previousMonthsData);
      setLoading(false);
    }

    if (!authLoading) loadLedger();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user?.id]);

  function toggleMonth(monthId: string) {
    setOpenMonthById((prev) => ({ ...prev, [monthId]: !prev[monthId] }));
  }

  const allPreviousMonthsExpanded = useMemo(() => {
    if (previousMonths.length === 0) return false;
    return previousMonths.every((month) => Boolean(openMonthById[month.id]));
  }, [previousMonths, openMonthById]);

  function toggleAllPreviousMonths() {
    if (allPreviousMonthsExpanded) {
      setOpenMonthById({});
      return;
    }
    const next: Record<string, boolean> = {};
    for (const month of previousMonths) next[month.id] = true;
    setOpenMonthById(next);
  }

  const month = currentMonth ?? emptyCurrentMonth(formatMonthId(monthStart(new Date())));
  const projectedDonationDisplayCents = Math.max(0, month.projectedDonationCents);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <PageHeader title="Ledger" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <View style={styles.stateWrap}>
            <ActivityIndicator color={colors.accentCyan} />
            <Text style={styles.stateText}>Loading ledger...</Text>
          </View>
        ) : error ? (
          <View style={styles.stateWrap}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <>
            <View style={styles.summaryGrid}>
              <Metric
                label="PROJECTED DONATION"
                value={formatCurrency(projectedDonationDisplayCents, currency)}
                color="#EC4899"
              />
              <Metric
                label="RECTIFY PASSES"
                value={`${month.rectifyPassesUsed}/5`}
                color="#F59E0B"
              />
              <Metric
                label="KEPT"
                value={formatCurrency(month.keptCents, currency)}
                color="#4ADE80"
              />
              <Metric
                label="FAILURES"
                value={String(month.failures)}
                color="#EF4444"
              />
            </View>

            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{month.label}</Text>
            </View>

            {month.entries.length === 0 ? (
              <Text style={styles.emptyText}>No ledger entries for this month.</Text>
            ) : (
              <View style={styles.entriesBlock}>
                {month.entries.map((entry) => (
                  <LedgerEntryRow
                    key={entry.id}
                    entry={entry}
                    currency={currency}
                  />
                ))}
              </View>
            )}

            <View style={styles.previousSection}>
              <View style={styles.previousHeader}>
                <Text style={styles.previousTitle}>Previous Months</Text>
                <TouchableOpacity
                  onPress={toggleAllPreviousMonths}
                  activeOpacity={0.82}
                  accessibilityRole="button"
                  accessibilityLabel={allPreviousMonthsExpanded ? 'Collapse all previous months' : 'Expand all previous months'}
                >
                  <Feather
                    name={allPreviousMonthsExpanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
              </View>

              {previousMonths.length === 0 ? (
                <Text style={styles.emptyText}>No previous ledger months yet.</Text>
              ) : (
                previousMonths.map((previousMonth) => {
                  const isOpen = Boolean(openMonthById[previousMonth.id]);
                  const monthIsReversal = previousMonth.totalCents < 0;
                  return (
                    <View key={previousMonth.id} style={styles.monthBlock}>
                      <TouchableOpacity
                        style={styles.monthHeader}
                        onPress={() => toggleMonth(previousMonth.id)}
                        activeOpacity={0.82}
                        accessibilityRole="button"
                        accessibilityState={{ expanded: isOpen }}
                        accessibilityLabel={`${previousMonth.label}, total ${formatCurrency(previousMonth.totalCents, currency)}`}
                      >
                        <View style={styles.monthHeaderLeft}>
                          <Feather
                            name={isOpen ? 'chevron-down' : 'chevron-right'}
                            size={16}
                            color={colors.textMuted}
                          />
                          <Text style={styles.monthLabel}>{previousMonth.label}</Text>
                        </View>
                        <Text style={[styles.monthTotal, monthIsReversal ? styles.credit : styles.debit]}>
                          {formatMonthNet(previousMonth.totalCents, currency)}
                        </Text>
                      </TouchableOpacity>

                      {isOpen && (
                        <View style={styles.entriesBlock}>
                          {previousMonth.entries.map((entry) => (
                            <LedgerEntryRow
                              key={entry.id}
                              entry={entry}
                              currency={currency}
                            />
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  stateWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  stateText: {
    color: colors.textMuted,
    fontSize: typography.sm,
  },
  errorText: {
    color: colors.warning,
    fontSize: typography.sm,
    textAlign: 'center',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xl,
    columnGap: spacing.md,
    marginBottom: spacing.xl,
  },
  metric: {
    width: '47%',
    gap: 5,
  },
  metricLabel: {
    fontSize: typography.xs,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
    fontWeight: typography.bold,
  },
  metricValue: {
    fontSize: 30,
    fontWeight: typography.normal,
    lineHeight: 38,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  sectionHeader: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  sectionTitle: {
    fontSize: 25,
    color: colors.textMuted,
    fontWeight: typography.semibold,
    letterSpacing: -0.6,
  },
  emptyText: {
    color: colors.textSubtle,
    fontSize: typography.sm,
    paddingTop: spacing.md,
  },
  entriesBlock: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  entryRow: {
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: spacing.sm,
  },
  entryMain: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  entryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
  },
  entryTitle: {
    fontSize: 18,
    color: colors.text,
    lineHeight: 20,
    flexShrink: 1,
  },
  entryBadge: {
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  entryBadgeText: {
    fontSize: 9,
    fontWeight: typography.bold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  entryAmountWrap: {
    alignItems: 'flex-end',
    paddingTop: 1,
    width: 108,
    gap: 2,
    marginLeft: spacing.xs,
  },
  entryAmount: {
    fontSize: 18,
    fontWeight: typography.normal,
    letterSpacing: 0.2,
    lineHeight: 21,
  },
  debit: {
    color: '#EF4444',
  },
  credit: {
    color: '#4ADE80',
  },
  previousSection: {
    marginTop: spacing.xxl + 2,
    gap: spacing.sm,
  },
  previousHeader: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  previousTitle: {
    color: colors.textMuted,
    fontSize: 24,
    fontWeight: typography.semibold,
    letterSpacing: -0.6,
  },
  monthBlock: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  monthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md + 2,
  },
  monthHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  monthLabel: {
    fontSize: 18,
    color: colors.text,
    lineHeight: 22,
  },
  monthTotal: {
    fontSize: 18,
    fontWeight: typography.normal,
    lineHeight: 21,
  },
});
