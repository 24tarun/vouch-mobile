import { useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';

import { useTheme } from '@/lib/ThemeContext';
import { useAuth } from '@/hooks/useAuth';
import { makeStyles } from '@/components/settings/styles';
import { UserAvatar } from '@/components/UserAvatar';
import { queryKeys } from '@/lib/query/keys';
import { supabase } from '@/lib/supabase';
import { removeProfileAvatar, uploadProfileAvatar } from '@/lib/profile-avatar';
import { AvatarCropModal } from '@/components/settings/AvatarCropModal';

export default function SettingsThemeScreen() {
  const router = useRouter();
  const { colors, theme, setTheme } = useTheme();
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [savingAlwaysShowActiveTasks, setSavingAlwaysShowActiveTasks] = useState(false);
  const [alwaysShowActiveTasksError, setAlwaysShowActiveTasksError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarPreviewUri, setAvatarPreviewUri] = useState<string | null>(null);
  const [avatarCropAsset, setAvatarCropAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const alwaysShowActiveTasks = profile?.always_show_active_tasks ?? false;
  const showFutureTasksMuted = !alwaysShowActiveTasks;

  function updateCachedAvatarPath(avatarPath: string | null) {
    if (!user) return;
    queryClient.setQueryData(queryKeys.currentProfile(user.id), (current: any) =>
      current ? { ...current, avatar_path: avatarPath } : current,
    );
  }

  async function uploadSelectedAvatar(asset: ImagePicker.ImagePickerAsset) {
    if (!user || avatarBusy) return;
    setAvatarPreviewUri(asset.uri);
    setAvatarBusy(true);
    const result = await uploadProfileAvatar({
      userId: user.id,
      currentAvatarPath: profile?.avatar_path,
      asset,
    });
    setAvatarBusy(false);
    setAvatarPreviewUri(null);

    if (!result.success) {
      Alert.alert('Could not update photo', result.error);
      return;
    }
    updateCachedAvatarPath(result.avatarPath);
  }

  async function chooseAvatarFromLibrary() {
    const current = await ImagePicker.getMediaLibraryPermissionsAsync();
    const permission = current.granted ? current : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo access needed', 'Allow photo access in Settings to choose a profile picture.');
      return;
    }

    const useCustomCropper = Platform.OS === 'ios';
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: !useCustomCropper,
      aspect: useCustomCropper ? undefined : [1, 1],
      shape: useCustomCropper ? undefined : 'oval',
      quality: 1,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (!result.canceled && result.assets[0]) {
      if (useCustomCropper) setAvatarCropAsset(result.assets[0]);
      else await uploadSelectedAvatar(result.assets[0]);
    }
  }

  async function takeAvatarPhoto() {
    const current = await ImagePicker.getCameraPermissionsAsync();
    const permission = current.granted ? current : await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access needed', 'Allow camera access in Settings to take a profile picture.');
      return;
    }

    const useCustomCropper = Platform.OS === 'ios';
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: !useCustomCropper,
      aspect: useCustomCropper ? undefined : [1, 1],
      shape: useCustomCropper ? undefined : 'oval',
      quality: 1,
    });
    if (!result.canceled && result.assets[0]) {
      if (useCustomCropper) setAvatarCropAsset(result.assets[0]);
      else await uploadSelectedAvatar(result.assets[0]);
    }
  }

  async function removeAvatar() {
    if (!user || avatarBusy) return;
    setAvatarBusy(true);
    const result = await removeProfileAvatar({
      userId: user.id,
      currentAvatarPath: profile?.avatar_path,
    });
    setAvatarBusy(false);
    if (!result.success) {
      Alert.alert('Could not remove photo', result.error);
      return;
    }
    updateCachedAvatarPath(null);
  }

  function showAvatarActions() {
    if (!user || avatarBusy) return;
    const hasAvatar = Boolean(profile?.avatar_path);

    if (Platform.OS === 'ios') {
      const options = hasAvatar
        ? ['Take Photo', 'Choose Photo', 'Remove Photo', 'Cancel']
        : ['Take Photo', 'Choose Photo', 'Cancel'];
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Profile Picture',
          options,
          cancelButtonIndex: options.length - 1,
          destructiveButtonIndex: hasAvatar ? 2 : undefined,
        },
        (buttonIndex) => {
          if (buttonIndex === 0) void takeAvatarPhoto();
          if (buttonIndex === 1) void chooseAvatarFromLibrary();
          if (hasAvatar && buttonIndex === 2) void removeAvatar();
        },
      );
      return;
    }

    Alert.alert('Profile Picture', undefined, [
      { text: 'Take Photo', onPress: () => { void takeAvatarPhoto(); } },
      { text: 'Choose Photo', onPress: () => { void chooseAvatarFromLibrary(); } },
      ...(hasAvatar
        ? [{ text: 'Remove Photo', style: 'destructive' as const, onPress: () => { void removeAvatar(); } }]
        : []),
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function handleAlwaysShowActiveTasksChange(nextValue: boolean) {
    if (!user || savingAlwaysShowActiveTasks) return;

    setSavingAlwaysShowActiveTasks(true);
    setAlwaysShowActiveTasksError(null);
    const previousProfile = queryClient.getQueryData(queryKeys.currentProfile(user.id));

    queryClient.setQueryData(queryKeys.currentProfile(user.id), (current: any) =>
      current ? { ...current, always_show_active_tasks: nextValue } : current,
    );

    const { error } = await supabase
      .from('profiles')
      .update({ always_show_active_tasks: nextValue })
      .eq('id', user.id);

    setSavingAlwaysShowActiveTasks(false);

    if (error) {
      queryClient.setQueryData(queryKeys.currentProfile(user.id), previousProfile);
      setAlwaysShowActiveTasksError(error.message);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AvatarCropModal
        asset={avatarCropAsset}
        onCancel={() => setAvatarCropAsset(null)}
        onChoose={async (asset) => {
          setAvatarCropAsset(null);
          await uploadSelectedAvatar(asset);
        }}
      />
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
        <Text style={styles.manageFriendsTitle}>Appearance</Text>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Profile Picture</Text>
          <View style={styles.card}>
            <View style={styles.profilePictureRow}>
              <UserAvatar
                username={profile?.username ?? 'User'}
                avatarPath={profile?.avatar_path}
                localUri={avatarPreviewUri}
                size={72}
                accessibilityLabel="Your profile picture"
              />
              <View style={styles.profilePictureContent}>
                <Text style={styles.profilePictureTitle}>{profile?.username ?? 'Your profile'}</Text>
                <TouchableOpacity
                  style={[styles.profilePictureButton, avatarBusy && styles.profilePictureButtonDisabled]}
                  onPress={showAvatarActions}
                  disabled={!user || avatarBusy}
                  activeOpacity={0.78}
                  accessibilityRole="button"
                  accessibilityLabel={profile?.avatar_path ? 'Change profile picture' : 'Add profile picture'}
                  accessibilityHint="Choose a photo, take a photo, or remove the current photo"
                >
                  {avatarBusy ? (
                    <ActivityIndicator size="small" color={colors.accentCyan} />
                  ) : (
                    <>
                      <Feather name="camera" size={15} color={colors.accentCyan} />
                      <Text style={styles.profilePictureButtonText}>
                        {profile?.avatar_path ? 'Change Photo' : 'Add Photo'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Appearance</Text>
          <View style={styles.appearanceCards}>
            <View style={styles.card}>
              <View style={styles.themeModeRow}>
                {[
                  { key: 'system', label: 'System' },
                  { key: 'dark', label: 'Dark' },
                  { key: 'light', label: 'Light' },
                ].map((mode) => {
                  const selected = theme === mode.key;
                  return (
                    <TouchableOpacity
                      key={mode.key}
                      style={[styles.themeModeButton, selected && styles.themeModeButtonActive]}
                      activeOpacity={0.85}
                      onPress={() => setTheme(mode.key as 'system' | 'dark' | 'light')}
                      accessibilityRole="button"
                      accessibilityLabel={`Set theme to ${mode.label}`}
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.themeModeButtonText, selected && styles.themeModeButtonTextActive]}>
                        {mode.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
            <View style={styles.card}>
              <View style={[styles.toggleRow, styles.standaloneToggleRow]}>
                <View style={styles.toggleTextWrap}>
                  <Text style={styles.toggleTitle}>Show future tasks with 0.50 opacity</Text>
                </View>
                <View style={styles.toggleSwitchWrap}>
                  <Switch
                    value={showFutureTasksMuted}
                    onValueChange={(showMuted) => {
                      void handleAlwaysShowActiveTasksChange(!showMuted);
                    }}
                    disabled={!user || savingAlwaysShowActiveTasks}
                    trackColor={{ false: colors.borderStrong, true: colors.accentCyan }}
                    thumbColor={colors.text}
                  />
                </View>
              </View>
              {alwaysShowActiveTasksError ? (
                <Text style={styles.errorText}>{alwaysShowActiveTasksError}</Text>
              ) : null}
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
