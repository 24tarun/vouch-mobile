import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { useTheme } from '@/lib/ThemeContext';
import { useAuth } from '@/hooks/useAuth';
import { makeStyles } from '@/components/settings/styles';
import { useManageFriends } from '@/lib/hooks/useManageFriends';
import { queryKeys } from '@/lib/query/keys';
import { supabase } from '@/lib/supabase';
import { type Currency } from '@/lib/types';
import { getFailureCostBounds } from '@/lib/domain/failure-cost';
import { normalizePomoDurationMinutes } from '@/lib/constants/timings';
import { formatTimeZoneLabel, getTimeZoneOptions } from '@/lib/timezones';
import { normalizeVoucherOption } from '@/lib/settings/relationships';
import { useTaskSortMode } from '@/lib/hooks/useTaskSortMode';
import type { DashboardSortMode } from '@/lib/hooks/useTasks';

const POMO_MIN_MINUTES = 1;
const POMO_MAX_MINUTES = 120;
const EVENT_DURATION_MIN_MINUTES = 0;
const EVENT_DURATION_MAX_MIN_MINUTES = 1000;
const EVENT_DURATION_FALLBACK_MINUTES = 60;

type PickerType = 'voucher' | 'currency' | 'timezone' | 'taskSort' | null;

interface PickerOption {
  label: string;
  value: string;
  disabled?: boolean;
}

interface VoucherOption {
  id: string;
  username: string;
}

const CURRENCY_OPTIONS: PickerOption[] = [
  { label: 'USD', value: 'USD' },
  { label: 'EUR', value: 'EUR' },
  { label: 'INR', value: 'INR' },
];

