import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { File, Paths } from 'expo-file-system';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { unregisterForPushNotificationsAsync } from '@/lib/notifications';
import { useAuth } from '@/hooks/useAuth';
import { colors } from '@/lib/theme';
import { styles } from './styles';
import { Currency } from '@/lib/types';
import { PageHeader } from '@/components/PageHeader';
import { StatsOverview } from '@/components/StatsOverview';
import {
  normalizeAiUsername,
  normalizeAiEmail,
} from '@/lib/constants/ai-profile';
import { getFailureCostBounds } from '@/lib/domain/failure-cost';
import { ACTIVE_VOUCHER_TASK_STATUSES } from '@/lib/constants/task-status';
import { FriendsSection } from './components/FriendsSection';
import { BlockedUsersSection } from './components/BlockedUsersSection';
import {
  type BlockedUserOption,
  type IncomingFriendRequest,
  type OutgoingFriendRequest,
  type SearchCandidate,
  type UserSummary,
  fetchRelationshipsData,
  normalizeSearchCandidate,
  normalizeVoucherOption,
} from '@/lib/settings/relationships';

type PickerType = 'voucher' | 'currency' | null;

interface PickerOption {
  label: string;
  value: string;
}

interface VoucherOption {
  id: string;
  username: string;
}

interface ActiveVoucherTask {
  id: string;
  title: string;
  ownerUsername: string;
}

type RelationshipAction = 'send' | 'accept' | 'reject' | 'remove' | 'block' | 'withdraw';

const POMO_MIN_MINUTES = 1;
const POMO_MAX_MINUTES = 120;
const ACCOUNT_DELETE_FALLBACK_URL = 'https://tas.tarunh.com/settings';
const CURRENCY_OPTIONS: PickerOption[] = [
  { label: 'USD', value: 'USD' },
  { label: 'EUR', value: 'EUR' },
  { label: 'INR', value: 'INR' },
];

interface RowProps {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
  destructive?: boolean;
  trailingText?: string;
  tinted?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
}

