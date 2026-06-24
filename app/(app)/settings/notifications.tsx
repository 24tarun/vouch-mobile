import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as AlarmKit from 'alarm-kit';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { useTheme } from '@/lib/ThemeContext';
import { useAuth } from '@/hooks/useAuth';
import { makeStyles } from '@/components/settings/styles';
import { SaveStatusTrafficLights, type SaveIndicatorPhase } from '@/components/settings/SaveStatusTrafficLights';
import { queryKeys } from '@/lib/query/keys';
import { supabase } from '@/lib/supabase';
import { syncLocalReminderNotificationsAsync } from '@/lib/notifications';
import {
  type NotificationSoundKey,
  getNotificationSoundConfigs,
  getNotificationSoundPreviewAsset,
  normalizeNotificationSoundKey,
} from '@/lib/notification-sounds';

type PickerType = 'notificationSound' | null;

interface PickerOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export default function SettingsNotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();

  const [activePicker, setActivePicker] = useState<PickerType>(null);
  const [notificationSoundKey, setNotificationSoundKey] = useState<NotificationSoundKey>('default');
  const [oneHourReminderEnabled, setOneHourReminderEnabled] = useState(true);
  const [tenMinuteReminderEnabled, setTenMinuteReminderEnabled] = useState(true);
  const [deadlineDueReminderEnabled, setDeadlineDueReminderEnabled] = useState(true);
  const [alarmStyleNotificationsEnabled, setAlarmStyleNotificationsEnabled] = useState(false);
  const [alarmKitAvailable, setAlarmKitAvailable] = useState(false);

  const [savingNotifications, setSavingNotifications] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [saveSuccessTick, setSaveSuccessTick] = useState(0);

  const [previewingSoundKey, setPreviewingSoundKey] = useState<NotificationSoundKey | null>(null);
  const previewSoundRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);

  const defaultsSavedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!profile || !user) return;
    const nextNotificationSoundKey = normalizeNotificationSoundKey(profile.notification_sound_key);
    const nextOneHourReminder = profile.deadline_one_hour_warning_enabled ?? true;
    const nextTenMinuteReminder = profile.deadline_final_warning_enabled ?? true;
    const nextDeadlineDueReminder = profile.deadline_due_warning_enabled ?? true;
    const nextAlarmStyleNotifications = profile.alarm_style_notifications_enabled ?? false;

    setNotificationSoundKey(nextNotificationSoundKey);
    setOneHourReminderEnabled(nextOneHourReminder);
    setTenMinuteReminderEnabled(nextTenMinuteReminder);
    setDeadlineDueReminderEnabled(nextDeadlineDueReminder);
    setAlarmStyleNotificationsEnabled(nextAlarmStyleNotifications);

    defaultsSavedRef.current = JSON.stringify({
      notificationSoundKey: nextNotificationSoundKey,
      oneHourReminderEnabled: nextOneHourReminder,
      tenMinuteReminderEnabled: nextTenMinuteReminder,
      deadlineDueReminderEnabled: nextDeadlineDueReminder,
      alarmStyleNotificationsEnabled: nextAlarmStyleNotifications,
    });

    setNotificationsError(null);
  }, [profile, user]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    void AlarmKit.isAlarmKitAvailableAsync().then(setAlarmKitAvailable);
  }, []);

  const notificationSoundLabel = useMemo(
    () =>
      getNotificationSoundConfigs().find((option) => option.key === notificationSoundKey)?.label
      ?? 'Default',
    [notificationSoundKey],
  );

  const notificationSoundPickerOptions: PickerOption[] = useMemo(
    () => getNotificationSoundConfigs().map((sound) => ({ label: sound.label, value: sound.key })),
    [],
  );

  const pickerOptions: PickerOption[] = useMemo(() => {
    if (activePicker === 'notificationSound') return notificationSoundPickerOptions;
    return [];
  }, [activePicker, notificationSoundPickerOptions]);

  const pickerTitle = useMemo(() => {
    if (activePicker === 'notificationSound') return 'Notification sound';
    return '';
  }, [activePicker]);

  const defaultsSnapshot = useMemo(
    () =>
      JSON.stringify({
        notificationSoundKey,
        oneHourReminderEnabled,
        tenMinuteReminderEnabled,
        deadlineDueReminderEnabled,
        alarmStyleNotificationsEnabled,
      }),
    [
      notificationSoundKey,
      oneHourReminderEnabled,
      tenMinuteReminderEnabled,
      deadlineDueReminderEnabled,
      alarmStyleNotificationsEnabled,
    ],
  );

  function applyPicker(value: string) {
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
    if (defaultsSavedRef.current === null) return;
    if (defaultsSnapshot === defaultsSavedRef.current) return;

    setNotificationsError(null);
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSavingNotifications(true);
      const previousProfile = queryClient.getQueryData(queryKeys.currentProfile(user.id));
      queryClient.setQueryData(queryKeys.currentProfile(user.id), (current: any) => current ? {
        ...current,
        notification_sound_key: notificationSoundKey,
        deadline_one_hour_warning_enabled: oneHourReminderEnabled,
        deadline_final_warning_enabled: tenMinuteReminderEnabled,
        deadline_due_warning_enabled: deadlineDueReminderEnabled,
        alarm_style_notifications_enabled: alarmStyleNotificationsEnabled,
      } : current);

      const { error } = await supabase
        .from('profiles')
        .update({
          notification_sound_key: notificationSoundKey,
          deadline_one_hour_warning_enabled: oneHourReminderEnabled,
          deadline_final_warning_enabled: tenMinuteReminderEnabled,
          deadline_due_warning_enabled: deadlineDueReminderEnabled,
          alarm_style_notifications_enabled: alarmStyleNotificationsEnabled,
        })
        .eq('id', user.id);

      setSavingNotifications(false);
      if (cancelled) return;

      if (error) {
        queryClient.setQueryData(queryKeys.currentProfile(user.id), previousProfile);
        setNotificationsError(error.message);
        return;
      }

      defaultsSavedRef.current = defaultsSnapshot;
      setSaveSuccessTick((c) => c + 1);
      void syncLocalReminderNotificationsAsync(user.id);
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    user,
    notificationSoundKey,
    oneHourReminderEnabled,
    tenMinuteReminderEnabled,
    deadlineDueReminderEnabled,
    alarmStyleNotificationsEnabled,
    defaultsSnapshot,
    queryClient,
  ]);

  const notificationsDirty = defaultsSavedRef.current !== null && defaultsSnapshot !== defaultsSavedRef.current;
  const saveIndicatorPhase: SaveIndicatorPhase = savingNotifications
    ? 'saving'
    : notificationsDirty
      ? 'dirty'
      : 'idle';

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
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={styles.manageFriendsTitle}>Notifications</Text>
          <SaveStatusTrafficLights phase={saveIndicatorPhase} successTick={saveSuccessTick} />
        </View>
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} showsVerticalScrollIndicator={false}>
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

              <View style={styles.toggleRow}>
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>Final call at deadline</Text>
                </View>
                <View style={styles.toggleSwitchWrap}>
                  <Switch
                    value={deadlineDueReminderEnabled}
                    onValueChange={setDeadlineDueReminderEnabled}
                    trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                    thumbColor={colors.text}
                  />
                </View>
              </View>

              <View style={[styles.toggleRow, !alarmKitAvailable && { opacity: 0.4 }]}>
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>Alarm style notifications</Text>
                  {!alarmKitAvailable && (
                    <Text style={styles.toggleSub}>
                      {Platform.OS === 'ios' ? 'Requires iOS 26 or later' : 'Coming soon on Android'}
                    </Text>
                  )}
                </View>
                <View style={styles.toggleSwitchWrap}>
                  <Switch
                    value={alarmStyleNotificationsEnabled}
                    onValueChange={setAlarmStyleNotificationsEnabled}
                    disabled={!alarmKitAvailable}
                    trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                    thumbColor={colors.text}
                  />
                </View>
              </View>

              {notificationsError ? <Text style={styles.errorText}>{notificationsError}</Text> : null}
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
