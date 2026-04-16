import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
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
import { colors, radius, spacing, typography } from '@/lib/theme';
import { Currency } from '@/lib/types';
import { PageHeader } from '@/components/PageHeader';
import { StatsOverview } from '@/components/StatsOverview';

type PickerType = 'voucher' | 'currency' | null;

interface PickerOption {
  label: string;
  value: string;
}

interface VoucherOption {
  id: string;
  username: string;
}

interface UserSummary {
  id: string;
  username: string;
  email: string;
  initial: string;
}

interface IncomingFriendRequest {
  id: string;
  sender_id: string;
  created_at: string;
  sender: UserSummary;
}

interface OutgoingFriendRequest {
  id: string;
  receiver_id: string;
  created_at: string;
  receiver: UserSummary;
}

interface SearchCandidate {
  id: string;
  email: string;
  username: string;
  already_friends: boolean;
  incoming_request_pending: boolean;
  outgoing_request_pending: boolean;
}

interface BlockedUserOption {
  id: string;
  username: string;
  email: string;
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
const ACTIVE_VOUCHER_TASK_STATUSES = [
  'ACTIVE',
  'POSTPONED',
  'MARKED_COMPLETE',
  'AWAITING_VOUCHER',
  'AWAITING_ORCA',
  'AWAITING_USER',
  'ESCALATED',
] as const;
const CURRENCY_OPTIONS: PickerOption[] = [
  { label: 'USD', value: 'USD' },
  { label: 'EUR', value: 'EUR' },
  { label: 'INR', value: 'INR' },
];

interface FailureCostBounds {
  minMajor: number;
  maxMajor: number;
  minCents: number;
  maxCents: number;
}

function getFailureCostBounds(currency: Currency): FailureCostBounds {
  if (currency === 'INR') {
    return {
      minMajor: 50,
      maxMajor: 1000,
      minCents: 5000,
      maxCents: 100000,
    };
  }

  return {
    minMajor: 1,
    maxMajor: 100,
    minCents: 100,
    maxCents: 10000,
  };
}

function buildUserSummary(profile: { id?: string; username?: string | null; email?: string | null } | null): UserSummary | null {
  if (!profile?.id) return null;
  const username = profile.username?.trim() || 'Friend';
  return {
    id: profile.id,
    username,
    email: profile.email?.trim().toLowerCase() || '',
    initial: username[0]?.toUpperCase() || '?',
  };
}

async function fetchRelationshipsData(userId: string): Promise<{
  friends: UserSummary[];
  incomingRequests: IncomingFriendRequest[];
  outgoingRequests: OutgoingFriendRequest[];
  error: string | null;
}> {
  const empty = { friends: [], incomingRequests: [], outgoingRequests: [] };

  const [friendsRes, incomingRequestsRes, outgoingRequestsRes] = await Promise.all([
    supabase
      .from('friendships')
      .select(`
        friend:profiles!friendships_friend_id_fkey(
          id,
          username,
          email
        )
      `)
      .eq('user_id', userId),
    supabase
      .from('friend_requests')
      .select(`
        id,
        sender_id,
        created_at,
        sender:profiles!friend_requests_sender_id_fkey(
          id,
          username,
          email
        )
      `)
      .eq('receiver_id', userId)
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false }),
    supabase
      .from('friend_requests')
      .select(`
        id,
        receiver_id,
        created_at,
        receiver:profiles!friend_requests_receiver_id_fkey(
          id,
          username,
          email
        )
      `)
      .eq('sender_id', userId)
      .eq('status', 'PENDING')
      .order('created_at', { ascending: false }),
  ]);

  if (friendsRes.error || incomingRequestsRes.error || outgoingRequestsRes.error) {
    return {
      ...empty,
      error:
        friendsRes.error?.message
        || incomingRequestsRes.error?.message
        || outgoingRequestsRes.error?.message
        || 'Failed to load friends',
    };
  }

  const friends = ((friendsRes.data ?? []) as any[])
    .map((row) => buildUserSummary(row.friend as { id?: string; username?: string | null; email?: string | null } | null))
    .filter((entry): entry is UserSummary => Boolean(entry))
    .sort((a, b) => a.username.localeCompare(b.username));

  const incomingRequests = ((incomingRequestsRes.data ?? []) as any[])
    .map((row) => {
      const sender = buildUserSummary(row.sender as { id?: string; username?: string | null; email?: string | null } | null);
      if (!sender || !row.id || !row.sender_id) return null;
      return {
        id: row.id as string,
        sender_id: row.sender_id as string,
        created_at: row.created_at as string,
        sender,
      } satisfies IncomingFriendRequest;
    })
    .filter((entry): entry is IncomingFriendRequest => Boolean(entry));

  const outgoingRequests = ((outgoingRequestsRes.data ?? []) as any[])
    .map((row) => {
      const receiver = buildUserSummary(row.receiver as { id?: string; username?: string | null; email?: string | null } | null);
      if (!receiver || !row.id || !row.receiver_id) return null;
      return {
        id: row.id as string,
        receiver_id: row.receiver_id as string,
        created_at: row.created_at as string,
        receiver,
      } satisfies OutgoingFriendRequest;
    })
    .filter((entry): entry is OutgoingFriendRequest => Boolean(entry));

  return { friends, incomingRequests, outgoingRequests, error: null };
}