export default function SettingsDefaultsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const { friends, blockedUsers, relationshipsLoading, blockedUsersLoading } = useManageFriends();

  const [activePicker, setActivePicker] = useState<PickerType>(null);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [savingUsername, setSavingUsername] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);

  const [defaultPomoInput, setDefaultPomoInput] = useState('25');
  const [defaultEventDurationInput, setDefaultEventDurationInput] = useState(String(EVENT_DURATION_FALLBACK_MINUTES));
  const [defaultFailureCostInput, setDefaultFailureCostInput] = useState('10');
  const [defaultVoucherId, setDefaultVoucherId] = useState<string | null>(null);
  const [currency, setCurrency] = useState<Currency>('USD');
  const [timeZone, setTimeZone] = useState('UTC');
  const [timeZoneUserSet, setTimeZoneUserSet] = useState(false);
  const [taskSortMode, setTaskSortMode] = useTaskSortMode();

  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsError, setDefaultsError] = useState<string | null>(null);

  const usernameSavedRef = useRef<string | null>(null);
  const defaultsSavedRef = useRef<string | null>(null);

  const voucherLoading = relationshipsLoading || blockedUsersLoading;

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

  useEffect(() => {
    if (!profile || !user) return;
    const nextUsername = profile.username;
    const nextPomo = normalizePomoDurationMinutes(profile.default_pomo_duration_minutes);
    const nextEventDuration = Number.isInteger(profile.default_event_duration_minutes)
      && profile.default_event_duration_minutes >= EVENT_DURATION_MIN_MINUTES
      && profile.default_event_duration_minutes <= EVENT_DURATION_MAX_MIN_MINUTES
      ? profile.default_event_duration_minutes
      : EVENT_DURATION_FALLBACK_MINUTES;
    const nextFailureCostCents = profile.default_failure_cost_cents ?? 1000;
    const nextFailureCostMajor = nextFailureCostCents / 100;
    const nextVoucherId = profile.default_voucher_id ?? user.id;
    const nextCurrency = profile.currency ?? 'USD';
    const nextTimeZone = profile.timezone ?? 'UTC';
    const nextTimeZoneUserSet = profile.timezone_user_set ?? false;

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
    setTimeZone(nextTimeZone);
    setTimeZoneUserSet(nextTimeZoneUserSet);

    usernameSavedRef.current = nextUsername;
    defaultsSavedRef.current = JSON.stringify({
      defaultPomoMinutes: nextPomo,
      defaultEventDurationMinutes: nextEventDuration,
      defaultFailureCostCents: nextFailureCostCents,
      defaultVoucherId: nextVoucherId,
      currency: nextCurrency,
      timeZone: nextTimeZone,
      timeZoneUserSet: nextTimeZoneUserSet,
    });

    setUsernameError(null);
    setDefaultsError(null);
  }, [profile, user]);

  const normalizedUsernameDraft = usernameDraft.trim().toLowerCase();
  const resolvedDefaultVoucherId = defaultVoucherId ?? user?.id ?? null;
  const normalizedPomoInput = defaultPomoInput.trim();
  const parsedPomoMinutes = Number(normalizedPomoInput);
  const normalizedEventDurationInput = defaultEventDurationInput.trim();
  const parsedEventDurationMinutes = Number(normalizedEventDurationInput);
  const normalizedFailureCostInput = defaultFailureCostInput.trim();
  const parsedFailureCostMajor = Number(normalizedFailureCostInput);
  const parsedFailureCostCents = Number.isFinite(parsedFailureCostMajor) ? Math.round(parsedFailureCostMajor * 100) : null;

  const currencySymbol = useMemo(() => {
    if (currency === 'EUR') return '€';
    if (currency === 'INR') return '₹';
    return '$';
  }, [currency]);

  const failureCostBounds = useMemo(() => getFailureCostBounds(currency), [currency]);

  const pomoValidationError = useMemo(() => {
    if (!normalizedPomoInput) return 'Default pomo duration is required.';
    if (!Number.isFinite(parsedPomoMinutes) || !Number.isInteger(parsedPomoMinutes)) return 'Default pomo duration must be a whole number.';
    if (parsedPomoMinutes < POMO_MIN_MINUTES || parsedPomoMinutes > POMO_MAX_MINUTES) {
      return `Default pomo duration must be between ${POMO_MIN_MINUTES} and ${POMO_MAX_MINUTES} minutes.`;
    }
    return null;
  }, [normalizedPomoInput, parsedPomoMinutes]);

  const eventDurationValidationError = useMemo(() => {
    if (!normalizedEventDurationInput) return 'Default time-bound duration is required.';
    if (!Number.isFinite(parsedEventDurationMinutes) || !Number.isInteger(parsedEventDurationMinutes)) return 'Default time-bound duration must be a whole number.';
    if (parsedEventDurationMinutes < EVENT_DURATION_MIN_MINUTES || parsedEventDurationMinutes > EVENT_DURATION_MAX_MIN_MINUTES) {
      return `Default time-bound duration must be between ${EVENT_DURATION_MIN_MINUTES} and ${EVENT_DURATION_MAX_MIN_MINUTES} minutes.`;
    }
    return null;
  }, [normalizedEventDurationInput, parsedEventDurationMinutes]);

  const failureCostValidationError = useMemo(() => {
    if (!normalizedFailureCostInput) return 'Default failure cost is required.';
    if (parsedFailureCostCents === null) return 'Default failure cost is invalid.';
    if (parsedFailureCostCents < failureCostBounds.minCents || parsedFailureCostCents > failureCostBounds.maxCents) {
      return `Default failure cost must be between ${currencySymbol}${failureCostBounds.minMajor} and ${currencySymbol}${failureCostBounds.maxMajor}.`;
    }
    return null;
  }, [normalizedFailureCostInput, parsedFailureCostCents, failureCostBounds, currencySymbol]);

  const voucherPickerOptions = useMemo(() => voucherOptions.map((option) => ({ label: option.username, value: option.id })), [voucherOptions]);
  const timeZonePickerOptions = useMemo(() => timeZoneOptions.map((zone) => ({ label: formatTimeZoneLabel(zone), value: zone })), [timeZoneOptions]);
  const taskSortPickerOptions: PickerOption[] = useMemo(
    () => [
      { label: 'Deadline ascending', value: 'deadline_asc' },
      { label: 'Deadline descending', value: 'deadline_desc' },
      { label: 'Created ascending', value: 'created_asc' },
      { label: 'Created descending', value: 'created_desc' },
    ],
    [],
  );
  const taskSortLabel = useMemo(() => {
    const labels: Record<DashboardSortMode, string> = {
      deadline_asc: 'Deadline ascending',
      deadline_desc: 'Deadline descending',
      created_asc: 'Created ascending',
      created_desc: 'Created descending',
    };
    return labels[taskSortMode] ?? 'Deadline ascending';
  }, [taskSortMode]);

  const pickerOptions: PickerOption[] = useMemo(() => {
    if (activePicker === 'voucher') return voucherPickerOptions;
    if (activePicker === 'currency') return CURRENCY_OPTIONS;
    if (activePicker === 'timezone') return timeZonePickerOptions;
    if (activePicker === 'taskSort') return taskSortPickerOptions;
    return [];
  }, [activePicker, voucherPickerOptions, timeZonePickerOptions, taskSortPickerOptions]);

  const pickerTitle = useMemo(() => {
    if (activePicker === 'voucher') return 'Default Voucher';
    if (activePicker === 'currency') return 'Currency';
    if (activePicker === 'timezone') return 'Timezone';
    if (activePicker === 'taskSort') return 'Task sorting';
    return '';
  }, [activePicker]);

  const defaultVoucherLabel = useMemo(() => voucherOptions.find((option) => option.id === defaultVoucherId)?.username ?? 'Select voucher', [voucherOptions, defaultVoucherId]);

  const defaultsSnapshot = useMemo(
    () => JSON.stringify({
      defaultPomoMinutes: parsedPomoMinutes,
      defaultEventDurationMinutes: parsedEventDurationMinutes,
      defaultFailureCostCents: parsedFailureCostCents,
      defaultVoucherId: resolvedDefaultVoucherId,
      currency,
      timeZone,
      timeZoneUserSet,
    }),
    [
      parsedPomoMinutes,
      parsedEventDurationMinutes,
      parsedFailureCostCents,
      resolvedDefaultVoucherId,
      currency,
      timeZone,
      timeZoneUserSet,
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
    if (activePicker === 'timezone') {
      setTimeZone(value);
      setTimeZoneUserSet(true);
    }
    if (activePicker === 'taskSort') setTaskSortMode(value as DashboardSortMode);
    setActivePicker(null);
  }

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
      queryClient.setQueryData(queryKeys.currentProfile(user.id), (current: any) => current ? { ...current, username: normalizedUsernameDraft } : current);

      const { error } = await supabase.from('profiles').update({ username: normalizedUsernameDraft }).eq('id', user.id);

      setSavingUsername(false);
      if (cancelled) return;

      if (error) {
        queryClient.setQueryData(queryKeys.currentProfile(user.id), previousProfile);
        if (error.code === '23505') setUsernameError('Username is already taken.');
        else setUsernameError(error.message);
        return;
      }

      usernameSavedRef.current = normalizedUsernameDraft;
      setUsernameDraft(normalizedUsernameDraft);
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

    setDefaultsError(null);
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSavingDefaults(true);
      const previousProfile = queryClient.getQueryData(queryKeys.currentProfile(user.id));
      queryClient.setQueryData(queryKeys.currentProfile(user.id), (current: any) => current ? {
        ...current,
        default_pomo_duration_minutes: parsedPomoMinutes,
        default_event_duration_minutes: parsedEventDurationMinutes,
        default_failure_cost_cents: parsedFailureCostCents,
        default_voucher_id: resolvedDefaultVoucherId,
        currency,
        timezone: timeZone,
        timezone_user_set: timeZoneUserSet,
      } : current);

      const { error } = await supabase.from('profiles').update({
        default_pomo_duration_minutes: parsedPomoMinutes,
        default_event_duration_minutes: parsedEventDurationMinutes,
        default_failure_cost_cents: parsedFailureCostCents,
        default_voucher_id: resolvedDefaultVoucherId,
        currency,
        timezone: timeZone,
        timezone_user_set: timeZoneUserSet,
      }).eq('id', user.id);

      setSavingDefaults(false);
      if (cancelled) return;

      if (error) {
        queryClient.setQueryData(queryKeys.currentProfile(user.id), previousProfile);
        setDefaultsError(error.message);
        return;
      }

      defaultsSavedRef.current = defaultsSnapshot;
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    user,
    resolvedDefaultVoucherId,
    defaultsSnapshot,
    parsedPomoMinutes,
    parsedEventDurationMinutes,
    parsedFailureCostCents,
    currency,
    timeZone,
    timeZoneUserSet,
    timeZoneOptions,
    pomoValidationError,
    failureCostValidationError,
    eventDurationValidationError,
    queryClient,
  ]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.manageFriendsHeader}>
        <TouchableOpacity
          style={styles.manageFriendsBackButton}
          onPress={() => router.back()}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="chevron-left" size={20} color={colors.text} />
          <Text style={styles.manageFriendsBackText}>Settings</Text>
        </TouchableOpacity>
        <Text style={styles.manageFriendsTitle}>Defaults</Text>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <View style={styles.card}>
            <View style={styles.defaultsContent}>
              <View style={styles.inlineField}>
                <Text style={styles.inlineFieldLabel}>Email</Text>
                <Text style={styles.inlineFieldValue} numberOfLines={1}>{profile?.email ?? ''}</Text>
              </View>

              <View style={styles.inlineField}>
                <Text style={styles.inlineFieldLabel}>Username</Text>
                <TextInput
                  style={styles.inlineFieldInput}
                  placeholder="username"
                  placeholderTextColor={colors.textSubtle}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={usernameDraft}
                  onChangeText={(value) => {
                    setUsernameDraft(value);
                    setUsernameError(null);
                  }}
                />
              </View>

              {savingUsername ? <Text style={styles.savingText}>Saving username...</Text> : null}
              {usernameError ? <Text style={styles.errorText}>{usernameError}</Text> : null}

              <TouchableOpacity
                style={styles.inlineFieldButton}
                onPress={() => setActivePicker('currency')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Select currency"
              >
                <Text style={styles.inlineFieldLabel} numberOfLines={1}>Currency</Text>
                <View style={styles.inlineFieldRight}>
                  <Text style={[styles.inlineFieldValue, styles.inlineFieldValueCompact]}>{currency}</Text>
                  <Feather name="chevron-down" size={16} color={colors.textMuted} />
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.inlineFieldButton}
                onPress={() => setActivePicker('timezone')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Select timezone"
              >
                <Text style={styles.inlineFieldLabel} numberOfLines={1}>Timezone</Text>
                <View style={styles.inlineFieldRight}>
                  <Text style={[styles.inlineFieldValue, styles.inlineFieldValueCompact]}>{formatTimeZoneLabel(timeZone)}</Text>
                  <Feather name="chevron-down" size={16} color={colors.textMuted} />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.card}>
            <View style={styles.defaultsContent}>
              <View style={styles.inlineField}>
                <Text style={styles.inlineFieldLabel}>Pomo duration (mins)</Text>
                <TextInput
                  style={styles.inlineFieldInput}
                  placeholder={`${POMO_MIN_MINUTES}`}
                  placeholderTextColor={colors.textSubtle}
                  keyboardType="number-pad"
                  value={defaultPomoInput}
                  onChangeText={(value) => {
                    setDefaultPomoInput(value);
                    setDefaultsError(null);
                  }}
                />
              </View>

              <View style={styles.inlineField}>
                <Text style={styles.inlineFieldLabel}>Time-bound duration (mins)</Text>
                <TextInput
                  style={styles.inlineFieldInput}
                  placeholder={`${EVENT_DURATION_FALLBACK_MINUTES}`}
                  placeholderTextColor={colors.textSubtle}
                  keyboardType="number-pad"
                  value={defaultEventDurationInput}
                  onChangeText={(value) => {
                    setDefaultEventDurationInput(value);
                    setDefaultsError(null);
                  }}
                />
              </View>

              <View style={styles.inlineField}>
                <Text style={styles.inlineFieldLabel}>{`Failure cost (${currencySymbol})`}</Text>
                <TextInput
                  style={styles.inlineFieldInput}
                  placeholder={`${failureCostBounds.minMajor}`}
                  placeholderTextColor={colors.textSubtle}
                  keyboardType={currency === 'INR' ? 'number-pad' : 'decimal-pad'}
                  value={defaultFailureCostInput}
                  onChangeText={(value) => {
                    setDefaultFailureCostInput(value);
                    setDefaultsError(null);
                  }}
                />
              </View>

              <TouchableOpacity
                style={styles.inlineFieldButton}
                onPress={() => setActivePicker('voucher')}
                activeOpacity={0.8}
                disabled={voucherLoading}
                accessibilityRole="button"
                accessibilityLabel="Select default voucher"
              >
                <Text style={styles.inlineFieldLabel}>Default voucher</Text>
                <View style={styles.inlineFieldRight}>
                  <Text style={styles.inlineFieldValue}>{voucherLoading ? 'Loading...' : defaultVoucherLabel}</Text>
                  <Feather name="chevron-down" size={16} color={colors.textMuted} />
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.inlineFieldButton}
                onPress={() => setActivePicker('taskSort')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Select task sort order"
              >
                <Text style={styles.inlineFieldLabel}>Task sorting</Text>
                <View style={styles.inlineFieldRight}>
                  <Text style={[styles.inlineFieldValue, styles.inlineFieldValueCompact]}>{taskSortLabel}</Text>
                  <Feather name="chevron-down" size={16} color={colors.textMuted} />
                </View>
              </TouchableOpacity>

              {savingDefaults ? <Text style={styles.savingText}>Saving...</Text> : null}
              {defaultsError ? <Text style={styles.errorText}>{defaultsError}</Text> : null}
            </View>
          </View>
        </View>

      </ScrollView>

      <Modal visible={activePicker !== null} transparent animationType="fade" onRequestClose={() => setActivePicker(null)}>
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
                    <Text style={[styles.pickerRowLabel, option.disabled ? styles.pickerRowLabelDisabled : null]}>{option.label}</Text>
                    {activePicker === 'taskSort' && taskSortMode === option.value ? (
                      <Feather name="check" size={16} color={colors.accentCyan} />
                    ) : null}
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