function SettingsRow({
  icon,
  label,
  onPress,
  destructive = false,
  trailingText,
  tinted = false,
  disabled = false,
  accessibilityHint,
}: RowProps) {
  const tint = destructive ? colors.destructive : colors.text;
  return (
    <TouchableOpacity
      style={[styles.row, tinted && styles.rowTinted, disabled && styles.rowDisabled]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={
        accessibilityHint
        ?? (
          destructive
            ? 'Performs a destructive account action'
            : trailingText
              ? 'Opens a coming soon message'
              : 'Opens this setting'
        )
      }
      disabled={disabled}
    >
      <View style={styles.rowLeft}>
        <Feather name={icon} size={18} color={tint} />
        <Text style={[styles.rowLabel, destructive && styles.rowLabelDestructive]}>
          {label}
        </Text>
      </View>
      {trailingText ? (
        <Text style={styles.trailingText}>{trailingText}</Text>
      ) : !destructive ? (
        <Feather name="chevron-right" size={16} color={colors.textSubtle} />
      ) : null}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const { user, profile } = useAuth();
  const [activePicker, setActivePicker] = useState<PickerType>(null);

  const [usernameDraft, setUsernameDraft] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSuccess, setUsernameSuccess] = useState<string | null>(null);

  const [defaultPomoInput, setDefaultPomoInput] = useState('25');
  const [defaultFailureCostInput, setDefaultFailureCostInput] = useState('10');
  const [defaultVoucherId, setDefaultVoucherId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [oneHourReminderEnabled, setOneHourReminderEnabled] = useState(true);
  const [tenMinuteReminderEnabled, setTenMinuteReminderEnabled] = useState(true);

  const [voucherOptions, setVoucherOptions] = useState<VoucherOption[]>([]);
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [friends, setFriends] = useState<UserSummary[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<IncomingFriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<OutgoingFriendRequest[]>([]);
  const [relationshipsLoading, setRelationshipsLoading] = useState(false);
  const [relationshipsError, setRelationshipsError] = useState<string | null>(null);
  const [relationshipInFlight, setRelationshipInFlight] = useState<Record<string, RelationshipAction | null>>({});
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [friendSearchResults, setFriendSearchResults] = useState<SearchCandidate[]>([]);
  const [friendSearchLoading, setFriendSearchLoading] = useState(false);
  const [friendSearchError, setFriendSearchError] = useState<string | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserOption[]>([]);
  const [blockedUsersLoading, setBlockedUsersLoading] = useState(false);
  const [blockedUsersError, setBlockedUsersError] = useState<string | null>(null);
  const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null);
  const [isCheckingDeleteConflicts, setIsCheckingDeleteConflicts] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  const [deleteAccountSuccess, setDeleteAccountSuccess] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsError, setDefaultsError] = useState<string | null>(null);
  const [defaultsSuccess, setDefaultsSuccess] = useState<string | null>(null);
  const [aiVoucherEnabled, setAiVoucherEnabled] = useState(false);
  const [savingAiFeatures, setSavingAiFeatures] = useState(false);
  const [aiFeaturesError, setAiFeaturesError] = useState<string | null>(null);
  const [aiFeaturesSuccess, setAiFeaturesSuccess] = useState<string | null>(null);
  const emailSavedRef = useRef<string | null>(null);
  const usernameSavedRef = useRef<string | null>(null);
  const defaultsSavedRef = useRef<string | null>(null);
  const aiFeaturesSavedRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!profile || !user) return;
    const nextEmail = (user.email ?? profile.email ?? '').trim().toLowerCase();
    const nextUsername = profile.username;
    const nextPomo = profile.default_pomo_duration_minutes ?? 25;
    const nextFailureCostCents = profile.default_failure_cost_cents ?? 1000;
    const nextFailureCostMajor = nextFailureCostCents / 100;
    const nextVoucherId = profile.default_voucher_id ?? user.id;
    const nextCurrency = profile.currency ?? 'USD';
    const nextOneHourReminder = profile.deadline_one_hour_warning_enabled ?? true;
    const nextTenMinuteReminder = profile.deadline_final_warning_enabled ?? true;
    const nextAiVoucherEnabled = profile.ai_friend_opt_in ?? false;

    setUsernameDraft(nextUsername);
    setDefaultPomoInput(String(nextPomo));
    setDefaultFailureCostInput(
      nextCurrency === 'INR'
        ? String(Math.round(nextFailureCostMajor))
        : nextFailureCostMajor.toFixed(2).replace(/\.00$/, ''),
    );
    setDefaultVoucherId(nextVoucherId);
    setCurrency(nextCurrency);
    setOneHourReminderEnabled(nextOneHourReminder);
    setTenMinuteReminderEnabled(nextTenMinuteReminder);
    setAiVoucherEnabled(nextAiVoucherEnabled);

    emailSavedRef.current = nextEmail;
    usernameSavedRef.current = nextUsername;
    defaultsSavedRef.current = JSON.stringify({
      defaultPomoMinutes: nextPomo,
      defaultFailureCostCents: nextFailureCostCents,
      defaultVoucherId: nextVoucherId,
      currency: nextCurrency,
      oneHourReminderEnabled: nextOneHourReminder,
      tenMinuteReminderEnabled: nextTenMinuteReminder,
    });
    aiFeaturesSavedRef.current = nextAiVoucherEnabled;

    setUsernameError(null);
    setUsernameSuccess(null);
    setDefaultsError(null);
    setDefaultsSuccess(null);
    setAiFeaturesError(null);
    setAiFeaturesSuccess(null);
    setDeleteAccountError(null);
    setDeleteAccountSuccess(false);
  }, [profile, user]);

  useEffect(() => {
    let mounted = true;

    async function loadVoucherOptions() {
      if (!user) return;
      setVoucherLoading(true);

      const [friendsRes, blockedRes] = await Promise.all([
        supabase
          .from('friendships')
          .select(`
            friend_id,
            friend:profiles!friendships_friend_id_fkey(
              id,
              username
            )
          `)
          .eq('user_id', user.id),
        supabase
          .from('user_blocks')
          .select('blocked_id')
          .eq('blocker_id', user.id),
      ]);

      if (!mounted) return;

      if (friendsRes.error || blockedRes.error) {
        setVoucherOptions([{ id: user.id, username: 'Me' }]);
        setVoucherLoading(false);
        return;
      }

      const blockedIds = new Set(
        ((blockedRes.data ?? []) as { blocked_id?: string | null }[])
          .map((row) => row.blocked_id)
          .filter((id): id is string => Boolean(id)),
      );
      const base = [{ id: user.id, username: 'Me' }];
      const fromFriends = ((friendsRes.data ?? []) as any[])
        .map((row) => {
          const friend = row?.friend as { id?: string; username?: string } | null;
          if (!friend?.id) return null;
          if (blockedIds.has(friend.id)) return null;
          return normalizeVoucherOption({ id: friend.id, username: friend.username ?? 'Friend' });
        })
        .filter((item): item is VoucherOption => Boolean(item?.id));

      const byId = new Map<string, VoucherOption>();
      [...base, ...fromFriends].forEach((entry) => byId.set(entry.id, entry));

      setVoucherOptions(Array.from(byId.values()));
      setVoucherLoading(false);
    }

    loadVoucherOptions();
    return () => {
      mounted = false;
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`settings-relationships-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'friend_requests',
          filter: `sender_id=eq.${user.id}`,
        },
        () => {
          void refreshRelationshipsAndSearch();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'friend_requests',
          filter: `receiver_id=eq.${user.id}`,
        },
        () => {
          void refreshRelationshipsAndSearch();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  // refreshRelationshipsAndSearch intentionally omitted to avoid resubscribing every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    let mounted = true;

    async function loadRelationships() {
      if (!user) {
        if (mounted) {
          setFriends([]);
          setIncomingRequests([]);
          setOutgoingRequests([]);
          setRelationshipsLoading(false);
        }
        return;
      }

      setRelationshipsLoading(true);
      setRelationshipsError(null);

      const result = await fetchRelationshipsData(user.id);

      if (!mounted) return;

      if (result.error) {
        setFriends([]);
        setIncomingRequests([]);
        setOutgoingRequests([]);
        setRelationshipsError(result.error);
        setRelationshipsLoading(false);
        return;
      }

      setFriends(result.friends);
      setIncomingRequests(result.incomingRequests);
      setOutgoingRequests(result.outgoingRequests);
      setRelationshipsLoading(false);
    }

    void loadRelationships();
    return () => {
      mounted = false;
    };
  }, [user]);

  useEffect(() => {
    const query = friendSearchQuery.trim();
    if (!user || query.length === 0) {
      setFriendSearchResults([]);
      setFriendSearchError(null);
      setFriendSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setFriendSearchLoading(true);
      const { data, error } = await supabase.rpc('search_users_for_friendship', {
        p_query: query,
        p_limit: 20,
      });

      if (cancelled) return;

      if (error) {
        setFriendSearchResults([]);
        setFriendSearchError(error.message);
        setFriendSearchLoading(false);
        return;
      }

      setFriendSearchResults(
        ((data ?? []) as SearchCandidate[])
          .map((candidate) => normalizeSearchCandidate(candidate))
          .filter((c) => !c.already_friends)
          .sort((a, b) => a.username.localeCompare(b.username)),
      );
      setFriendSearchError(null);
      setFriendSearchLoading(false);
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [friendSearchQuery, user]);

  useEffect(() => {
    let mounted = true;

    async function loadBlockedUsers() {
      if (!user) {
        if (mounted) {
          setBlockedUsers([]);
          setBlockedUsersLoading(false);
        }
        return;
      }

      setBlockedUsersLoading(true);
      setBlockedUsersError(null);

      const { data, error } = await supabase
        .from('user_blocks')
        .select(`
          blocked_id,
          blocked:profiles!user_blocks_blocked_id_fkey(
            id,
            username,
            email
          )
        `)
        .eq('blocker_id', user.id)
        .order('created_at', { ascending: false });

      if (!mounted) return;

      if (error) {
        setBlockedUsers([]);
        setBlockedUsersError(error.message);
        setBlockedUsersLoading(false);
        return;
      }

      const nextBlockedUsers = ((data ?? []) as any[])
        .map((row) => {
          const blocked = row?.blocked as { id?: string; username?: string | null; email?: string | null } | null;
          if (!blocked?.id) return null;
          return {
            id: blocked.id,
            username: normalizeAiUsername(blocked.id, blocked.username, 'Blocked user'),
            email: normalizeAiEmail(blocked.id, blocked.email, ''),
          } satisfies BlockedUserOption;
        })
        .filter((entry): entry is BlockedUserOption => Boolean(entry))
        .sort((a, b) => a.username.localeCompare(b.username));

      setBlockedUsers(nextBlockedUsers);
      setBlockedUsersLoading(false);
    }

    void loadBlockedUsers();
    return () => {
      mounted = false;
    };
  }, [user]);

  async function handleExportData() {
    if (!user || isExporting) return;
    setIsExporting(true);
    try {
      const [
        tasksRes,
        subtasksRes,
        remindersRes,
        taskEventsRes,
        ledgerRes,
        recurrenceRulesRes,
        pomoRes,
        commitmentsRes,
        friendshipsRes,
      ] = await Promise.all([
        supabase.from('tasks' as any).select('id, title, description, failure_cost_cents, deadline, status, postponed_at, marked_completed_at, recurrence_rule_id, iteration_number, start_at, is_strict, required_pomo_minutes, requires_proof, has_proof, resubmit_count, created_at, updated_at').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('task_subtasks' as any).select('id, parent_task_id, title, is_completed, completed_at, created_at').eq('user_id', user.id),
        supabase.from('task_reminders' as any).select('id, parent_task_id, reminder_at, source, notified_at, created_at').eq('user_id', user.id),
        supabase.from('task_events' as any).select('id, task_id, event_type, from_status, to_status, created_at').eq('user_id', user.id).order('created_at', { ascending: true }),
        supabase.from('ledger_entries' as any).select('id, task_id, period, amount_cents, entry_type, created_at').eq('user_id', user.id).order('created_at', { ascending: true }),
        supabase.from('recurrence_rules' as any).select('id, title, description, failure_cost_cents, required_pomo_minutes, requires_proof, rule_config, timezone, latest_iteration, created_at, updated_at').eq('user_id', user.id),
        supabase.from('pomo_sessions' as any).select('id, task_id, duration_minutes, elapsed_seconds, is_strict, status, started_at, completed_at, created_at').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('commitments' as any).select('id, name, description, start_date, end_date, status, created_at, updated_at').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('friendships' as any).select('id, created_at, friend:profiles!friendships_friend_id_fkey(username, email)').eq('user_id', user.id),
      ]);

      const exportQueryError =
        tasksRes.error?.message
        || subtasksRes.error?.message
        || remindersRes.error?.message
        || taskEventsRes.error?.message
        || ledgerRes.error?.message
        || recurrenceRulesRes.error?.message
        || pomoRes.error?.message
        || commitmentsRes.error?.message
        || friendshipsRes.error?.message;

      if (exportQueryError) {
        Alert.alert('Export failed', exportQueryError);
        return;
      }

      const subtasksByTask: Record<string, unknown[]> = {};
      const remindersByTask: Record<string, unknown[]> = {};
      for (const s of (subtasksRes.data ?? []) as any[]) {
        if (!subtasksByTask[s.parent_task_id]) subtasksByTask[s.parent_task_id] = [];
        subtasksByTask[s.parent_task_id].push(s);
      }
      for (const r of (remindersRes.data ?? []) as any[]) {
        if (!remindersByTask[r.parent_task_id]) remindersByTask[r.parent_task_id] = [];
        remindersByTask[r.parent_task_id].push(r);
      }

      const exportPayload = {
        exported_at: new Date().toISOString(),
        profile: {
          id: user.id,
          email: user.email,
          username: profile?.username,
          currency: profile?.currency,
          created_at: profile?.created_at,
        },
        tasks: ((tasksRes.data ?? []) as any[]).map((t: any) => ({
          ...t,
          subtasks: subtasksByTask[t.id] ?? [],
          reminders: remindersByTask[t.id] ?? [],
        })),
        task_events: taskEventsRes.data ?? [],
        ledger_entries: ledgerRes.data ?? [],
        recurrence_rules: recurrenceRulesRes.data ?? [],
        pomo_sessions: pomoRes.data ?? [],
        commitments: commitmentsRes.data ?? [],
        friends: ((friendshipsRes.data ?? []) as any[]).map((f: any) => ({
          username: f.friend?.username ?? null,
          email: f.friend?.email ?? null,
          friends_since: f.created_at,
        })),
      };

      const json = JSON.stringify(exportPayload, null, 2);
      const filename = `vouch-export-${new Date().toISOString().slice(0, 10)}.json`;
      const file = new File(Paths.cache, filename);
      file.write(json);
      await Share.share({ url: file.uri, title: filename });
    } catch {
      Alert.alert('Export failed', 'Could not export your data. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }

  async function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          if (user?.id) {
            await unregisterForPushNotificationsAsync(user.id);
          }

          const { error } = await supabase.auth.signOut({ scope: 'local' });
          if (error) {
            Alert.alert('Sign out failed', error.message);
          }
        },
      },
    ]);
  }

  function isMissingDeleteEndpoint(message: string) {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('does not exist')
      || normalized.includes('could not find the function')
      || normalized.includes('function delete_account')
      || normalized.includes('404')
      || normalized.includes('not found')
    );
  }

  function readDeletePayloadError(payload: unknown): string | null {
    if (!payload || typeof payload !== 'object') return null;
    const maybeError = (payload as { error?: unknown }).error;
    return typeof maybeError === 'string' && maybeError.trim().length > 0
      ? maybeError
      : null;
  }

  async function getActiveVoucherTasksForDeleteCheck(): Promise<{ tasks: ActiveVoucherTask[]; error: string | null }> {
    if (!user) return { tasks: [], error: 'Not authenticated' };

    const { data, error } = await supabase
      .from('tasks')
      .select(`
        id,
        title,
        owner:profiles!tasks_user_id_fkey(
          username
        )
      `)
      .eq('voucher_id', user.id)
      .in('status', ACTIVE_VOUCHER_TASK_STATUSES);

    if (error) {
      return { tasks: [], error: error.message };
    }

    const tasks = ((data ?? []) as any[])
      .map((row) => ({
        id: String(row.id ?? ''),
        title: String(row.title ?? 'Untitled task').trim() || 'Untitled task',
        ownerUsername: String(row.owner?.username ?? 'unknown').trim() || 'unknown',
      }))
      .filter((row) => row.id.length > 0);

    return { tasks, error: null };
  }

  function buildDeleteAccountConfirmationMessage(tasks: ActiveVoucherTask[]): string {
    if (tasks.length === 0) {
      return 'This will permanently remove your account and associated data. This action cannot be undone.';
    }

    return 'You are still an active voucher for pending tasks or have other active dependencies. Continue anyway?';
  }

  async function runDeleteAccount(): Promise<{ error: string | null; backendUnavailable: boolean }> {
    const edgeResult = await supabase.functions.invoke('delete-account');
    if (!edgeResult.error) {
      const payloadError = readDeletePayloadError(edgeResult.data);
      return { error: payloadError, backendUnavailable: false };
    }

    const rpcResult = await supabase.rpc('delete_account');
    if (!rpcResult.error) {
      const payloadError = readDeletePayloadError(rpcResult.data);
      return { error: payloadError, backendUnavailable: false };
    }

    const edgeMessage = edgeResult.error.message || 'Delete endpoint failed';
    const rpcMessage = rpcResult.error.message || 'Delete RPC failed';
    const backendUnavailable = isMissingDeleteEndpoint(edgeMessage) && isMissingDeleteEndpoint(rpcMessage);

    if (backendUnavailable) {
      return {
        error: 'Account deletion is not configured for mobile yet. You can finish this from web settings.',
        backendUnavailable: true,
      };
    }

    return {
      error: rpcMessage,
      backendUnavailable: false,
    };
  }

  async function performAccountDeletion() {
    if (isDeletingAccount || deleteAccountSuccess) return;

    setIsDeletingAccount(true);
    setDeleteAccountError(null);

    try {
      const result = await runDeleteAccount();
      if (result.error) {
        setDeleteAccountError(result.error);
        if (result.backendUnavailable) {
          Alert.alert(
            'Continue on web',
            'Account deletion is currently handled on vouch-web. Open web settings now?',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Open Web Settings',
                onPress: () => { void Linking.openURL(ACCOUNT_DELETE_FALLBACK_URL); },
              },
            ],
          );
        }
        return;
      }

      setDeleteAccountSuccess(true);
      if (user?.id) {
        await unregisterForPushNotificationsAsync(user.id);
      }

      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) {
        // Keep the flow successful even if local token cleanup fails.
        console.warn('Account deleted, but sign-out cleanup failed:', signOutError.message);
      }
    } catch {
      setDeleteAccountError('Failed to delete account.');
    } finally {
      setIsDeletingAccount(false);
    }
  }

  async function handleDeleteAccount() {
    if (!user || isCheckingDeleteConflicts || isDeletingAccount || deleteAccountSuccess) return;

    setIsCheckingDeleteConflicts(true);
    setDeleteAccountError(null);

    try {
      const { tasks, error } = await getActiveVoucherTasksForDeleteCheck();
      if (error) {
        setDeleteAccountError(error);
        return;
      }

      Alert.alert(
        tasks.length > 0 ? 'You are an active voucher' : 'Delete account permanently',
        buildDeleteAccountConfirmationMessage(tasks),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: tasks.length > 0 ? 'Delete anyway' : 'Delete',
            style: 'destructive',
            onPress: () => { void performAccountDeletion(); },
          },
        ],
      );
    } catch {
      setDeleteAccountError('Failed to check active voucher tasks.');
    } finally {
      setIsCheckingDeleteConflicts(false);
    }
  }

  async function handleUnblockUser(blockedUser: BlockedUserOption) {
    setUnblockingUserId(blockedUser.id);
    setBlockedUsersError(null);

    try {
      const { error } = await supabase.rpc('unblock_user', {
        p_target_user_id: blockedUser.id,
      });

      if (error) {
        setBlockedUsersError(error.message);
        return;
      }

      setBlockedUsers((prev) => prev.filter((entry) => entry.id !== blockedUser.id));
    } finally {
      setUnblockingUserId(null);
    }
  }

  function updateRelationshipInFlight(key: string, action: RelationshipAction | null) {
    setRelationshipInFlight((prev) => ({ ...prev, [key]: action }));
  }

  async function refreshRelationshipsAndSearch() {
    if (!user) return;

    setRelationshipsLoading(true);
    setRelationshipsError(null);

    const result = await fetchRelationshipsData(user.id);

    if (result.error) {
      setRelationshipsError(result.error);
      setRelationshipsLoading(false);
      return;
    }

    setFriends(result.friends);
    setIncomingRequests(result.incomingRequests);
    setOutgoingRequests(result.outgoingRequests);
    setRelationshipsLoading(false);

    if (friendSearchQuery.trim()) {
      const { data, error } = await supabase.rpc('search_users_for_friendship', {
        p_query: friendSearchQuery.trim(),
        p_limit: 20,
      });

      if (error) {
        setFriendSearchResults([]);
        setFriendSearchError(error.message);
        return;
      }

      setFriendSearchResults(
        ((data ?? []) as SearchCandidate[])
          .map((candidate) => normalizeSearchCandidate(candidate))
          .filter((c) => !c.already_friends)
          .sort((a, b) => a.username.localeCompare(b.username)),
      );
      setFriendSearchError(null);
    }
  }

  async function handleSendFriendRequest(candidate: SearchCandidate) {
    const key = `send:${candidate.id}`;
    updateRelationshipInFlight(key, 'send');
    try {
      const { error } = await supabase.rpc('send_friend_request', {
        p_target_user_id: candidate.id,
      });

      if (error) {
        Alert.alert('Could not send request', error.message);
        return;
      }

      await refreshRelationshipsAndSearch();
    } finally {
      updateRelationshipInFlight(key, null);
    }
  }

  async function handleAcceptFriendRequest(request: IncomingFriendRequest) {
    const key = `request:${request.id}:accept`;
    updateRelationshipInFlight(key, 'accept');
    try {
      const { error } = await supabase.rpc('accept_friend_request', {
        p_request_id: request.id,
      });

      if (error) {
        Alert.alert('Could not accept request', error.message);
        return;
      }

      await refreshRelationshipsAndSearch();
    } finally {
      updateRelationshipInFlight(key, null);
    }
  }

  async function handleRejectFriendRequest(request: IncomingFriendRequest) {
    const key = `request:${request.id}:reject`;
    updateRelationshipInFlight(key, 'reject');
    try {
      const { error } = await supabase.rpc('reject_friend_request', {
        p_request_id: request.id,
      });

      if (error) {
        Alert.alert('Could not reject request', error.message);
        return;
      }

      await refreshRelationshipsAndSearch();
    } finally {
      updateRelationshipInFlight(key, null);
    }
  }

  async function handleWithdrawFriendRequest(request: OutgoingFriendRequest) {
    const key = `outgoing:${request.id}:withdraw`;
    updateRelationshipInFlight(key, 'withdraw');
    try {
      const { error } = await supabase.rpc('withdraw_friend_request', {
        p_request_id: request.id,
      });

      if (error) {
        if (error.message?.toLowerCase().includes('no longer pending')) {
          await refreshRelationshipsAndSearch();
          return;
        }
        Alert.alert('Could not withdraw request', error.message);
        return;
      }

      await refreshRelationshipsAndSearch();
    } finally {
      updateRelationshipInFlight(key, null);
    }
  }

  async function handleRemoveFriend(friend: UserSummary) {
    const key = `friend:${friend.id}:remove`;
    updateRelationshipInFlight(key, 'remove');
    try {
      const { error } = await supabase.rpc('remove_friend', {
        p_target_user_id: friend.id,
      });

      if (error) {
        Alert.alert('Could not remove friend', error.message);
        return;
      }

      if (defaultVoucherId === friend.id && user) {
        setDefaultVoucherId(user.id);
      }

      await refreshRelationshipsAndSearch();
    } finally {
      updateRelationshipInFlight(key, null);
    }
  }

  async function handleBlockRelationshipUser(target: UserSummary | SearchCandidate, sourceKey: string) {
    updateRelationshipInFlight(sourceKey, 'block');
    try {
      const { error } = await supabase.rpc('block_user', {
        p_target_user_id: target.id,
      });

      if (error) {
        Alert.alert('Could not block user', error.message);
        return;
      }

      if (defaultVoucherId === target.id && user) {
        setDefaultVoucherId(user.id);
      }

      await refreshRelationshipsAndSearch();
    } finally {
      updateRelationshipInFlight(sourceKey, null);
    }
  }

  const avatarInitial = (usernameDraft || profile?.username || '')
    .trim()
    .charAt(0)
    .toUpperCase() || '?';
  const normalizedUsernameDraft = usernameDraft.trim().toLowerCase();
  const resolvedDefaultVoucherId = defaultVoucherId ?? user?.id ?? null;
  const normalizedPomoInput = defaultPomoInput.trim();
  const parsedPomoMinutes = Number(normalizedPomoInput);
  const pomoValidationError = useMemo(() => {
    if (!normalizedPomoInput) return 'Default pomo duration is required.';
    if (!Number.isFinite(parsedPomoMinutes) || !Number.isInteger(parsedPomoMinutes)) {
      return 'Default pomo duration must be a whole number.';
    }
    if (parsedPomoMinutes < POMO_MIN_MINUTES || parsedPomoMinutes > POMO_MAX_MINUTES) {
      return `Default pomo duration must be between ${POMO_MIN_MINUTES} and ${POMO_MAX_MINUTES} minutes.`;
    }
    return null;
  }, [normalizedPomoInput, parsedPomoMinutes]);
  const currencySymbol = useMemo(() => {
    if (currency === 'EUR') return '€';
    if (currency === 'INR') return '₹';
    return '$';
  }, [currency]);
  const failureCostBounds = useMemo(() => getFailureCostBounds(currency), [currency]);
  const normalizedFailureCostInput = defaultFailureCostInput.trim();
  const parsedFailureCostMajor = Number(normalizedFailureCostInput);
  const parsedFailureCostCents = Number.isFinite(parsedFailureCostMajor)
    ? Math.round(parsedFailureCostMajor * 100)
    : null;
  const failureCostValidationError = useMemo(() => {
    if (!normalizedFailureCostInput) return 'Default failure cost is required.';
    if (parsedFailureCostCents === null) return 'Default failure cost is invalid.';
    if (
      parsedFailureCostCents < failureCostBounds.minCents ||
      parsedFailureCostCents > failureCostBounds.maxCents
    ) {
      return `Default failure cost must be between ${currencySymbol}${failureCostBounds.minMajor} and ${currencySymbol}${failureCostBounds.maxMajor}.`;
    }
    return null;
  }, [
    normalizedFailureCostInput,
    parsedFailureCostCents,
    failureCostBounds,
    currencySymbol,
  ]);

  const voucherPickerOptions: PickerOption[] = useMemo(
    () => voucherOptions.map((option) => ({ label: option.username, value: option.id })),
    [voucherOptions],
  );

  const pickerOptions: PickerOption[] = useMemo(() => {
    if (activePicker === 'voucher') return voucherPickerOptions;
    if (activePicker === 'currency') return CURRENCY_OPTIONS;
    return [];
  }, [activePicker, voucherPickerOptions]);

  const pickerTitle = useMemo(() => {
    if (activePicker === 'voucher') return 'Default Voucher';
    if (activePicker === 'currency') return 'Currency';
    return '';
  }, [activePicker]);

  const defaultVoucherLabel = useMemo(
    () => voucherOptions.find((option) => option.id === defaultVoucherId)?.username ?? 'Select voucher',
    [voucherOptions, defaultVoucherId],
  );
  const defaultsSnapshot = useMemo(
    () =>
      JSON.stringify({
        defaultPomoMinutes: parsedPomoMinutes,
        defaultFailureCostCents: parsedFailureCostCents,
        defaultVoucherId: resolvedDefaultVoucherId,
        currency,
        oneHourReminderEnabled,
        tenMinuteReminderEnabled,
      }),
    [
      parsedPomoMinutes,
      parsedFailureCostCents,
      resolvedDefaultVoucherId,
      currency,
      oneHourReminderEnabled,
      tenMinuteReminderEnabled,
    ],
  );

  function validateUsername(value: string): string | null {
    if (!value) return 'Username is required.';
    if (value.length < 3) return 'Username must be at least 3 characters.';
    if (!/^[a-zA-Z0-9_]+$/.test(value)) return 'Letters, numbers, and underscores only.';
    return null;
  }

  function applyPicker(value: string) {
    if (activePicker === 'voucher') setDefaultVoucherId(value);
    if (activePicker === 'currency') setCurrency(value as Currency);
    setActivePicker(null);
  }

  useEffect(() => {
    if (!user) return;
    if (usernameSavedRef.current === null) return;
    if (normalizedUsernameDraft === usernameSavedRef.current) return;

    const validationError = validateUsername(normalizedUsernameDraft);
    if (validationError) {
      setUsernameError(validationError);
      setUsernameSuccess(null);
      return;
    }

    setUsernameError(null);
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSavingUsername(true);
      setUsernameSuccess(null);

      const { error } = await supabase
        .from('profiles')
        .update({ username: normalizedUsernameDraft })
        .eq('id', user.id);

      setSavingUsername(false);
      if (cancelled) return;

      if (error) {
        if (error.code === '23505') {
          setUsernameError('Username is already taken.');
        } else {
          setUsernameError(error.message);
        }
        return;
      }

      usernameSavedRef.current = normalizedUsernameDraft;
      setUsernameDraft(normalizedUsernameDraft);
      setUsernameSuccess('Saved');
    }, 700);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalizedUsernameDraft, user]);

  useEffect(() => {
    if (!user || !resolvedDefaultVoucherId) return;
    if (defaultsSavedRef.current === null) return;
    if (defaultsSnapshot === defaultsSavedRef.current) return;

    if (pomoValidationError) {
      setDefaultsError(pomoValidationError);
      setDefaultsSuccess(null);
      return;
    }
    if (failureCostValidationError) {
      setDefaultsError(failureCostValidationError);
      setDefaultsSuccess(null);
      return;
    }

    setDefaultsError(null);
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSavingDefaults(true);
      setDefaultsSuccess(null);

      const { error } = await supabase
        .from('profiles')
        .update({
          default_pomo_duration_minutes: parsedPomoMinutes,
          default_failure_cost_cents: parsedFailureCostCents,
          default_voucher_id: resolvedDefaultVoucherId,
          currency,
          deadline_one_hour_warning_enabled: oneHourReminderEnabled,
          deadline_final_warning_enabled: tenMinuteReminderEnabled,
        })
        .eq('id', user.id);

      setSavingDefaults(false);
      if (cancelled) return;

      if (error) {
        setDefaultsError(error.message);
        return;
      }

      defaultsSavedRef.current = defaultsSnapshot;
      setDefaultsSuccess('Saved');
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    user,
    parsedPomoMinutes,
    parsedFailureCostCents,
    resolvedDefaultVoucherId,
    currency,
    oneHourReminderEnabled,
    tenMinuteReminderEnabled,
    defaultsSnapshot,
    pomoValidationError,
    failureCostValidationError,
  ]);

  useEffect(() => {
    if (!user) return;
    if (aiFeaturesSavedRef.current === null) return;
    if (aiVoucherEnabled === aiFeaturesSavedRef.current) return;

    setAiFeaturesError(null);
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSavingAiFeatures(true);
      setAiFeaturesSuccess(null);

      const { error } = await supabase
        .from('profiles')
        .update({ ai_friend_opt_in: aiVoucherEnabled })
        .eq('id', user.id);

      setSavingAiFeatures(false);
      if (cancelled) return;

      if (error) {
        setAiFeaturesError(error.message);
        return;
      }

      aiFeaturesSavedRef.current = aiVoucherEnabled;
      setAiFeaturesSuccess('Saved');
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [user, aiVoucherEnabled]);

  useEffect(() => {
    if (!usernameSuccess) return;
    const timer = setTimeout(() => setUsernameSuccess(null), 1600);
    return () => clearTimeout(timer);
  }, [usernameSuccess]);

  useEffect(() => {
    if (!defaultsSuccess) return;
    const timer = setTimeout(() => setDefaultsSuccess(null), 1600);
    return () => clearTimeout(timer);
  }, [defaultsSuccess]);

  useEffect(() => {
    if (!aiFeaturesSuccess) return;
    const timer = setTimeout(() => setAiFeaturesSuccess(null), 1600);
    return () => clearTimeout(timer);
  }, [aiFeaturesSuccess]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <PageHeader title="Settings" />

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        <StatsOverview />

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account</Text>
          <View style={styles.card}>
            <View style={styles.accountContent}>
              <View style={styles.accountIdentityRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{avatarInitial}</Text>
                </View>
                <View style={styles.accountIdentityMeta}>
                  <Text style={styles.accountIdentityTitle}>Account Info</Text>
                  <Text style={styles.accountIdentitySub} numberOfLines={1} ellipsizeMode="clip">
                    {profile?.email ?? ''}
                  </Text>
                </View>
              </View>

              <View style={styles.defaultsField}>
                <View style={styles.usernameInlineField}>
                  <Text style={styles.usernameInlineLabel}>Username</Text>
                  <TextInput
                    style={styles.usernameInlineInput}
                    placeholder="username"
                    placeholderTextColor={colors.textSubtle}
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={usernameDraft}
                    onChangeText={(value) => {
                      setUsernameDraft(value);
                      setUsernameError(null);
                      setUsernameSuccess(null);
                    }}
                  />
                </View>
              </View>

              {savingUsername ? <Text style={styles.savingText}>Saving username...</Text> : null}
              {usernameError ? <Text style={styles.errorText}>{usernameError}</Text> : null}
              {usernameSuccess ? <Text style={styles.successText}>{usernameSuccess}</Text> : null}
            </View>
            <SettingsRow
              icon="log-out"
              label="Sign out from all sessions"
              onPress={handleSignOut}
              destructive
              tinted
            />
          </View>
        </View>

        <FriendsSection
          friendSearchQuery={friendSearchQuery}
          setFriendSearchQuery={setFriendSearchQuery}
          friendSearchLoading={friendSearchLoading}
          friendSearchError={friendSearchError}
          friendSearchResults={friendSearchResults}
          relationshipsError={relationshipsError}
          relationshipsLoading={relationshipsLoading}
          incomingRequests={incomingRequests}
          outgoingRequests={outgoingRequests}
          friends={friends}
          relationshipInFlight={relationshipInFlight}
          onSendFriendRequest={handleSendFriendRequest}
          onBlockRelationshipUser={handleBlockRelationshipUser}
          onAcceptFriendRequest={handleAcceptFriendRequest}
          onRejectFriendRequest={handleRejectFriendRequest}
          onWithdrawFriendRequest={handleWithdrawFriendRequest}
          onRemoveFriend={handleRemoveFriend}
        />

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Defaults</Text>
          <View style={styles.card}>
            <View style={styles.defaultsContent}>
              <View style={styles.defaultsField}>
                <Text style={styles.defaultsLabel}>Currency</Text>
                <TouchableOpacity
                  style={styles.selectButton}
                  onPress={() => setActivePicker('currency')}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Select currency"
                >
                  <Text style={styles.selectLabel}>{currency}</Text>
                  <Feather name="chevron-down" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <View style={styles.defaultsField}>
                <Text style={styles.defaultsLabel}>Default pomo duration</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder={`${POMO_MIN_MINUTES}`}
                  placeholderTextColor={colors.textSubtle}
                  keyboardType="number-pad"
                  value={defaultPomoInput}
                  onChangeText={(value) => {
                    setDefaultPomoInput(value);
                    setDefaultsError(null);
                    setDefaultsSuccess(null);
                  }}
                />
                <Text style={styles.toggleSub}>
                  Range: {POMO_MIN_MINUTES} - {POMO_MAX_MINUTES} minutes
                </Text>
              </View>

              <View style={styles.defaultsField}>
                <Text style={styles.defaultsLabel}>Default failure cost</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder={`${failureCostBounds.minMajor}`}
                  placeholderTextColor={colors.textSubtle}
                  keyboardType={currency === 'INR' ? 'number-pad' : 'decimal-pad'}
                  value={defaultFailureCostInput}
                  onChangeText={(value) => {
                    setDefaultFailureCostInput(value);
                    setDefaultsError(null);
                    setDefaultsSuccess(null);
                  }}
                />
                <Text style={styles.toggleSub}>
                  Range: {currencySymbol}
                  {failureCostBounds.minMajor} - {currencySymbol}
                  {failureCostBounds.maxMajor}
                </Text>
              </View>

              <View style={styles.defaultsField}>
                <Text style={styles.defaultsLabel}>Default voucher</Text>
                <TouchableOpacity
                  style={styles.selectButton}
                  onPress={() => setActivePicker('voucher')}
                  activeOpacity={0.8}
                  disabled={voucherLoading}
                  accessibilityRole="button"
                  accessibilityLabel="Select default voucher"
                >
                  <Text style={styles.selectLabel}>
                    {voucherLoading ? 'Loading vouchers...' : defaultVoucherLabel}
                  </Text>
                  <Feather name="chevron-down" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <View style={styles.toggleRow}>
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>1 hour reminder</Text>
                  <Text style={styles.toggleSub}>Default warning one hour before deadline.</Text>
                </View>
                <Switch
                  value={oneHourReminderEnabled}
                  onValueChange={setOneHourReminderEnabled}
                  trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                  thumbColor={colors.text}
                />
              </View>

              <View style={styles.toggleRow}>
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>10 minute reminder</Text>
                  <Text style={styles.toggleSub}>Default final warning ten minutes before deadline.</Text>
                </View>
                <Switch
                  value={tenMinuteReminderEnabled}
                  onValueChange={setTenMinuteReminderEnabled}
                  trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                  thumbColor={colors.text}
                />
              </View>

              {savingDefaults ? <Text style={styles.savingText}>Saving defaults...</Text> : null}
              {defaultsError ? <Text style={styles.errorText}>{defaultsError}</Text> : null}
              {defaultsSuccess ? <Text style={styles.successText}>{defaultsSuccess}</Text> : null}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>AI-Features</Text>
          <View style={styles.card}>
            <View style={styles.defaultsContent}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>AI-voucher</Text>
                  <Text style={styles.toggleSub}>Enable or disable AI-voucher for your account.</Text>
                </View>
                <Switch
                  value={aiVoucherEnabled}
                  onValueChange={setAiVoucherEnabled}
                  trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                  thumbColor={colors.text}
                />
              </View>

              {savingAiFeatures ? <Text style={styles.savingText}>Saving AI features...</Text> : null}
              {aiFeaturesError ? <Text style={styles.errorText}>{aiFeaturesError}</Text> : null}
              {aiFeaturesSuccess ? <Text style={styles.successText}>{aiFeaturesSuccess}</Text> : null}
            </View>
          </View>
        </View>

        <BlockedUsersSection
          blockedUsersLoading={blockedUsersLoading}
          blockedUsersError={blockedUsersError}
          blockedUsers={blockedUsers}
          unblockingUserId={unblockingUserId}
          onUnblockUser={handleUnblockUser}
        />

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Session</Text>
          <View style={styles.card}>
            <SettingsRow
              icon="download"
              label={isExporting ? 'Exporting...' : 'Export my data'}
              onPress={() => { void handleExportData(); }}
            />
            <SettingsRow
              icon="trash-2"
              label={
                deleteAccountSuccess
                  ? 'Account deleted'
                  : isDeletingAccount
                    ? 'Deleting account...'
                    : isCheckingDeleteConflicts
                      ? 'Checking...'
                      : 'Delete account permanently'
              }
              onPress={handleDeleteAccount}
              destructive
              disabled={isDeletingAccount || isCheckingDeleteConflicts || deleteAccountSuccess}
              accessibilityHint="Deletes your account permanently"
            />
            {deleteAccountError ? <Text style={styles.errorText}>{deleteAccountError}</Text> : null}
            {deleteAccountSuccess ? <Text style={styles.successText}>Account successfully deleted.</Text> : null}
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={activePicker !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setActivePicker(null)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.backdropTapTarget} onPress={() => setActivePicker(null)} />
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>{pickerTitle}</Text>
              <TouchableOpacity onPress={() => setActivePicker(null)} activeOpacity={0.75}>
                <Text style={styles.pickerDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {pickerOptions.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={styles.pickerRow}
                  onPress={() => applyPicker(option.value)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.pickerRowLabel}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
