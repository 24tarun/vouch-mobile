import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Alert,
  Easing,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import {
  syncLocalReminderNotificationsAsync,
  unregisterForPushNotificationsAsync,
} from '@/lib/notifications';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/lib/ThemeContext';
import { makeStyles } from '@/components/settings/styles';
import { Charity, Currency } from '@/lib/types';
import { PageHeader } from '@/components/PageHeader';
import {
  AI_PROFILE_ID,
  normalizeAiUsername,
  normalizeAiEmail,
} from '@/lib/constants/ai-profile';
import { getFailureCostBounds } from '@/lib/domain/failure-cost';
import { ACTIVE_VOUCHER_TASK_STATUSES } from '@/lib/constants/task-status';
import { normalizePomoDurationMinutes } from '@/lib/constants/timings';
import { CalendarSyncSection } from '@/components/settings/CalendarSyncSection';
import { useRelationships, type RelationshipsData } from '@/lib/hooks/useRelationships';
import { useBlockedUsers } from '@/lib/hooks/useBlockedUsers';
import { queryKeys } from '@/lib/query/keys';
import { WEBSITE_URL } from '@/lib/auth-urls';
import {
  type NotificationSoundKey,
  getNotificationSoundConfigs,
  getNotificationSoundPreviewAsset,
  normalizeNotificationSoundKey,
} from '@/lib/notification-sounds';
import {
  type BlockedUserOption,
  type IncomingFriendRequest,
  type OutgoingFriendRequest,
  type SearchCandidate,
  type UserSummary,
  normalizeSearchCandidate,
  normalizeVoucherOption,
} from '@/lib/settings/relationships';
import { formatTimeZoneLabel, getTimeZoneOptions } from '@/lib/timezones';

type PickerType = 'voucher' | 'currency' | 'timezone' | 'charity' | 'notificationSound' | null;

interface PickerOption {
  label: string;
  value: string;
  disabled?: boolean;
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
const EVENT_DURATION_MIN_MINUTES = 0;
const EVENT_DURATION_MAX_MINUTES = 1000;
const EVENT_DURATION_FALLBACK_MINUTES = 60;
const SHOW_CALENDAR_SYNC = false;
const ACCOUNT_DELETE_FALLBACK_URL = `${WEBSITE_URL}/settings`;
const ACCOUNT_DELETE_API_URL = `${WEBSITE_URL}/api/account/delete`;
const CURRENCY_OPTIONS: PickerOption[] = [
  { label: 'USD', value: 'USD' },
  { label: 'EUR', value: 'EUR' },
  { label: 'INR', value: 'INR' },
];

type SaveIndicatorPhase = 'idle' | 'dirty' | 'saving' | 'saved';

function SaveStatusTrafficLights({
  phase,
  successTick,
}: {
  phase: SaveIndicatorPhase;
  successTick: number;
}) {
  const { colors } = useTheme();
  const pulse = useRef(new Animated.Value(0)).current;
  const [flashPhase, setFlashPhase] = useState<Exclude<SaveIndicatorPhase, 'idle'> | null>(null);
  const previousPhaseRef = useRef<SaveIndicatorPhase>(phase);
  const lightSize = 22;
  const lightRadius = lightSize / 2;

  useEffect(() => {
    const previousPhase = previousPhaseRef.current;
    previousPhaseRef.current = phase;

    if (phase === previousPhase || (phase !== 'dirty' && phase !== 'saving')) return;

    setFlashPhase(phase);
    pulse.setValue(0);
    Animated.sequence([
      Animated.timing(pulse, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(pulse, {
        toValue: 0,
        duration: 150,
        easing: Easing.in(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(pulse, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start(() => {
      setFlashPhase(null);
      pulse.setValue(0);
    });
  }, [phase, pulse]);

  useEffect(() => {
    if (successTick === 0) return;

    setFlashPhase('saved');
    pulse.setValue(0);
    Animated.sequence([
      Animated.timing(pulse, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(pulse, {
        toValue: 0,
        duration: 150,
        easing: Easing.in(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(pulse, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start(() => {
      setFlashPhase(null);
      pulse.setValue(0);
    });
  }, [successTick, pulse]);

  const displayedPhase = flashPhase ?? phase;

  const redOpacity = displayedPhase === 'dirty'
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.52, 1] })
    : 0.25;
  const amberOpacity = displayedPhase === 'saving'
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.52, 1] })
    : 0.25;
  const greenOpacity = displayedPhase === 'saved'
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.58, 1] })
    : displayedPhase === 'dirty' || displayedPhase === 'saving'
      ? 0.08
      : 0.92;
  const redScale = displayedPhase === 'dirty'
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] })
    : 1;
  const amberScale = displayedPhase === 'saving'
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] })
    : 1;
  const greenScale = displayedPhase === 'saved'
    ? pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] })
    : displayedPhase === 'dirty' || displayedPhase === 'saving'
      ? 1
      : 1.04;

  return (
    <View
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
      accessibilityLabel={
        phase === 'dirty'
          ? 'Unsaved settings changes'
          : phase === 'saving'
            ? 'Saving settings'
            : phase === 'saved'
              ? 'Settings saved'
              : 'Settings are up to date'
      }
    >
      <Animated.View
        style={{
          width: lightSize,
          height: lightSize,
          borderRadius: lightRadius,
          backgroundColor: colors.destructive,
          opacity: redOpacity,
          transform: [{ scale: redScale }],
          shadowColor: colors.destructive,
          shadowOpacity: displayedPhase === 'dirty' ? 0.6 : 0.14,
          shadowRadius: displayedPhase === 'dirty' ? 8 : 2,
          shadowOffset: { width: 0, height: 0 },
          elevation: displayedPhase === 'dirty' ? 6 : 0,
        }}
      />
      <Animated.View
        style={{
          width: lightSize,
          height: lightSize,
          borderRadius: lightRadius,
          backgroundColor: colors.warning,
          opacity: amberOpacity,
          transform: [{ scale: amberScale }],
          shadowColor: colors.warning,
          shadowOpacity: displayedPhase === 'saving' ? 0.55 : 0.14,
          shadowRadius: displayedPhase === 'saving' ? 8 : 2,
          shadowOffset: { width: 0, height: 0 },
          elevation: displayedPhase === 'saving' ? 6 : 0,
        }}
      />
      <Animated.View
        style={{
          width: lightSize,
          height: lightSize,
          borderRadius: lightRadius,
          backgroundColor: colors.success,
          opacity: greenOpacity,
          transform: [{ scale: greenScale }],
          shadowColor: colors.success,
          shadowOpacity: displayedPhase === 'saved' ? 0.62 : displayedPhase === 'idle' ? 0.4 : 0,
          shadowRadius: displayedPhase === 'saved' ? 10 : displayedPhase === 'idle' ? 6 : 0,
          shadowOffset: { width: 0, height: 0 },
          elevation: displayedPhase === 'saved' ? 7 : displayedPhase === 'idle' ? 4 : 0,
        }}
      />
    </View>
  );
}

