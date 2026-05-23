import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { type Colors, spacing, typography } from '@/lib/theme';
import { useTheme } from '@/lib/ThemeContext';
import { useAuth } from '@/hooks/useAuth';
import { PageHeader } from '@/components/PageHeader';
import { useLedger } from '@/lib/hooks/useLedger';
import { WEBSITE_URL } from '@/lib/auth-urls';
import { supabase } from '@/lib/supabase';

type CurrencyCode = 'USD' | 'EUR' | 'INR';
type LedgerEntryKind = 'failure' | 'rectified' | 'override' | 'voucher_timeout_penalty' | 'other';

interface LedgerEntry {
  id: string;
  taskId: string | null;
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

function badgeForKind(kind: LedgerEntryKind, colors: Colors): { label: string; fg: string; bg: string } {
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
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
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
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const router = useRouter();
  const badge = badgeForKind(entry.kind, colors);
  const reversal = isReversal(entry.kind, entry.amountCents);

  function handlePress() {
    if (entry.taskId) {
      router.push(`/(app)/tasks/${entry.taskId}` as any);
    }
  }

  const content = (
    <>
      <View style={styles.entryMain}>
        <Text style={styles.entryTitle} numberOfLines={1} ellipsizeMode="tail">
          {entry.title}
        </Text>
        <View style={styles.entryMeta}>
          <View style={[styles.entryBadge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.entryBadgeText, { color: badge.fg }]}>{badge.label}</Text>
          </View>
          {entry.taskId && <Feather name="external-link" size={14} color={colors.textMuted} />}
        </View>
      </View>

      <View style={styles.entryAmountWrap}>
        <Text style={[styles.entryAmount, reversal ? styles.credit : styles.debit]}>
          {reversal ? '+' : '-'}{formatCurrency(entry.amountCents, currency)}
        </Text>
      </View>
    </>
  );

  if (!entry.taskId) {
    return <View style={styles.entryRow}>{content}</View>;
  }

  return (
    <TouchableOpacity
      style={styles.entryRow}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`View task: ${entry.title}`}
    >
      {content}
    </TouchableOpacity>
  );
}

export default function LedgerScreen() {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors, isDark), [colors, isDark]);
  const { user, profile } = useAuth();
  const currency = useMemo(() => resolveCurrency(profile?.currency), [profile?.currency]);
  const ledger = useLedger(user?.id);
  const [openMonthById, setOpenMonthById] = useState<Record<string, boolean>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [requestingLedgerSummary, setRequestingLedgerSummary] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.resolve(ledger.refetch());
    setRefreshing(false);
  }

  function toggleMonth(monthId: string) {
    setOpenMonthById((prev) => ({ ...prev, [monthId]: !prev[monthId] }));
  }

  const month = ledger.data?.currentMonth ?? emptyCurrentMonth(formatMonthId(monthStart(new Date())));
  const previousMonths = useMemo(
    () => ledger.data?.previousMonths ?? [],
    [ledger.data?.previousMonths],
  );

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

  const projectedDonationDisplayCents = Math.max(0, month.projectedDonationCents);

  async function handleRequestLedgerTillDate() {
    if (requestingLedgerSummary) return;
    setRequestingLedgerSummary(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token?.trim();
      if (!accessToken) {
        Alert.alert('Not authenticated', 'Please sign in again and retry.');
        return;
      }

      const response = await fetch(`${WEBSITE_URL}/api/ledger/till-date`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const payload = await response.json() as {
        success?: boolean;
        error?: string;
        message?: string;
      };

      if (!response.ok || !payload.success) {
        Alert.alert('Could not compile ledger', payload.error ?? 'Request failed.');
        return;
      }

      Alert.alert('Email sent', payload.message ?? 'Ledger till date report was sent to your registered email.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.';
      Alert.alert('Could not compile ledger', message);
    } finally {
      setRequestingLedgerSummary(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <PageHeader title="Ledger" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.textMuted}
            colors={[colors.textMuted]}
          />
        }
      >
        {ledger.loading ? (
          <View style={styles.stateWrap}>
            <ActivityIndicator color={colors.accentCyan} />
            <Text style={styles.stateText}>Loading ledger...</Text>
          </View>
        ) : ledger.error ? (
          <View style={styles.stateWrap}>
            <Text style={styles.errorText}>{ledger.error}</Text>
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
              <TouchableOpacity
                style={styles.ledgerRequestButton}
                onPress={() => { void handleRequestLedgerTillDate(); }}
                disabled={requestingLedgerSummary}
                activeOpacity={0.82}
                accessibilityRole="button"
                accessibilityLabel="Request Ledger Till Date"
              >
                {requestingLedgerSummary ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Text style={styles.ledgerRequestButtonLabel}>Request Ledger Till Date</Text>
                )}
              </TouchableOpacity>
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

const makeStyles = (colors: Colors, isDark = true) => StyleSheet.create({
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
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: 25,
    color: colors.textMuted,
    fontWeight: typography.semibold,
    letterSpacing: -0.6,
  },
  ledgerRequestButton: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface2,
    borderRadius: 999,
    minHeight: 34,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ledgerRequestButtonLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: typography.medium,
    letterSpacing: 0.2,
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
  entryTitle: {
    fontSize: 18,
    color: colors.text,
    lineHeight: 20,
  },
  entryMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
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
    color: colors.destructive,
  },
  credit: {
    color: colors.success,
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