interface RowProps {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  onPress: () => void;
  destructive?: boolean;
  trailingText?: string;
  tinted?: boolean;
}

function SettingsRow({
  icon,
  label,
  onPress,
  destructive = false,
  trailingText,
  tinted = false,
}: RowProps) {
  const tint = destructive ? colors.destructive : colors.text;
  return (
    <TouchableOpacity
      style={[styles.row, tinted && styles.rowTinted]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={
        destructive
          ? 'Signs you out of your account'
          : trailingText
            ? 'Opens a coming soon message'
            : 'Opens this setting'
      }
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

  const [emailDraft, setEmailDraft] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

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
    const nextAiVoucherEnabled = profile.orca_friend_opt_in ?? false;

    setEmailDraft(nextEmail);
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

    setEmailError(null);
    setEmailSuccess(null);
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
        ((blockedRes.data ?? []) as Array<{ blocked_id?: string | null }>)
          .map((row) => row.blocked_id)
          .filter((id): id is string => Boolean(id)),
      );
      const base = [{ id: user.id, username: 'Me' }];
      const fromFriends = ((friendsRes.data ?? []) as any[])
        .map((row) => {
          const friend = row?.friend as { id?: string; username?: string } | null;
          if (!friend?.id) return null;
          if (blockedIds.has(friend.id)) return null;
          return { id: friend.id, username: friend.username ?? 'Friend' };
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
            username: blocked.username?.trim() || 'Blocked user',
            email: blocked.email?.trim().toLowerCase() || '',
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

          const { error } = await supabase.auth.signOut();
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
      .in('status', [...ACTIVE_VOUCHER_TASK_STATUSES] as any);

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
        .update({ orca_friend_opt_in: aiVoucherEnabled })
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

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Friends</Text>
          <View style={styles.card}>
            <View style={styles.defaultsContent}>
              <View style={styles.friendSearchRow}>
                <Feather name="search" size={16} color={colors.textMuted} />
                <TextInput
                  style={styles.friendSearchInput}
                  placeholder="Search by email or username"
                  placeholderTextColor={colors.textSubtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={friendSearchQuery}
                  onChangeText={setFriendSearchQuery}
                />
                {friendSearchQuery.length > 0 ? (
                  <TouchableOpacity onPress={() => setFriendSearchQuery('')} hitSlop={8}>
                    <Feather name="x-circle" size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                ) : null}
              </View>

              {friendSearchQuery.trim().length > 0 ? (
                <View style={styles.friendsList}>
                  {friendSearchLoading ? (
                    <Text style={styles.savingText}>Searching...</Text>
                  ) : friendSearchError ? (
                    <Text style={styles.errorText}>{friendSearchError}</Text>
                  ) : friendSearchResults.length === 0 ? (
                    <Text style={styles.toggleSub}>No matching users found.</Text>
                  ) : (
                    friendSearchResults.map((candidate) => {
                      const sendKey = `send:${candidate.id}`;
                      const blockKey = `search:${candidate.id}:block`;
                      const isSending = relationshipInFlight[sendKey] === 'send';
                      const isBlocking = relationshipInFlight[blockKey] === 'block';

                      return (
                        <View key={candidate.id} style={styles.friendRow}>
                          <View style={styles.friendMeta}>
                            <View style={styles.friendAvatar}>
                              <Text style={styles.friendAvatarText}>{candidate.username?.[0]?.toUpperCase() || '?'}</Text>
                            </View>
                            <View style={styles.friendText}>
                              <Text style={styles.friendName} numberOfLines={1} ellipsizeMode="clip">{candidate.username}</Text>
                              <Text style={styles.friendEmail} numberOfLines={1} ellipsizeMode="clip">{candidate.email}</Text>
                            </View>
                          </View>
                          <View style={styles.friendActions}>
                            {candidate.already_friends ? (
                              <Text style={styles.friendStateLabel}>Friends</Text>
                            ) : candidate.incoming_request_pending ? (
                              <Text style={styles.friendStateLabel}>Requested you</Text>
                            ) : candidate.outgoing_request_pending ? (
                              <Text style={styles.friendStateLabel}>Requested</Text>
                            ) : (
                              <TouchableOpacity
                                style={[styles.friendButton, (isSending || isBlocking) && styles.friendButtonDisabled]}
                                onPress={() => { void handleSendFriendRequest(candidate); }}
                                activeOpacity={0.8}
                                disabled={isSending || isBlocking}
                              >
                                {isSending ? (
                                  <ActivityIndicator size="small" color={colors.text} />
                                ) : (
                                  <Text style={styles.friendButtonText}>Add Friend</Text>
                                )}
                              </TouchableOpacity>
                            )}
                            <TouchableOpacity
                              style={[
                                styles.friendButton,
                                styles.friendButtonDestructive,
                                (isSending || isBlocking) && styles.friendButtonDisabled,
                              ]}
                              onPress={() => { void handleBlockRelationshipUser(candidate, blockKey); }}
                              activeOpacity={0.8}
                              disabled={isSending || isBlocking}
                            >
                              {isBlocking ? (
                                <ActivityIndicator size="small" color={colors.destructive} />
                              ) : (
                                <Text style={[styles.friendButtonText, styles.friendButtonTextDestructive]}>Block</Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        </View>
                      );
                    })
                  )}
                </View>
              ) : null}

              {!friendSearchQuery.trim() && relationshipsError ? <Text style={styles.errorText}>{relationshipsError}</Text> : null}
              {!friendSearchQuery.trim() && relationshipsLoading ? <Text style={styles.savingText}>Loading friends...</Text> : null}

              {!friendSearchQuery.trim() && !relationshipsLoading && incomingRequests.length === 0 && outgoingRequests.length === 0 && friends.length === 0 ? (
                <Text style={styles.toggleSub}>No friends yet.</Text>
              ) : null}

              {!friendSearchQuery.trim() && !relationshipsLoading ? (
                <View style={styles.friendsList}>
                  {incomingRequests.map((request) => {
                    const acceptKey = `request:${request.id}:accept`;
                    const rejectKey = `request:${request.id}:reject`;
                    const blockKey = `request:${request.id}:block`;
                    const busy = Boolean(
                      relationshipInFlight[acceptKey]
                      || relationshipInFlight[rejectKey]
                      || relationshipInFlight[blockKey],
                    );

                    return (
                      <View key={request.id} style={styles.friendRow}>
                        <View style={styles.friendMeta}>
                          <View style={styles.friendAvatar}>
                            <Text style={styles.friendAvatarText}>{request.sender.initial}</Text>
                          </View>
                          <View style={styles.friendText}>
                            <Text style={styles.friendName} numberOfLines={1} ellipsizeMode="clip">{request.sender.username}</Text>
                            <Text style={styles.friendEmail} numberOfLines={1} ellipsizeMode="clip">{request.sender.email}</Text>
                          </View>
                        </View>
                        <View style={styles.friendIconActions}>
                          <TouchableOpacity
                            style={[styles.circleActionButton, { backgroundColor: colors.successMuted }, busy && styles.friendButtonDisabled]}
                            onPress={() => { void handleAcceptFriendRequest(request); }}
                            activeOpacity={0.75}
                            disabled={busy}
                          >
                            {relationshipInFlight[acceptKey] === 'accept' ? (
                              <ActivityIndicator size="small" color={colors.success} />
                            ) : (
                              <Feather name="check" size={16} color={colors.success} />
                            )}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.circleActionButton, { backgroundColor: colors.destructiveMuted }, busy && styles.friendButtonDisabled]}
                            onPress={() => { void handleRejectFriendRequest(request); }}
                            activeOpacity={0.75}
                            disabled={busy}
                          >
                            {relationshipInFlight[rejectKey] === 'reject' ? (
                              <ActivityIndicator size="small" color={colors.destructive} />
                            ) : (
                              <Feather name="x" size={16} color={colors.destructive} />
                            )}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.circleActionButton, { backgroundColor: colors.destructiveMuted }, busy && styles.friendButtonDisabled]}
                            onPress={() => { void handleBlockRelationshipUser(request.sender, blockKey); }}
                            activeOpacity={0.75}
                            disabled={busy}
                          >
                            {relationshipInFlight[blockKey] === 'block' ? (
                              <ActivityIndicator size="small" color={colors.destructive} />
                            ) : (
                              <Feather name="slash" size={16} color={colors.destructive} />
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}

                  {outgoingRequests.map((request) => {
                    const withdrawKey = `outgoing:${request.id}:withdraw`;
                    const blockKey = `sent-request:${request.id}:block`;
                    const isWithdrawing = relationshipInFlight[withdrawKey] === 'withdraw';
                    const isBlocking = relationshipInFlight[blockKey] === 'block';
                    const busy = isWithdrawing || isBlocking;
                    return (
                      <View key={request.id} style={styles.friendRow}>
                        <View style={styles.friendMeta}>
                          <View style={styles.friendAvatar}>
                            <Text style={styles.friendAvatarText}>{request.receiver.initial}</Text>
                          </View>
                          <View style={styles.friendText}>
                            <Text style={styles.friendName} numberOfLines={1} ellipsizeMode="clip">{request.receiver.username}</Text>
                            <Text style={styles.friendEmail} numberOfLines={1} ellipsizeMode="clip">{request.receiver.email}</Text>
                          </View>
                        </View>
                        <View style={styles.friendIconActions}>
                          <TouchableOpacity
                            style={[styles.circleActionButton, { backgroundColor: '#3B2712' }, busy && styles.friendButtonDisabled]}
                            onPress={() => { void handleWithdrawFriendRequest(request); }}
                            activeOpacity={0.75}
                            disabled={busy}
                          >
                            {isWithdrawing ? (
                              <ActivityIndicator size="small" color={colors.warning} />
                            ) : (
                              <Feather name="user-x" size={16} color={colors.warning} />
                            )}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.circleActionButton, { backgroundColor: colors.destructiveMuted }, busy && styles.friendButtonDisabled]}
                            onPress={() => { void handleBlockRelationshipUser(request.receiver, blockKey); }}
                            activeOpacity={0.75}
                            disabled={busy}
                          >
                            {isBlocking ? (
                              <ActivityIndicator size="small" color={colors.destructive} />
                            ) : (
                              <Feather name="slash" size={16} color={colors.destructive} />
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}

                  {friends.map((friend) => {
                    const removeKey = `friend:${friend.id}:remove`;
                    const blockKey = `friend:${friend.id}:block`;
                    const isRemoving = relationshipInFlight[removeKey] === 'remove';
                    const isBlocking = relationshipInFlight[blockKey] === 'block';
                    const busy = isRemoving || isBlocking;

                    return (
                      <View key={friend.id} style={styles.friendRow}>
                        <View style={styles.friendMeta}>
                          <View style={styles.friendAvatar}>
                            <Text style={styles.friendAvatarText}>{friend.initial}</Text>
                          </View>
                          <View style={styles.friendText}>
                            <Text style={styles.friendName} numberOfLines={1} ellipsizeMode="clip">{friend.username}</Text>
                            <Text style={styles.friendEmail} numberOfLines={1} ellipsizeMode="clip">{friend.email}</Text>
                          </View>
                        </View>
                        <View style={styles.friendActions}>
                          <TouchableOpacity
                            style={[styles.circleActionButton, { backgroundColor: '#3B2712' }, busy && styles.friendButtonDisabled]}
                            onPress={() => { void handleRemoveFriend(friend); }}
                            activeOpacity={0.75}
                            disabled={busy}
                          >
                            {isRemoving ? (
                              <ActivityIndicator size="small" color={colors.warning} />
                            ) : (
                              <Feather name="user-minus" size={16} color={colors.warning} />
                            )}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.circleActionButton, { backgroundColor: colors.destructiveMuted }, busy && styles.friendButtonDisabled]}
                            onPress={() => { void handleBlockRelationshipUser(friend, blockKey); }}
                            activeOpacity={0.75}
                            disabled={busy}
                          >
                            {isBlocking ? (
                              <ActivityIndicator size="small" color={colors.destructive} />
                            ) : (
                              <Feather name="slash" size={16} color={colors.destructive} />
                            )}
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          </View>
        </View>

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

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Blocked Users</Text>
          <View style={styles.card}>
            <View style={styles.defaultsContent}>
              <Text style={styles.toggleSub}>
                Unblock people you previously blocked so they can send friend requests again.
              </Text>

              {blockedUsersLoading ? <Text style={styles.savingText}>Loading blocked users...</Text> : null}
              {blockedUsersError ? <Text style={styles.errorText}>{blockedUsersError}</Text> : null}

              {!blockedUsersLoading && blockedUsers.length === 0 ? (
                <Text style={styles.toggleSub}>No blocked users.</Text>
              ) : null}

              {blockedUsers.map((blockedUser) => (
                <View key={blockedUser.id} style={styles.blockedUserRow}>
                  <View style={styles.blockedUserMeta}>
                    <Text style={styles.blockedUserName} numberOfLines={1} ellipsizeMode="clip">{blockedUser.username}</Text>
                    <Text style={styles.blockedUserEmail} numberOfLines={1} ellipsizeMode="clip">{blockedUser.email}</Text>
                  </View>
                  <TouchableOpacity
                    style={[
                      styles.unblockButton,
                      unblockingUserId === blockedUser.id && styles.unblockButtonDisabled,
                    ]}
                    onPress={() => { void handleUnblockUser(blockedUser); }}
                    activeOpacity={0.8}
                    disabled={unblockingUserId === blockedUser.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Unblock ${blockedUser.username}`}
                  >
                    <Text style={styles.unblockButtonText}>
                      {unblockingUserId === blockedUser.id ? 'Unblocking...' : 'Unblock'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Session</Text>
          <View style={styles.card}>
            <SettingsRow
              icon="download"
              label={isExporting ? 'Exporting...' : 'Export my data'}
              onPress={() => { void handleExportData(); }}
            />
            <TouchableOpacity
              style={[
                styles.deleteAccountButton,
                (isDeletingAccount || isCheckingDeleteConflicts || deleteAccountSuccess)
                  && styles.deleteAccountButtonDisabled,
              ]}
              onPress={handleDeleteAccount}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Delete account permanently"
              disabled={isDeletingAccount || isCheckingDeleteConflicts || deleteAccountSuccess}
            >
              <Feather name="trash-2" size={18} color={colors.destructive} />
              <Text style={styles.deleteAccountButtonText}>
                {deleteAccountSuccess
                  ? 'Account deleted'
                  : isDeletingAccount
                    ? 'Deleting account...'
                    : isCheckingDeleteConflicts
                      ? 'Checking...'
                      : 'Delete account permanently'}
              </Text>
            </TouchableOpacity>
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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  body: {
    flex: 1,
    paddingHorizontal: spacing.md,
  },
  bodyContent: {
    gap: spacing.lg,
    paddingVertical: spacing.lg,
    paddingBottom: spacing.xxl,
  },

  // Account card
  accountContent: {
    gap: spacing.md,
  },
  accountIdentityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  accountIdentityMeta: {
    flex: 1,
    paddingTop: 2,
    gap: 4,
  },
  accountIdentityTitle: {
    fontSize: typography.base,
    color: colors.text,
    fontWeight: typography.semibold,
  },
  accountIdentitySub: {
    fontSize: typography.sm,
    color: colors.textMuted,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: typography.md,
    fontWeight: typography.bold,
    color: colors.text,
  },
  readOnlyField: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  readOnlyFieldText: {
    fontSize: typography.base,
    color: colors.text,
  },

  // Sections
  section: {
    gap: spacing.sm,
    paddingTop: spacing.lg,
  },
  sectionLabel: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: colors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  card: {},
  cardDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  rowTinted: {
    borderWidth: 1,
    borderColor: '#7F1D1D66',
    backgroundColor: '#450A0A26',
    borderRadius: radius.md,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowLabel: {
    fontSize: typography.base,
    color: colors.text,
    fontWeight: typography.normal,
  },
  rowLabelDestructive: {
    color: colors.destructive,
  },
  trailingText: {
    fontSize: typography.sm,
    color: colors.textMuted,
    fontWeight: typography.medium,
  },
  defaultsContent: {
    gap: spacing.md,
  },
  defaultsField: {
    gap: spacing.sm,
  },
  friendSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 46,
  },
  friendSearchInput: {
    flex: 1,
    color: colors.text,
    fontSize: typography.base,
    paddingVertical: 0,
  },
  defaultsLabel: {
    fontSize: typography.sm,
    color: colors.textMuted,
    fontWeight: typography.medium,
  },
  selectButton: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectLabel: {
    color: colors.text,
    fontSize: typography.base,
    flex: 1,
    paddingRight: spacing.sm,
  },
  textInput: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    color: colors.text,
    fontSize: typography.base,
  },
  usernameInlineField: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  usernameInlineLabel: {
    fontSize: typography.base,
    color: colors.textMuted,
    fontWeight: typography.medium,
  },
  usernameInlineInput: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: typography.base,
    textAlign: 'right',
    paddingVertical: 0,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  toggleTextWrap: {
    flex: 1,
    gap: 2,
  },
  toggleTitle: {
    fontSize: typography.base,
    color: colors.text,
    fontWeight: typography.medium,
  },
  toggleSub: {
    fontSize: typography.sm,
    color: colors.textMuted,
    lineHeight: 18,
  },
  errorText: {
    fontSize: typography.sm,
    color: colors.destructive,
  },
  savingText: {
    fontSize: typography.sm,
    color: colors.textMuted,
  },
  successText: {
    fontSize: typography.sm,
    color: colors.success,
  },
  deleteAccountButton: {
    minHeight: 52,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  deleteAccountButtonDisabled: {
    opacity: 0.65,
  },
  deleteAccountButtonText: {
    fontSize: typography.base,
    color: colors.destructive,
    fontWeight: typography.semibold,
  },
  blockedUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  blockedUserMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  blockedUserName: {
    fontSize: typography.base,
    color: colors.text,
    fontWeight: typography.medium,
  },
  blockedUserEmail: {
    fontSize: typography.sm,
    color: colors.textMuted,
  },
  unblockButton: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unblockButtonDisabled: {
    opacity: 0.6,
  },
  unblockButtonText: {
    fontSize: typography.sm,
    color: colors.text,
    fontWeight: typography.semibold,
  },
  friendsList: {
    gap: spacing.sm,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  friendMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flex: 1,
  },
  friendAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  friendAvatarText: {
    color: colors.text,
    fontSize: typography.sm,
    fontWeight: typography.semibold,
  },
  friendText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  friendName: {
    fontSize: typography.base,
    color: colors.text,
    fontWeight: typography.medium,
  },
  friendEmail: {
    fontSize: typography.sm,
    color: colors.textMuted,
  },
  friendActions: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  friendIconActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  circleActionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  friendButton: {
    minHeight: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendButtonDestructive: {
    borderColor: '#7F1D1D',
    backgroundColor: colors.destructiveMuted,
  },
  friendButtonDisabled: {
    opacity: 0.6,
  },
  friendButtonText: {
    fontSize: typography.sm,
    color: colors.text,
    fontWeight: typography.semibold,
  },
  friendButtonTextDestructive: {
    color: '#FCA5A5',
  },
  friendStateLabel: {
    fontSize: typography.sm,
    color: colors.textMuted,
    fontWeight: typography.medium,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  backdropTapTarget: {
    flex: 1,
  },
  pickerSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.borderStrong,
    maxHeight: '62%',
    paddingBottom: spacing.md,
  },
  pickerHeader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pickerTitle: {
    fontSize: typography.md,
    color: colors.text,
    fontWeight: typography.semibold,
  },
  pickerDone: {
    fontSize: typography.base,
    color: colors.text,
    fontWeight: typography.medium,
  },
  pickerRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  pickerRowLabel: {
    fontSize: typography.base,
    color: colors.text,
  },
});