function buildUserSummaryFromCandidate(candidate: SearchCandidate): UserSummary {
  const username = normalizeAiUsername(candidate.id, candidate.username, 'Friend');
  return {
    id: candidate.id,
    username,
    email: normalizeAiEmail(candidate.id, candidate.email, ''),
    initial: username[0]?.toUpperCase() || '?',
  };
}


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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const relationshipsQuery = useRelationships(user?.id);
  const blockedUsersQuery = useBlockedUsers(user?.id);
  const [activePicker, setActivePicker] = useState<PickerType>(null);

  const [usernameDraft, setUsernameDraft] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const [defaultPomoInput, setDefaultPomoInput] = useState('25');
  const [defaultEventDurationInput, setDefaultEventDurationInput] = useState(String(EVENT_DURATION_FALLBACK_MINUTES));
  const [defaultFailureCostInput, setDefaultFailureCostInput] = useState('10');
  const [defaultVoucherId, setDefaultVoucherId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [notificationSoundKey, setNotificationSoundKey] = useState<NotificationSoundKey>('default');
  const [timeZone, setTimeZone] = useState('UTC');
  const [timeZoneUserSet, setTimeZoneUserSet] = useState(false);
  const [charityEnabled, setCharityEnabled] = useState(false);
  const [selectedCharityId, setSelectedCharityId] = useState<string | null>(null);
  const charityUserOverrideRef = useRef(false);
  const [oneHourReminderEnabled, setOneHourReminderEnabled] = useState(true);
  const [tenMinuteReminderEnabled, setTenMinuteReminderEnabled] = useState(true);
  const [defaultRequiresProofForAllTasks, setDefaultRequiresProofForAllTasks] = useState(false);

  const [relationshipInFlight, setRelationshipInFlight] = useState<Record<string, RelationshipAction | null>>({});
  const [friendSearchQuery, setFriendSearchQuery] = useState('');
  const [friendSearchResults, setFriendSearchResults] = useState<SearchCandidate[]>([]);
  const [friendSearchLoading, setFriendSearchLoading] = useState(false);
  const [friendSearchError, setFriendSearchError] = useState<string | null>(null);
  const [unblockingUserId, setUnblockingUserId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [isCheckingDeleteConflicts, setIsCheckingDeleteConflicts] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  const [deleteAccountSuccess, setDeleteAccountSuccess] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSent, setExportSent] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [previewingSoundKey, setPreviewingSoundKey] = useState<NotificationSoundKey | null>(null);
  const previewSoundRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  const [defaultsError, setDefaultsError] = useState<string | null>(null);
  const [aiVoucherEnabled, setAiVoucherEnabled] = useState(false);
  const [savingAiFeatures, setSavingAiFeatures] = useState(false);
  const [aiFeaturesError, setAiFeaturesError] = useState<string | null>(null);
  const [voucherCanViewActiveTasks, setVoucherCanViewActiveTasks] = useState(true);
  const [savingVoucherVisibility, setSavingVoucherVisibility] = useState(false);
  const [voucherVisibilityError, setVoucherVisibilityError] = useState<string | null>(null);
  const [calendarSaving, setCalendarSaving] = useState(false);
  const [saveSuccessTick, setSaveSuccessTick] = useState(0);
  const [charities, setCharities] = useState<Charity[]>([]);
  const [charitiesLoaded, setCharitiesLoaded] = useState(false);
  const [charitiesError, setCharitiesError] = useState<string | null>(null);
  const emailSavedRef = useRef<string | null>(null);
  const usernameSavedRef = useRef<string | null>(null);
  const defaultsSavedRef = useRef<string | null>(null);
  const aiFeaturesSavedRef = useRef<boolean | null>(null);
  const voucherVisibilitySavedRef = useRef<boolean | null>(null);
  const friends = relationshipsQuery.friends;
  const incomingRequests = relationshipsQuery.incomingRequests;
  const outgoingRequests = relationshipsQuery.outgoingRequests;
  const relationshipsLoading = relationshipsQuery.loading;
  const relationshipsError = relationshipsQuery.error;
  const blockedUsers = blockedUsersQuery.blockedUsers;
  const blockedUsersLoading = blockedUsersQuery.loading;
  const blockedUsersError = blockedUsersQuery.error;
  const voucherLoading = relationshipsLoading || blockedUsersLoading;
  const deviceTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    [],
  );
  const timeZoneOptions = useMemo(() => {
    const options = getTimeZoneOptions();
    return options.includes(timeZone) ? options : [timeZone, ...options];
  }, [timeZone]);

  const voucherOptions = useMemo(() => {
    if (!user) return [];
    const blockedIds = new Set(blockedUsers.map((blockedUser) => blockedUser.id));
    const byId = new Map<string, VoucherOption>();
    byId.set(user.id, { id: user.id, username: 'Me' });
    for (const friend of friends) {
      if (blockedIds.has(friend.id)) continue;
      byId.set(friend.id, normalizeVoucherOption({ id: friend.id, username: friend.username }));
    }
    return Array.from(byId.values());
  }, [blockedUsers, friends, user]);
  const defaultCharityId = useMemo(() => {
    const donateToDeveloper = charities.find(
      (charity) => charity.key === 'donate_to_developer' && charity.is_active,
    );
    if (donateToDeveloper) return donateToDeveloper.id;
    const firstActiveCharity = charities.find((charity) => charity.is_active);
    return firstActiveCharity?.id ?? null;
  }, [charities]);

  useEffect(() => {
    if (!profile || !user) return;
    const nextEmail = (user.email ?? profile.email ?? '').trim().toLowerCase();
    const nextUsername = profile.username;
    const nextPomo = normalizePomoDurationMinutes(profile.default_pomo_duration_minutes);
    const nextEventDuration = Number.isInteger(profile.default_event_duration_minutes)
      && profile.default_event_duration_minutes >= EVENT_DURATION_MIN_MINUTES
      && profile.default_event_duration_minutes <= EVENT_DURATION_MAX_MINUTES
      ? profile.default_event_duration_minutes
      : EVENT_DURATION_FALLBACK_MINUTES;
    const nextFailureCostCents = profile.default_failure_cost_cents ?? 1000;
    const nextFailureCostMajor = nextFailureCostCents / 100;
    const nextVoucherId = profile.default_voucher_id ?? user.id;
    const nextCurrency = profile.currency ?? 'USD';
    const nextNotificationSoundKey = normalizeNotificationSoundKey(profile.notification_sound_key);
    const nextOneHourReminder = profile.deadline_one_hour_warning_enabled ?? true;
    const nextTenMinuteReminder = profile.deadline_final_warning_enabled ?? true;
    const nextDefaultRequiresProofForAllTasks = profile.default_requires_proof_for_all_tasks ?? false;
    const nextAiVoucherEnabled = profile.ai_friend_opt_in ?? false;
    const nextVoucherCanViewActiveTasks = profile.voucher_can_view_active_tasks ?? true;
    const nextTimeZone = profile.timezone ?? 'UTC';
    const nextTimeZoneUserSet = profile.timezone_user_set ?? false;
    const nextCharityEnabled = profile.charity_enabled ?? false;
    const nextSelectedCharityId = profile.selected_charity_id ?? null;

    setUsernameDraft(nextUsername);
    setDefaultPomoInput(String(nextPomo));
    setDefaultEventDurationInput(String(nextEventDuration));
    setDefaultFailureCostInput(
      nextCurrency === 'INR'
        ? String(Math.round(nextFailureCostMajor))
        : nextFailureCostMajor.toFixed(2).replace(/\.00$/, ''),
    );
    setDefaultVoucherId(nextVoucherId);
    setCurrency(nextCurrency);
    setNotificationSoundKey(nextNotificationSoundKey);
    setOneHourReminderEnabled(nextOneHourReminder);
    setTenMinuteReminderEnabled(nextTenMinuteReminder);
    setDefaultRequiresProofForAllTasks(nextDefaultRequiresProofForAllTasks);
    setAiVoucherEnabled(nextAiVoucherEnabled);
    setVoucherCanViewActiveTasks(nextVoucherCanViewActiveTasks);
    setTimeZone(nextTimeZone);
    setTimeZoneUserSet(nextTimeZoneUserSet);
    if (!charityUserOverrideRef.current) {
      setCharityEnabled(nextCharityEnabled);
      setSelectedCharityId(nextSelectedCharityId);
    }

    emailSavedRef.current = nextEmail;
    usernameSavedRef.current = nextUsername;
    if (!charityUserOverrideRef.current) {
      defaultsSavedRef.current = JSON.stringify({
        defaultPomoMinutes: nextPomo,
        defaultEventDurationMinutes: nextEventDuration,
        defaultFailureCostCents: nextFailureCostCents,
        defaultVoucherId: nextVoucherId,
        currency: nextCurrency,
        notificationSoundKey: nextNotificationSoundKey,
        oneHourReminderEnabled: nextOneHourReminder,
        tenMinuteReminderEnabled: nextTenMinuteReminder,
        defaultRequiresProofForAllTasks: nextDefaultRequiresProofForAllTasks,
        timeZone: nextTimeZone,
        timeZoneUserSet: nextTimeZoneUserSet,
        charityEnabled: nextCharityEnabled,
        selectedCharityId: nextSelectedCharityId,
      });
    }
    aiFeaturesSavedRef.current = nextAiVoucherEnabled;
    voucherVisibilitySavedRef.current = nextVoucherCanViewActiveTasks;

    setUsernameError(null);
    setDefaultsError(null);
    setAiFeaturesError(null);
    setVoucherVisibilityError(null);
    setDeleteAccountError(null);
    setDeleteAccountSuccess(false);
  }, [profile, user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function loadCharities() {
      const { data, error } = await supabase
        .from('charities')
        .select('id, key, name, is_active')
        .order('name', { ascending: true });

      if (cancelled) return;
      if (error) {
        setCharities([]);
        setCharitiesLoaded(true);
        setCharitiesError(error.message);
        return;
      }

      setCharities(((data ?? []) as Charity[]));
      setCharitiesLoaded(true);
      setCharitiesError(null);
    }

    void loadCharities();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    if (timeZoneUserSet) return;
    if (!deviceTimeZone || deviceTimeZone === timeZone) return;
    if (!timeZoneOptions.includes(deviceTimeZone)) return;
    setTimeZone(deviceTimeZone);
  }, [deviceTimeZone, timeZone, timeZoneOptions, timeZoneUserSet]);

  useEffect(() => {
    if (!charityEnabled) return;
    if (!charitiesLoaded) return;
    const activeSelectedCharity = charities.find((charity) => charity.id === selectedCharityId) ?? null;
    if (!selectedCharityId || !activeSelectedCharity || !activeSelectedCharity.is_active) {
      if (defaultCharityId) {
        setSelectedCharityId(defaultCharityId);
        return;
      }
      setCharityEnabled(false);
      setSelectedCharityId(null);
    }
  }, [charities, charitiesLoaded, charityEnabled, defaultCharityId, selectedCharityId]);

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

  async function handleExportData() {
    if (!user || isExporting || exportSent) return;

    const EXPORT_COOLDOWN_KEY = 'vouch:last-export-ts';
    const EXPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

    try {
      const lastTs = await AsyncStorage.getItem(EXPORT_COOLDOWN_KEY);
      if (lastTs) {
        const elapsed = Date.now() - Number(lastTs);
        if (elapsed < EXPORT_COOLDOWN_MS) {
          const hoursLeft = Math.ceil((EXPORT_COOLDOWN_MS - elapsed) / (60 * 60 * 1000));
          Alert.alert('Export unavailable', `You can export again in ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'}.`);
          return;
        }
      }
    } catch {}

    setIsExporting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        Alert.alert('Export failed', 'Not authenticated.');
        return;
      }

      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
      const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
      if (!supabaseUrl || !anonKey) {
        Alert.alert('Export failed', 'Missing configuration.');
        return;
      }

      const response = await fetch(`${supabaseUrl}/functions/v1/export-user-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey,
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      const result = await response.json() as { success?: boolean; error?: string; rateLimited?: boolean };

      if (!response.ok) {
        if (result.rateLimited) {
          await AsyncStorage.setItem(EXPORT_COOLDOWN_KEY, String(Date.now()));
        }
        Alert.alert('Export failed', result.error ?? 'Unknown error.');
        return;
      }

      await AsyncStorage.setItem(EXPORT_COOLDOWN_KEY, String(Date.now()));
      setExportSent(true);
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
    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token?.trim();
    if (!accessToken) {
      return { error: 'Not authenticated', backendUnavailable: false };
    }

    try {
      const response = await fetch(ACCOUNT_DELETE_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      let payload: { error?: string; success?: boolean } | null = null;
      try {
        payload = await response.json() as { error?: string; success?: boolean };
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const message = typeof payload?.error === 'string' && payload.error.trim().length > 0
          ? payload.error
          : 'Failed to delete account.';
        return { error: message, backendUnavailable: response.status >= 500 };
      }

      if (payload && payload.success === true) {
        return { error: null, backendUnavailable: false };
      }

      return { error: 'Failed to delete account.', backendUnavailable: false };
    } catch {
      return {
        error: 'Could not reach delete endpoint. You can finish this from web settings.',
        backendUnavailable: true,
      };
    }
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
    if (!user) return;
    setUnblockingUserId(blockedUser.id);
    const previousBlockedUsers = queryClient.getQueryData<BlockedUserOption[]>(queryKeys.blockedUsers(user.id));
    queryClient.setQueryData<BlockedUserOption[]>(
      queryKeys.blockedUsers(user.id),
      (previous) => (previous ?? []).filter((entry) => entry.id !== blockedUser.id),
    );

    try {
      const { error } = await supabase.rpc('unblock_user', {
        p_target_user_id: blockedUser.id,
      });

      if (error) {
        queryClient.setQueryData(queryKeys.blockedUsers(user.id), previousBlockedUsers);
        Alert.alert('Could not unblock user', error.message);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.blockedUsers(user.id) });
    } finally {
      setUnblockingUserId(null);
    }
  }

  function updateRelationshipInFlight(key: string, action: RelationshipAction | null) {
    setRelationshipInFlight((prev) => ({ ...prev, [key]: action }));
  }

  function patchRelationshipsCache(
    updater: (current: RelationshipsData) => RelationshipsData,
  ) {
    if (!user) return;
    queryClient.setQueryData<RelationshipsData>(
      queryKeys.relationships(user.id),
      (current) => (current ? updater(current) : current),
    );
  }

  function patchBlockedUsersCache(
    updater: (current: BlockedUserOption[]) => BlockedUserOption[],
  ) {
    if (!user) return;
    queryClient.setQueryData<BlockedUserOption[]>(
      queryKeys.blockedUsers(user.id),
      (current) => updater(current ?? []),
    );
  }

  function patchFriendSearchResults(
    updater: (current: SearchCandidate[]) => SearchCandidate[],
  ) {
    setFriendSearchResults((current) => updater(current));
  }

  function invalidateRelationshipCaches() {
    if (!user) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.relationships(user.id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.blockedUsers(user.id) });
  }

  async function refreshRelationshipsAndSearch() {
    if (!user) return;
    await relationshipsQuery.refetch();

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

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        refreshRelationshipsAndSearch(),
        blockedUsersQuery.refetch(),
        supabase
          .from('charities')
          .select('id, key, name, is_active')
          .order('name', { ascending: true })
          .then(({ data, error }) => {
            if (error) {
              setCharitiesError(error.message);
              return;
            }
            setCharities(((data ?? []) as Charity[]));
            setCharitiesError(null);
          }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSendFriendRequest(candidate: SearchCandidate) {
    if (!user) return;
    const key = `send:${candidate.id}`;
    updateRelationshipInFlight(key, 'send');
    const previousRelationships = queryClient.getQueryData<RelationshipsData>(queryKeys.relationships(user.id));
    const previousSearchResults = friendSearchResults;
    const receiver = buildUserSummaryFromCandidate(candidate);

    patchRelationshipsCache((current) => ({
      ...current,
      outgoingRequests: [
        {
          id: `pending-outgoing:${candidate.id}`,
          receiver_id: candidate.id,
          created_at: new Date().toISOString(),
          receiver,
        },
        ...current.outgoingRequests.filter((entry) => entry.receiver_id !== candidate.id),
      ],
    }));
    patchFriendSearchResults((current) =>
      current.map((entry) => (
        entry.id === candidate.id
          ? { ...entry, outgoing_request_pending: true, incoming_request_pending: false }
          : entry
      )),
    );

    try {
      const { error } = await supabase.rpc('send_friend_request', {
        p_target_user_id: candidate.id,
      });

      if (error) {
        queryClient.setQueryData(queryKeys.relationships(user.id), previousRelationships);
        setFriendSearchResults(previousSearchResults);
        Alert.alert('Could not send request', error.message);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.relationships(user.id) });
    } finally {
      updateRelationshipInFlight(key, null);
    }
  }

  async function handleAcceptFriendRequest(request: IncomingFriendRequest) {
    if (!user) return;
    const key = `request:${request.id}:accept`;
    updateRelationshipInFlight(key, 'accept');
    const previousRelationships = queryClient.getQueryData<RelationshipsData>(queryKeys.relationships(user.id));
    const previousSearchResults = friendSearchResults;

    patchRelationshipsCache((current) => ({
      ...current,
      incomingRequests: current.incomingRequests.filter((entry) => entry.id !== request.id),
      friends: [...current.friends, request.sender]
        .filter((entry, index, list) => list.findIndex((candidate) => candidate.id === entry.id) === index)
        .sort((a, b) => a.username.localeCompare(b.username)),
    }));
    patchFriendSearchResults((current) =>
      current.map((entry) => (
        entry.id === request.sender.id
          ? {
              ...entry,
              already_friends: true,
              incoming_request_pending: false,
              outgoing_request_pending: false,
            }
          : entry
      )),
    );

    try {
      const { error } = await supabase.rpc('accept_friend_request', {
        p_request_id: request.id,
      });

      if (error) {
        queryClient.setQueryData(queryKeys.relationships(user.id), previousRelationships);
        setFriendSearchResults(previousSearchResults);
        Alert.alert('Could not accept request', error.message);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.relationships(user.id) });
    } finally {
      updateRelationshipInFlight(key, null);
    }
  }

  async function handleRejectFriendRequest(request: IncomingFriendRequest) {
    if (!user) return;
    const key = `request:${request.id}:reject`;
    updateRelationshipInFlight(key, 'reject');
    const previousRelationships = queryClient.getQueryData<RelationshipsData>(queryKeys.relationships(user.id));
    const previousSearchResults = friendSearchResults;

    patchRelationshipsCache((current) => ({
      ...current,
      incomingRequests: current.incomingRequests.filter((entry) => entry.id !== request.id),
    }));
    patchFriendSearchResults((current) =>
      current.map((entry) => (
        entry.id === request.sender.id
          ? { ...entry, incoming_request_pending: false }
          : entry
      )),
    );

    try {
      const { error } = await supabase.rpc('reject_friend_request', {
        p_request_id: request.id,
      });

      if (error) {
        queryClient.setQueryData(queryKeys.relationships(user.id), previousRelationships);
        setFriendSearchResults(previousSearchResults);
        Alert.alert('Could not reject request', error.message);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.relationships(user.id) });
    } finally {
      updateRelationshipInFlight(key, null);
    }
  }

  async function handleWithdrawFriendRequest(request: OutgoingFriendRequest) {
    if (!user) return;
    const key = `outgoing:${request.id}:withdraw`;
    updateRelationshipInFlight(key, 'withdraw');
    const previousRelationships = queryClient.getQueryData<RelationshipsData>(queryKeys.relationships(user.id));
    const previousSearchResults = friendSearchResults;

    patchRelationshipsCache((current) => ({
      ...current,
      outgoingRequests: current.outgoingRequests.filter((entry) => entry.id !== request.id),
    }));
    patchFriendSearchResults((current) =>
      current.map((entry) => (
        entry.id === request.receiver_id
          ? { ...entry, outgoing_request_pending: false }
          : entry
      )),
    );

    try {
      const { error } = await supabase.rpc('withdraw_friend_request', {
        p_request_id: request.id,
      });

      if (error) {
        if (error.message?.toLowerCase().includes('no longer pending')) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.relationships(user.id) });
          return;
        }
        queryClient.setQueryData(queryKeys.relationships(user.id), previousRelationships);
        setFriendSearchResults(previousSearchResults);
        Alert.alert('Could not withdraw request', error.message);
        return;
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.relationships(user.id) });
    } finally {
      updateRelationshipInFlight(key, null);
    }
  }

  async function handleRemoveFriend(friend: UserSummary) {
    if (!user) return;
    const key = `friend:${friend.id}:remove`;
    updateRelationshipInFlight(key, 'remove');
    const isAiFriend = friend.id === AI_PROFILE_ID;
    const previousRelationships = queryClient.getQueryData<RelationshipsData>(queryKeys.relationships(user.id));
    const previousProfile = queryClient.getQueryData(queryKeys.currentProfile(user.id));
    const previousSearchResults = friendSearchResults;
    const previousDefaultVoucherId = defaultVoucherId;
    const previousAiVoucherEnabled = aiVoucherEnabled;

    patchRelationshipsCache((current) => ({
      ...current,
      friends: current.friends.filter((entry) => entry.id !== friend.id),
    }));
    patchFriendSearchResults((current) =>
      current.map((entry) => (
        entry.id === friend.id
          ? {
              ...entry,
              already_friends: false,
              incoming_request_pending: false,
              outgoing_request_pending: false,
            }
          : entry
      )),
    );
    if (isAiFriend) {
      queryClient.setQueryData(queryKeys.currentProfile(user.id), (current: any) =>
        current ? { ...current, ai_friend_opt_in: false } : current,
      );
      setAiVoucherEnabled(false);
    }
    if (defaultVoucherId === friend.id) {
      setDefaultVoucherId(user.id);
    }

    try {
      const removeFriendPromise = supabase.rpc('remove_friend', { p_target_user_id: friend.id });
      const aiProfileUpdatePromise = isAiFriend
        ? supabase.from('profiles').update({ ai_friend_opt_in: false }).eq('id', user.id)
        : Promise.resolve(null);

      const [removeRes] = await Promise.all([removeFriendPromise, aiProfileUpdatePromise]);

      if (removeRes.error) {
        queryClient.setQueryData(queryKeys.relationships(user.id), previousRelationships);
        queryClient.setQueryData(queryKeys.currentProfile(user.id), previousProfile);
        setFriendSearchResults(previousSearchResults);
        setDefaultVoucherId(previousDefaultVoucherId);
        setAiVoucherEnabled(previousAiVoucherEnabled);
        Alert.alert('Could not remove friend', removeRes.error.message);
        return;
      }

      if (isAiFriend) {
        aiFeaturesSavedRef.current = false;
      }
      invalidateRelationshipCaches();
    } finally {
      updateRelationshipInFlight(key, null);
    }
  }

  async function handleBlockRelationshipUser(target: UserSummary | SearchCandidate, sourceKey: string) {
    if (!user) return;
    updateRelationshipInFlight(sourceKey, 'block');
    const previousRelationships = queryClient.getQueryData<RelationshipsData>(queryKeys.relationships(user.id));
    const previousBlockedUsers = queryClient.getQueryData<BlockedUserOption[]>(queryKeys.blockedUsers(user.id));
    const previousSearchResults = friendSearchResults;
    const previousDefaultVoucherId = defaultVoucherId;
    const blockedEntry: BlockedUserOption = {
      id: target.id,
      username: normalizeAiUsername(target.id, target.username, 'Blocked user'),
      email: normalizeAiEmail(target.id, target.email, ''),
    };

    patchRelationshipsCache((current) => ({
      ...current,
      friends: current.friends.filter((entry) => entry.id !== target.id),
      incomingRequests: current.incomingRequests.filter((entry) => entry.sender.id !== target.id),
      outgoingRequests: current.outgoingRequests.filter((entry) => entry.receiver.id !== target.id),
    }));
    patchBlockedUsersCache((current) => {
      if (current.some((entry) => entry.id === target.id)) return current;
      return [blockedEntry, ...current].sort((a, b) => a.username.localeCompare(b.username));
    });
    patchFriendSearchResults((current) => current.filter((entry) => entry.id !== target.id));
    if (defaultVoucherId === target.id) {
      setDefaultVoucherId(user.id);
    }

    try {
      const { error } = await supabase.rpc('block_user', {
        p_target_user_id: target.id,
      });

      if (error) {
        queryClient.setQueryData(queryKeys.relationships(user.id), previousRelationships);
        queryClient.setQueryData(queryKeys.blockedUsers(user.id), previousBlockedUsers);
        setFriendSearchResults(previousSearchResults);
        setDefaultVoucherId(previousDefaultVoucherId);
        Alert.alert('Could not block user', error.message);
        return;
      }
      invalidateRelationshipCaches();
    } finally {
      updateRelationshipInFlight(sourceKey, null);
    }
  }

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
  const normalizedEventDurationInput = defaultEventDurationInput.trim();
  const parsedEventDurationMinutes = Number(normalizedEventDurationInput);
  const eventDurationValidationError = useMemo(() => {
    if (!normalizedEventDurationInput) return 'Default time-bound duration is required.';
    if (!Number.isFinite(parsedEventDurationMinutes) || !Number.isInteger(parsedEventDurationMinutes)) {
      return 'Default time-bound duration must be a whole number.';
    }
    if (
      parsedEventDurationMinutes < EVENT_DURATION_MIN_MINUTES
      || parsedEventDurationMinutes > EVENT_DURATION_MAX_MINUTES
    ) {
      return `Default time-bound duration must be between ${EVENT_DURATION_MIN_MINUTES} and ${EVENT_DURATION_MAX_MINUTES} minutes.`;
    }
    return null;
  }, [normalizedEventDurationInput, parsedEventDurationMinutes]);
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
  const selectedCharity = useMemo(
    () => charities.find((charity) => charity.id === selectedCharityId) ?? null,
    [charities, selectedCharityId],
  );
  const charityValidationError = useMemo(() => {
    if (!charityEnabled) return null;
    if (!selectedCharityId) return 'Select one charity when Charity Choice is enabled.';
    if (!selectedCharity || !selectedCharity.is_active) {
      return 'Selected charity is unavailable. Choose an active charity.';
    }
    return null;
  }, [charityEnabled, selectedCharity, selectedCharityId]);

  const voucherPickerOptions: PickerOption[] = useMemo(
    () => voucherOptions.map((option) => ({ label: option.username, value: option.id })),
    [voucherOptions],
  );
  const timeZonePickerOptions: PickerOption[] = useMemo(
    () => timeZoneOptions.map((zone) => ({ label: formatTimeZoneLabel(zone), value: zone })),
    [timeZoneOptions],
  );
  const charityPickerOptions: PickerOption[] = useMemo(
    () => [
      { label: 'No charity selected', value: '__none__' },
      ...charities.map((charity) => ({
        label: charity.is_active ? charity.name : `${charity.name} (Unavailable)`,
        value: charity.id,
        disabled: !charity.is_active,
      })),
    ],
    [charities],
  );
  const notificationSoundPickerOptions: PickerOption[] = useMemo(
    () => getNotificationSoundConfigs().map((sound) => ({ label: sound.label, value: sound.key })),
    [],
  );
  const pickerOptions: PickerOption[] = useMemo(() => {
    if (activePicker === 'voucher') return voucherPickerOptions;
    if (activePicker === 'currency') return CURRENCY_OPTIONS;
    if (activePicker === 'timezone') return timeZonePickerOptions;
    if (activePicker === 'charity') return charityPickerOptions;
    if (activePicker === 'notificationSound') return notificationSoundPickerOptions;
    return [];
  }, [
    activePicker,
    charityPickerOptions,
    notificationSoundPickerOptions,
    timeZonePickerOptions,
    voucherPickerOptions,
  ]);

  const pickerTitle = useMemo(() => {
    if (activePicker === 'voucher') return 'Default Voucher';
    if (activePicker === 'currency') return 'Currency';
    if (activePicker === 'timezone') return 'Timezone';
    if (activePicker === 'charity') return 'Charity';
    if (activePicker === 'notificationSound') return 'Notification sound';
    return '';
  }, [activePicker]);

  const defaultVoucherLabel = useMemo(
    () => voucherOptions.find((option) => option.id === defaultVoucherId)?.username ?? 'Select voucher',
    [voucherOptions, defaultVoucherId],
  );
  const selectedCharityLabel = useMemo(
    () => charities.find((charity) => charity.id === selectedCharityId)?.name ?? 'Select one charity',
    [charities, selectedCharityId],
  );
  const notificationSoundLabel = useMemo(
    () =>
      getNotificationSoundConfigs().find((option) => option.key === notificationSoundKey)?.label
      ?? 'Default',
    [notificationSoundKey],
  );
  const defaultsSnapshot = useMemo(
    () =>
      JSON.stringify({
        defaultPomoMinutes: parsedPomoMinutes,
        defaultEventDurationMinutes: parsedEventDurationMinutes,
        defaultFailureCostCents: parsedFailureCostCents,
        defaultVoucherId: resolvedDefaultVoucherId,
        currency,
        notificationSoundKey,
        oneHourReminderEnabled,
        tenMinuteReminderEnabled,
        defaultRequiresProofForAllTasks,
        timeZone,
        timeZoneUserSet,
        charityEnabled,
        selectedCharityId,
      }),
    [
      parsedPomoMinutes,
      parsedEventDurationMinutes,
      parsedFailureCostCents,
      resolvedDefaultVoucherId,
      currency,
      notificationSoundKey,
      oneHourReminderEnabled,
      tenMinuteReminderEnabled,
      defaultRequiresProofForAllTasks,
      timeZone,
      timeZoneUserSet,
      charityEnabled,
      selectedCharityId,
    ],
  );
  const usernameDirty = usernameSavedRef.current !== null && normalizedUsernameDraft !== usernameSavedRef.current;
  const defaultsDirty = defaultsSavedRef.current !== null && defaultsSnapshot !== defaultsSavedRef.current;
  const aiFeaturesDirty = aiFeaturesSavedRef.current !== null && aiVoucherEnabled !== aiFeaturesSavedRef.current;
  const voucherVisibilityDirty = (
    voucherVisibilitySavedRef.current !== null
    && voucherCanViewActiveTasks !== voucherVisibilitySavedRef.current
  );
  const anySettingDirty = usernameDirty || defaultsDirty || aiFeaturesDirty || voucherVisibilityDirty;
  const anySettingSaving = (
    savingUsername
    || savingDefaults
    || savingAiFeatures
    || savingVoucherVisibility
    || calendarSaving
  );
  const saveIndicatorPhase: SaveIndicatorPhase = anySettingSaving
    ? 'saving'
    : anySettingDirty
      ? 'dirty'
      : 'idle';

  function validateUsername(value: string): string | null {
    if (!value) return 'Username is required.';
    if (value.length < 3) return 'Username must be at least 3 characters.';
    if (!/^[a-zA-Z0-9_]+$/.test(value)) return 'Letters, numbers, and underscores only.';
    return null;
  }

  function applyPicker(value: string) {
    if (activePicker === 'voucher') setDefaultVoucherId(value);
    if (activePicker === 'currency') setCurrency(value as Currency);
    if (activePicker === 'timezone') {
      setTimeZone(value);
      setTimeZoneUserSet(true);
    }
    if (activePicker === 'charity') {
      charityUserOverrideRef.current = true;
      if (value === '__none__') {
        setSelectedCharityId(null);
        setCharityEnabled(false);
        setActivePicker(null);
        return;
      }
      setSelectedCharityId(value);
      setCharityEnabled(true);
    }
    if (activePicker === 'notificationSound') {
      setNotificationSoundKey(normalizeNotificationSoundKey(value));
    }
    setActivePicker(null);
  }

  async function handlePreviewNotificationSound(key: NotificationSoundKey) {
    setPreviewingSoundKey(key);
    try {
      const previewAsset = getNotificationSoundPreviewAsset(key);
      if (!previewAsset) {
        Alert.alert('No preview available', 'Default system sound cannot be previewed in-app.');
        return;
      }

      if (previewSoundRef.current) {
        previewSoundRef.current.remove();
        previewSoundRef.current = null;
      }

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      const player = createAudioPlayer(previewAsset);
      previewSoundRef.current = player;
      player.seekTo(0);
      player.play();

      setTimeout(() => {
        if (previewSoundRef.current !== player) return;
        player.remove();
        previewSoundRef.current = null;
      }, 3000);
    } finally {
      setTimeout(() => {
        setPreviewingSoundKey((current) => (current === key ? null : current));
      }, 1200);
    }
  }

  useEffect(() => () => {
    if (!previewSoundRef.current) return;
    previewSoundRef.current.remove();
    previewSoundRef.current = null;
  }, []);

  useEffect(() => {
    if (!user) return;
    if (usernameSavedRef.current === null) return;
    if (normalizedUsernameDraft === usernameSavedRef.current) {
      setUsernameError(null);
      return;
    }

    const validationError = validateUsername(normalizedUsernameDraft);
    if (validationError) {
      setUsernameError(validationError);
      return;
    }

    setUsernameError(null);
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSavingUsername(true);
      const previousProfile = queryClient.getQueryData(queryKeys.currentProfile(user.id));
      queryClient.setQueryData(queryKeys.currentProfile(user.id), (current: any) => current ? {
        ...current,
        username: normalizedUsernameDraft,
      } : current);

      const { error } = await supabase
        .from('profiles')
        .update({ username: normalizedUsernameDraft })
        .eq('id', user.id);

      setSavingUsername(false);
      if (cancelled) return;

      if (error) {
        queryClient.setQueryData(queryKeys.currentProfile(user.id), previousProfile);
        if (error.code === '23505') {
          setUsernameError('Username is already taken.');
        } else {
          setUsernameError(error.message);
        }
        return;
      }

      usernameSavedRef.current = normalizedUsernameDraft;
      setUsernameDraft(normalizedUsernameDraft);
      setSaveSuccessTick((current) => current + 1);
    }, 700);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [normalizedUsernameDraft, queryClient, user]);

  useEffect(() => {
    if (!user || !resolvedDefaultVoucherId) return;
    if (defaultsSavedRef.current === null) return;
    if (defaultsSnapshot === defaultsSavedRef.current) return;

    if (pomoValidationError) {
      setDefaultsError(pomoValidationError);
      return;
    }
    if (failureCostValidationError) {
      setDefaultsError(failureCostValidationError);
      return;
    }
    if (eventDurationValidationError) {
      setDefaultsError(eventDurationValidationError);
      return;
    }
    if (!timeZone || !timeZoneOptions.includes(timeZone)) {
      setDefaultsError('Timezone is invalid.');
      return;
    }
    if (charityValidationError) {
      setDefaultsError(charityValidationError);
      return;
    }

    setDefaultsError(null);
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSavingDefaults(true);
      const resolvedCharityEnabled = charityEnabled;
      const resolvedSelectedCharityId = selectedCharityId;
      const previousProfile = queryClient.getQueryData(queryKeys.currentProfile(user.id));
      queryClient.setQueryData(queryKeys.currentProfile(user.id), (current: any) => current ? {
        ...current,
        default_pomo_duration_minutes: parsedPomoMinutes,
        default_event_duration_minutes: parsedEventDurationMinutes,
        default_failure_cost_cents: parsedFailureCostCents,
        default_voucher_id: resolvedDefaultVoucherId,
        currency,
        notification_sound_key: notificationSoundKey,
        timezone: timeZone,
        timezone_user_set: timeZoneUserSet,
        charity_enabled: resolvedCharityEnabled,
        selected_charity_id: resolvedSelectedCharityId,
        deadline_one_hour_warning_enabled: oneHourReminderEnabled,
        deadline_final_warning_enabled: tenMinuteReminderEnabled,
        default_requires_proof_for_all_tasks: defaultRequiresProofForAllTasks,
      } : current);

      const { error } = await supabase
        .from('profiles')
        .update({
          default_pomo_duration_minutes: parsedPomoMinutes,
          default_event_duration_minutes: parsedEventDurationMinutes,
          default_failure_cost_cents: parsedFailureCostCents,
          default_voucher_id: resolvedDefaultVoucherId,
          currency,
          notification_sound_key: notificationSoundKey,
          timezone: timeZone,
          timezone_user_set: timeZoneUserSet,
          charity_enabled: resolvedCharityEnabled,
          selected_charity_id: resolvedSelectedCharityId,
          deadline_one_hour_warning_enabled: oneHourReminderEnabled,
          deadline_final_warning_enabled: tenMinuteReminderEnabled,
          default_requires_proof_for_all_tasks: defaultRequiresProofForAllTasks,
        })
        .eq('id', user.id);

      setSavingDefaults(false);
      if (cancelled) return;

      if (error) {
        queryClient.setQueryData(queryKeys.currentProfile(user.id), previousProfile);
        setDefaultsError(error.message);
        return;
      }

      defaultsSavedRef.current = defaultsSnapshot;
      charityUserOverrideRef.current = false;
      setSaveSuccessTick((current) => current + 1);
      void syncLocalReminderNotificationsAsync(user.id);
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    user,
    parsedPomoMinutes,
    parsedEventDurationMinutes,
    parsedFailureCostCents,
    resolvedDefaultVoucherId,
    currency,
    notificationSoundKey,
    oneHourReminderEnabled,
    tenMinuteReminderEnabled,
    defaultRequiresProofForAllTasks,
    timeZone,
    timeZoneOptions,
    timeZoneUserSet,
    charityEnabled,
    selectedCharityId,
    charityValidationError,
    defaultsSnapshot,
    pomoValidationError,
    failureCostValidationError,
    eventDurationValidationError,
    queryClient,
  ]);

  useEffect(() => {
    if (!user) return;
    if (aiFeaturesSavedRef.current === null) return;
    if (aiVoucherEnabled === aiFeaturesSavedRef.current) return;

    setAiFeaturesError(null);
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSavingAiFeatures(true);
      const previousProfile = queryClient.getQueryData(queryKeys.currentProfile(user.id));
      const previousRelationships = queryClient.getQueryData(queryKeys.relationships(user.id)) as any;

      queryClient.setQueryData(queryKeys.currentProfile(user.id), (current: any) => current ? {
        ...current,
        ai_friend_opt_in: aiVoucherEnabled,
      } : current);

      queryClient.setQueryData(queryKeys.relationships(user.id), (current: any) => {
        if (!current) return current;
        const nextFriends = aiVoucherEnabled
          ? current.friends.some((friend: any) => friend.id === AI_PROFILE_ID)
            ? current.friends
            : [
                ...current.friends,
                {
                  id: AI_PROFILE_ID,
                  username: normalizeAiUsername(AI_PROFILE_ID, null, 'AI voucher'),
                  email: normalizeAiEmail(AI_PROFILE_ID, null, ''),
                  initial: normalizeAiUsername(AI_PROFILE_ID, null, 'AI voucher')[0]?.toUpperCase() || 'A',
                },
              ]
          : current.friends.filter((friend: any) => friend.id !== AI_PROFILE_ID);

        return {
          ...current,
          friends: nextFriends,
        };
      });

      const [profileRes, friendshipRes] = await Promise.all([
        supabase
          .from('profiles')
          .update({ ai_friend_opt_in: aiVoucherEnabled })
          .eq('id', user.id),
        aiVoucherEnabled
          ? supabase.from('friendships').upsert(
              { user_id: user.id, friend_id: AI_PROFILE_ID },
              { onConflict: 'user_id,friend_id' },
            )
          : supabase
              .from('friendships')
              .delete()
              .eq('user_id', user.id)
              .eq('friend_id', AI_PROFILE_ID),
      ]);

      setSavingAiFeatures(false);
      if (cancelled) return;

      const error = profileRes.error ?? friendshipRes.error;
      if (error) {
        queryClient.setQueryData(queryKeys.currentProfile(user.id), previousProfile);
        queryClient.setQueryData(queryKeys.relationships(user.id), previousRelationships);
        setAiFeaturesError(error.message);
        return;
      }

      aiFeaturesSavedRef.current = aiVoucherEnabled;
      setSaveSuccessTick((current) => current + 1);
      void queryClient.invalidateQueries({ queryKey: queryKeys.relationships(user.id) });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [aiVoucherEnabled, queryClient, user]);

  useEffect(() => {
    if (!user) return;
    if (voucherVisibilitySavedRef.current === null) return;
    if (voucherCanViewActiveTasks === voucherVisibilitySavedRef.current) return;

    setVoucherVisibilityError(null);
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSavingVoucherVisibility(true);
      const previousProfile = queryClient.getQueryData(queryKeys.currentProfile(user.id));
      queryClient.setQueryData(queryKeys.currentProfile(user.id), (current: any) => current ? {
        ...current,
        voucher_can_view_active_tasks: voucherCanViewActiveTasks,
      } : current);

      const { error } = await supabase
        .from('profiles')
        .update({ voucher_can_view_active_tasks: voucherCanViewActiveTasks })
        .eq('id', user.id);

      setSavingVoucherVisibility(false);
      if (cancelled) return;

      if (error) {
        queryClient.setQueryData(queryKeys.currentProfile(user.id), previousProfile);
        setVoucherVisibilityError(error.message);
        return;
      }

      voucherVisibilitySavedRef.current = voucherCanViewActiveTasks;
      setSaveSuccessTick((current) => current + 1);
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [voucherCanViewActiveTasks, queryClient, user]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <PageHeader
        title="Settings"
        rightAccessory={<SaveStatusTrafficLights phase={saveIndicatorPhase} successTick={saveSuccessTick} />}
      />

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { void handleRefresh(); }}
            tintColor={colors.textMuted}
            colors={[colors.textMuted]}
          />
        }
      >
        <Text style={styles.signedInText}>Signed in as {user?.email ?? ''}</Text>

        <View style={styles.section}>
          <View style={styles.card}>
            <View style={styles.defaultsContent}>
              <TouchableOpacity
                style={styles.inlineFieldButton}
                onPress={() => router.push('/settings/theme')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Open appearance"
              >
                <Text style={styles.inlineFieldLabel}>Appearance</Text>
                <Feather name="chevron-right" size={16} color={colors.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.inlineFieldButton}
                onPress={() => router.push('/settings/defaults')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Open defaults"
              >
                <Text style={styles.inlineFieldLabel}>Defaults</Text>
                <Feather name="chevron-right" size={16} color={colors.textMuted} />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.inlineFieldButton}
                onPress={() => router.push('/settings/manage-friends')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Manage friends"
              >
                <Text style={styles.inlineFieldLabel}>Manage Friends</Text>
                <Feather name="chevron-right" size={16} color={colors.textMuted} />
              </TouchableOpacity>

            </View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.card}>
            <View style={styles.defaultsContent}>
              <TouchableOpacity
                style={styles.inlineFieldButton}
                onPress={() => setActivePicker('notificationSound')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Select notification sound"
              >
                <Text numberOfLines={1} style={[styles.inlineFieldLabel, styles.inlineFieldLabelFixed]}>
                  Notification sound
                </Text>
                <View style={styles.inlineFieldRight}>
                  <Text style={styles.inlineFieldValue}>{notificationSoundLabel}</Text>
                  <Feather name="chevron-down" size={16} color={colors.textMuted} />
                </View>
              </TouchableOpacity>

              <View style={styles.toggleRow}>
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>1 hour reminder</Text>
                </View>
                <View style={styles.toggleSwitchWrap}>
                  <Switch
                    value={oneHourReminderEnabled}
                    onValueChange={setOneHourReminderEnabled}
                    trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                    thumbColor={colors.text}
                  />
                </View>
              </View>

              <View style={styles.toggleRow}>
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>10 minute reminder</Text>
                </View>
                <View style={styles.toggleSwitchWrap}>
                  <Switch
                    value={tenMinuteReminderEnabled}
                    onValueChange={setTenMinuteReminderEnabled}
                    trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                    thumbColor={colors.text}
                  />
                </View>
              </View>

              {savingDefaults ? <Text style={styles.savingText}>Saving...</Text> : null}
              {defaultsError ? <Text style={styles.errorText}>{defaultsError}</Text> : null}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.card}>
            <View style={styles.defaultsContent}>
              <View style={styles.toggleRow}>
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>Charity mode</Text>
                </View>
                <View style={styles.toggleSwitchWrap}>
                  <Switch
                    value={charityEnabled}
                    onValueChange={(nextEnabled) => {
                      charityUserOverrideRef.current = true;
                      setCharityEnabled(nextEnabled);
                      if (!nextEnabled) {
                        setSelectedCharityId(null);
                        if (activePicker === 'charity') {
                          setActivePicker(null);
                        }
                        return;
                      }
                      if (!selectedCharityId || !selectedCharity || !selectedCharity.is_active) {
                        setSelectedCharityId(defaultCharityId);
                      }
                      setActivePicker('charity');
                    }}
                    trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                    thumbColor={colors.text}
                  />
                </View>
              </View>

              {charityEnabled ? (
                <TouchableOpacity
                  style={styles.inlineFieldButton}
                  onPress={() => setActivePicker('charity')}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Select charity"
                >
                  <Text numberOfLines={1} style={[styles.inlineFieldLabel, styles.inlineFieldLabelFixed]}>
                    Charity
                  </Text>
                  <View style={styles.inlineFieldRight}>
                    <Text style={styles.inlineFieldValue}>{selectedCharityLabel}</Text>
                    <Feather name="chevron-down" size={16} color={colors.textMuted} />
                  </View>
                </TouchableOpacity>
              ) : null}

              {charitiesError ? <Text style={styles.errorText}>{charitiesError}</Text> : null}

              <View style={styles.toggleRow}>
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>AI-voucher</Text>
                </View>
                <View style={styles.toggleSwitchWrap}>
                  <Switch
                    value={aiVoucherEnabled}
                    onValueChange={setAiVoucherEnabled}
                    trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                    thumbColor={colors.text}
                  />
                </View>
              </View>

              {savingAiFeatures ? <Text style={styles.savingText}>Saving AI features...</Text> : null}
              {aiFeaturesError ? <Text style={styles.errorText}>{aiFeaturesError}</Text> : null}
            </View>
          </View>
        </View>

        {SHOW_CALENDAR_SYNC ? (
          <CalendarSyncSection
            onSavingStateChange={setCalendarSaving}
            onSaveSuccess={() => setSaveSuccessTick((current) => current + 1)}
          />
        ) : null}

        <View style={styles.section}>
          <View style={styles.card}>
            <View style={styles.defaultsContent}>
              <SettingsRow
                icon="log-out"
                label="Sign out"
                onPress={handleSignOut}
                destructive
              />
              <SettingsRow
                icon="mail"
                label={exportSent ? 'Please check your email in a little while' : isExporting ? 'Sending to email...' : 'Export my data'}
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
          <View style={[styles.pickerSheet, insets.bottom > 0 && { paddingBottom: 16 + insets.bottom }]}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>{pickerTitle}</Text>
              <TouchableOpacity onPress={() => setActivePicker(null)} activeOpacity={0.75}>
                <Text style={styles.pickerDone}>Done</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {pickerOptions.map((option) => (
                <View key={option.value} style={styles.pickerRow}>
                  <TouchableOpacity
                    style={styles.pickerRowMain}
                    onPress={() => {
                      if (option.disabled) return;
                      applyPicker(option.value);
                    }}
                    activeOpacity={0.75}
                    disabled={option.disabled}
                  >
                    <Text style={[styles.pickerRowLabel, option.disabled ? styles.pickerRowLabelDisabled : null]}>
                      {option.label}
                    </Text>
                    {activePicker === 'notificationSound' && notificationSoundKey === option.value ? (
                      <Feather name="check" size={16} color={colors.accentCyan} />
                    ) : null}
                  </TouchableOpacity>
                  {activePicker === 'notificationSound' && !option.disabled ? (
                    <TouchableOpacity
                      style={styles.previewButton}
                      onPress={() => { void handlePreviewNotificationSound(normalizeNotificationSoundKey(option.value)); }}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityLabel={`Preview ${option.label}`}
                    >
                      <Text style={styles.previewButtonText}>
                        {previewingSoundKey === option.value ? 'Playing...' : 'Play'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
